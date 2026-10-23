/**
 * R17: security at the gate. The line's rows run the real line over the stub
 * sandbox with the stand-in scanners, which find what a fixture seeds and
 * report in the real scanners' formats (`@olympus-ai/adapters`, stand-in).
 * The rows that say they need Docker run the real gitleaks and Semgrep
 * images through the runtime's own `scanTree`, so what the stand-ins stand
 * for is shown to hold of the pinned images.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Finding, SecurityCheckSpec } from '@olympus-ai/integrity';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import type { RunId } from '@olympus-ai/core';
import type { EnforcementDecision, EvidenceBundle, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { ONE_RULE } from './decisions.js';
import { ARTIFACTS, HELLO_REPRODUCTION, HELLO_TASK, readRecord, refusalOf, secretScanCheck, withLine, writeManifest } from './line.js';
import { withProvider } from './local-sandbox.js';
import { bundles, inTask, runHello, writes } from './verification.js';

const api = async () => import('@olympus-ai/api');
const adapters = async () => import('@olympus-ai/adapters');

/** A secret only the stand-in matches, seeded where a change or a base puts it. */
const SEEDED = 'SEEDED-SECRET-ABCDEFGHIJ0123456789';
/** A token gitleaks' default rules call a GitHub personal access token. It grants nothing. */
const PAT = 'ghp_8fK2mQ9xLp4vT7wZr1YbN3cJ6hD0sA5eU2iO';
const PAT_ALLOWED = 'ghp_9gK2mQ9xLp4vT7wZr1YbN3cJ6hD0sA5eU2iP';
/** This process's uid where the host has uids, so the container can read the copy the runtime made. */
const USER = process.getuid === undefined || process.getgid === undefined ? { uid: 0, gid: 0 } : { uid: process.getuid(), gid: process.getgid() };
const COMPILES = { id: 'hello-exit-zero', kind: 'compile', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 };

function scanOf(bundle: EvidenceBundle): EvidenceBundle['checks'][number] {
  const result = bundle.checks.find((c) => c.checkId === 'secret-scan');
  if (result === undefined) throw new Error(`R17: the bundle holds no secret-scan result: ${JSON.stringify(bundle.checks.map((c) => c.checkId))}`);
  return result;
}

export const SEEDED_SECRET_FAILS_VERIFY: LocalAssertion = runtime({
  id: 'I5.seeded-secret-fails-verify',
  title:
    'a change that commits a seeded secret fails verify on every iteration, its secret-scan result naming the finding by rule, file, and line, and the task parks; the secret itself is in no bundle; the same run without the secret passes',
  run: async () => {
    await withLine('r17-seeded-', async (rig) => {
      const { state, vault } = await runHello(rig, { during: async (sandbox, req) => { await inTask(sandbox, req, writes({ 'config.ts': `export const token = '${SEEDED}';\n` })); } });
      if (state.tasks[HELLO_TASK] !== 'parked') throw new Error(`R17: a change committing a secret left its task ${String(state.tasks[HELLO_TASK])}, not parked`);
      const all = await bundles(vault, state);
      for (const bundle of all) {
        const findings = scanOf(bundle).findings;
        if (findings?.length !== 1 || findings[0]?.location.path !== 'config.ts' || findings[0].location.line !== 1) {
          throw new Error(`R17: the secret scan did not name the seeded secret: ${JSON.stringify(findings)}`);
        }
        if (JSON.stringify(bundle).includes(SEEDED)) throw new Error('R17: the secret\'s value reached the evidence bundle');
      }
      // Each failed iteration reaches the enforcement record, its failed check saying why (D-R17-06).
      const decisions = await Promise.all((await vault.readDecisions(rig.runId)).map((ref) => readRecord<EnforcementDecision>(vault, ref)));
      const gates = decisions.flatMap((d) => (d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'gate-failed' ? [d.decision.refusal] : []));
      if (gates.length !== all.length || !gates.every((g) => g.failed.some((f) => f.checkId === 'secret-scan' && f.cause === 'new-finding'))) {
        throw new Error(`R17: ${String(all.length)} failed iterations reached the record as ${JSON.stringify(gates)}`);
      }
    });
    await withLine('r17-seeded-control-', async (rig) => {
      const { state } = await runHello(rig);
      if (state.tasks[HELLO_TASK] !== 'passed') throw new Error(`R17 control: the same run with no secret left its task ${String(state.tasks[HELLO_TASK])}`);
    });
  },
});

