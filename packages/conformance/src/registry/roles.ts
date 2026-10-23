/**
 * R20: the role compiler. Every seat runs under instructions a person wrote,
 * compiled from the roles directory at admission and pinned there by hash
 * (D-A-RC-01 to D-A-RC-06).
 *
 * Each assertion drives the real admission and line in `@olympus-ai/api` over
 * the real compiler and filesystem Vault, with the rig's copy of the shipped
 * roles, so a role file edited or broken here is one the runtime reads. The
 * Claude Code driver's rendering is checked on the argv it builds, over a
 * provider that records every exec and starts nothing.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunOutcome } from '@olympus-ai/api';
import type { CompiledRole, RoleId, TaskId, TaskRequest } from '@olympus-ai/core';
import type { ExecResult, SandboxHandle, SandboxProvider, SandboxSpec, Teardown } from '@olympus-ai/sandbox';
import type { AdmissionRecord, UsageRecord } from '@olympus-ai/vault';
import { compileError, runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { workspaceRoot } from '../kit/workspace.js';
import { HELLO_REVIEW, HELLO_TASK, lineScope, linePolicy, readRecord, stubDriver, withLine, type LineRig } from './line.js';

const api = async () => import('@olympus-ai/api');

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The hash of the rig's copy of a role file, as it stands now. */
async function fileHash(rig: LineRig, role: string): Promise<string> {
  return sha256(await readFile(join(rig.roles, `${role}.md`)));
}

/** A run of the hello fixture to its stop for approval at `integrate`, through a stub driver that records every request. */
async function runHello(rig: LineRig, beforeDrive?: () => Promise<void>) {
  const { admitRun } = await api();
  const driver = await stubDriver();
  const reviewer = await stubDriver({ family: 'other' });
  const components = await rig.components({ driver, reviewer });
  const admission = await admitRun(await rig.request(components));
  if (!admission.ok) throw new Error(`R20: the hello run was refused at admission as ${admission.reason}`);
  if (beforeDrive !== undefined) await beforeDrive();
  const outcome = await admission.admitted.drive();
  return { outcome, driver, reviewer, components };
}

async function admissionOf(rig: LineRig, vault: Parameters<typeof readRecord>[0]): Promise<AdmissionRecord> {
  const state = await vault.readRunState(rig.runId);
  return readRecord<AdmissionRecord>(vault, state.admission);
}

/** The refusal `outcome` carries, or a failure naming what it was instead. */
function refusedAs<R extends Exclude<RunOutcome, { ok: true }>['reason']>(outcome: RunOutcome, reason: R, what: string): Extract<RunOutcome, { reason: R }> {
  if (outcome.ok || outcome.reason !== reason) throw new Error(`R20: ${what} was ${outcome.ok ? 'admitted' : `refused as ${outcome.reason}`}, not refused as ${reason}`);
  return outcome as Extract<RunOutcome, { reason: R }>;
}

/** Nothing ran and nothing but the decision was stored: no state, and no driver call. */
async function nothingRan(rig: LineRig, requests: readonly unknown[], what: string): Promise<void> {
  if (requests.length > 0) throw new Error(`R20: ${what} reached the driver ${String(requests.length)} times before it was refused`);
  const { isNoRunState } = await import('@olympus-ai/vault');
  const vault = (await rig.components()).vault;
  try {
    await vault.readRunState(rig.runId);
  } catch (error) {
    if (isNoRunState(error)) return;
    throw error;
  }
  throw new Error(`R20: ${what} left run state behind`);
}

