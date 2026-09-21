import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthFs, RunnerDeps, SignalHost } from '../../run-external-review.ts';
import {
  ArchiveError,
  AUTH_JSON_LABEL,
  USAGE,
  archiveEarlierAttempt,
  authJsonSecrets,
  authRefreshed,
  buildManifest,
  codexSpawn,
  findLeakedSecrets,
  guardScratch,
  main,
  parseArgs,
  planArchive,
  reconcileAuthAfterRun,
} from '../../run-external-review.ts';
import type { Manifest } from '../evidence.ts';
import { RECORDABLE_ENV, keylessUrl, outcomeOf, redactEnv } from '../evidence.ts';
import type { GeminiResult } from '../gemini.ts';
import { RequestTimeoutError } from '../gemini.ts';
import type { IngestionVerdict } from '../ingestion.ts';
import type { EchoVerdict } from '../integrity.ts';
import { sha256 } from '../payload.ts';
import { buildCodexScratch, removeScratch } from '../scratch.ts';

// A key-shaped-but-fake value: realistic enough that a naive substring check
// would find it if it leaked anywhere it should not.
const FAKE_KEY = 'AIzaSyDummyDummyDummyDummyDummyDummy12';

describe('parseArgs', () => {
  it('reads a unit and a family', () => {
    expect(parseArgs(['P5', 'codex'])).toEqual({ unit: 'P5', family: 'codex', dryRun: false });
    expect(parseArgs(['P10', 'gemini'])).toEqual({ unit: 'P10', family: 'gemini', dryRun: false });
  });

  it('reads --dry-run wherever it appears', () => {
    expect(parseArgs(['P5', 'codex', '--dry-run'])).toEqual({ unit: 'P5', family: 'codex', dryRun: true });
    expect(parseArgs(['--dry-run', 'P5', 'gemini'])).toEqual({ unit: 'P5', family: 'gemini', dryRun: true });
  });

  it('refuses an unknown family rather than defaulting to one', () => {
    expect(() => parseArgs(['P5', 'claude'])).toThrow(/unknown family "claude"/);
    expect(() => parseArgs(['P5', 'Codex'])).toThrow(/unknown family "Codex"/);
  });

  it('refuses a missing family with a usage line', () => {
    expect(() => parseArgs(['P5'])).toThrow(USAGE);
    expect(() => parseArgs([])).toThrow(USAGE);
  });

  it('refuses an unknown option and an extra argument', () => {
    expect(() => parseArgs(['P5', 'codex', '--force'])).toThrow(/unknown option "--force"/);
    expect(() => parseArgs(['P5', 'codex', 'gemini'])).toThrow(/unexpected argument "gemini"/);
  });
});