export const BASE_SECRET_DOES_NOT_FAIL_THE_CHANGE: LocalAssertion = runtime({
  id: 'I2.base-finding-does-not-fail-the-change',
  title:
    'a secret already on the base is in the base record\'s findings and does not fail a change that leaves it; the same secret copied to a second file is a finding the base does not account for, and fails it',
  run: async () => {
    await withLine('r17-base-', async (rig) => {
      await writeFile(join(rig.dirs.artifacts, 'legacy.ts'), `export const old = '${SEEDED}';\n`);
      const { state, vault } = await runHello(rig);
      if (state.tasks[HELLO_TASK] !== 'passed') throw new Error(`R17: a change that left a base secret alone was ${String(state.tasks[HELLO_TASK])}`);
      const [bundle] = await bundles(vault, state);
      if (bundle === undefined) throw new Error('R17: no evidence');
      const base = await readRecord<{ checks: Array<{ checkId: string; findings: readonly Finding[] | null }> }>(vault, bundle.baseRun);
      const found = base.checks.find((c) => c.checkId === 'secret-scan')?.findings;
      if (found?.length !== 1) throw new Error(`R17: the base record does not hold the base's secret: ${JSON.stringify(found)}`);
    });
    await withLine('r17-base-copied-', async (rig) => {
      await writeFile(join(rig.dirs.artifacts, 'legacy.ts'), `export const old = '${SEEDED}';\n`);
      const { state } = await runHello(rig, { during: async (sandbox, req) => { await inTask(sandbox, req, writes({ 'copy.ts': `export const again = '${SEEDED}';\n` })); } });
      if (state.tasks[HELLO_TASK] === 'passed') throw new Error('R17: a base secret copied into a second file passed as if the base accounted for it');
    });
  },
});

export const MANIFEST_MUST_PIN_SECURITY_CHECKS: LocalAssertion = runtime({
  id: 'I5.manifest-must-pin-security-checks',
  title:
    'a manifest that pins no secret-scan check is refused at admission naming the kind, and the refusal is one recorded decision; over a stack with a static-analysis slot, one that pins no static-analysis check is refused naming that kind; a secret-scan check of another image is refused naming the image declared for it',
  run: async () => {
    const { startRun } = await api();
    const refusedFor = async (prefix: string, checks: readonly unknown[], arrange?: (root: string) => Promise<void>): Promise<string[]> => withLine(prefix, async (rig) => {
      if (arrange !== undefined) await arrange(rig.dirs.artifacts);
      await writeManifest(rig.dirs, checks, { asWritten: true });
      const components = await rig.components();
      const outcome = await startRun(await rig.request(components));
      if (outcome.ok || outcome.reason !== 'invalid-request') throw new Error(`R17: ${prefix} was ${outcome.ok ? 'admitted' : outcome.reason}`);
      const decisions = await Promise.all((await components.vault.readDecisions(rig.runId)).map((ref) => readRecord<EnforcementDecision>(components.vault, ref)));
      if (decisions.length !== 1 || decisions[0]?.decision.cause !== 'admission-refused') {
        throw new Error(`R17: ${prefix} left ${JSON.stringify(decisions.map((d) => d.decision.cause))}, not one admission refusal`);
      }
      return outcome.problems.map((p) => `${p.path} ${p.code} ${p.message}`);
    });
    const unscanned = await refusedFor('r17-no-scan-', [COMPILES, HELLO_REPRODUCTION]);
    if (!unscanned.some((p) => p.startsWith('manifest.checks missing') && p.includes('secret-scan'))) throw new Error(`R17: no secret-scan check was refused as ${JSON.stringify(unscanned)}`);
    const node = async (root: string): Promise<void> => { await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'hello', private: true })); };
    const unanalysed = await refusedFor('r17-no-static-', [COMPILES, HELLO_REPRODUCTION, await secretScanCheck()], node);
    if (!unanalysed.some((p) => p.startsWith('manifest.checks missing') && p.includes('static-analysis'))) throw new Error(`R17: no static-analysis check was refused as ${JSON.stringify(unanalysed)}`);
    const { SECRET_SCAN_IMAGE } = await adapters();
    const foreign = await refusedFor('r17-image-', [COMPILES, HELLO_REPRODUCTION, { ...(await secretScanCheck()), image: SECRET_SCAN_IMAGE }]);
    if (!foreign.some((p) => p.includes('.image not-pinned'))) throw new Error(`R17: a secret-scan check of an undeclared image was refused as ${JSON.stringify(foreign)}`);
  },
});