export const ADMISSION_PINS_EVERY_ROLE: LocalAssertion = runtime({
  id: 'I3.admission-pins-every-role',
  title:
    'a run admitted with the roles directory records every compiled role, its instructions, and the SHA-256 of its file in the admission record; a role file edited after admission changes nothing the run\'s tasks receive, before the drive or on a resume, while a later run gets the edit',
  run: async () => {
    await withLine('r20-pin-', async (rig) => {
      const builderHash = await fileHash(rig, 'builder');
      const original = await readFile(join(rig.roles, 'builder.md'), 'utf8');
      const edited = `${original}\nAn instruction added after admission.\n`;
      const { driver, components } = await runHello(rig, () => writeFile(join(rig.roles, 'builder.md'), edited));

      const record = await admissionOf(rig, components.vault);
      const pinned = record.roles.map((r) => ({ role: r.role, sha256: r.sha256 }));
      const expected = [{ role: 'builder', sha256: builderHash }, { role: 'reviewer', sha256: await fileHash(rig, 'reviewer') }];
      if (JSON.stringify(pinned) !== JSON.stringify(expected)) throw new Error(`R20: the admission record pins ${JSON.stringify(pinned)}, not every role in the directory with its file's hash ${JSON.stringify(expected)}`);
      if (record.roles[0]?.instructions !== original) throw new Error('R20: the admission record does not carry the builder role\'s instructions as admitted');

      const [build] = driver.requests;
      if (build === undefined) throw new Error('R20: the builder was never called');
      if (build.role.instructions !== original || build.role.sha256 !== builderHash) {
        throw new Error('R20: the builder ran under the role file as edited after admission, not as the run was admitted with');
      }

      // A resume reads the pinned roles from the record, never the directory.
      const { resumeRun } = await api();
      const again = await stubDriver();
      await resumeRun({ runId: rig.runId, components: await rig.components({ driver: again, reviewer: await stubDriver({ family: 'other' }) }) });
      if (again.requests.some((r) => r.role.instructions !== original && r.role.role === 'builder')) throw new Error('R20: a resume ran the builder under the edited role file');

      // A later run is admitted with the edit.
      const { compileRoles } = await import('@olympus-ai/compiler');
      const later = await compileRoles(rig.roles);
      if (!later.ok || later.roles.find((r) => r.role === 'builder')?.sha256 !== sha256(edited)) throw new Error('R20: the edited role file does not compile to its new version');
    });
  },
});

export const SEAT_WITHOUT_A_ROLE_IS_REFUSED: LocalAssertion = runtime({
  id: 'I5.seat-without-a-role-is-refused',
  title:
    'a task graph naming a role with no role file is refused at admission as role-undefined, naming the role, before any driver call and with no run state; so is a run whose roles directory defines no reviewer; the CLI\'s default prompt is never a fallback',
  run: async () => {
    await withLine('r20-undefined-', async (rig) => {
      const { startRun } = await api();
      // The graph's builder task names a role the directory lacks, though the policy grants it.
      const graphPath = join(rig.dirs.artifacts, 'graph.json');
      await writeFile(graphPath, (await readFile(graphPath, 'utf8')).replace('"role": "builder"', '"role": "implementer"'));
      const policy = await linePolicy({}, { roles: { ['implementer' as RoleId]: lineScope(['build', 'verify'], 'standard'), ['reviewer' as RoleId]: lineScope(['review'], 'deep') } });
      const driver = await stubDriver();
      const outcome = await startRun(await rig.request(await rig.components({ driver, reviewer: driver }), { policy }));
      const refused = refusedAs(outcome, 'role-undefined', 'a graph naming a role with no file');
      if (JSON.stringify(refused.roles) !== JSON.stringify(['implementer'])) throw new Error(`R20: the refusal named ${JSON.stringify(refused.roles)}, not the undefined role`);
      await nothingRan(rig, driver.requests, 'a graph naming a role with no file');
    });
    await withLine('r20-no-reviewer-', async (rig) => {
      const { startRun } = await api();
      await rm(join(rig.roles, 'reviewer.md'));
      const driver = await stubDriver();
      const outcome = await startRun(await rig.request(await rig.components({ driver, reviewer: driver })));
      const refused = refusedAs(outcome, 'role-undefined', 'a run with no reviewer role');
      if (!refused.roles.includes('reviewer' as RoleId)) throw new Error(`R20: the refusal named ${JSON.stringify(refused.roles)}, not reviewer`);
      await nothingRan(rig, driver.requests, 'a run with no reviewer role');
    });
  },
});