describe('findLeakedSecrets', () => {
  it('reports the NAME of a variable whose value appears in the contents, never the value', () => {
    const leaked = findLeakedSecrets(['## Findings\n', `the key was ${FAKE_KEY}\n`], { GEMINI_API_KEY: FAKE_KEY });

    expect(leaked).toEqual(['GEMINI_API_KEY']);
    expect(JSON.stringify(leaked)).not.toContain(FAKE_KEY.slice(0, 8));
  });

  it('matches a long value on its full text, or on its last 20 characters alone', () => {
    expect(findLeakedSecrets([`the key ${FAKE_KEY} in full`], { GEMINI_API_KEY: FAKE_KEY })).toEqual(['GEMINI_API_KEY']);
    // A copy missing its start is still caught: the tail is what is unique.
    expect(findLeakedSecrets([`tail ${FAKE_KEY.slice(-20)} only`], { GEMINI_API_KEY: FAKE_KEY })).toEqual([
      'GEMINI_API_KEY',
    ]);
    expect(findLeakedSecrets([`tail ${FAKE_KEY.slice(-19)} only`], { GEMINI_API_KEY: FAKE_KEY })).toEqual([]);
  });

  it('does not trip on a different OpenAI project key, though every such key begins "sk-proj-"', () => {
    const key = 'sk-proj-Qx7vN2mKp9Lw4Rt8Yz3Bc6Hd1Fj5Gs0Ae2Uo7Iy9Tr4We';
    const reply = 'The fixture uses the placeholder sk-proj-dummydummydummydummydummydummy as its key.';

    expect(findLeakedSecrets([reply], { OPENAI_API_KEY: key })).toEqual([]);
  });

  it('does not trip on another JWT that shares its header, though every such token begins "eyJhbGci"', () => {
    const otherJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJvdGhlciJ9.b3RoZXJzaWduYXR1cmVvdGhlcg';
    const reply = `A test fixture carries the id token ${otherJwt}.`;

    expect(findLeakedSecrets([reply], {}, authJsonSecrets(AUTH_JSON))).toEqual([]);
    expect(findLeakedSecrets([`${reply} ${ACCESS_TOKEN}`], {}, authJsonSecrets(AUTH_JSON))).toEqual([AUTH_JSON_LABEL]);
  });

  it('matches a value shorter than 24 characters only in full', () => {
    const env = { MY_SERVICE_TOKEN: 'svc-live-0f9e8d7c6b' };

    expect(findLeakedSecrets(['connects with svc-live-0f9e8d7'], env)).toEqual([]);
    expect(findLeakedSecrets(['ends in live-0f9e8d7c6b'], env)).toEqual([]);
    expect(findLeakedSecrets(['connects with svc-live-0f9e8d7c6b'], env)).toEqual(['MY_SERVICE_TOKEN']);
  });

  it('never reports a RECORDABLE_ENV name, whose value the manifest records by design', () => {
    const env: Record<string, string> = {};
    for (const name of RECORDABLE_ENV) env[name] = `/scratch/olympus-codex-scratch-${name}/config`;

    expect(findLeakedSecrets([JSON.stringify(env), Object.values(env).join('\n')], env)).toEqual([]);
  });

  it('never matches a value shorter than eight characters, from the environment or the credential file', () => {
    expect(findLeakedSecrets(['abc1234 appears here'], { SHORT_TOKEN: 'abc1234' }, ['abc1234'])).toEqual([]);
  });

  it('does not trip on a Windows path quoted in a reply, though APPDATA, TEMP and USERPROFILE begin it', () => {
    // The false positive measured on 2026-09-21: under default-deny, this
    // reply would have deleted the evidence of a run whose bundle was sent.
    const env = {
      APPDATA: 'C:\\Users\\Mike\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Mike\\AppData\\Local',
      TEMP: 'C:\\Users\\Mike\\AppData\\Local\\Temp',
      USERPROFILE: 'C:\\Users\\Mike',
      GEMINI_API_KEY: FAKE_KEY,
    };
    const reply = 'The scratch dir C:\\Users\\Mike\\AppData\\Local\\Temp\\olympus-codex-scratch-x is never removed.';

    expect(findLeakedSecrets([reply], env)).toEqual([]);
  });

  it('trips on any variable whose name says it is a secret, and not on one whose name does not', () => {
    const env = { MY_SERVICE_TOKEN: 'svc-live-0f9e8d7c6b', DATABASE_HOST: 'db-primary.internal' };
    const reply = 'connects to db-primary.internal using svc-live-0f9e8d7c6b';

    expect(findLeakedSecrets([reply], env)).toEqual(['MY_SERVICE_TOKEN']);
  });

  it('trips on a credential-file token in a session log, reporting a label and never the token', () => {
    const secrets = authJsonSecrets(AUTH_JSON);
    const session = `{"type":"session_meta","payload":{"note":"${REFRESH_TOKEN}"}}`;
    const leaked = findLeakedSecrets(['clean manifest', session], {}, secrets);

    expect(leaked).toEqual([AUTH_JSON_LABEL]);
    expect(JSON.stringify(leaked)).not.toContain(REFRESH_TOKEN.slice(0, 8));
  });

  it('reports nothing when no value appears', () => {
    expect(findLeakedSecrets(['a clean reply'], { GEMINI_API_KEY: FAKE_KEY, OPENAI_API_KEY: 'sk-proj-dummydummy' })).toEqual(
      [],
    );
  });

  it('reports every leaking name, across every file', () => {
    const env = { GEMINI_API_KEY: FAKE_KEY, OPENAI_API_KEY: 'sk-proj-dummydummy', CODEX_HOME: '/scratch/config' };
    const leaked = findLeakedSecrets(['clean manifest', `session ${env.OPENAI_API_KEY}`, `reply ${FAKE_KEY}`], env);

    expect([...leaked].sort()).toEqual(['GEMINI_API_KEY', 'OPENAI_API_KEY']);
  });

  it('skips a secret-named variable whose value is the path of an existing file: it names a credential, it is not one', () => {
    // A manifest records paths beside it, so matching the path would withhold
    // every run's evidence after the bundle was sent.
    const dir = mkdtempSync(join(tmpdir(), 'olympus-credentials-file-'));
    try {
      const credentialsFile = join(dir, 'key.json');
      writeFileSync(credentialsFile, '{}');
      const output = `the scratch was at ${join(dir, 'scratch')}`;

      expect(findLeakedSecrets([output], { GOOGLE_APPLICATION_CREDENTIALS: credentialsFile })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still searches a secret that merely starts with "/", since it names no existing file', () => {
    const env = { MY_SERVICE_TOKEN: '/notafile-SecretSecret123' };

    expect(findLeakedSecrets(['the token is /notafile-SecretSecret123'], env)).toEqual(['MY_SERVICE_TOKEN']);
  });

  it('never skips GEMINI_API_KEY or OPENAI_API_KEY, even when the value is the path of an existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'olympus-canary-path-'));
    try {
      const existing = join(dir, 'file');
      writeFileSync(existing, '');
      const output = `found ${existing}`;

      expect([...findLeakedSecrets([output], { GEMINI_API_KEY: existing, OPENAI_API_KEY: existing })].sort()).toEqual([
        'GEMINI_API_KEY',
        'OPENAI_API_KEY',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Shaped like the measured file (key paths only were measured, never values):
// three tokens, an account id, and a last_refresh timestamp.
const REFRESH_TOKEN = 'rt_dummyRefreshTokenDummyRefreshToken';
const AUTH_JSON = JSON.stringify({
  OPENAI_API_KEY: null,
  tokens: {
    id_token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJkdW1teSJ9.ZHVtbXlzaWduYXR1cmU',
    access_token: 'eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJkdW1teSJ9.YWNjZXNzc2lnbmF0dXJl',
    refresh_token: REFRESH_TOKEN,
    account_id: '00000000-0000-4000-8000-000000000000',
  },
  last_refresh: '2026-09-20T21:50:59.123456789Z',
  auth_mode: 'chatgpt',
});

const ACCESS_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJkdW1teSJ9.YWNjZXNzc2lnbmF0dXJl';

// The same file after Codex refreshed it: the same account, a rotated token.
const ROTATED_TOKEN = 'rt_rotatedNewTokenRotatedNewToken';
const REFRESHED_AUTH_JSON = AUTH_JSON.replace(REFRESH_TOKEN, ROTATED_TOKEN);

describe('authJsonSecrets', () => {
  it('collects every string under tokens and nothing else in the file', () => {
    expect(authJsonSecrets(AUTH_JSON)).toEqual([
      'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJkdW1teSJ9.ZHVtbXlzaWduYXR1cmU',
      ACCESS_TOKEN,
      REFRESH_TOKEN,
      '00000000-0000-4000-8000-000000000000',
    ]);
  });

  it('walks tokens recursively, and takes a top-level OPENAI_API_KEY only when it is a string', () => {
    const apiKeyMode = JSON.stringify({ OPENAI_API_KEY: 'sk-proj-dummydummydummy', auth_mode: 'apikey' });
    const nested = JSON.stringify({ tokens: { extra: { deeper: ['nested-token-value-1'] } }, note: 'not-a-token-value' });

    expect(authJsonSecrets(apiKeyMode)).toEqual(['sk-proj-dummydummydummy']);
    expect(authJsonSecrets(nested)).toEqual(['nested-token-value-1']);
  });

  it("no longer trips on a manifest whose timestamps share last_refresh's YYYY-MM- prefix (the measured collision)", () => {
    const manifest = JSON.stringify({ startedAt: '2026-09-21T14:45:24.000Z', endedAt: '2026-09-21T14:50:24.000Z' });

    expect(authJsonSecrets(AUTH_JSON)).not.toContain('2026-09-20T21:50:59.123456789Z');
    expect(findLeakedSecrets([manifest], {}, authJsonSecrets(AUTH_JSON))).toEqual([]);
  });

  it('trips on a string under tokens appearing in a reply, returning the auth.json label only', () => {
    const leaked = findLeakedSecrets([`## Findings\nthe token was ${ACCESS_TOKEN}\n`], {}, authJsonSecrets(AUTH_JSON));

    expect(leaked).toEqual([AUTH_JSON_LABEL]);
    expect(JSON.stringify(leaked)).not.toContain(ACCESS_TOKEN.slice(0, 8));
  });

  it('refuses a file that is not JSON without quoting any of its text', () => {
    const broken = `{"tokens":{"refresh_token":"${REFRESH_TOKEN}"`;

    expect(() => authJsonSecrets(broken)).toThrow('not valid JSON');
    expect(() => authJsonSecrets(broken)).not.toThrow(REFRESH_TOKEN.slice(0, 8));
  });
});

describe('authRefreshed', () => {
  it('is false for identical content and true when a token changed', () => {
    const refreshed = AUTH_JSON.replace(REFRESH_TOKEN, 'rt_dummyRotatedTokenDummyRotatedToken');

    expect(authRefreshed(Buffer.from(AUTH_JSON), Buffer.from(AUTH_JSON))).toBe(false);
    expect(authRefreshed(Buffer.from(AUTH_JSON), Buffer.from(refreshed))).toBe(true);
  });
});

describe('reconcileAuthAfterRun', () => {
  const REAL = '/home/maintainer/.codex/auth.json';
  const SCRATCH = '/tmp/olympus-codex-scratch-x/config/auth.json';
  // It shares no 20-character tail with REFRESH_TOKEN, so a hit on it can
  // only come from the post-run file.
  const ROTATED = ROTATED_TOKEN;
  const REFRESHED_JSON = REFRESHED_AUTH_JSON;

  /** An in-memory filesystem that records every write-side call in order. */
  function fakeFs(files: Record<string, string>): { fs: AuthFs; calls: string[]; files: Map<string, Uint8Array> } {
    const store = new Map<string, Uint8Array>(Object.entries(files).map(([path, text]) => [path, Buffer.from(text)]));
    const calls: string[] = [];
    const fs: AuthFs = {
      exists: (path) => store.has(path),
      readFile: (path) => {
        const data = store.get(path);
        if (data === undefined) throw new Error(`ENOENT ${path}`);
        return data;
      },
      writeFile: (path, data) => {
        calls.push(`write ${path}`);
        store.set(path, data);
      },
      rename: (from, to) => {
        calls.push(`rename ${from} -> ${to}`);
        const data = store.get(from);
        if (data === undefined) throw new Error(`ENOENT ${from}`);
        store.set(to, data);
        store.delete(from);
      },
      remove: (path) => {
        calls.push(`remove ${path}`);
        store.delete(path);
      },
    };
    return { fs, calls, files: store };
  }

  it('writes nothing when the scratch credential is unchanged', () => {
    const { fs, calls } = fakeFs({ [REAL]: AUTH_JSON, [SCRATCH]: AUTH_JSON });

    const result = reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), fs);

    expect(result).toEqual({ writeBack: 'unchanged', refreshedSecrets: [], leftoverTemp: null });
    expect(calls).toEqual([]);
  });

  it('writes a refreshed credential back through a sibling temp file renamed over the original', () => {
    const { fs, calls, files } = fakeFs({ [REAL]: AUTH_JSON, [SCRATCH]: REFRESHED_JSON });

    const result = reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), fs);

    expect(result.writeBack).toBe('written-back');
    expect(calls).toHaveLength(2);
    const temp = (calls[0] ?? '').replace(/^write /, '');
    expect(calls[0]).toMatch(/^write /);
    expect(dirname(temp)).toBe(dirname(REAL));
    expect(temp).not.toBe(REAL);
    expect(calls[1]).toBe(`rename ${temp} -> ${REAL}`);
    expect(Buffer.from(files.get(REAL) ?? []).toString()).toBe(REFRESHED_JSON);
  });

  it('searches for a refreshed token found only in the post-run file', () => {
    const { fs } = fakeFs({ [REAL]: AUTH_JSON, [SCRATCH]: REFRESHED_JSON });
    const output = `{"type":"session_meta","payload":{"note":"${ROTATED}"}}`;

    const result = reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), fs);

    expect(findLeakedSecrets([output], {}, authJsonSecrets(AUTH_JSON))).toEqual([]);
    expect(findLeakedSecrets([output], {}, [...authJsonSecrets(AUTH_JSON), ...result.refreshedSecrets])).toEqual([
      AUTH_JSON_LABEL,
    ]);
  });

  it('leaves the real file alone when it changed during the run, but still searches for the new tokens', () => {
    const someoneElses = AUTH_JSON.replace(REFRESH_TOKEN, 'rt_dummyInteractiveDummyInteractive');
    const { fs, calls } = fakeFs({ [REAL]: someoneElses, [SCRATCH]: REFRESHED_JSON });

    const result = reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), fs);

    expect(result.writeBack).toBe('real-file-changed');
    expect(result.refreshedSecrets).toContain(ROTATED);
    expect(calls).toEqual([]);
  });

  it('never writes back a post-run file that is not valid JSON', () => {
    const { fs, calls } = fakeFs({ [REAL]: AUTH_JSON, [SCRATCH]: '{"tokens":' });

    expect(reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), fs).writeBack).toBe('unparseable');
    expect(calls).toEqual([]);
  });

  it('removes the temp file and reports failure when the rename fails, leaving the original in place', () => {
    const { fs, calls, files } = fakeFs({ [REAL]: AUTH_JSON, [SCRATCH]: REFRESHED_JSON });
    const failing: AuthFs = {
      ...fs,
      rename: () => {
        throw new Error('EPERM');
      },
    };

    const result = reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), failing);

    expect(result.writeBack).toBe('write-failed');
    expect(result.leftoverTemp).toBeNull();
    expect(calls[1]).toMatch(/^remove /);
    expect(Buffer.from(files.get(REAL) ?? []).toString()).toBe(AUTH_JSON);
  });

  it('reports the temp file by PATH, never contents, when removing it fails too', () => {
    const { fs } = fakeFs({ [REAL]: AUTH_JSON, [SCRATCH]: REFRESHED_JSON });
    const failing: AuthFs = {
      ...fs,
      rename: () => {
        throw new Error('EPERM');
      },
      remove: () => {
        throw new Error('EBUSY');
      },
    };

    const result = reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), failing);

    expect(result.writeBack).toBe('write-failed');
    expect(result.leftoverTemp).not.toBeNull();
    expect(dirname(result.leftoverTemp ?? '')).toBe(dirname(REAL));
    expect(result.leftoverTemp).not.toContain(ROTATED.slice(0, 8));
  });

  it("never writes back a different account's credential", () => {
    const otherAccount = REFRESHED_JSON.replace('00000000-0000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111');
    const { fs, calls } = fakeFs({ [REAL]: AUTH_JSON, [SCRATCH]: otherAccount });

    const result = reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), fs);

    expect(result.writeBack).toBe('not-this-account');
    expect(result.refreshedSecrets).toContain(ROTATED);
    expect(calls).toEqual([]);
  });

  it('never writes back a file whose tokens object is empty or missing', () => {
    for (const scratch of [JSON.stringify({ tokens: {} }), JSON.stringify({ OPENAI_API_KEY: null })]) {
      const { fs, calls } = fakeFs({ [REAL]: AUTH_JSON, [SCRATCH]: scratch });

      expect(reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), fs).writeBack).toBe('not-this-account');
      expect(calls).toEqual([]);
    }
  });

  it('reports a failed read instead of throwing, so the run still writes its evidence', () => {
    const { fs, calls } = fakeFs({ [REAL]: AUTH_JSON, [SCRATCH]: REFRESHED_JSON });
    const scratchUnreadable: AuthFs = {
      ...fs,
      readFile: () => {
        throw new Error('EACCES');
      },
    };
    const realUnreadable: AuthFs = {
      ...fs,
      readFile: (path) => {
        if (path === REAL) throw new Error('EACCES');
        return fs.readFile(path);
      },
    };

    expect(reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), scratchUnreadable).writeBack).toBe('read-failed');
    const second = reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), realUnreadable);
    expect(second.writeBack).toBe('read-failed');
    expect(second.refreshedSecrets).toContain(ROTATED);
    expect(calls).toEqual([]);
  });
});