export const SUPPRESSION_ADDED_FAILS: LocalAssertion = runtime({
  id: 'I3.suppression-added-fails-the-check',
  title:
    'a change that commits a seeded secret behind an inline gitleaks:allow fails the secret-scan check as suppression-added, and the marker is recorded as a suppression-marker violation; a marker already on the base is not the change\'s',
  run: async () => {
    const { securityShortfall } = await api();
    const { STAND_IN_SECRET_SCANNER } = await adapters();
    const check = (await secretScanCheck()) as unknown as SecurityCheckSpec;
    await withLine('r17-allow-', async (rig) => {
      const { state, vault, violations } = await runHello(rig, { during: async (sandbox, req) => { await inTask(sandbox, req, writes({ 'config.ts': `export const token = '${SEEDED}'; // gitleaks:allow\n` })); } });
      if (state.tasks[HELLO_TASK] === 'passed') throw new Error('R17: a suppressed secret passed');
      const [bundle] = await bundles(vault, state);
      if (bundle === undefined) throw new Error('R17: no evidence');
      const failed = securityShortfall(check, scanOf(bundle), [], STAND_IN_SECRET_SCANNER, bundle.tamper);
      if (failed?.cause !== 'suppression-added') throw new Error(`R17: the suppressed secret failed as ${failed?.cause ?? 'nothing'}, not suppression-added`);
      if (!violations.some((v) => v.kind === 'suppression-marker')) throw new Error(`R17: no suppression-marker violation was recorded: ${JSON.stringify(violations.map((v) => v.kind))}`);
    });
    await withLine('r17-allow-base-', async (rig) => {
      await writeFile(join(rig.dirs.artifacts, 'notes.md'), 'an example marker: gitleaks:allow\n');
      const { state, violations } = await runHello(rig);
      if (state.tasks[HELLO_TASK] !== 'passed' || violations.some((v) => v.kind === 'suppression-marker')) {
        throw new Error(`R17: a marker already on the base was charged to the change: ${String(state.tasks[HELLO_TASK])}`);
      }
    });
  },
});

export const SPEC_CARRIES_ITS_SECURITY_PART: LocalAssertion = runtime({
  id: 'I5.spec-carries-its-security-part',
  title:
    'a spec admitted with no security part is refused at the spec exit naming the part, before anything is locked; a part that is neither none-with-a-reason nor every required field is refused at admission',
  run: async () => {
    const { startRun } = await api();
    await withLine('r17-part-', async (rig) => {
      const components = await rig.components();
      const { specParts: _omitted, ...artifacts } = ARTIFACTS;
      const refused = refusalOf(await startRun(await rig.request(components, { artifacts })), 'R17 part');
      if (refused.at !== 'spec' || refused.transition.reason !== 'spec-part-missing') {
        throw new Error(`R17: a spec with no security part was refused as ${JSON.stringify(refused.transition)} at ${refused.at}`);
      }
      // The Vault holds no lock for the run, and says so rather than reporting one intact.
      const locked = await components.vault.verifyLocks(rig.runId).then(() => true, (error: unknown) => !String(error).includes('nothing is locked'));
      if (locked) throw new Error('R17: the spec was locked before its missing part refused it');
    });
    await withLine('r17-part-bad-', async (rig) => {
      await writeFile(join(rig.dirs.artifacts, 'security.json'), JSON.stringify({ none: '' }));
      const outcome = await startRun(await rig.request(await rig.components()));
      if (outcome.ok || outcome.reason !== 'invalid-request' || !outcome.problems.some((p) => p.code === 'not-a-security-part')) {
        throw new Error(`R17: a none with no reason was ${outcome.ok ? 'admitted' : outcome.reason}`);
      }
    });
  },
});

