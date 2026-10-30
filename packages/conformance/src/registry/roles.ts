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
import { join, relative } from 'node:path';
import ts from 'typescript';
import type { RunOutcome } from '@olympus-ai/api';
import type { CompiledRole, RoleId, RunId, TaskId, TaskRequest } from '@olympus-ai/core';
import type { ExecResult, SandboxHandle, SandboxProvider, SandboxSpec, Teardown } from '@olympus-ai/sandbox';
import type { AdmissionRecord, UsageRecord } from '@olympus-ai/vault';
import { compileError, runtime } from '../kit/assert.js';
import type { Assertion, LocalAssertion } from '../kit/types.js';
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
      // Every role file the directory holds, the drafting seats' included (R19), each with its file's hash.
      const files = (await readdir(rig.roles)).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -'.md'.length)).sort();
      const expected = await Promise.all(files.map(async (role) => ({ role, sha256: role === 'builder' ? builderHash : await fileHash(rig, role) })));
      if (!files.includes('builder') || !files.includes('reviewer')) throw new Error(`R20: the rig's roles directory holds ${JSON.stringify(files)}`);
      if (JSON.stringify(pinned) !== JSON.stringify(expected)) throw new Error(`R20: the admission record pins ${JSON.stringify(pinned)}, not every role in the directory with its file's hash ${JSON.stringify(expected)}`);
      if (record.roles.find((r) => r.role === ('builder' as RoleId))?.instructions !== original) throw new Error('R20: the admission record does not carry the builder role\'s instructions as admitted');

      const [build] = driver.requests;
      if (build === undefined) throw new Error('R20: the builder was never called');
      if (build.role.instructions !== original || build.role.sha256 !== builderHash) {
        throw new Error('R20: the builder ran under the role file as edited after admission, not as the run was admitted with');
      }

      // A later run is admitted with the edit, and pins it.
      const { admitRun } = await api();
      const laterRunId = 'r20pinlaterrun' as RunId;
      const later = await admitRun(await rig.request(await rig.components(), { runId: laterRunId }));
      if (!later.ok) throw new Error(`R20: a later run was refused at admission as ${later.reason}`);
      const laterRecord = await readRecord<AdmissionRecord>(components.vault, (await components.vault.readRunState(laterRunId)).admission);
      const laterBuilder = laterRecord.roles.find((r) => r.role === 'builder');
      if (laterBuilder?.sha256 !== sha256(edited) || laterBuilder.instructions !== edited) throw new Error('R20: a run admitted after the edit does not pin the edited role file');
    });

    // A resume reads the pinned roles from the record, never the directory: a run admitted, its role file then
    // edited, and first driven by the resume, so the builder's only call is the resume's (codex-2, D-R20-11).
    await withLine('r20-pin-resume-', async (rig) => {
      const { admitRun, resumeRun } = await api();
      const builderHash = await fileHash(rig, 'builder');
      const original = await readFile(join(rig.roles, 'builder.md'), 'utf8');
      const admission = await admitRun(await rig.request(await rig.components()));
      if (!admission.ok) throw new Error(`R20: the hello run was refused at admission as ${admission.reason}`);
      await writeFile(join(rig.roles, 'builder.md'), `${original}\nAn instruction added after admission.\n`);
      const resumed = await stubDriver();
      await resumeRun({ runId: rig.runId, components: await rig.components({ driver: resumed, reviewer: await stubDriver({ family: 'other' }) }) });
      const builds = resumed.requests.filter((r) => r.role.role === 'builder');
      if (builds.length === 0) throw new Error('R20: the resume never called the builder, so no resumed role was delivered to check');
      if (builds.some((r) => r.role.instructions !== original || r.role.sha256 !== builderHash)) {
        throw new Error('R20: a resume ran the builder under the role file as edited after admission, not as the run was admitted with');
      }
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
      // No catch: a host that cannot make the link fails here rather than passing unexercised (D-R20-10).
      // A file link and not a junction: a junction is a directory, refused as one whether or not the link is followed.
      await symlink(target, join(rig.roles, 'builder.md'), 'file');
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

/** Records every exec and starts nothing; answers a `claude` invocation with a session that ran. */
class RecordingProvider implements SandboxProvider {
  readonly id = 'recording';
  readonly calls: Array<{ readonly cmd: readonly string[]; readonly env: Readonly<Record<string, string>> }> = [];
  constructor(private readonly key: string) {}
  provision(_spec: SandboxSpec): Promise<SandboxHandle> {
    return Promise.resolve('recorded' as SandboxHandle);
  }
  exec(_h: SandboxHandle, cmd: string[], options?: { env?: Readonly<Record<string, string>> }): Promise<ExecResult> {
    this.calls.push({ cmd: [...cmd], env: { ...options?.env } });
    const init = { type: 'system', subtype: 'init', session_id: '11111111-2222-5333-a444-555566667777', tools: ['Read'], mcp_servers: [], agents: [], model: 'm', apiKeySource: this.key, claude_code_version: '0' };
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
    'the Claude Code driver\'s argv carries the role\'s instructions verbatim at the head of the appended system prompt, followed by the granted context and nothing else, with no agent definition that could carry a grant or replace the CLI\'s prompt; and no exec writes them into the workspace',
  run: async () => {
    const { ClaudeCodeDriver, KEY_VARIABLE } = await import('@olympus-ai/driver-claude-code');
    const role: CompiledRole = { role: 'builder' as RoleId, instructions: 'A distinctive line only the role carries.', sha256: sha256('A distinctive line only the role carries.') };
    const request = (sandbox: SandboxHandle): TaskRequest => ({
      taskId: 't' as TaskId, role, stablePrefix: 'granted context', variableSuffix: 't', tier: 'standard', tools: ['Read'], sandbox, timeoutMs: 1000,
      budget: { maxTokens: 1, maxCostUsd: 1, maxWallClockMs: 1000 },
    });
    const provider = new RecordingProvider(KEY_VARIABLE);
    await new ClaudeCodeDriver({ provider }).runTask(request('recorded' as SandboxHandle));
    const carrying = provider.calls.filter((c) => [...c.cmd, ...Object.values(c.env)].some((part) => part.includes(role.instructions)));
    const [task] = carrying;
    if (carrying.length !== 1 || !task?.cmd.includes('claude')) throw new Error(`R20: ${String(carrying.length)} execs carry the role's text; exactly one, the CLI invocation, may`);
    const appended = task.cmd[task.cmd.indexOf('--append-system-prompt') + 1];
    if (appended !== `${role.instructions}\n\ngranted context`) {
      throw new Error(`R20: the appended prompt is ${JSON.stringify(appended)}, not the role's instructions followed by the granted context`);
    }
    // An agent definition could carry tools or a model beside the grant, and replaces the CLI's prompt (D-R20-14).
    for (const flag of ['--agents', '--agent', '--system-prompt']) {
      if (task.cmd.includes(flag)) throw new Error(`R20: the argv carries ${flag}`);
    }
  },
});

export const COMPILER_TAKES_ONLY_A_DIRECTORY: LocalAssertion = runtime({
  id: 'I7.compiler-takes-only-a-directory',
  title:
    'the compiler package depends on core alone; every module under its src, parsed, loads nothing but node built-ins, its own modules, and core — statically, dynamically, or by require — and never refers to process; compileRoles declares one parameter with no default. What reaches it is the directory path its caller passes',
  run: async () => {
    const root = join(workspaceRoot(), 'packages', 'compiler');
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    if (JSON.stringify(Object.keys(manifest.dependencies ?? {})) !== JSON.stringify(['@olympus-ai/core'])) {
      throw new Error(`R20: the compiler depends on ${JSON.stringify(manifest.dependencies)}, not on core alone`);
    }
    const allowed = (from: string): boolean => from.startsWith('node:') || from.startsWith('./') || from === '@olympus-ai/core';
    let declared: number | undefined;
    for (const file of await sourceFiles(join(root, 'src'))) {
      const name = relative(root, file).replaceAll('\\', '/');
      const parsed = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === 'process') throw new Error(`R20: ${name} refers to process`);
        const loaded = loadedModule(node);
        if (loaded !== undefined && !allowed(loaded)) throw new Error(`R20: ${name} loads ${loaded}`);
        if (ts.isFunctionDeclaration(node) && node.name?.text === 'compileRoles') {
          if (node.parameters.some((p) => p.initializer !== undefined || p.dotDotDotToken !== undefined || p.questionToken !== undefined)) {
            throw new Error(`R20: compileRoles in ${name} declares a parameter with a default, rest, or optional marker`);
          }
          declared = node.parameters.length;
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }
    if (declared !== 1) throw new Error(`R20: compileRoles declares ${String(declared)} parameters, not the directory alone`);
  },
});

/** Every `.ts` file under `dir`, at any depth. */
async function sourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

/** The module `node` loads — an import or export declaration, `import()`, or `require()` — or undefined. A specifier that is not a literal is named as such, so it is never allowed. */
function loadedModule(node: ts.Node): string | undefined {
  const specifier = (expr: ts.Expression | undefined): string => (expr !== undefined && ts.isStringLiteralLike(expr) ? expr.text : '<computed specifier>');
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier === undefined ? undefined : specifier(node.moduleSpecifier);
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) return specifier(node.moduleReference.expression);
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
    return specifier(node.arguments[0]);
  }
  return undefined;
}

export const R20_I1: readonly LocalAssertion[] = [ROLES_DIRECTORY_OUTSIDE_EVERY_MOUNT];
export const R20_I2: readonly LocalAssertion[] = [ATTEMPT_RECORDS_ITS_ROLE_VERSION];
export const R20_I3: readonly Assertion[] = [
  ADMISSION_PINS_EVERY_ROLE,
  DRIVER_RENDERS_THE_ROLE_ON_THE_INVOCATION,
];
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