describe('codexSpawn', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hands the Codex child exactly one variable, CODEX_HOME, even when the parent holds both API keys', () => {
    vi.stubEnv('GEMINI_API_KEY', FAKE_KEY);
    vi.stubEnv('OPENAI_API_KEY', 'sk-proj-dummydummydummy');
    const scratch = { root: '/scratch', configHome: '/scratch/config', workDir: '/scratch/work' };

    const spawnSpec = codexSpawn(scratch, '/codex/bin/codex.js', '/scratch/last-message.txt');

    expect(Object.keys(spawnSpec.env)).toEqual(['CODEX_HOME']);
    expect(spawnSpec.env.CODEX_HOME).toBe('/scratch/config');
    expect(JSON.stringify(spawnSpec)).not.toContain(FAKE_KEY.slice(0, 8));
    expect(JSON.stringify(spawnSpec)).not.toContain('sk-proj-');
    // So the manifest's envOverrides is CODEX_HOME alone, recorded verbatim:
    // there is nothing left in it to redact.
    expect(redactEnv(spawnSpec.env)).toEqual({ CODEX_HOME: '/scratch/config' });
  });

  it('runs in the empty work dir and passes the reply path to codex exec', () => {
    const scratch = { root: '/scratch', configHome: '/scratch/config', workDir: '/scratch/work' };

    const spawnSpec = codexSpawn(scratch, '/codex/bin/codex.js', '/scratch/last-message.txt');

    expect(spawnSpec.command).toBe(process.execPath);
    expect(spawnSpec.cwd).toBe('/scratch/work');
    expect(spawnSpec.args[0]).toBe('/codex/bin/codex.js');
    expect(spawnSpec.args).toContain('/scratch/last-message.txt');
  });
});

const COMPLETE: IngestionVerdict = { kind: 'complete', inputTokens: 127_096, floor: 80_732 };
const VERIFIED: EchoVerdict = { kind: 'verified' };