export const RULE_NEEDS_A_DENIAL_CHECK: LocalAssertion = runtime({
  id: 'I5.authorization-rule-needs-a-denial-check',
  title:
    'an authorization rule the security part names with no locked check denying it refuses the test-design exit naming the rule, before the base runs; with a behavioral check naming it in deniesRule the run crosses test-design',
  run: async () => {
    const { startRun } = await api();
    await withLine('r17-denial-', async (rig) => {
      await writeFile(join(rig.dirs.artifacts, 'security.json'), JSON.stringify(ONE_RULE));
      const components = await rig.components();
      const refused = refusalOf(await startRun(await rig.request(components)), 'R17 denial');
      if (refused.at !== 'test-design' || refused.transition.reason !== 'denial-check-missing' || refused.transition.rules.join() !== 'owner-only') {
        throw new Error(`R17: an undenied rule was refused as ${JSON.stringify(refused.transition)} at ${refused.at}`);
      }
      if ((await components.vault.readBaseRun(rig.runId, null)) !== null) throw new Error('R17: the base ran before the undenied rule refused the exit');
    });
    await withLine('r17-denial-control-', async (rig) => {
      await writeFile(join(rig.dirs.artifacts, 'security.json'), JSON.stringify(ONE_RULE));
      const denies = { id: 'stranger-refused', kind: 'behavioral', onBase: 'passes', deniesRule: 'owner-only', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 };
      await writeManifest(rig.dirs, [COMPILES, denies, HELLO_REPRODUCTION]);
      const { state } = await runHello(rig);
      if (state.tasks[HELLO_TASK] !== 'passed') throw new Error(`R17 control: a denied rule did not cross test-design and pass: ${String(state.tasks[HELLO_TASK])}`);
    });
  },
});

export const STATIC_ANALYSIS_SLOT_REQUIRED_AT_L3: LocalAssertion = runtime({
  id: 'I5.static-analysis-slot-required-at-l3',
  title:
    'an adapter set with no static-analysis slot names static-analysis among its missing controls and is refused at L3; a Node.js repository\'s set carries the declared scanner and does not name it',
  run: async () => {
    const { adapterAdmission, buildAdapterSet, missingControls, STATIC_ANALYSIS_SCANNER } = await adapters();
    const root = await mkdtemp(join(tmpdir(), 'r17-slot-'));
    try {
      const bare = await buildAdapterSet(root, { provider: null, coverage: null });
      const l3 = adapterAdmission(bare, 3);
      if (bare.staticAnalysis !== null || l3.ok || !l3.unavailable.includes('static-analysis')) {
        throw new Error(`R17: a set with no static-analysis scanner was not refused at L3 for it: ${JSON.stringify(l3)}`);
      }
      await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'x', private: true }));
      const node = await buildAdapterSet(root, { provider: null, coverage: null });
      if (node.staticAnalysis !== STATIC_ANALYSIS_SCANNER || missingControls(node).includes('static-analysis')) {
        throw new Error('R17: a Node.js repository\'s set does not carry the declared static-analysis scanner');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
});

