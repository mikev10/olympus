/**
 * R10: the trust ratchet. Within a run, capability only narrows. Each clause of
 * the unit's conformance is one assertion here, and each fails when its check
 * is deleted:
 *
 * - a narrowed scope wider than its role's is refused at validation;
 * - a narrowed run seating a role with no narrowed scope is refused;
 * - an author below `narrowBelow` is admitted narrowed, and the record says so;
 * - no task after narrowing gets a sandbox, tools, or level beyond the narrowed scope;
 * - the narrowing input is withheld until the narrowing is recorded and committed;
 * - no call restores a narrowed capability;
 * - a sensitive path is absent from an ungranted task's tree, is not deleted by
 *   its diff, and a write to it is refused;
 * - a policy with no R10 keys admits exactly as before.
 *
 * The three `capability-narrowed` rows of P14's table run the scenarios
 * exported at the bottom.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ApprovalKey, ApprovalOutcome, CapabilityScope, NarrowedScope, Policy, PolicyDocument, RoleId, RunState, TaskRequest,
} from '@olympus-ai/core';
import type { SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import type { EnforcementDecision, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { HELLO_REVIEW, HELLO_TASK, lineScope, linePolicy, readRecord, stubDriver, withLine, writeManifest, type LineRig, type ObservedDriver } from './line.js';
import { issuePolicy, plantCandidate } from './triggers.js';
import { sensitiveDraftGoesBack } from './drafting.js';

const api = async () => import('@olympus-ai/api');
const core = async () => import('@olympus-ai/core');

const BUILDER = 'builder' as RoleId;
const REVIEWER = 'reviewer' as RoleId;
const HOST = 'api.example.test';
const INPUT = 'r10-input-from-a-declared-source';
const SECRET = 'secrets/key.txt';

/** What a role keeps once narrowed: read only, no network, at most `ceiling`. */
function narrowTo(ceiling: 0 | 1 | 2): NarrowedScope {
  return { tools: ['read'], network: { egress: 'none' }, autonomyCeiling: ceiling };
}

/** A role's full scope here: two tools and one host, so a narrowing has something to take away. */
function wide(scope: CapabilityScope, narrowed: NarrowedScope | null, grants: string[] = []): CapabilityScope {
  return { ...scope, tools: ['read', 'write'], network: { egress: [HOST] }, narrowed, sensitiveGrants: grants };
}

/** The line's two roles, wide, each with `narrowed` (or none), and the builder granted `grants`. */
function roles(narrowed: { builder: NarrowedScope | null; reviewer: NarrowedScope | null }, grants: string[] = []): PolicyDocument['roles'] {
  return {
    [BUILDER]: wide(lineScope(['build', 'verify'], 'standard'), narrowed.builder, grants),
    [REVIEWER]: wide(lineScope(['review'], 'deep'), narrowed.reviewer),
  };
}

/** `issuePolicy`'s roles listing `issue`, made wide and narrowable. */
async function candidatePolicy(narrowed: { builder: NarrowedScope | null; reviewer: NarrowedScope | null }, narrowBelow: Policy['triggers']['narrowBelow']): Promise<Policy> {
  const base = await issuePolicy({ narrowBelow });
  const { StrictPolicyEngine } = await core();
  return new StrictPolicyEngine().resolvePolicy({
    ...base,
    roles: Object.fromEntries(Object.entries(base.roles).map(([id, scope]) => [id, wide(scope, id === BUILDER ? narrowed.builder : narrowed.reviewer)])),
  });
}