function codexFacts(overrides: Partial<Omit<Manifest, 'outcome'>> = {}): Omit<Manifest, 'outcome'> {
  return {
    unit: 'P5',
    family: 'codex',
    invocation: {
      kind: 'cli',
      command: '/usr/bin/node',
      argv: ['codex.js', 'exec'],
      envOverrides: redactEnv({ CODEX_HOME: '/scratch/config' }),
    },
    cleanRoom: { configHome: ['auth.json'], workDir: [] },
    exitCode: 0,
    timedOut: false,
    startedAt: '2026-09-21T00:00:00.000Z',
    endedAt: '2026-09-21T00:05:00.000Z',
    durationMs: 300_000,
    cliVersion: '0.155.1',
    modelReported: 'gpt-6-astra',
    tokenUsage: { input_tokens: 127_096 },
    payloadSha256: 'a'.repeat(64),
    payloadBytes: 403_661,
    ingestion: COMPLETE,
    postRunFileCount: 332,
    recordedApprovalPolicy: 'never',
    bundleSha256: 'b'.repeat(64),
    integrity: VERIFIED,
    replySha256: 'c'.repeat(64),
    ...overrides,
  };
}

function geminiFacts(overrides: Partial<Omit<Manifest, 'outcome'>> = {}): Omit<Manifest, 'outcome'> {
  return codexFacts({
    family: 'gemini',
    invocation: {
      kind: 'api',
      method: 'POST',
      url: keylessUrl('https://generativelanguage.googleapis.com/v1beta/models/m:generateContent'),
      modelRequested: 'gemini-3.1-pro-preview',
      headerNames: ['x-goog-api-key', 'content-type'],
    },
    cleanRoom: null,
    cliVersion: 'api:generativelanguage/v1beta',
    postRunFileCount: null,
    recordedApprovalPolicy: null,
    ...overrides,
  });
}

describe('buildManifest', () => {
  it('carries every fact through unchanged and adds the derived outcome', () => {
    const facts = codexFacts();

    expect(buildManifest(facts)).toEqual({ ...facts, outcome: 'counted' });
  });

  it('reproduces its own outcome: outcomeOf(manifest) equals manifest.outcome on every outcome path', () => {
    const ingestions: readonly IngestionVerdict[] = [
      COMPLETE,
      { kind: 'short', inputTokens: 24_181, floor: 80_732 },
      { kind: 'unreported', floor: 80_732 },
    ];
    const integrities: readonly EchoVerdict[] = [
      VERIFIED,
      { kind: 'failed', absent: ['endNonce'] },
      { kind: 'unverified', absent: ['endNonce'] },
    ];
    const policies = ['never', 'on-request', null];
    const seen = new Set<string>();

    for (const facts of [codexFacts, geminiFacts]) {
      for (const exitCode of [0, 1, null]) {
        for (const timedOut of [false, true]) {
          for (const recordedApprovalPolicy of policies) {
            for (const ingestion of ingestions) {
              for (const integrity of integrities) {
                const manifest = buildManifest(facts({ exitCode, timedOut, recordedApprovalPolicy, ingestion, integrity }));
                // Through JSON, as a verifier reading the committed file would.
                const reread = JSON.parse(JSON.stringify(manifest)) as Manifest; // JSON-parse boundary: round-trip of a Manifest.

                expect(outcomeOf(manifest)).toBe(manifest.outcome);
                expect(outcomeOf(reread)).toBe(manifest.outcome);
                seen.add(manifest.outcome);
              }
            }
          }
        }
      }
    }
    // Every one of the four outcomes was exercised.
    expect([...seen].sort()).toEqual(['FAILED', 'INTEGRITY_FAILED', 'INTEGRITY_UNVERIFIED', 'counted']);
  });

  it('ignores an outcome smuggled in on a wider object and derives its own', () => {
    const smuggled = { ...codexFacts({ exitCode: 1 }), outcome: 'counted' as const };

    expect(buildManifest(smuggled).outcome).toBe('FAILED');
  });

  it('never yields counted for a codex run whose recorded approval policy is anything but "never"', () => {
    for (const recordedApprovalPolicy of ['on-request', 'untrusted', 'on-failure', 'Never', '', null]) {
      const manifest = buildManifest(codexFacts({ recordedApprovalPolicy }));

      expect(manifest.outcome).toBe('FAILED');
      // Codex's real exit code is what the manifest records, with no synthetic
      // stand-in; the recorded policy beside it is what the outcome turns on.
      expect(manifest.exitCode).toBe(0);
      expect(manifest.recordedApprovalPolicy).toBe(recordedApprovalPolicy);
      expect(outcomeOf(manifest)).toBe('FAILED');
    }
  });

  it('does not apply the approval-policy rule to gemini, whose api transport records none', () => {
    expect(buildManifest(geminiFacts()).outcome).toBe('counted');
  });
});

const STEM = '2026-09-21-P5-driver-claude-code-review-codex';
const CURRENT = [`${STEM}.md`, `${STEM}.run.json`, `${STEM}.session.jsonl`];
const FAILED_MANIFEST = JSON.stringify({ unit: 'P5', family: 'codex', outcome: 'FAILED' });
const COUNTED_MANIFEST = JSON.stringify({ unit: 'P5', family: 'codex', outcome: 'counted' });

describe('planArchive', () => {
  it('refuses to plan anything over a manifest that records a counted review', () => {
    expect(planArchive(CURRENT, STEM, COUNTED_MANIFEST)).toEqual({ kind: 'counted' });
  });

  it("moves a failed attempt's three files to .attempt-1, keeping each extension", () => {
    expect(planArchive(CURRENT, STEM, FAILED_MANIFEST)).toEqual({
      kind: 'archive',
      moves: [
        { from: `${STEM}.md`, to: `${STEM}.attempt-1.md` },
        { from: `${STEM}.run.json`, to: `${STEM}.attempt-1.run.json` },
        { from: `${STEM}.session.jsonl`, to: `${STEM}.attempt-1.session.jsonl` },
      ],
    });
  });

  it('uses .attempt-2 when .attempt-1 is already taken, and the lowest free number after that', () => {
    const attempt1 = [`${STEM}.attempt-1.run.json`, `${STEM}.attempt-1.session.jsonl`];
    const attempt3 = [`${STEM}.attempt-3.run.json`];

    expect(planArchive([...CURRENT, ...attempt1], STEM, FAILED_MANIFEST)).toMatchObject({
      moves: [{ to: `${STEM}.attempt-2.md` }, { to: `${STEM}.attempt-2.run.json` }, { to: `${STEM}.attempt-2.session.jsonl` }],
    });
    expect(planArchive([...CURRENT, ...attempt1, ...attempt3], STEM, FAILED_MANIFEST)).toMatchObject({
      moves: [{ to: `${STEM}.attempt-2.md` }, { to: `${STEM}.attempt-2.run.json` }, { to: `${STEM}.attempt-2.session.jsonl` }],
    });
  });

  it('archives outputs that have no manifest at all', () => {
    expect(planArchive([`${STEM}.md`], STEM, null)).toEqual({
      kind: 'archive',
      moves: [{ from: `${STEM}.md`, to: `${STEM}.attempt-1.md` }],
    });
  });

  it('refuses, and plans no move, over a manifest it cannot read: the guard fails closed', () => {
    const unreadable = [
      `\uFEFF${COUNTED_MANIFEST}`, // a BOM from a Windows editor
      `<<<<<<< HEAD\n${COUNTED_MANIFEST}\n=======\n${FAILED_MANIFEST}\n>>>>>>> branch\n`, // conflict markers
      '{"outcome": "counted"', // truncated
      JSON.stringify({ unit: 'P5' }), // no outcome
      JSON.stringify({ outcome: 1 }), // not a string outcome
      '[]',
    ];
    for (const text of unreadable) {
      expect(planArchive(CURRENT, STEM, text)).toEqual({ kind: 'unreadable' });
    }
  });

  it('plans nothing when no earlier output exists, and ignores the other family', () => {
    const otherFamily = CURRENT.map((name) => name.replace('-review-codex', '-review-gemini'));

    expect(planArchive(otherFamily, STEM, null)).toEqual({ kind: 'archive', moves: [] });
  });

  it('gives an archived reply a name the shipped skills do not read as the current review', () => {
    // triage-review and run-review read exactly
    // docs/reviews/<date>-<UNIT>-<slug>-review-<family>.md and .run.json.
    const currentReply = /^\d{4}-\d{2}-\d{2}-P5-.+-review-(codex|gemini)\.md$/;
    const currentManifest = /^\d{4}-\d{2}-\d{2}-P5-.+-review-(codex|gemini)\.run\.json$/;
    const plan = planArchive(CURRENT, STEM, FAILED_MANIFEST);
    const archived = plan.kind === 'archive' ? plan.moves.map((move) => move.to) : [];

    expect(currentReply.test(`${STEM}.md`)).toBe(true);
    expect(archived).toContain(`${STEM}.attempt-1.md`);
    for (const name of archived) {
      expect(currentReply.test(name), name).toBe(false);
      expect(currentManifest.test(name), name).toBe(false);
    }
  });
});