export const FINGERPRINT_IGNORES_LINE: LocalAssertion = runtime({
  id: 'I2.finding-fingerprint-ignores-line',
  title:
    'a finding\'s fingerprint is the runtime\'s and independent of its line: the same secret on another line or in another file is the base\'s finding, a second copy of it is new, and a report the runtime cannot read is no result rather than a clean scan',
  run: async () => {
    const { parseGitleaksReport, STAND_IN_SECRET_SCANNER, newFindings } = await adapters();
    const { securityShortfall } = await api();
    const report = (entries: Array<[string, number]>): string => JSON.stringify(entries.map(([file, line]) => ({ RuleID: 'seeded-secret', File: file, StartLine: line, Secret: SEEDED })));
    const base = parseGitleaksReport(report([['a.ts', 1]]));
    const moved = parseGitleaksReport(report([['b.ts', 40]]));
    const copied = parseGitleaksReport(report([['a.ts', 1], ['b.ts', 2]]));
    if (base === undefined || moved === undefined || copied === undefined) throw new Error('R17: a gitleaks report did not parse');
    if (newFindings(base, moved).length !== 0) throw new Error('R17: a secret moved to another line and file read as a new finding');
    if (newFindings(base, copied).length !== 1) throw new Error('R17: a second copy of a base secret was not a new finding');
    if (parseGitleaksReport('[{"RuleID":"x","File":"a","StartLine":1,"Secret":"REDACTED"}]') !== undefined) throw new Error('R17: a redacted report was read as findings');
    const check = (await secretScanCheck()) as unknown as SecurityCheckSpec;
    const unread = { checkId: check.id, exitCode: 0, stdout: '', stderr: '', suiteCount: null, expectation: null, findings: null, durationMs: 1, startedAt: new Date(0).toISOString() };
    if (securityShortfall(check, unread, [], STAND_IN_SECRET_SCANNER, { suppressionMarkersAdded: [] })?.cause !== 'no-result') {
      throw new Error('R17: a scan with no readable report was not judged no-result');
    }
  },
});

/** Runs `check` through the runtime's own scan over `tree` on a real daemon, with the real scanner its kind is declared for. */
async function realScan(provider: SandboxProvider, base: string, tree: string, check: SecurityCheckSpec): Promise<readonly Finding[] | null> {
  const { scanTree, SCANNERS, scannerFor } = await api();
  const scratch = join(base, 'scratch');
  const outcome = await scanTree({
    sandbox: provider,
    tree,
    scratch: { dir: scratch, tree: join(scratch, 'tree'), config: join(scratch, 'config') },
    check,
    scanner: scannerFor(check.kind, SCANNERS),
    limits: { cpus: 1, memoryMb: 1024, pids: 256 },
    user: USER,
  });
  if (!outcome.ok) throw new Error(`R17: the scan did not run: ${outcome.reason}`);
  return outcome.result.findings;
}

/** The scanner run over `tree` as it stands, with no runtime copy: what the in-tree files would have hidden. */
async function unstripped(provider: SandboxProvider, tree: string, check: SecurityCheckSpec, configDir: string): Promise<readonly Finding[] | undefined> {
  const { SCAN_CONFIG, SCANNERS, scannerFor } = await api();
  const scanner = scannerFor(check.kind, SCANNERS);
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, scanner.configFile), check.config ?? scanner.defaultConfig ?? '');
  const handle = await provider.provision({
    image: check.image,
    mounts: { workspace: { source: tree, target: '/workspace', mode: 'ro' }, others: [{ source: configDir, target: SCAN_CONFIG, mode: 'ro' }] },
    egress: { mode: 'deny-all', allow: [] },
    limits: { cpus: 1, memoryMb: 1024, pids: 256, wallClockMs: check.timeoutMs },
    user: USER,
  });
  try {
    const exec = await provider.exec(handle, [...scanner.invocation(`${SCAN_CONFIG}/${scanner.configFile}`)], { env: { HOME: '/tmp' } });
    return scanner.parse(exec.stdout);
  } finally {
    await provider.destroy(handle);
  }
}