/** One broken entry, and the code the compiler must refuse it with. */
const BROKEN_ENTRIES: ReadonlyArray<{ readonly what: string; readonly entry: string; readonly code: string; readonly make: (dir: string) => Promise<void> }> = [
  { what: 'an oversized role file', entry: 'builder.md', code: 'too-large', make: (dir) => writeFile(join(dir, 'builder.md'), 'a'.repeat(32 * 1024 + 1)) },
  { what: 'a role file that is not UTF-8', entry: 'builder.md', code: 'not-utf8', make: (dir) => writeFile(join(dir, 'builder.md'), new Uint8Array([0x42, 0xc3, 0x28])) },
  { what: 'an empty role file', entry: 'builder.md', code: 'empty', make: (dir) => writeFile(join(dir, 'builder.md'), '') },
  { what: 'a misnamed role file', entry: 'Planner.md', code: 'invalid-name', make: (dir) => writeFile(join(dir, 'Planner.md'), 'Plan.') },
  { what: 'a directory in the roles directory', entry: 'drafts', code: 'not-regular', make: (dir) => mkdir(join(dir, 'drafts')) },
];

export const BROKEN_ROLE_ENTRY_REFUSES_ADMISSION: LocalAssertion = runtime({
  id: 'I5.broken-role-entry-refuses-admission',
  title:
    'an oversized, non-UTF-8, empty, misnamed, or non-regular entry in the roles directory refuses admission as roles-refused, naming the entry and its code, before any driver call and with no run state; the 32 KiB cap admits a file exactly at it; a symbolic link is refused even when it points at a valid role file',
  run: async () => {
    for (const broken of BROKEN_ENTRIES) {
      await withLine(`r20-broken-${broken.code}-`, async (rig) => {
        const { startRun } = await api();
        await broken.make(rig.roles);
        const driver = await stubDriver();
        const outcome = await startRun(await rig.request(await rig.components({ driver, reviewer: driver })));
        const refused = refusedAs(outcome, 'roles-refused', broken.what);
        if (!refused.refused.some((r) => r.entry === broken.entry && r.code === broken.code && r.message.includes(broken.entry))) {
          throw new Error(`R20: ${broken.what} was refused naming ${JSON.stringify(refused.refused)}, not ${broken.entry} as ${broken.code}`);
        }
        await nothingRan(rig, driver.requests, broken.what);
      });
    }
    // The cap is the cap: a file exactly at it is admitted, so the refusal above is the limit's and not the content's.
    await withLine('r20-at-cap-', async (rig) => {
      const { admitRun } = await api();
      await writeFile(join(rig.roles, 'builder.md'), 'a'.repeat(32 * 1024));
      const admitted = await admitRun(await rig.request(await rig.components()));
      if (!admitted.ok) throw new Error(`R20: a role file exactly at the byte cap was refused as ${admitted.reason}`);
    });
    await withLine('r20-link-', async (rig) => {
      const { startRun } = await api();
      const target = join(rig.dirs.artifacts, 'planted-role.md');
      await writeFile(target, 'Instructions planted where an agent can write them.');
      await rm(join(rig.roles, 'builder.md'));
      try {
        await symlink(target, join(rig.roles, 'builder.md'), 'file');
      } catch {
        // A host that cannot make a link without privilege cannot plant one either; the compiler's own suite covers it where it can.
        return;
      }
      const outcome = await startRun(await rig.request(await rig.components()));
      const refused = refusedAs(outcome, 'roles-refused', 'a role file that is a link into the workspace');
      if (!refused.refused.some((r) => r.entry === 'builder.md' && r.code === 'not-regular')) throw new Error(`R20: the link was refused as ${JSON.stringify(refused.refused)}`);
    });
  },
});

