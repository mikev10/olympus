import { describe, expect, it } from 'vitest';
import { USAGE, buildManifest, findLeakedSecrets, parseArgs } from '../../run-external-review.ts';
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

  it('does not match a value shorter than eight characters', () => {
    expect(findLeakedSecrets(['abc1234 appears here'], { SHORT: 'abc1234' })).toEqual([]);
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