export const WORKSPACE_IGNORE_FILE_DOES_NOT_HIDE: LocalAssertion = runtime({
  id: 'I3.workspace-ignore-file-does-not-hide-a-finding',
  title:
    'the pinned gitleaks, run by the runtime with no network, reports a secret the workspace\'s .gitleaksignore and .gitleaks.toml would hide, and one behind an inline gitleaks:allow; the same scanner over the tree as it stands does not report the first, so the ignore file is what the runtime kept out (needs Docker)',
  timeoutMs: 300_000,
  run: async () => {
    const { SECRET_SCAN_IMAGE } = await adapters();
    await withProvider('conformance-r17-gitleaks-', async (provider, dirs, base) => {
      const tree = dirs.workspace;
      await writeFile(join(tree, 'x.ts'), `const a = '${PAT}';\nconst b = '${PAT_ALLOWED}'; // gitleaks:allow\n`);
      await writeFile(join(tree, '.gitleaksignore'), 'x.ts:github-pat:1\n');
      await writeFile(join(tree, '.gitleaks.toml'), '[extend]\nuseDefault = true\n[allowlist]\npaths = ["x.ts"]\n');
      const check: SecurityCheckSpec = { id: 'secret-scan', kind: 'secret-scan', image: SECRET_SCAN_IMAGE, config: null, required: true, timeoutMs: 120_000 };
      const found = await realScan(provider, base, tree, check);
      if (found?.length !== 2 || !found.every((f) => f.rule === 'github-pat' && f.location.path === 'x.ts')) {
        throw new Error(`R17: the runtime's scan did not report both secrets: ${JSON.stringify(found)}`);
      }
      const hidden = await unstripped(provider, tree, check, join(base, 'raw-config'));
      // Over the tree as it stands, the ignore file hides line 1; the flag still reports line 2.
      if (hidden?.length !== 1 || hidden[0]?.location.line !== 2) {
        throw new Error(`R17 control: the in-tree files did not hide the secret they name, so the row shows nothing: ${JSON.stringify(hidden)}`);
      }
    });
  },
});

/** The `gate-failed` decisions the run's record holds, each with the checks it failed. */
async function failedGates(vault: Vault, runId: RunId): Promise<ReadonlyArray<ReadonlyArray<{ readonly checkId: string; readonly cause: string }>>> {
  const decisions = await Promise.all((await vault.readDecisions(runId)).map((ref) => readRecord<EnforcementDecision>(vault, ref)));
  return decisions.flatMap((d) => (d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'gate-failed' ? [d.decision.refusal.failed] : []));
}

export const SCANNER_CONFIG_NAMES_ARE_STILL_SCANNED: LocalAssertion = runtime({
  id: 'I3.scanner-config-names-are-still-scanned',
  title:
    'a secret written into .gitleaks.toml or under a directory named .gitleaksignore, and a flagged call under a directory named .semgrepignore, each fail verify as a new finding: the scan copy sets those names aside without dropping their bytes; a tree that already holds the set-aside name parks its task rather than pass (codex-1)',
  run: async () => {
    const cases: ReadonlyArray<readonly [string, Record<string, string>, string]> = [
      ['toml', { '.gitleaks.toml': `token = '${SEEDED}'\n` }, 'secret-scan'],
      ['ignore-dir', { '.gitleaksignore/credential.txt': `${SEEDED}\n` }, 'secret-scan'],
      ['semgrep-dir', { '.semgrepignore/payload.ts': 'export const f = (x: string) => eval(x);\n' }, 'static-analysis'],
    ];
    for (const [label, files, checkId] of cases) {
      await withLine(`r17-set-aside-${label}-`, async (rig) => {
        // A package.json gives the stack its static-analysis slot, so the rig pins that check too.
        if (checkId === 'static-analysis') await writeFile(join(rig.dirs.artifacts, 'package.json'), JSON.stringify({ name: 'x', private: true }));
        const { state, vault } = await runHello(rig, { during: async (sandbox, req) => { await inTask(sandbox, req, writes(files)); } });
        if (state.tasks[HELLO_TASK] !== 'parked') throw new Error(`R17: ${Object.keys(files).join()} left its task ${String(state.tasks[HELLO_TASK])}, not parked`);
        const gates = await failedGates(vault, rig.runId);
        if (gates.length === 0 || !gates.every((failed) => failed.some((f) => f.checkId === checkId && f.cause === 'new-finding'))) {
          throw new Error(`R17: ${Object.keys(files).join()} did not fail ${checkId} as a new finding: ${JSON.stringify(gates)}`);
        }
      });
    }
    await withLine('r17-set-aside-clash-', async (rig) => {
      const files = { '.gitleaks.toml': `token = '${SEEDED}'\n`, '.gitleaks.toml.scan-set-aside': '' };
      const { state } = await runHello(rig, { during: async (sandbox, req) => { await inTask(sandbox, req, writes(files)); } });
      if (state.tasks[HELLO_TASK] !== 'parked') throw new Error(`R17: a tree holding the set-aside name left its task ${String(state.tasks[HELLO_TASK])}, not parked`);
    });
  },
});