export const ROLES_DIRECTORY_OUTSIDE_EVERY_MOUNT: LocalAssertion = runtime({
  id: 'I1.roles-directory-outside-every-mount',
  title:
    'admission refuses a roles directory inside the workspace or the workspace store, as an invalid request on roles, before anything is compiled or stored: a copy of either is what a sandbox mounts, so a role there is one an agent could rewrite',
  run: async () => {
    await withLine('r20-inside-', async (rig) => {
      const { startRun } = await api();
      const places = [join(rig.dirs.artifacts, 'roles'), join(rig.workspaces.root, 'roles')];
      for (const inside of places) {
        await cp(rig.roles, inside, { recursive: true });
        const driver = await stubDriver();
        const outcome = await startRun(await rig.request(await rig.components({ driver, reviewer: driver }), { roles: inside }));
        const refused = refusedAs(outcome, 'invalid-request', `a roles directory at ${inside}`);
        if (!refused.problems.some((p) => p.path === 'roles' && p.code === 'overlaps')) throw new Error(`R20: a roles directory at ${inside} was refused for ${JSON.stringify(refused.problems)}`);
        await nothingRan(rig, driver.requests, `a roles directory at ${inside}`);
        await rm(inside, { recursive: true, force: true });
      }
    });
  },
});

export const ATTEMPT_RECORDS_ITS_ROLE_VERSION: LocalAssertion = runtime({
  id: 'I2.attempt-records-its-role-version',
  title:
    'every usage record a run state references names the role and the hash of the version its call ran under, beside the model, taken from the admission record: the builder\'s calls name builder, and the review seat\'s names reviewer',
  run: async () => {
    await withLine('r20-attempt-', async (rig) => {
      const { components } = await runHello(rig);
      const state = await components.vault.readRunState(rig.runId);
      const record = await admissionOf(rig, components.vault);
      const pinned = new Map(record.roles.map((r) => [r.role as string, r.sha256]));
      const usage = await Promise.all(state.usage.map((ref) => readRecord<UsageRecord>(components.vault, ref)));
      if (usage.length === 0) throw new Error('R20: the run state references no usage record');
      for (const u of usage) {
        const expected = u.taskId === HELLO_REVIEW ? 'reviewer' : u.taskId === HELLO_TASK ? 'builder' : undefined;
        if (u.role.id !== expected || u.role.sha256 !== pinned.get(expected)) {
          throw new Error(`R20: the call for ${u.taskId} records role ${JSON.stringify(u.role)}, not ${String(expected)} at its admitted hash`);
        }
        if (typeof u.model.model !== 'string' || u.model.model === '') throw new Error('R20: a usage record names a role but no model beside it');
      }
      if (!usage.some((u) => u.taskId === HELLO_REVIEW)) throw new Error('R20: no usage record covers the review seat');
    });
  },
});