/** A stub sandbox that keeps every spec the line provisions, in order. */
async function recordingSandbox(): Promise<{ sandbox: SandboxProvider; specs: SandboxSpec[] }> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const inner = new StubSandboxProvider();
  const specs: SandboxSpec[] = [];
  const sandbox = new Proxy(inner, {
    get(target, key) {
      if (key === 'provision') {
        return (spec: SandboxSpec) => {
          specs.push(spec);
          return target.provision(spec);
        };
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as SandboxProvider;
  return { sandbox, specs };
}

/** `vault`, whose `capability-narrowed` writes fail, as a store that cannot be written would. */
function failingNarrowings(vault: Vault): Vault {
  return new Proxy(vault, {
    get(target, key) {
      if (key === 'recordDecision') {
        return (d: EnforcementDecision) => (d.decision.cause === 'capability-narrowed' ? Promise.reject(new Error('stand-in: the record cannot be written')) : target.recordDecision(d));
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

async function decisionsOf(vault: Vault, runId: RunState['runId']): Promise<EnforcementDecision[]> {
  const refs = await vault.readDecisions(runId);
  return Promise.all(refs.map((ref) => readRecord<EnforcementDecision>(vault, ref)));
}

function narrowings(decisions: readonly EnforcementDecision[]): EnforcementDecision[] {
  return decisions.filter((d) => d.decision.cause === 'capability-narrowed');
}

/** Every committed version of the run's state, oldest first, as the filesystem Vault keeps them. */
async function history(rig: LineRig): Promise<RunState[]> {
  const latest = await rig.state();
  const states: RunState[] = [];
  for (let v = 0; v <= Number(latest.version); v++) {
    // A version a commit skipped is not in the history; every one written is read.
    const raw = await readFile(join(rig.dirs.store, 'runs', rig.runId, 'state', `${String(v)}.json`), 'utf8').catch(() => null);
    if (raw !== null) states.push(JSON.parse(raw) as RunState);
  }
  if (states.length === 0) throw new Error(`R10: no state of run ${rig.runId} was read back`);
  return states;
}

/** Every spec and request is within the narrowed scope: no host, and no tool but `read`. */
function withinNarrowed(specs: readonly SandboxSpec[], requests: readonly TaskRequest[], context: string): void {
  const wideSpec = specs.find((s) => s.egress.mode !== 'deny-all' || s.egress.allow.includes(HOST));
  if (wideSpec !== undefined) throw new Error(`${context}: a sandbox was provisioned with egress ${JSON.stringify(wideSpec.egress)} after the run narrowed`);
  const wideRequest = requests.find((r) => r.tools.some((t) => t !== 'read'));
  if (wideRequest !== undefined) throw new Error(`${context}: task ${wideRequest.taskId} was handed the tools ${JSON.stringify(wideRequest.tools)} after the run narrowed`);
}

/** A candidate run by a `collaborator`, admitted under `policy` and not yet driven. */
async function candidateRun(rig: LineRig, policy: Policy, components: Awaited<ReturnType<LineRig['components']>>, level: 0 | 1 = 1) {
  const { admitRun } = await api();
  const candidate = await plantCandidate(components.vault, `r10-${rig.runId}`, { authorTrust: 'collaborator', extracted: { repository: 'octo/hello', number: '1', labels: '', authorTrust: 'collaborator' } });
  return admitRun(await rig.request(components, { policy, candidate, requestedLevel: level }));
}

// ---------------------------------------------------------------------------

export const NARROWED_SCOPE_NO_WIDER: LocalAssertion = runtime({
  id: 'I4.narrowed-scope-no-wider-than-its-role',
  title: "a role's narrowed scope is refused at validation where it names a tool or a host the role lacks, or a ceiling above the role's, and a sensitive grant must name a class the policy declares (R10, A-R10-01)",
  run: async () => {
    const { DEFAULT_POLICY_DOCUMENT, validatePolicyDocument } = await core();
    const doc = (narrowed: NarrowedScope, grants: string[] = []): PolicyDocument => ({
      ...DEFAULT_POLICY_DOCUMENT,
      sensitivePaths: { secrets: ['secrets/**'] },
      roles: { [BUILDER]: wide(lineScope(['build'], 'standard'), narrowed, grants) },
    });
    const control = validatePolicyDocument(doc(narrowTo(1), ['secrets']));
    if (!control.ok) throw new Error(`R10 control: a narrowed scope within its role's was refused: ${JSON.stringify(control.defects)}`);
    const cases: Array<[string, NarrowedScope | null, string[]]> = [
      ['a tool the role lacks', { ...narrowTo(1), tools: ['read', 'shell'] }, []],
      ['a host the role cannot reach', { ...narrowTo(1), network: { egress: [HOST, 'elsewhere.example.test'] } }, []],
      ['a ceiling above the role', narrowTo(2), []],
      ['an undeclared class', narrowTo(1), ['keys']],
    ];
    for (const [what, narrowed, grants] of cases) {
      // The role's own ceiling is 2 in `lineScope`; drop it to 1 so a narrowed 2 is above it.
      const d = doc(narrowed ?? narrowTo(1), grants);
      const role = d.roles[BUILDER];
      if (role === undefined) throw new Error('R10: the builder role is missing from its own document');
      const checked = validatePolicyDocument({ ...d, roles: { [BUILDER]: { ...role, autonomyCeiling: 1 } } });
      if (checked.ok) throw new Error(`R10: a narrowed scope naming ${what} validated`);
    }
  },
});

export const NARROWED_RUN_REFUSES_UNNARROWED_ROLE: LocalAssertion = runtime({
  id: 'I5.narrowed-run-refuses-a-role-with-no-narrowed-scope',
  title: 'a run narrowed at admission — by an author below narrowBelow, or by a seated role holding a sensitive grant — that seats a role declaring no narrowed scope is refused before anything is written; the same run with every role narrowed is admitted (R10, D-A-TR-02)',
  run: async () => {
    await withLine('r10-unnarrowed-trust-', async (rig) => {
      const components = await rig.components();
      const outcome = await candidateRun(rig, await candidatePolicy({ builder: narrowTo(1), reviewer: null }, { issue: 'owner' }), components);
      if (outcome.ok || outcome.reason !== 'policy-refused' || outcome.role !== REVIEWER || outcome.refusal.reason !== 'capability-missing') {
        throw new Error(`I5: a trust-narrowed run seating a reviewer with no narrowed scope was ${JSON.stringify(outcome.ok ? 'admitted' : outcome)}`);
      }
    });
    await withLine('r10-unnarrowed-grant-', async (rig) => {
      const { admitRun } = await api();
      const policy = await linePolicy({}, { sensitivePaths: { secrets: ['secrets/**'] }, roles: roles({ builder: narrowTo(1), reviewer: null }, ['secrets']) });
      const outcome = await admitRun(await rig.request(await rig.components(), { policy }));
      if (outcome.ok || outcome.reason !== 'policy-refused' || outcome.role !== REVIEWER) {
        throw new Error(`I5: a grant-narrowed run seating a reviewer with no narrowed scope was ${JSON.stringify(outcome.ok ? 'admitted' : outcome)}`);
      }
    });
    await withLine('r10-unnarrowed-control-', async (rig) => {
      const components = await rig.components();
      const outcome = await candidateRun(rig, await candidatePolicy({ builder: narrowTo(1), reviewer: narrowTo(1) }, { issue: 'owner' }), components);
      if (!outcome.ok) throw new Error(`I5 control: a trust-narrowed run with every role narrowed was refused: ${JSON.stringify(outcome)}`);
    });
  },
});

/** An author below `narrowBelow`, admitted narrowed; the decision and the first state both say so. Shared with P14's table. */
export async function authorTrustNarrowing(): Promise<void> {
  await withLine('r10-trust-', async (rig) => {
    const components = await rig.components();
    const outcome = await candidateRun(rig, await candidatePolicy({ builder: narrowTo(1), reviewer: narrowTo(1) }, { issue: 'owner' }), components);
    if (!outcome.ok) throw new Error(`R10: a collaborator below narrowBelow 'owner' was not admitted: ${JSON.stringify(outcome)}`);
    const first = outcome.admitted.state;
    if (first.narrowed?.cause.kind !== 'author-trust' || first.narrowed.cause.trust !== 'collaborator' || first.narrowed.level !== 1) {
      throw new Error(`R10: the first state of a trust-narrowed run carries ${JSON.stringify(first.narrowed)}`);
    }
    const found = narrowings(await decisionsOf(components.vault, rig.runId));
    const [d] = found;
    if (found.length !== 1 || d?.decision.cause !== 'capability-narrowed' || d.decision.decidedBy !== 'admission' || d.decision.narrowing.kind !== 'author-trust'
      || d.taskId !== null || d.station !== 'intake' || JSON.stringify(Object.keys(d.decision.scopes).sort()) !== JSON.stringify([BUILDER, REVIEWER])) {
      throw new Error(`R10: a trust narrowing was recorded as ${JSON.stringify(found)}`);
    }
  });
  // At or above it, the same candidate is admitted at full scope, with nothing recorded.
  await withLine('r10-trust-control-', async (rig) => {
    const components = await rig.components();
    const outcome = await candidateRun(rig, await candidatePolicy({ builder: narrowTo(1), reviewer: narrowTo(1) }, { issue: 'collaborator' }), components);
    if (!outcome.ok || outcome.admitted.state.narrowed !== null) throw new Error(`R10 control: a collaborator at narrowBelow was ${JSON.stringify(outcome.ok ? outcome.admitted.state.narrowed : outcome)}`);
    if (narrowings(await decisionsOf(components.vault, rig.runId)).length !== 0) throw new Error('R10 control: an unnarrowed run recorded a narrowing');
  });
  // A level above the narrowed ceiling is an over-request, refused, never admitted lower (D-R10-02).
  await withLine('r10-trust-over-', async (rig) => {
    const components = await rig.components();
    const outcome = await candidateRun(rig, await candidatePolicy({ builder: narrowTo(0), reviewer: narrowTo(1) }, { issue: 'owner' }), components);
    if (outcome.ok || outcome.reason !== 'policy-refused' || outcome.refusal.reason !== 'exceeds-cap' || outcome.role !== BUILDER) {
      throw new Error(`R10: L1 asked of a run whose narrowed ceiling is L0 was ${JSON.stringify(outcome.ok ? 'admitted' : outcome)}`);
    }
  });
}

export const AUTHOR_BELOW_NARROWBELOW_ADMITTED_NARROWED: LocalAssertion = runtime({
  id: 'I4.author-below-narrowbelow-admitted-narrowed',
  title: "an admitted author below the kind's narrowBelow is admitted narrowed: the first state carries the narrowing, and admission records capability-narrowed with each seated role's narrowed scope; an author at narrowBelow is not narrowed, and a level above a narrowed ceiling is refused, never lowered (R10, A-R10-01, D-R10-02)",
  run: authorTrustNarrowing,
});

export const NO_TASK_BEYOND_NARROWED_SCOPE: LocalAssertion = runtime({
  id: 'I4.no-task-after-narrowing-beyond-the-narrowed-scope',
  title: "every task of a narrowed run gets a sandbox, tools, and an exit level from its role's narrowed scope: a run narrowed at admission provisions no host and hands no tool beyond it through review, and a run narrowed by input at build reads build's exit approval at the narrowed level (R10, D-A-TR-03)",
  run: async () => {
    await withLine('r10-scope-', async (rig) => {
      const { sandbox, specs } = await recordingSandbox();
      const driver = await stubDriver();
      const components = await rig.components({ sandbox, driver, reviewer: driver });
      const outcome = await candidateRun(rig, await candidatePolicy({ builder: narrowTo(1), reviewer: narrowTo(1) }, { issue: 'owner' }), components);
      if (!outcome.ok) throw new Error(`R10: the narrowed candidate run was refused: ${JSON.stringify(outcome)}`);
      await outcome.admitted.drive();
      const state = await rig.state();
      if (state.tasks[HELLO_REVIEW] !== 'passed' || driver.requests.length < 2) throw new Error(`R10: the narrowed run did not reach its review (${JSON.stringify(state.tasks)})`);
      withinNarrowed(specs, driver.requests, 'R10');
    });
    // The control: the same run unnarrowed is handed the wide scope, so the check above can see one.
    await withLine('r10-scope-control-', async (rig) => {
      const { sandbox, specs } = await recordingSandbox();
      const driver = await stubDriver();
      const components = await rig.components({ sandbox, driver, reviewer: driver });
      const outcome = await candidateRun(rig, await candidatePolicy({ builder: narrowTo(1), reviewer: narrowTo(1) }, {}), components);
      if (!outcome.ok) throw new Error(`R10 control: the unnarrowed candidate run was refused: ${JSON.stringify(outcome)}`);
      await outcome.admitted.drive();
      let wideSeen = true;
      try {
        withinNarrowed(specs, driver.requests, 'control');
        wideSeen = false;
      } catch {
        // The wide scope reached a task, as it should in an unnarrowed run.
      }
      if (!wideSeen) throw new Error('R10 control: an unnarrowed run was handed only the narrowed scope');
    });
    // Narrowed by input at build: build's exit is read at the narrowed L0, where it needs a person.
    for (const narrowed of [true, false]) {
      await withLine(`r10-level-${String(narrowed)}-`, async (rig) => {
        const outcome = await inputRun(rig, { ceiling: 0, cells: { 'build:0': 'human-required' }, input: narrowed });
        if (!outcome.ok) throw new Error(`R10: the input run was refused at admission: ${JSON.stringify(outcome)}`);
        const ended = await outcome.admitted.drive(narrowed ? { inputFor: (t) => (t.id === HELLO_TASK ? { source: 'repo-instructions', text: INPUT } : null) } : {});
        const waiting = !ended.ok && ended.reason === 'refused' && ended.transition.reason === 'approval-required' && ended.transition.key === 'build:0';
        if (narrowed !== waiting) throw new Error(`R10: a run ${narrowed ? '' : 'not '}narrowed at build to L0 ended ${JSON.stringify(ended.ok ? 'passed' : ended.reason === 'refused' ? ended.transition : ended)}`);
      });
    }
  },
});

/** A person's run of the hello fixture under wide, narrowable roles at `ceiling`, with `cells` added to the approvals. */
async function inputRun(
  rig: LineRig,
  options: { ceiling: 0 | 1; cells?: Partial<Record<ApprovalKey, ApprovalOutcome>>; input: boolean; components?: Awaited<ReturnType<LineRig['components']>>; reviewer?: NarrowedScope | null },
) {
  const { admitRun } = await api();
  const policy = await linePolicy(options.cells ?? {}, { roles: roles({ builder: narrowTo(options.ceiling), reviewer: options.reviewer === undefined ? narrowTo(options.ceiling) : options.reviewer }) });
  return admitRun(await rig.request(options.components ?? (await rig.components()), { policy }));
}

/** Input brought at build narrows the run, recorded by the line over the build task. Shared with P14's table. */
export async function inputNarrowing(): Promise<void> {
  await withLine('r10-input-', async (rig) => {
    const { sandbox, specs } = await recordingSandbox();
    let seenAt: { specs: number; narrowed: RunState['narrowed']; recorded: number } | null = null;
    const vaultRef: { vault: Vault | null } = { vault: null };
    const driver: ObservedDriver = await stubDriver({
      during: async (req) => {
        if (!req.variableSuffix.includes(INPUT)) return;
        const vault = vaultRef.vault;
        if (vault === null) throw new Error('R10: no vault to read');
        seenAt = { specs: specs.length, narrowed: (await vault.readRunState(rig.runId)).narrowed, recorded: narrowings(await decisionsOf(vault, rig.runId)).length };
      },
    });
    const components = await rig.components({ sandbox, driver, reviewer: driver });
    vaultRef.vault = components.vault;
    const outcome = await inputRun(rig, { ceiling: 1, input: true, components });
    if (!outcome.ok) throw new Error(`R10: the input run was refused at admission: ${JSON.stringify(outcome)}`);
    if (outcome.admitted.state.narrowed !== null) throw new Error('R10: a person\'s run with no input was narrowed at admission');
    await outcome.admitted.drive({ inputFor: (t) => (t.id === HELLO_TASK ? { source: 'repo-instructions', text: INPUT } : null) });
    const placed = driver.requests.filter((r) => r.variableSuffix.includes(INPUT));
    if (placed.length !== 1 || placed[0]?.taskId !== HELLO_TASK) throw new Error(`R10: the input was placed in ${String(placed.length)} requests`);
    const at = seenAt as { specs: number; narrowed: RunState['narrowed']; recorded: number } | null;
    if (at === null || at.narrowed?.cause.kind !== 'input' || at.recorded !== 1) {
      throw new Error(`R10: when the input reached a model the run held ${JSON.stringify(at)}, not a recorded and committed narrowing`);
    }
    // The sandbox the input reached was provisioned after the narrowing, from the narrowed scope.
    withinNarrowed(specs.slice(0, at.specs), placed, 'R10');
    if (placed.some((r) => r.role.instructions.includes(INPUT))) throw new Error('R10: the input reached a role prompt (I7)');
    const found = narrowings(await decisionsOf(components.vault, rig.runId));
    const [d] = found;
    if (found.length !== 1 || d?.decision.cause !== 'capability-narrowed' || d.decision.decidedBy !== 'line' || d.taskId !== HELLO_TASK || d.station !== 'build'
      || d.decision.narrowing.kind !== 'input' || d.decision.narrowing.source !== 'repo-instructions') {
      throw new Error(`R10: an input narrowing was recorded as ${JSON.stringify(found)}`);
    }
  });
}

export const NARROWING_INPUT_WITHHELD: LocalAssertion = runtime({
  id: 'I5.narrowing-input-withheld-until-narrowed',
  title: "input a declared source brings reaches a model only in a request whose sandbox was provisioned from the narrowed scope, after the narrowing was recorded and committed; where the record cannot be written, or a seated role has no narrowed scope, the input reaches no model and the drive stops (R10, D-A-TR-03, D-R10-03)",
  run: async () => {
    await inputNarrowing();
    for (const failure of ['record', 'role'] as const) {
      await withLine(`r10-withheld-${failure}-`, async (rig) => {
        const driver = await stubDriver();
        const built = await rig.components({ driver, reviewer: driver });
        const components = failure === 'record' ? await rig.components({ driver, reviewer: driver, vault: failingNarrowings(built.vault) }) : built;
        const outcome = await inputRun(rig, { ceiling: 1, input: true, components, ...(failure === 'role' ? { reviewer: null } : {}) });
        if (!outcome.ok) throw new Error(`R10: the ${failure} run was refused at admission: ${JSON.stringify(outcome)}`);
        let stopped = false;
        try {
          await outcome.admitted.drive({ inputFor: () => ({ source: 'trigger-fields', text: INPUT }) });
        } catch {
          stopped = true;
        }
        if (!stopped) throw new Error(`R10: a drive whose narrowing failed (${failure}) did not stop`);
        if (driver.requests.some((r) => r.variableSuffix.includes(INPUT))) throw new Error(`R10: input reached a model though its narrowing failed (${failure})`);
        if ((await rig.state()).narrowed !== null) throw new Error(`R10: a narrowing that failed (${failure}) was committed`);
      });
    }
  },
});

export const NO_CALL_RESTORES_CAPABILITY: LocalAssertion = runtime({
  id: 'I4.no-call-restores-a-narrowed-capability',
  title: "once committed, a run's narrowing is in every later state, through an approval, a resume with no input, and a second input, and the tasks after it are handed only the narrowed scope (R10, A-R10-02)",
  run: async () => {
    await withLine('r10-ratchet-', async (rig) => {
      const { approveStation, resumeRun } = await api();
      const { sandbox, specs } = await recordingSandbox();
      const driver = await stubDriver();
      const components = await rig.components({ sandbox, driver, reviewer: driver });
      const outcome = await inputRun(rig, { ceiling: 0, cells: { 'build:0': 'human-required' }, input: true, components });
      if (!outcome.ok) throw new Error(`R10: the ratchet run was refused at admission: ${JSON.stringify(outcome)}`);
      await outcome.admitted.drive({ inputFor: (t) => (t.id === HELLO_TASK ? { source: 'repo-instructions', text: INPUT } : null) });
      const first = (await rig.state()).narrowed;
      if (first === null) throw new Error('R10: the input did not narrow the run');
      const approved = await approveStation({ runId: rig.runId, key: 'build:0', approvedBy: 'maintainer', vault: components.vault });
      if (!approved.ok) throw new Error(`R10: build's exit at the narrowed level could not be approved: ${JSON.stringify(approved)}`);
      const before = specs.length;
      const reopened = await rig.components({ sandbox, driver, reviewer: driver });
      // A second input on resume finds the run narrowed and leaves it so.
      await resumeRun({ runId: rig.runId, components: reopened }, { inputFor: () => ({ source: 'trigger-fields', text: INPUT }) });
      const states = await history(rig);
      const from = states.findIndex((s) => s.narrowed !== null);
      const cleared = states.slice(from).find((s) => JSON.stringify(s.narrowed) !== JSON.stringify(first));
      if (from === -1 || cleared !== undefined) throw new Error(`R10: a later state holds the narrowing ${JSON.stringify(cleared?.narrowed)} where ${JSON.stringify(first)} was committed`);
      if ((await rig.state()).tasks[HELLO_REVIEW] !== 'passed') throw new Error('R10: the narrowed run did not reach its review after the approval');
      withinNarrowed(specs.slice(before), driver.requests.slice(1), 'R10');
      if (specs.length === before) throw new Error('R10: no task ran after the narrowing, so nothing was checked');
      if (narrowings(await decisionsOf(components.vault, rig.runId)).length !== 1) throw new Error('R10: a second input narrowed the run again');
    });
  },
});

/** Writes `secrets/key.txt` into the workspace and a check that it is in the verified tree. */
async function withSecret(rig: LineRig): Promise<void> {
  await mkdir(join(rig.dirs.artifacts, 'secrets'), { recursive: true });
  await writeFile(join(rig.dirs.artifacts, SECRET), 'classified\n');
  const manifest = JSON.parse(await readFile(join(rig.dirs.artifacts, 'verify.json'), 'utf8')) as { checks: unknown[] };
  await writeManifest(rig.dirs, [
    ...manifest.checks,
    { id: 'sensitive-present', kind: 'compile', command: ['node', '-e', `process.exit(require('node:fs').existsSync(${JSON.stringify(SECRET)}) ? 0 : 1)`], required: true, timeoutMs: 10000 },
  ]);
}

/** Whether `path` is in the tree `req`'s sandbox mounts. */
function mounted(specs: readonly SandboxSpec[], req: TaskRequest, path: string): Promise<boolean> {
  const spec = specs.at(-1);
  if (spec === undefined) throw new Error(`R10: no sandbox was provisioned for task ${req.taskId}`);
  return readFile(join(spec.mounts.workspace.source, ...path.split('/'))).then(() => true, () => false);
}

/** A run of the hello fixture with `secrets/**` classified; the builder granted it when `granted`, and `onBuild` run in its sandbox. */
async function sensitiveRun(rig: LineRig, granted: boolean, onBuild: (req: TaskRequest, specs: readonly SandboxSpec[]) => Promise<void>) {
  const { admitRun } = await api();
  await withSecret(rig);
  const { sandbox, specs } = await recordingSandbox();
  const driver = await stubDriver({ during: (req) => (req.taskId === HELLO_TASK ? onBuild(req, specs) : Promise.resolve()) });
  const components = await rig.components({ sandbox, driver, reviewer: driver });
  const policy = await linePolicy({}, { sensitivePaths: { secrets: ['secrets/**'] }, roles: roles({ builder: narrowTo(1), reviewer: narrowTo(1) }, granted ? ['secrets'] : []) });
  const outcome = await admitRun(await rig.request(components, { policy }));
  if (!outcome.ok) throw new Error(`R10: the sensitive run was refused at admission: ${JSON.stringify(outcome)}`);
  return { outcome: await outcome.admitted.drive(), components };
}

/** A role granted the class, in a run narrowed by that grant at admission; recorded by admission. Shared with P14's table. */
export async function grantNarrowing(): Promise<void> {
  await withLine('r10-granted-', async (rig) => {
    const seen = { value: null as boolean | null };
    const { components } = await sensitiveRun(rig, true, async (req, specs) => {
      seen.value = await mounted(specs, req, SECRET);
    });
    if (seen.value !== true) throw new Error('R10: a role granted the class in a run narrowed at admission was not handed its path');
    const state = await rig.state();
    if (state.narrowed?.cause.kind !== 'sensitive-grant') throw new Error(`R10: a grant-narrowed run holds ${JSON.stringify(state.narrowed)}`);
    const [d] = narrowings(await decisionsOf(components.vault, rig.runId));
    if (d?.decision.cause !== 'capability-narrowed' || d.decision.decidedBy !== 'admission' || d.decision.narrowing.kind !== 'sensitive-grant'
      || JSON.stringify(d.decision.narrowing.roles) !== JSON.stringify([BUILDER])) {
      throw new Error(`R10: a grant narrowing was recorded as ${JSON.stringify(d)}`);
    }
  });
}

export const SENSITIVE_PATH_WITHHELD: LocalAssertion = runtime({
  id: 'I4.sensitive-path-absent-from-an-ungranted-tree',
  title: "a path a sensitive class matches is absent from the tree an ungranted task is handed, verification still sees it, the task's diff does not delete it, and a write to the class is refused as a capability escape; a role granted it in a run narrowed at admission is handed it (R10, D-A-TR-04, D-R10-05)",
  run: async () => {
    await withLine('r10-sensitive-', async (rig) => {
      const seen = { value: null as boolean | null };
      const { outcome } = await sensitiveRun(rig, false, async (req, specs) => {
        seen.value = await mounted(specs, req, SECRET);
      });
      if (seen.value !== false) throw new Error('R10: an ungranted task was handed the sensitive path');
      const state = await rig.state();
      // Passed `verify`, whose `sensitive-present` check fails on a tree without the path, so the diff deleted nothing.
      if (state.tasks[HELLO_TASK] !== 'passed') throw new Error(`R10: the ungranted task did not pass verify over the full tree: ${JSON.stringify(outcome.ok ? state.tasks : outcome)}`);
    });
    for (const path of [SECRET, 'secrets/new.txt']) {
      await withLine(`r10-sensitive-write-${path.endsWith('new.txt') ? 'new' : 'old'}-`, async (rig) => {
        const { outcome } = await sensitiveRun(rig, false, async (_req, specs) => {
          const spec = specs.at(-1);
          if (spec === undefined) throw new Error('R10: no sandbox');
          await mkdir(join(spec.mounts.workspace.source, 'secrets'), { recursive: true });
          await writeFile(join(spec.mounts.workspace.source, ...path.split('/')), 'replaced\n');
        });
        if (outcome.ok || outcome.reason !== 'refused' || outcome.transition.reason !== 'violation' || !outcome.transition.message.includes(path)) {
          throw new Error(`R10: a write to ${path} by an ungranted task ended ${JSON.stringify(outcome.ok ? 'passed' : outcome)}`);
        }
      });
    }
    await grantNarrowing();
    // A class is matched against tree-relative paths, so a glob that is not one would classify nothing and is refused (codex-4).
    const { DEFAULT_POLICY_DOCUMENT, validatePolicyDocument } = await core();
    for (const glob of ['/secrets/key.txt', './secrets/**', 'secrets\\key.txt', '../secrets/**', 'secrets/../../x', 'C:/secrets/**']) {
      if (validatePolicyDocument({ ...DEFAULT_POLICY_DOCUMENT, sensitivePaths: { secrets: [glob] } }).ok) throw new Error(`R10: the sensitive glob ${JSON.stringify(glob)}, which no tree-relative path matches, validated`);
    }
    if (!validatePolicyDocument({ ...DEFAULT_POLICY_DOCUMENT, sensitivePaths: { secrets: ['secrets/**', '**/.env'] } }).ok) throw new Error('R10 control: tree-relative sensitive globs were refused');
    await sensitiveDraftGoesBack();
    // A locked artifact is context every seat is offered as text, so none may be sensitive: admission refuses it (codex-1).
    await withLine('r10-sensitive-artifact-', async (rig) => {
      const { admitRun } = await api();
      const policy = await linePolicy({}, { sensitivePaths: { specs: ['spec.md'] }, roles: roles({ builder: narrowTo(1), reviewer: narrowTo(1) }) });
      const outcome = await admitRun(await rig.request(await rig.components(), { policy }));
      if (outcome.ok || outcome.reason !== 'invalid-request' || !outcome.problems.some((p) => p.code === 'sensitive-artifact' && p.message.includes('spec.md'))) {
        throw new Error(`R10: a run whose locked spec is sensitive was ${JSON.stringify(outcome.ok ? 'admitted' : outcome)}`);
      }
    });
  },
});

export const POLICY_WITHOUT_R10_KEYS_UNCHANGED: LocalAssertion = runtime({
  id: 'I5.policy-without-r10-keys-admits-as-before',
  title: 'a policy written before R10, with no sensitivePaths, sensitiveGrants, narrowed, or narrowBelow, validates and resolves to none of each, and a run under it, or a candidate below every floor-level narrowBelow, is admitted and driven as before: not narrowed, and nothing recorded (R10, A-R10-01)',
  run: async () => {
    const { validatePolicyDocument } = await core();
    await withLine('r10-before-', async (rig) => {
      const { startRun } = await api();
      const current = await linePolicy();
      const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown> & { roles: Record<string, Record<string, unknown>>; triggers: Record<string, unknown> };
      delete legacy.sensitivePaths;
      delete legacy.triggers.narrowBelow;
      for (const scope of Object.values(legacy.roles)) {
        delete scope.sensitiveGrants;
        delete scope.narrowed;
      }
      const checked = validatePolicyDocument(legacy);
      if (!checked.ok) throw new Error(`R10: a policy with no R10 keys was refused: ${JSON.stringify(checked.defects)}`);
      const doc = checked.document;
      if (Object.keys(doc.sensitivePaths).length !== 0 || Object.keys(doc.triggers.narrowBelow).length !== 0
        || Object.values(doc.roles).some((s) => s.sensitiveGrants.length !== 0 || s.narrowed !== null)) {
        throw new Error(`R10: a policy with no R10 keys resolved to ${JSON.stringify(doc)}`);
      }
      const components = await rig.components();
      // The figure a person approved, read under the same policy resolved; the request carries the policy as written.
      const { approvedCostUsd } = await rig.request(components, { policy: current });
      const outcome = await startRun(await rig.request(components, { policy: legacy as unknown as Policy, approvedCostUsd }));
      const state = await rig.state();
      if (state.narrowed !== null || narrowings(await decisionsOf(components.vault, rig.runId)).length !== 0) throw new Error('R10: a run under a pre-R10 policy was narrowed');
      if (state.tasks[HELLO_TASK] !== 'passed' || state.tasks[HELLO_REVIEW] !== 'passed') {
        throw new Error(`R10: a run under a pre-R10 policy ended ${JSON.stringify(outcome.ok ? state.tasks : outcome)}`);
      }
    });
  },
});

export const R10_I4: readonly LocalAssertion[] = [
  NARROWED_SCOPE_NO_WIDER, AUTHOR_BELOW_NARROWBELOW_ADMITTED_NARROWED, NO_TASK_BEYOND_NARROWED_SCOPE, NO_CALL_RESTORES_CAPABILITY, SENSITIVE_PATH_WITHHELD,
];
export const R10_I5: readonly LocalAssertion[] = [NARROWED_RUN_REFUSES_UNNARROWED_ROLE, NARROWING_INPUT_WITHHELD, POLICY_WITHOUT_R10_KEYS_UNCHANGED];