describe('archiveEarlierAttempt', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'olympus-archive-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeRun(manifest: string): void {
    writeFileSync(join(dir, `${STEM}.md`), 'the reply');
    writeFileSync(join(dir, `${STEM}.run.json`), manifest);
    writeFileSync(join(dir, `${STEM}.session.jsonl`), '{"type":"session_meta"}\n');
  }

  it('refuses over a counted review and renames nothing', () => {
    writeRun(COUNTED_MANIFEST);

    expect(archiveEarlierAttempt(dir, STEM, false)).toEqual({ kind: 'counted' });
    expect(readdirSync(dir).sort()).toEqual([...CURRENT].sort());
  });

  it("renames a failed run's three files to .attempt-1, leaving the fixed names free for the rerun", () => {
    writeRun(FAILED_MANIFEST);

    const plan = archiveEarlierAttempt(dir, STEM, false);

    expect(plan).toMatchObject({ kind: 'archive' });
    expect(readdirSync(dir).sort()).toEqual(
      [`${STEM}.attempt-1.md`, `${STEM}.attempt-1.run.json`, `${STEM}.attempt-1.session.jsonl`].sort(),
    );
    expect(readFileSync(join(dir, `${STEM}.attempt-1.run.json`), 'utf8')).toBe(FAILED_MANIFEST);
  });

  it('archives a second failed attempt as .attempt-2 beside the first', () => {
    writeRun(FAILED_MANIFEST);
    archiveEarlierAttempt(dir, STEM, false);
    writeRun(FAILED_MANIFEST);

    archiveEarlierAttempt(dir, STEM, false);

    expect(readdirSync(dir).filter((name) => name.includes('.attempt-2.')).sort()).toEqual(
      [`${STEM}.attempt-2.md`, `${STEM}.attempt-2.run.json`, `${STEM}.attempt-2.session.jsonl`].sort(),
    );
  });

  it('renames nothing in a dry run, but reports what it would move', () => {
    writeRun(FAILED_MANIFEST);

    const plan = archiveEarlierAttempt(dir, STEM, true);

    expect(plan).toMatchObject({ kind: 'archive', moves: [{ to: `${STEM}.attempt-1.md` }, {}, {}] });
    expect(readdirSync(dir).sort()).toEqual([...CURRENT].sort());
  });

  it('refuses over an unreadable manifest and renames nothing', () => {
    writeRun(`\uFEFF${COUNTED_MANIFEST}`);

    expect(archiveEarlierAttempt(dir, STEM, false)).toEqual({ kind: 'unreadable' });
    expect(readdirSync(dir).sort()).toEqual([...CURRENT].sort());
  });

  it('names what was already renamed when a rename fails part-way', () => {
    writeRun(FAILED_MANIFEST);
    let calls = 0;
    const failSecond = (from: string, to: string): void => {
      calls += 1;
      if (calls === 2) throw new Error('EBUSY');
      renameSync(from, to);
    };

    let caught: unknown;
    try {
      archiveEarlierAttempt(dir, STEM, false, failSecond);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ArchiveError);
    expect(caught instanceof ArchiveError ? caught.renamed : []).toEqual([
      { from: `${STEM}.md`, to: `${STEM}.attempt-1.md` },
    ]);
  });
});