export const REVIEW_SEAT_RUNS_AS_REVIEWER: LocalAssertion = runtime({
  id: 'I4.review-seat-runs-as-reviewer',
  title:
    'the review seat runs under the reviewer role\'s pinned instructions whatever role its task names, and under exactly the grants its task\'s role holds at review: a role is instructions, never a grant',
  run: async () => {
    await withLine('r20-review-', async (rig) => {
      // The review task names `auditor`, whose scope at review differs from `reviewer`'s; the seat's instructions are still reviewer's.
      const graphPath = join(rig.dirs.artifacts, 'graph.json');
      await writeFile(graphPath, (await readFile(graphPath, 'utf8')).replace('"role": "reviewer"', '"role": "auditor"'));
      await writeFile(join(rig.roles, 'auditor.md'), 'Instructions no review seat may run under.');
      const auditor = { ...lineScope(['review'], 'deep'), tools: [] as string[] };
      const policy = await linePolicy({}, { roles: { ['builder' as RoleId]: lineScope(['build', 'verify'], 'standard'), ['auditor' as RoleId]: auditor } });
      const { admitRun } = await api();
      const driver = await stubDriver();
      const reviewer = await stubDriver({ family: 'other' });
      const admission = await admitRun(await rig.request(await rig.components({ driver, reviewer }), { policy }));
      if (!admission.ok) throw new Error(`R20: the run was refused at admission as ${admission.reason}`);
      await admission.admitted.drive();
      const seat = reviewer.requests.find((r) => r.taskId === HELLO_REVIEW);
      if (seat === undefined) throw new Error('R20: the review seat was never called');
      const reviewerFile = await readFile(join(rig.roles, 'reviewer.md'), 'utf8');
      if (seat.role.role !== 'reviewer' || seat.role.instructions !== reviewerFile) throw new Error(`R20: the review seat ran under ${seat.role.role}, not the reviewer role`);
      if (JSON.stringify(seat.tools) !== JSON.stringify(auditor.tools)) throw new Error(`R20: the review seat's tools are ${JSON.stringify(seat.tools)}, not its task's grant ${JSON.stringify(auditor.tools)}`);
    });
  },
});

/** Records every exec and starts nothing; answers a `claude` invocation with a session that loaded `agents`. */
class RecordingProvider implements SandboxProvider {
  readonly id = 'recording';
  readonly calls: Array<{ readonly cmd: readonly string[]; readonly env: Readonly<Record<string, string>> }> = [];
  constructor(private readonly key: string, private readonly agents: readonly string[]) {}
  provision(_spec: SandboxSpec): Promise<SandboxHandle> {
    return Promise.resolve('recorded' as SandboxHandle);
  }
  exec(_h: SandboxHandle, cmd: string[], options?: { env?: Readonly<Record<string, string>> }): Promise<ExecResult> {
    this.calls.push({ cmd: [...cmd], env: { ...options?.env } });
    const init = { type: 'system', subtype: 'init', session_id: '11111111-2222-5333-a444-555566667777', tools: ['Read'], mcp_servers: [], agents: this.agents, model: 'm', apiKeySource: this.key, claude_code_version: '0' };
    const result = { type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'done', total_cost_usd: 0, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 } };
    return Promise.resolve({ exitCode: 0, stdout: `${JSON.stringify(init)}\n${JSON.stringify(result)}`, stderr: '', durationMs: 1 });
  }
  destroy(_h: SandboxHandle): Promise<Teardown> {
    return Promise.resolve({ meter: { kind: 'unmetered' }, egress: { kind: 'none' } });
  }
  capabilities() {
    return { computerUse: false, gpu: false, os: 'linux' as const, persistent: false, remote: false };
  }
}

