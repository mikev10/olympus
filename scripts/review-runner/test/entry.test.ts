import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthFs } from '../../run-external-review.ts';
import {
  AUTH_JSON_LABEL,
  USAGE,
  archiveEarlierAttempt,
  authJsonSecrets,
  authRefreshed,
  buildManifest,
  codexSpawn,
  findLeakedSecrets,
  parseArgs,
  planArchive,
  reconcileAuthAfterRun,
} from '../../run-external-review.ts';
import type { Manifest } from '../evidence.ts';
import { RECORDABLE_ENV, keylessUrl, outcomeOf, redactEnv } from '../evidence.ts';
import type { IngestionVerdict } from '../ingestion.ts';
import type { EchoVerdict } from '../integrity.ts';

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

  it('matches on the first eight characters alone, so a truncated copy is still caught', () => {
    expect(findLeakedSecrets([`prefix ${FAKE_KEY.slice(0, 8)} only`], { GEMINI_API_KEY: FAKE_KEY })).toEqual([
      'GEMINI_API_KEY',
    ]);
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
  // Its first eight characters differ from REFRESH_TOKEN's, so a hit on it can
  // only come from the post-run file.
  const ROTATED = 'rt_rotatedNewTokenRotatedNewToken';
  const REFRESHED_JSON = AUTH_JSON.replace(REFRESH_TOKEN, ROTATED);

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

    expect(result).toEqual({ writeBack: 'unchanged', refreshedSecrets: [] });
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

    expect(reconcileAuthAfterRun(SCRATCH, REAL, Buffer.from(AUTH_JSON), failing).writeBack).toBe('write-failed');
    expect(calls[1]).toMatch(/^remove /);
    expect(Buffer.from(files.get(REAL) ?? []).toString()).toBe(AUTH_JSON);
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

  it("takes its outcome from outcomeOf's answer, across every combination of the deciding facts", () => {
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

    for (const facts of [codexFacts, geminiFacts]) {
      for (const exitCode of [0, 1, null]) {
        for (const timedOut of [false, true]) {
          for (const ingestion of ingestions) {
            for (const integrity of integrities) {
              const manifest = buildManifest(facts({ exitCode, timedOut, ingestion, integrity }));

              expect(manifest.outcome).toBe(outcomeOf({ exitCode, timedOut, ingestion, integrity }));
            }
          }
        }
      }
    }
  });

  it('ignores an outcome smuggled in on a wider object and derives its own', () => {
    const smuggled = { ...codexFacts({ exitCode: 1 }), outcome: 'counted' as const };

    expect(buildManifest(smuggled).outcome).toBe('FAILED');
  });

  it('never yields counted for a codex run whose recorded approval policy is anything but "never"', () => {
    for (const recordedApprovalPolicy of ['on-request', 'untrusted', 'on-failure', 'Never', '', null]) {
      const manifest = buildManifest(codexFacts({ recordedApprovalPolicy }));

      expect(manifest.outcome).toBe('FAILED');
      // The process's real exit code is what the manifest records; the
      // recorded policy beside it is what shows why the run failed.
      expect(manifest.exitCode).toBe(0);
      expect(manifest.recordedApprovalPolicy).toBe(recordedApprovalPolicy);
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

  it('archives outputs whose manifest is missing or unreadable, since neither can show a counted review', () => {
    expect(planArchive([`${STEM}.md`], STEM, null)).toEqual({
      kind: 'archive',
      moves: [{ from: `${STEM}.md`, to: `${STEM}.attempt-1.md` }],
    });
    expect(planArchive(CURRENT, STEM, '{"outcome": "counted"')).toMatchObject({ kind: 'archive' });
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
});