describe('guardScratch', () => {
  const scratch = { root: '/tmp/olympus-codex-scratch-abc', configHome: '/tmp/olympus-codex-scratch-abc/config', workDir: '/tmp/olympus-codex-scratch-abc/work' };

  function fakeHost(): { host: SignalHost; fire: (event: string) => void; exits: number[]; listening: () => number } {
    const listeners = new Map<string, Array<() => void>>();
    const exits: number[] = [];
    const host: SignalHost = {
      on: (event, listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      off: (event, listener) => {
        listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== listener));
      },
      exit: (code) => {
        exits.push(code);
      },
    };
    const fire = (event: string): void => {
      for (const listener of listeners.get(event) ?? []) listener();
    };
    const listening = (): number => [...listeners.values()].reduce((sum, list) => sum + list.length, 0);
    return { host, fire, exits, listening };
  }

  it('removes exactly the scratch it holds on Ctrl-C, then exits 130', () => {
    const { host, fire, exits } = fakeHost();
    const removed: string[] = [];
    guardScratch(scratch, (s) => removed.push(s.root), host);

    fire('SIGINT');

    expect(removed).toEqual([scratch.root]);
    expect(exits).toEqual([130]);
  });

  it('removes it on SIGTERM (exit 143) and on process exit', () => {
    const term = fakeHost();
    const removedOnTerm: string[] = [];
    guardScratch(scratch, (s) => removedOnTerm.push(s.root), term.host);
    term.fire('SIGTERM');

    const exit = fakeHost();
    const removedOnExit: string[] = [];
    guardScratch(scratch, (s) => removedOnExit.push(s.root), exit.host);
    exit.fire('exit');

    expect(removedOnTerm).toEqual([scratch.root]);
    expect(term.exits).toEqual([143]);
    expect(removedOnExit).toEqual([scratch.root]);
    expect(exit.exits).toEqual([]);
  });

  it('stops listening once released', () => {
    const { host, fire, listening } = fakeHost();
    const removed: string[] = [];
    const guard = guardScratch(scratch, (s) => removed.push(s.root), host);

    expect(listening()).toBe(3);
    guard.release();
    fire('SIGINT');

    expect(listening()).toBe(0);
    expect(removed).toEqual([]);
  });

  it('once the bundle is being sent, reports the egress, writes the credential back, and only then removes the scratch', () => {
    const { host, fire, exits } = fakeHost();
    const steps: string[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      steps.push(`print ${String(line)}`);
    });
    try {
      const guard = guardScratch(scratch, () => steps.push('remove'), host);
      guard.sending('codex', () => steps.push('write-back'));

      fire('SIGTERM');

      expect(steps).toHaveLength(3);
      expect(steps[0]).toMatch(/^print .*bundle WAS sent to OpenAI/);
      expect(steps[0]).toMatch(/no evidence was written because the run was interrupted/i);
      expect(steps.slice(1)).toEqual(['write-back', 'remove']);
      expect(exits).toEqual([143]);
    } finally {
      errors.mockRestore();
    }
  });

  it('before the bundle is sent, a signal removes the scratch without claiming any egress', () => {
    const { host, fire } = fakeHost();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const removed: string[] = [];
      guardScratch(scratch, (s) => removed.push(s.root), host);

      fire('SIGINT');

      expect(removed).toEqual([scratch.root]);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

// main, wired to spies. These are the executable form of the property the
// runner exists for: nothing is sent, written or renamed before every refusal
// has had its chance, and a dry run contacts no one.
describe('main: egress order', () => {
  const UNIT = 'Z9';
  const PROMPT = `2026-09-21-${UNIT}-probe-review-prompt.txt`;
  const BUNDLE = `2026-09-21-${UNIT}-probe-review-bundle.txt`;
  const NONCE = '0123456789abcdef0123456789abcdef';
  const ECHO = `base 1111111 head 2222222 last section packages/core/src/a.ts nonce ${NONCE}`;
  const EGRESS = /^(runCli|callGemini)$/;
  const WRITE = /^(write|rename|authFs\.(write|rename|remove)) /;
  /** What the stand-in `git log` reports as the commit that last touched the artifacts. */
  const LAST_TOUCHED = '4a1f0c3e9b8d7a6f5e4d3c2b1a0f9e8d7c6b5a49';

  type Family = 'codex' | 'gemini';

  interface Options {
    readonly nonce?: boolean;
    readonly untracked?: boolean;
    readonly modified?: boolean;
    /** The artifacts' last commit is not on the upstream. */
    readonly unpushed?: boolean;
    /** The branch has no upstream at all. */
    readonly noUpstream?: boolean;
    readonly platform?: NodeJS.Platform;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly contaminate?: boolean;
    /** Appended to the reviewer's reply. */
    readonly replyExtra?: string;
    readonly authReadThrows?: boolean;
    /** The stand-in makes the -o path a directory, so reading the reply throws (EISDIR). */
    readonly replyReadThrows?: boolean;
    readonly removeThrows?: boolean;
    /** The stand-in Gemini call rejects with this. */
    readonly geminiRejects?: () => Error;
    /** The signal the maintainer sends while the vendor call is in flight. The
     *  stand-in Codex refreshes its credential first. The call never settles. */
    readonly interrupt?: 'SIGINT' | 'SIGTERM';
  }

  interface Harness {
    readonly deps: RunnerDeps;
    readonly calls: string[];
    readonly gitCalls: string[];
    readonly reviews: string;
    readonly home: string;
    /** Signal listeners still registered on the stand-in process. */
    readonly listening: () => number;
  }

  const temps: string[] = [];

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function harness(options: Options = {}): Harness {
    const root = mkdtempSync(join(tmpdir(), 'olympus-main-test-'));
    temps.push(root);
    const reviews = join(root, 'docs', 'reviews');
    mkdirSync(reviews, { recursive: true });
    writeFileSync(join(reviews, PROMPT), 'Review the bundle.\n');
    const tail = options.nonce === false ? [] : [`=== BUNDLE END === ${NONCE}`];
    writeFileSync(
      join(reviews, BUNDLE),
      ['BASE: 1111111', 'HEAD: 2222222', '', '===== packages/core/src/a.ts =====', 'export const a = 1;', ...tail, ''].join('\n'),
    );
    const install = join(root, 'codex-install');
    mkdirSync(join(install, 'bin'), { recursive: true });
    writeFileSync(join(install, 'bin', 'codex.js'), '');
    writeFileSync(join(install, 'package.json'), JSON.stringify({ version: '0.0.0-test' }));
    const home = join(root, 'home');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'auth.json'), AUTH_JSON);

    const calls: string[] = [];
    const gitCalls: string[] = [];
    const listeners = new Map<string, Array<() => void>>();
    const fire = (event: string): void => {
      for (const listener of listeners.get(event) ?? []) listener();
    };
    const listening = (): number => [...listeners.values()].reduce((sum, list) => sum + list.length, 0);
    const reply = `## Findings\n${ECHO}\n${options.replyExtra ?? ''}`;
    const deps: RunnerDeps = {
      repoRoot: root,
      homeDir: home,
      env: { CODEX_JS: join(install, 'bin', 'codex.js'), GEMINI_API_KEY: FAKE_KEY, ...options.env },
      platform: options.platform ?? 'win32',
      git: (_cwd, args) => {
        gitCalls.push(args.join(' '));
        if (args[0] === 'rev-parse' && args.includes('@{u}')) {
          if (options.noUpstream === true) throw new Error("fatal: no upstream configured for branch 'test-branch'");
          return 'origin/test-branch\n';
        }
        if (args[0] === 'rev-parse') return 'test-branch\n';
        if (args[0] === 'ls-files' && options.untracked === true) throw new Error('did not match any file known to git');
        if (args[0] === 'status' && options.modified === true) return ` M ${args[3] ?? ''}\n`;
        if (args[0] === 'log') return `${LAST_TOUCHED}\n`;
        // `merge-base --is-ancestor` exits 1 when it is not, which execFileSync throws.
        if (args[0] === 'merge-base' && options.unpushed === true) throw new Error('Command failed: git merge-base');
        return '';
      },
      runCli: (spawnOptions) => {
        calls.push('runCli');
        // A stand-in Codex: the reply to -o, and a rollout log shaped like the measured one.
        const out = spawnOptions.args[spawnOptions.args.indexOf('-o') + 1] ?? '';
        const codexHome = spawnOptions.env.CODEX_HOME ?? '';
        if (options.interrupt !== undefined) {
          writeFileSync(join(codexHome, 'auth.json'), REFRESHED_AUTH_JSON);
          fire(options.interrupt);
          return new Promise<never>(() => undefined);
        }
        if (options.replyReadThrows === true) mkdirSync(out);
        else writeFileSync(out, reply);
        const sessions = join(codexHome, 'sessions', '2026', '09', '21');
        mkdirSync(sessions, { recursive: true });
        writeFileSync(
          join(sessions, 'rollout-test.jsonl'),
          [
            { type: 'turn_context', payload: { approval_policy: 'never' } },
            { type: 'world_state', payload: { state: { collaboration_mode: { model: 'test-model' } } } },
            { type: 'token_usage_record', payload: { usage: { input_tokens: 1000 } } },
          ]
            .map((record) => JSON.stringify(record))
            .join('\n'),
        );
        return Promise.resolve({ exitCode: 0, timedOut: false, stdout: '', stderr: '' });
      },
      callGemini: () => {
        calls.push('callGemini');
        if (options.interrupt !== undefined) {
          fire(options.interrupt);
          return new Promise<never>(() => undefined);
        }
        if (options.geminiRejects !== undefined) return Promise.reject(options.geminiRejects());
        const result: GeminiResult = {
          reply,
          modelVersion: 'test-model',
          promptTokenCount: 1000,
          responseId: 'resp-test',
          usageMetadata: { promptTokenCount: 1000 },
          complete: true,
          incompleteReason: null,
        };
        return Promise.resolve(result);
      },
      buildScratch: (source) => {
        calls.push('buildScratch');
        const scratch = buildCodexScratch(source);
        temps.push(scratch.root);
        if (options.contaminate === true) writeFileSync(join(scratch.configHome, 'AGENTS.md'), 'contaminant');
        return scratch;
      },
      removeScratch: (scratch) => {
        calls.push('removeScratch');
        // The root stays registered in `temps`, so afterEach still removes it.
        if (options.removeThrows === true) throw new Error('EBUSY: resource busy or locked');
        removeScratch(scratch);
      },
      writeFile: (path, content) => {
        calls.push(`write ${basename(path)}`);
        writeFileSync(path, content);
      },
      rename: (from, to) => {
        calls.push(`rename ${basename(from)}`);
        renameSync(from, to);
      },
      authFs: {
        exists: (path) => existsSync(path),
        readFile: (path) => {
          if (options.authReadThrows === true) throw new Error('EACCES');
          return readFileSync(path);
        },
        writeFile: (path) => {
          calls.push(`authFs.write ${path}`);
        },
        rename: (from) => {
          calls.push(`authFs.rename ${from}`);
        },
        remove: (path) => {
          calls.push(`authFs.remove ${path}`);
        },
      },
      signals: {
        on: (event, listener) => {
          listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        },
        off: (event, listener) => {
          listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== listener));
        },
        exit: (code) => {
          calls.push(`exit ${String(code)}`);
        },
      },
    };
    return { deps, calls, gitCalls, reviews, home, listening };
  }

  /** An earlier FAILED attempt, so any archive that ran would show as a rename. */
  function earlierFailedAttempt(h: Harness, family: Family): void {
    const stem = `2026-09-21-${UNIT}-probe-review-${family}`;
    writeFileSync(join(h.reviews, `${stem}.md`), 'an earlier reply');
    writeFileSync(join(h.reviews, `${stem}.run.json`), JSON.stringify({ outcome: 'FAILED' }));
    writeFileSync(join(h.reviews, `${stem}.session.jsonl`), '');
  }

  function expectNothingSentOrWritten(h: Harness, listingBefore: readonly string[]): void {
    expect(h.calls.filter((call) => EGRESS.test(call))).toEqual([]);
    expect(h.calls.filter((call) => WRITE.test(call))).toEqual([]);
    expect(readdirSync(h.reviews).sort()).toEqual([...listingBefore].sort());
    // A scratch that was built was removed: the credential copy did not outlive the refusal.
    if (h.calls.includes('buildScratch')) expect(h.calls).toContain('removeScratch');
  }

  const refusals: ReadonlyArray<{
    readonly name: string;
    readonly families: readonly Family[];
    readonly options?: Options;
    readonly setup?: (h: Harness, family: Family) => void;
  }> = [
    { name: 'the review artifacts are missing', families: ['codex', 'gemini'], setup: (h) => {
        rmSync(join(h.reviews, PROMPT));
      },
    },
    { name: 'an artifact is not committed', families: ['codex', 'gemini'], options: { untracked: true } },
    { name: 'an artifact has uncommitted changes', families: ['codex', 'gemini'], options: { modified: true } },
    { name: 'the artifacts are committed but not pushed', families: ['codex', 'gemini'], options: { unpushed: true } },
    { name: 'the branch has no upstream', families: ['codex', 'gemini'], options: { noUpstream: true } },
    { name: 'the bundle has no end nonce', families: ['codex', 'gemini'], options: { nonce: false } },
    {
      name: 'a counted review is present',
      families: ['codex', 'gemini'],
      setup: (h, family) => {
        writeFileSync(join(h.reviews, `2026-09-21-${UNIT}-probe-review-${family}.run.json`), JSON.stringify({ outcome: 'counted' }));
      },
    },
    {
      name: 'an unreadable manifest is present',
      families: ['codex', 'gemini'],
      setup: (h, family) => {
        writeFileSync(join(h.reviews, `2026-09-21-${UNIT}-probe-review-${family}.run.json`), `\uFEFF{"outcome":"counted"}`);
      },
    },
    { name: 'the platform is not Windows', families: ['codex'], options: { platform: 'linux' } },
    { name: 'the Codex entry point cannot be resolved', families: ['codex'], options: { env: { CODEX_JS: join(tmpdir(), 'no-such-codex', 'codex.js') } } },
    { name: 'there is no Codex credential', families: ['codex'], setup: (h) => {
        rmSync(join(h.home, '.codex', 'auth.json'));
      },
    },
    { name: 'the clean room fails', families: ['codex'], options: { contaminate: true } },
    { name: 'GEMINI_API_KEY is missing', families: ['gemini'], options: { env: { GEMINI_API_KEY: undefined } } },
  ];

  for (const refusal of refusals) {
    for (const family of refusal.families) {
      it(`${family}: refuses when ${refusal.name}, with no vendor call and no write or rename`, async () => {
        const h = harness(refusal.options);
        earlierFailedAttempt(h, family);
        refusal.setup?.(h, family);
        const listingBefore = readdirSync(h.reviews);

        expect(await main([UNIT, family], h.deps)).toBe(1);
        expectNothingSentOrWritten(h, listingBefore);
      });
    }
  }

  for (const family of ['codex', 'gemini'] as const) {
    it(`${family}: --dry-run contacts no one and writes or renames nothing, even with an attempt to archive`, async () => {
      const h = harness();
      earlierFailedAttempt(h, family);
      const listingBefore = readdirSync(h.reviews);

      expect(await main([UNIT, family, '--dry-run'], h.deps)).toBe(0);
      expectNothingSentOrWritten(h, listingBefore);
    });

    it(`${family}: a run that passes every refusal archives, then sends once, then writes its evidence`, async () => {
      const h = harness();
      earlierFailedAttempt(h, family);
      const vendor = family === 'codex' ? 'runCli' : 'callGemini';

      expect(await main([UNIT, family], h.deps)).toBe(0);

      const renames = h.calls.flatMap((call, i) => (call.startsWith('rename ') ? [i] : []));
      const writes = h.calls.flatMap((call, i) => (call.startsWith('write ') ? [i] : []));
      const sent = h.calls.indexOf(vendor);
      expect(h.calls.filter((call) => EGRESS.test(call))).toEqual([vendor]);
      expect(renames).toHaveLength(3);
      expect(Math.max(...renames)).toBeLessThan(sent);
      expect(writes).toHaveLength(3);
      expect(Math.min(...writes)).toBeGreaterThan(sent);
      const manifest = JSON.parse(
        readFileSync(join(h.reviews, `2026-09-21-${UNIT}-probe-review-${family}.run.json`), 'utf8'),
      ) as Manifest; // JSON-parse boundary: the file this run just wrote.
      expect(manifest.outcome).toBe('counted');
      expect(outcomeOf(manifest)).toBe('counted');
    });
  }

  it('gemini: a reply carrying GEMINI_API_KEY is checked before writing, so no file is written at all', async () => {
    const h = harness({ replyExtra: `the key is ${FAKE_KEY}` });
    const listingBefore = readdirSync(h.reviews);

    expect(await main([UNIT, 'gemini'], h.deps)).toBe(1);
    expect(h.calls).toContain('callGemini');
    expect(h.calls.filter((call) => call.startsWith('write '))).toEqual([]);
    expect(readdirSync(h.reviews).sort()).toEqual([...listingBefore].sort());
  });

  it('codex: a reply carrying a credential-file token writes no file at all, and the scratch is still removed', async () => {
    const h = harness({ replyExtra: `token ${REFRESH_TOKEN}` });

    expect(await main([UNIT, 'codex'], h.deps)).toBe(1);
    expect(h.calls).toContain('runCli');
    expect(h.calls.filter((call) => call.startsWith('write '))).toEqual([]);
    expect(h.calls.at(-1)).toBe('removeScratch');
  });

  it('codex: a reply that cannot be read still leaves a manifest recording a non-counted run', async () => {
    const h = harness({ replyReadThrows: true });

    expect(await main([UNIT, 'codex'], h.deps)).toBe(1);
    const stem = `2026-09-21-${UNIT}-probe-review-codex`;
    const manifest = JSON.parse(readFileSync(join(h.reviews, `${stem}.run.json`), 'utf8')) as Manifest; // JSON-parse boundary: the file this run just wrote.
    expect(manifest.outcome).not.toBe('counted');
    expect(manifest.outcome).toBe('INTEGRITY_FAILED');
    expect(outcomeOf(manifest)).toBe(manifest.outcome);
    // The reply is treated as null, so no reply file is written.
    expect(existsSync(join(h.reviews, `${stem}.md`))).toBe(false);
    expect(existsSync(join(h.reviews, `${stem}.session.jsonl`))).toBe(true);
  });

  it('codex: a failed read in the credential write-back cannot stop the run writing its evidence', async () => {
    const h = harness({ authReadThrows: true });

    expect(await main([UNIT, 'codex'], h.deps)).toBe(0);
    expect(h.calls.filter((call) => call.startsWith('write '))).toHaveLength(3);
  });

  it('checks that the commit which last touched the prompt and bundle is on the upstream, and names the push when it is not', async () => {
    const pushed = harness();

    expect(await main([UNIT, 'gemini', '--dry-run'], pushed.deps)).toBe(0);
    expect(pushed.gitCalls).toContain(`log -1 --format=%H -- docs/reviews/${PROMPT} docs/reviews/${BUNDLE}`);
    expect(pushed.gitCalls).toContain(`merge-base --is-ancestor ${LAST_TOUCHED} @{u}`);

    for (const options of [{ unpushed: true }, { noUpstream: true }]) {
      const errors = vi.mocked(console.error);
      errors.mockClear();
      const h = harness(options);

      expect(await main([UNIT, 'gemini', '--dry-run'], h.deps)).toBe(1);
      expect(errors.mock.calls.flat().join('\n')).toMatch(/push/i);
    }
  });

  it('codex: refuses on any platform but Windows, where its read isolation was measured; gemini runs no local tool and is unaffected', async () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const errors = vi.mocked(console.error);
      errors.mockClear();
      const h = harness({ platform });

      expect(await main([UNIT, 'codex'], h.deps)).toBe(1);
      expect(h.calls).not.toContain('runCli');
      expect(h.calls).not.toContain('buildScratch');
      expect(errors.mock.calls.flat().join('\n')).toMatch(/measured only on Windows/);
    }

    const gemini = harness({ platform: 'linux' });
    expect(await main([UNIT, 'gemini'], gemini.deps)).toBe(0);
  });

  for (const family of ['codex', 'gemini'] as const) {
    it(`${family}: the manifest's replySha256 is the SHA-256 of the reply file's bytes as written`, async () => {
      const h = harness({ replyExtra: 'Non-ASCII survives: café — ✓\n' });

      expect(await main([UNIT, family], h.deps)).toBe(0);
      const stem = `2026-09-21-${UNIT}-probe-review-${family}`;
      const manifest = JSON.parse(readFileSync(join(h.reviews, `${stem}.run.json`), 'utf8')) as Manifest; // JSON-parse boundary: the file this run just wrote.
      expect(manifest.replySha256).toBe(sha256(readFileSync(join(h.reviews, `${stem}.md`))));
    });
  }

  it('codex: replySha256 is null when no reply file is written', async () => {
    const h = harness({ replyReadThrows: true });

    expect(await main([UNIT, 'codex'], h.deps)).toBe(1);
    const stem = `2026-09-21-${UNIT}-probe-review-codex`;
    const manifest = JSON.parse(readFileSync(join(h.reviews, `${stem}.run.json`), 'utf8')) as Manifest; // JSON-parse boundary: the file this run just wrote.
    expect(existsSync(join(h.reviews, `${stem}.md`))).toBe(false);
    expect(manifest.replySha256).toBeNull();
  });

  const timeouts: ReadonlyArray<readonly [string, () => Error]> = [
    ["fetch's TimeoutError", () => new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
    ["fetch's AbortError", () => new DOMException('This operation was aborted', 'AbortError')],
    [
      "undici's header timeout",
      () => new TypeError('fetch failed', { cause: Object.assign(new Error('Headers Timeout Error'), { code: 'UND_ERR_HEADERS_TIMEOUT' }) }),
    ],
    [
      "undici's body timeout",
      () => new TypeError('fetch failed', { cause: Object.assign(new Error('Body Timeout Error'), { code: 'UND_ERR_BODY_TIMEOUT' }) }),
    ],
    ["the https transport's own timeout", () => new RequestTimeoutError()],
  ];

  for (const [name, rejection] of timeouts) {
    it(`gemini: records ${name} as timedOut: true, and the run as FAILED`, async () => {
      const h = harness({ geminiRejects: rejection });

      expect(await main([UNIT, 'gemini'], h.deps)).toBe(1);
      const manifest = JSON.parse(
        readFileSync(join(h.reviews, `2026-09-21-${UNIT}-probe-review-gemini.run.json`), 'utf8'),
      ) as Manifest; // JSON-parse boundary: the file this run just wrote.
      expect(manifest.timedOut).toBe(true);
      expect(manifest.outcome).toBe('FAILED');
    });
  }

  it('gemini: records a failure that is not a timeout as timedOut: false', async () => {
    const refused = (): Error =>
      new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    const h = harness({ geminiRejects: refused });

    expect(await main([UNIT, 'gemini'], h.deps)).toBe(1);
    const manifest = JSON.parse(
      readFileSync(join(h.reviews, `2026-09-21-${UNIT}-probe-review-gemini.run.json`), 'utf8'),
    ) as Manifest; // JSON-parse boundary: the file this run just wrote.
    expect(manifest.timedOut).toBe(false);
    expect(manifest.outcome).toBe('FAILED');
  });

  it('codex: a scratch that cannot be removed is reported, but a counted run stays counted and the signal guard is still released', async () => {
    const h = harness({ removeThrows: true });

    expect(await main([UNIT, 'codex'], h.deps)).toBe(0);
    expect(h.listening()).toBe(0);
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toMatch(/could not be removed/);
  });

  it('codex: Ctrl-C mid-run says the bundle was sent, writes the refreshed credential back, then removes the scratch', async () => {
    const h = harness({ interrupt: 'SIGINT' });

    void main([UNIT, 'codex'], h.deps);
    await vi.waitFor(() => {
      expect(h.calls).toContain('exit 130');
    });

    const at = (prefix: string): number => h.calls.findIndex((call) => call.startsWith(prefix));
    expect(at('runCli')).toBeGreaterThanOrEqual(0);
    expect(at('authFs.write ')).toBeGreaterThan(at('runCli'));
    expect(at('authFs.rename ')).toBeGreaterThan(at('authFs.write '));
    expect(at('removeScratch')).toBeGreaterThan(at('authFs.rename '));
    expect(at('exit 130')).toBeGreaterThan(at('removeScratch'));
    expect(h.calls.filter((call) => call.startsWith('write '))).toEqual([]);
    const printed = vi.mocked(console.error).mock.calls.flat().join('\n');
    expect(printed).toMatch(/bundle WAS sent to OpenAI/);
    expect(printed).toMatch(/no evidence was written because the run was interrupted/i);
  });

  it('gemini: SIGTERM mid-call says the bundle was sent to Google and that no evidence was written', async () => {
    const h = harness({ interrupt: 'SIGTERM' });

    void main([UNIT, 'gemini'], h.deps);
    await vi.waitFor(() => {
      expect(h.calls).toContain('exit 143');
    });

    const printed = vi.mocked(console.error).mock.calls.flat().join('\n');
    expect(printed).toMatch(/bundle WAS sent to Google/);
    expect(printed).toMatch(/no evidence was written because the run was interrupted/i);
    expect(h.calls.filter((call) => call.startsWith('write '))).toEqual([]);
  });
});