export const DRIVER_RENDERS_THE_ROLE_ON_THE_INVOCATION: LocalAssertion = runtime({
  id: 'I3.driver-renders-the-role-on-the-invocation',
  title:
    'the Claude Code driver\'s argv carries the role\'s instructions as the agent the session runs as, with no field beside them that could carry a grant; no exec writes them into the workspace; and a session that did not load the role is refused rather than run under the CLI\'s default prompt',
  run: async () => {
    const { ClaudeCodeDriver, KEY_VARIABLE } = await import('@olympus-ai/driver-claude-code');
    const role: CompiledRole = { role: 'builder' as RoleId, instructions: 'A distinctive line only the role carries.', sha256: sha256('A distinctive line only the role carries.') };
    const request = (sandbox: SandboxHandle): TaskRequest => ({
      taskId: 't' as TaskId, role, stablePrefix: 'granted context', variableSuffix: 't', tier: 'standard', tools: ['Read'], sandbox, timeoutMs: 1000,
      budget: { maxTokens: 1, maxCostUsd: 1, maxWallClockMs: 1000 },
    });
    const provider = new RecordingProvider(KEY_VARIABLE, ['claude', 'builder']);
    await new ClaudeCodeDriver({ provider }).runTask(request('recorded' as SandboxHandle));
    const carrying = provider.calls.filter((c) => [...c.cmd, ...Object.values(c.env)].some((part) => part.includes(role.instructions)));
    const [task] = carrying;
    if (carrying.length !== 1 || !task?.cmd.includes('claude')) throw new Error(`R20: ${String(carrying.length)} execs carry the role's text; exactly one, the CLI invocation, may`);
    const at = task.cmd.indexOf('--agents');
    const agents = JSON.parse(task.cmd[at + 1] ?? '{}') as Record<string, Record<string, unknown>>;
    if (JSON.stringify(agents) !== JSON.stringify({ builder: { description: 'the builder role', prompt: role.instructions } })) {
      throw new Error(`R20: the argv's agent definition is ${JSON.stringify(agents)}, not the role's instructions alone`);
    }
    if (task.cmd[task.cmd.indexOf('--agent') + 1] !== 'builder') throw new Error('R20: the session does not run as the role');

    const unloaded = new RecordingProvider(KEY_VARIABLE, ['claude']);
    try {
      await new ClaudeCodeDriver({ provider: unloaded }).runTask(request('recorded' as SandboxHandle));
    } catch (error) {
      if ((error as Error).message.includes('did not load the builder role')) return;
      throw error;
    }
    throw new Error('R20: a session that did not load its role returned a result');
  },
});

export const COMPILER_TAKES_ONLY_A_DIRECTORY: LocalAssertion = runtime({
  id: 'I7.compiler-takes-only-a-directory',
  title:
    'the compiler package depends on core alone and imports nothing but node built-ins and core, so no trigger payload, check, rubric, or corpus type can reach it; compileRoles takes one parameter',
  run: async () => {
    const root = join(workspaceRoot(), 'packages', 'compiler');
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    if (JSON.stringify(Object.keys(manifest.dependencies ?? {})) !== JSON.stringify(['@olympus-ai/core'])) {
      throw new Error(`R20: the compiler depends on ${JSON.stringify(manifest.dependencies)}, not on core alone`);
    }
    for (const file of await readdir(join(root, 'src'))) {
      const source = await readFile(join(root, 'src', file), 'utf8');
      for (const [, from] of source.matchAll(/from '([^']+)'/g)) {
        if (from === undefined || from.startsWith('node:') || from.startsWith('./') || from === '@olympus-ai/core') continue;
        throw new Error(`R20: compiler/src/${file} imports ${from}`);
      }
    }
    const { compileRoles } = await import('@olympus-ai/compiler');
    if (compileRoles.length !== 1) throw new Error(`R20: compileRoles takes ${String(compileRoles.length)} parameters, not the directory alone`);
  },
});

export const R20_I1: readonly LocalAssertion[] = [ROLES_DIRECTORY_OUTSIDE_EVERY_MOUNT];
export const R20_I2: readonly LocalAssertion[] = [ATTEMPT_RECORDS_ITS_ROLE_VERSION];
export const R20_I3: readonly LocalAssertion[] = [ADMISSION_PINS_EVERY_ROLE, DRIVER_RENDERS_THE_ROLE_ON_THE_INVOCATION];
export const R20_I4: readonly LocalAssertion[] = [REVIEW_SEAT_RUNS_AS_REVIEWER];
export const R20_I5: readonly LocalAssertion[] = [SEAT_WITHOUT_A_ROLE_IS_REFUSED, BROKEN_ROLE_ENTRY_REFUSES_ADMISSION];
export const R20_I7: readonly LocalAssertion[] = [
  COMPILER_TAKES_ONLY_A_DIRECTORY,
  compileError({
    id: 'I7.compiler-refuses-untrusted-input',
    title: 'compileRoles given an UntrustedPayload, its raw text, or any second argument does not compile: the directory is its only input',
    fixture: 'i7/compiler-refuses-untrusted-input.ts',
  }),
];