export const STATIC_ANALYSIS_RUNS_OFFLINE: LocalAssertion = runtime({
  id: 'I5.static-analysis-runs-offline-on-pinned-rules',
  title:
    'the pinned Semgrep, run by the runtime with no network on the rules the check pins, reports a seeded sink by rule, file, and line, behind a nosemgrep comment and a .semgrepignore that would exclude its file, and one in a file under a directory named .semgrepignore (needs Docker)',
  timeoutMs: 600_000,
  run: async () => {
    const { STATIC_ANALYSIS_IMAGE } = await adapters();
    await withProvider('conformance-r17-semgrep-', async (provider, dirs, base) => {
      const tree = dirs.workspace;
      await writeFile(join(tree, 'x.ts'), 'export function f(x: string) {\n  return eval(x); // nosemgrep\n}\n');
      await writeFile(join(tree, '.semgrepignore'), 'x.ts\n');
      // A directory carrying the ignore file's name is set aside, never dropped, so its source is still analysed (D-R17-07).
      await mkdir(join(tree, 'lib', '.semgrepignore'), { recursive: true });
      await writeFile(join(tree, 'lib', '.semgrepignore', 'payload.ts'), 'export const g = (y: string) => eval(y);\n');
      const rules = 'rules:\n  - id: no-eval\n    languages: [typescript]\n    severity: ERROR\n    message: eval of a value\n    pattern: eval($X)\n';
      const check: SecurityCheckSpec = { id: 'static-analysis', kind: 'static-analysis', image: STATIC_ANALYSIS_IMAGE, config: rules, required: true, timeoutMs: 300_000 };
      const found = await realScan(provider, base, tree, check);
      const sink = found?.find((f) => f.location.path === 'x.ts');
      if (sink?.location.line !== 2 || !sink.rule.endsWith('no-eval')) {
        throw new Error(`R17: the runtime's static analysis did not report the sink: ${JSON.stringify(found)}`);
      }
      const setAside = 'lib/.semgrepignore.scan-set-aside/payload.ts';
      if (found?.length !== 2 || !found.some((f) => f.location.path === setAside && f.location.line === 1)) {
        throw new Error(`R17: the runtime's static analysis did not report the sink under a set-aside directory: ${JSON.stringify(found)}`);
      }
    });
  },
});

/** Every R17 assertion, by the invariant it is registered under. */
export const R17_I2: readonly LocalAssertion[] = [BASE_SECRET_DOES_NOT_FAIL_THE_CHANGE, FINGERPRINT_IGNORES_LINE];
export const R17_I3: readonly LocalAssertion[] = [SUPPRESSION_ADDED_FAILS, WORKSPACE_IGNORE_FILE_DOES_NOT_HIDE, SCANNER_CONFIG_NAMES_ARE_STILL_SCANNED];
export const R17_I5: readonly LocalAssertion[] = [
  SEEDED_SECRET_FAILS_VERIFY,
  MANIFEST_MUST_PIN_SECURITY_CHECKS,
  SPEC_CARRIES_ITS_SECURITY_PART,
  RULE_NEEDS_A_DENIAL_CHECK,
  STATIC_ANALYSIS_SLOT_REQUIRED_AT_L3,
  STATIC_ANALYSIS_RUNS_OFFLINE,
];
