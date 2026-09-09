# S1 — Walking skeleton

**Unit:** S1 (Phase 1, maintainer-only)
**Depends on:** F2 Contracts, F3 Conformance harness
**Blocks:** P1, P2, P3, P8 (the parallel start of Phase 2), and everything after them

The thinnest path through the line, entirely stubs, so the shape is proven before any real component exists and later units have a running system to attach to. Three stubs, three stations, one fixture task, one gate verdict. Nothing here is meant to survive: every Phase 2 unit replaces one piece, and the skeleton is built so that a piece which is *not* replaced cannot pass unnoticed.

**Four findings from writing this, all applied below:**

1. **The line cannot live in `core`.** The package graph is `core → sandbox`, `integrity → core`, `vault → core, integrity` (D-F2-06). Anything that calls a `Vault` and a `Driver` and produces a `GateResult` imports `vault` and `integrity`, and `core` cannot without a cycle. The entry point therefore lives in `packages/api`: the frozen name for the runtime as a service, of which an in-process entry point is the first form. P9 adds the HTTP surface on top of it and the CLI as a client. **P4 inherits a question this exposes:** "station machine (`core`)" can hold only the parts that need no `vault` or `integrity` type; the parts that touch either go beside this entry point or the graph changes. P4 decides; S1 records.
2. **The I5 assertion cannot be an external assertion.** The registry refuses every external assertion until execution reconciliation exists (D-F3-20, owed to P2). S1 would be the first unit to need one, and inheriting the reconciliation would double the unit. Instead the assertion is a local runtime assertion in the registry that executes the entry point, reaching `@olympus-ai/api` through the same published-entry map the fixtures already use (§7). The reconciliation stays with P2.
3. **The line is itself a stub, and says so.** The verify station runs checks but performs no tamper analysis and no claim/evidence diff; there is no policy engine and no approval. If only the three infrastructure stubs declared themselves unsafe, replacing them would lift the L1 cap while the line still faked its half. So the line carries a declaration of its own (`SkeletonLine`) and stays in the refusal until P4 and P6 replace it.
4. **Contract findings, recorded for their owners, not fixed here.** (a) `SandboxCapabilities.os` has no value for a Windows host: right for Docker, which always runs Linux, unrepresentable for a provider that executes on the host. The stub's `capabilities()` throws on such a host; P2 decides whether the union grows. (b) `SandboxProvider.exec` takes no timeout, so `CheckSpec.timeoutMs` cannot be applied through the contract except by provisioning one sandbox per check with `wallClockMs` set to it; P6 and P2 decide. (c) `ExecResult.exitCode: number` cannot represent a process ended by a signal; the stub throws instead of inventing a code; P2 decides. (d) `Vault.lock(runId, paths, by)` gives the paths no base; the stub takes a root at construction; P1 decides, beside the `commitRunState` version question already recorded. (e) `TamperReport` has no "not performed" state, which is why finding 3 exists: an empty report from a line that ran no analysis would read as a clean one; P6 and P7 decide.

---

## Session Scope

1. Load `CLAUDE.md`, `F1-spine.md`, this unit's entry in `DECOMPOSITION.md`, and this file. Nothing else.
2. Write the conformance additions first (§7) and watch them fail.
3. Write the three stubs (§2–§4), then the entry point and the line (§5–§6), then the test (§8).
4. Run the acceptance criteria (§9). Ship with `ship-unit`; the unit touches `packages/conformance/` and per-package manifests, so the pull request carries the `gate-change` label.
5. **Stop.** Human review before any Phase 2 unit starts.

Out of scope, binding: containers; any model call; any real integrity check (tamper analysis, suite enumeration, claim/evidence diff); persistence of any kind; a CLI (P9 owns it; a throwaway here would be rewritten); a policy engine or approvals (P3); any station beyond `spec`, `build`, `verify`; any edit to a contract file (the nine F2 files, any `src/**/types.ts`, `core/src/driver/contract.ts`); paying down or adding any pending registry entry other than what §7 names.

---

## 1. Safety declaration — `packages/api/src/safety.ts`

I5 applied to the skeleton. A component that cannot enforce what its contract implies declares that through a property on its own interface. The runtime enumerates the declarations before a run starts and refuses to carry a run above L1 while any exist, naming each one. Nothing in the contracts changes: the declaration is a property the stub adds, and the runtime's graph type is where it is required.

```ts
/**
 * A component that cannot enforce what its contract implies. The runtime
 * refuses to start a run above L1 while any component in its graph carries
 * one, and names every one in the refusal. A stub that forgets to declare
 * is caught by the conformance fixture that assigns each exported stub to
 * DeclaresUnsafe (I5.stubs-declare-unsafe).
 */
export interface UnsafeDeclaration {
  readonly component: string;                  // the exported name: 'StubVault', 'SkeletonLine'
  readonly cannotEnforce: readonly string[];   // one line per control the component does not provide; never empty
}

export interface DeclaresUnsafe {
  readonly unsafe: UnsafeDeclaration;
}

/** Every declaration in the graph, plus the line's own. Order: vault, sandbox, driver, line. */
export function unsafeComponents(graph: ComponentGraph): UnsafeDeclaration[];

/** The line's own declaration (finding 3). Deleted by the unit that replaces the line. */
export const SKELETON_LINE: DeclaresUnsafe;
```

`unsafeComponents` reads the `unsafe` property structurally (`'unsafe' in component`), so a stub in `vault`, `sandbox`, or `core` needs no import from `api` to declare itself; the compile-ok fixture in §7 is what pins each stub's property to this type. `SKELETON_LINE.unsafe.cannotEnforce` lists: no policy engine, so a level is not resolved against a cap and no approval is evaluated; no tamper analysis, so `GateResult.tamper` is empty by construction; no claim/evidence diff, so `EvidenceBundle.claimEvidenceDiff` is empty by construction; no station beyond the three.

**Levels in the skeleton.** L0 and L1 both mean: run the three stations and return the gate verdict to the caller, who is the supervising human. Nothing distinguishes them here; that is the policy engine's job (P3). L2 and L3 are refused while any declaration exists, which in S1 is always.

---

## 2. `StubVault` — `packages/vault/src/stub/vault.ts`

Implements `Vault` exactly as F2 §3 specifies: named operations only, no generic write, every method present. In-memory means the store is a `Map` that dies with the process; it does not mean any operation is relaxed. Locks are real SHA-256 over file bytes (`node:crypto`), so the I3 path through the skeleton is not faked, only unpersisted.

```ts
export class StubVault implements Vault, DeclaresUnsafe {
  readonly unsafe: UnsafeDeclaration;          // component 'StubVault'
  /** `root` is what locked paths resolve against (finding 4d). */
  constructor(root: string);

  read(ref: VaultRef): Promise<Uint8Array>;                    // bytes stored under ref.hash; unknown ref throws
  lock(runId: RunId, paths: string[], by: StationId): Promise<LockManifest>;
  verifyLocks(runId: RunId): Promise<LockVerdict>;
  writeEvidence(b: EvidenceBundle): Promise<VaultRef>;         // kind 'evidence'; hash = sha256 of the JSON bytes
  recordViolation(v: IntegrityViolation): Promise<VaultRef>;   // kind 'violation'; same
  readRunState(runId: RunId): Promise<RunState>;               // no state for runId throws
  commitRunState(s: RunState, ifVersion: string): Promise<RunState>;
}
```

Rules, each of which is a test in `packages/vault/test/stub.test.ts`:

- `lock` hashes each path's bytes under `root`, stores one `LockEntry` per path with `lockedBy: by` and `lockedAt` now, and replaces any earlier manifest for the run. A path that does not exist throws (I5); it does not lock an empty hash.
- `verifyLocks` re-hashes every entry and returns `{ ok: false, tampered }` with one item per mismatch. A run with no manifest throws: `{ ok: true }` is never the answer to "nothing was locked".
- `writeEvidence` and `recordViolation` serialise the record to JSON, store the bytes under their SHA-256, and return the ref. A second write of identical bytes returns the same ref.
- `commitRunState` compares `ifVersion` against the stored version, `'0'` when the run has none; a mismatch throws and stores nothing; on match it stores `s` with `version` set to the next integer and returns what it stored. `s.version` is ignored on input. The contract leaves which of the two is authoritative to P1; the stub picks `ifVersion` and this line says so.
- `cannotEnforce`: persistence (everything is lost with the process); I1 at the mount layer (nothing prevents a process on the host from reaching the vault's memory; the guarantee is the sandbox's, and the sandbox is also a stub).

`packages/vault/src/index.ts` adds `export * from './stub/vault.js';`.

---

## 3. `StubSandboxProvider` — `packages/sandbox/src/stub/provider.ts`

Implements `SandboxProvider`. Executes commands on the host, in the Workspace mount's source directory, with no container. It cannot enforce a mount table, an egress policy, or a resource limit, and it declares each of those rather than accepting a spec as if it could.

```ts
export class StubSandboxProvider implements SandboxProvider, DeclaresUnsafe {
  readonly id: 'stub-local';
  readonly unsafe: UnsafeDeclaration;          // component 'StubSandboxProvider'

  provision(spec: SandboxSpec): Promise<SandboxHandle>;
  exec(h: SandboxHandle, cmd: string[]): Promise<ExecResult>;
  destroy(h: SandboxHandle): Promise<void>;
  capabilities(): SandboxCapabilities;
}
```

Rules, each a test in `packages/sandbox/test/stub.test.ts`:

- `provision` requires `spec.mounts.workspace.source` to be an existing directory and throws otherwise; it records that directory against a fresh handle and mounts nothing. `others`, `egress`, and `limits` are accepted and ignored, and the declaration says so; refusing them would refuse every spec, which is what the L1 cap is for.
- `exec` spawns `cmd[0]` with `cmd.slice(1)` as arguments, `shell: false`, working directory the recorded source, and returns the process's own exit code, captured stdout and stderr, and the wall-clock duration. An empty `cmd` or an unknown handle throws. A process that ends by signal throws naming the signal (finding 4c).
- `destroy` forgets the handle; an unknown handle throws.
- `capabilities` returns `{ computerUse: false, gpu: false, os, persistent: true, remote: false }` where `os` is the host's when it is `linux` or `darwin` (reported as `macos`). On any other host it throws (finding 4a); the skeleton never calls it, so the line runs on every host and the claim is made on none it cannot make honestly. `persistent: true` is true: files written by one `exec` are there for the next, because nothing is ever torn down.
- `cannotEnforce`: the mount table (nothing is mounted; every path on the host is reachable, the Vault's memory included); egress (the host network is reachable); limits (no CPU, memory, PID, or wall-clock bound is applied); isolation (commands run as the invoking user).

`packages/sandbox/src/index.ts` adds `export * from './stub/provider.js';`.

---

## 4. `StubDriver` — `packages/core/src/driver/stub/driver.ts`

Implements `Driver`. Calls no model. Returns the canned `TaskResult` it was constructed with. It lives beside the contract it implements, in `core`, and so falls under the I9 terminal scan.

```ts
export interface CannedResult {
  readonly claim: AgentClaim;                  // default: { narrative: 'stub: no model was called', filesChanged: [] }
}

export class StubDriver implements Driver, DeclaresUnsafe {
  readonly id: 'stub';
  readonly contractVersion: typeof DRIVER_CONTRACT_VERSION;
  readonly unsafe: UnsafeDeclaration;          // component 'StubDriver'
  constructor(canned?: Partial<CannedResult>);

  provenanceId(): string;                      // 'stub-driver@' + contractVersion
  capabilities(): DriverCapabilities;          // every boolean false, parallelism 1
  resolveModel(tier: ModelTier): ModelIdentity; // provider 'stub', family 'stub' (assigned as ModelFamily), model 'stub', version '0'
  runTask(req: TaskRequest): Promise<TaskResult>;
  cancel(taskId: TaskId): Promise<void>;       // no-op
  emitArtifacts(roles: CompiledRole[], targetDir: string): Promise<void>;   // writes nothing
  on(kind: DriverEvent['kind'], handler: (e: DriverEvent) => void): void;   // records nothing; never fires
}
```

`runTask` returns `{ taskId: req.taskId, claim, events: [], usage: all zero, model: resolveModel(req.tier), contractVersion }`. There is no status field to fill and no place the stub could report success (I2); the test asserts the returned object's keys are exactly the contract's six. `spawnSubagent` and `steer` are omitted, which is what `capabilities()` says. `cannotEnforce`: no model is called (every result is the canned claim); no event is observed (`events` is empty and `on` handlers never fire); `emitArtifacts` writes nothing.

`packages/core/src/index.ts` adds `export * from './driver/stub/driver.js';`.

---

## 5. Entry point — `packages/api/src/run.ts`

`packages/api` is new: `@olympus-ai/api`, MIT, `main` and `types` at `./src/index.ts` like the others, dependencies `core`, `vault`, `integrity`, `sandbox` (`workspace:*`), scripts `typecheck`, `lint`, `test`. Its `tsconfig.json` includes `src` and `test`.

```ts
export interface ComponentGraph {
  readonly vault: Vault;
  readonly sandbox: SandboxProvider;
  readonly driver: Driver;
}

/** One task, described completely by the caller. The plan station that would emit it does not exist. */
export interface FixtureTask {
  readonly id: TaskId;
  readonly workspace: string;                  // absolute path; the Workspace mount source, and what lockedPaths resolve against
  readonly lockedPaths: readonly string[];     // workspace-relative; locked at `spec`, re-verified at `build` and `verify`
  readonly checks: readonly CheckSpec[];       // the verification manifest, run at `verify`
}

export interface RunRequest {
  readonly runId: RunId;
  readonly baseCommit: string;                 // evidence binds to it; a fixture supplies a literal
  readonly requestedLevel: AutonomyLevel;
  readonly task: FixtureTask;
  readonly components: ComponentGraph;
}

export type StationRefusal = Extract<StationTransition, { ok: false }>;

export type RunOutcome =
  | { readonly ok: true; readonly gate: GateResult; readonly next: StationTransition; readonly state: RunState; readonly evidence: VaultRef }
  | { readonly ok: false; readonly reason: 'unsafe-above-l1'; readonly requestedLevel: AutonomyLevel; readonly unsafe: readonly UnsafeDeclaration[] }
  | { readonly ok: false; readonly reason: 'refused'; readonly at: StationId; readonly transition: StationRefusal };

export function startRun(req: RunRequest): Promise<RunOutcome>;
```

`startRun`, in order:

1. `unsafeComponents(req.components)`. If non-empty and `req.requestedLevel > 1`, return `unsafe-above-l1` with every declaration. Nothing has been provisioned, locked, or written.
2. Build the `Run` (`trigger: { kind: 'human', eventId: runId, lineage: { depth: 0, chain: [], windowStart } }`, `station: 'spec'`, `graph: null`) and the `Task` (`station: 'build'`, `role: 'builder'`, `dependsOn: []`, `dependencySet: ['**']`, `worktreePath: task.workspace`, `attempt: 1`). Commit the initial `RunState` (`station: 'spec'`, `tasks: { [task.id]: 'pending' }`, `version` from `commitRunState(_, '0')`).
3. Run the line (§6). A station refusal returns `refused` with the station and the transition; the verify station's verdict returns `ok: true`.

`startRun` never writes to a stream, reads `process.argv`, or exits. It returns; the caller decides what a verdict means. The I9 scan is widened to this package (§7) so that stays true.

`packages/api/src/index.ts` exports everything in §1 and §5.

---

## 6. The line — `packages/api/src/line.ts`

Three station functions over one context, called in order. Each commits run state on the way out, so a `RunState` alone says where the run is. Each of `build` and `verify` re-verifies the locks on the way in (I3).

```ts
interface LineContext {
  readonly run: Run;
  readonly task: Task;
  readonly fixture: FixtureTask;
  readonly components: ComponentGraph;
  state: RunState;                             // replaced by every commit
  locks: LockManifest | null;                  // set by spec
  result: TaskResult | null;                   // set by build, read by verify
}
```

**`spec`** — `vault.lock(runId, fixture.lockedPaths, 'spec')` → `ctx.locks`; commit `station: 'build'`; return `{ ok: true, next: 'build' }`.

**`build`** — `vault.verifyLocks`; on `{ ok: false }`, record an `IntegrityViolation` (`kind: 'lock-tamper'`, `role: task.role`, `detail: { tampered }`, provenance from the driver), commit `station: 'build'` with the violation ref and `tasks[id]: 'failed'`, and return `{ ok: false, reason: 'lock-tamper', detail }`. Otherwise provision a sandbox from a `SandboxSpec` whose mount table is the Workspace alone (`workspace: { source: fixture.workspace, target: '/workspace', mode: 'rw' }`, `others: []`, `egress: { mode: 'deny-all', allow: [] }`, `limits` zero), commit `tasks[id]: 'running'`, build the `TaskRequest` (`stablePrefix`: the locked files' text, read after verification; `variableSuffix`: the task id; `tier: 'fast'`; `tools: []`, since no policy grants any (I4); `timeoutMs` and `budget` zero), `driver.runTask` → `ctx.result`, destroy the sandbox, commit `station: 'verify'`, `tasks[id]: 'verifying'`; return `{ ok: true, next: 'verify' }`.

**`verify`** — `vault.verifyLocks`, same refusal as `build`. Provision a fresh sandbox (the build one is gone; evidence is collected where the agent never ran). For each `CheckSpec` in `fixture.checks`, `sandbox.exec(h, command.split(/\s+/))` and record a `CheckResult` (`checkId`, the process's `exitCode`, `stdout`, `stderr`, `suiteCount: null`, `durationMs`, `startedAt`). Whitespace split and no shell is the whole command grammar in S1; P6 replaces it. Destroy the sandbox. Derive:

- `verdict` is `'fail'` when any check with `required: true` has no result, a non-zero exit code, or an `expectedSuiteCount` while `suiteCount` is `null` or below it; otherwise `'pass'`. `'escalate'` is never produced (no protected-path policy). `tasks[id]` becomes `'passed'` or `'failed'` from the verdict and from nothing else (I2).
- `gate` is `{ checks, tamper: EMPTY_TAMPER_REPORT, violations: [], verdict }`. The empty report is not a claim that analysis ran; `SKELETON_LINE` says it did not (finding 3).
- `evidence` is `vault.writeEvidence({ runId, taskId, baseCommit, checks, claim: result.claim, claimEvidenceDiff: [], collectedBy: 'runtime', driverProvenanceId, contractVersion })`.

Commit `station: 'verify'` with the evidence ref and the task status; return the gate and `next`: `{ ok: true, next: 'review' }` on pass, `{ ok: false, reason: 'gate-failed', detail }` on fail. The run stops here either way; `review` does not exist.

---

## 7. Conformance — `packages/conformance`

Written first. Three registry changes, one fixture, two configuration edits.

**`I5.unsafe-component-refused-above-l1`** (runtime, in `registry/i5.ts`). Copies the hello fixture (§8) to a temporary directory, wires `StubVault`, `StubSandboxProvider`, and `StubDriver`, and calls `startRun`:

- at L2 and at L3: the outcome is `unsafe-above-l1`, and the `component` names are exactly `StubVault`, `StubSandboxProvider`, `StubDriver`, `SkeletonLine`, in that order, each with a non-empty `cannotEnforce`. Deleting any stub's declaration removes its name and fails the assertion; deleting the runtime's check makes L2 succeed and fails it.
- at L1: the outcome is `ok: true` with a `GateResult` whose verdict is `'pass'`, so the assertion is not satisfied by a runtime that refuses everything.

**`I5.stubs-declare-unsafe`** (compile-ok fixture `fixtures/types/i5/stubs-declare-unsafe.ts`). Assigns an instance of each stub and `SKELETON_LINE` to `DeclaresUnsafe`. Removing a declaration is a compile error in the fixture before it is a runtime failure in the assertion above.

**`I9.api-never-touches-a-terminal`** (runtime, in `registry/i9.ts`). The existing scan over `@olympus-ai/core`, run over `@olympus-ai/api` as well: no terminal module import, no `process` stream, `argv`, or `exit`, no `console`. The entry point is what I9 is about.

**Configuration.** `packages/conformance/tsconfig.json` maps `@olympus-ai/api` to `../api/src/index.ts` (`I8.fixture-paths-match-published-entries` fails until it does). `packages/conformance/vitest.config.ts` derives `resolve.alias` from that same `paths` map at config time, so the runtime assertion's `import('@olympus-ai/api')` resolves to the published entry the fixtures typecheck against, with no `package.json` dependency and so no workspace cycle when a Phase 2 package devDepends on the kit (D-F3-04). One map, two readers.

**Pending entries.** None added, none paid. `pending-baseline.json` is untouched. The skeleton exercises `I2.status-derived-from-check-results`, `I3.lock-verification-detects-change`, and `I3.transition-reverifies-locks` and registers none of them: P6, P1, and P4 own those assertions and the code that earns them, and the skeleton's versions are the ones they replace. The behaviours are tested in `packages/api/test` as ordinary tests.

---

## 8. Fixture and test — `packages/api/test`

`test/fixtures/hello/spec.md` is the one locked artifact; the directory is the Workspace. The fixture task locks `['spec.md']` and runs one check: `{ id: 'hello-exit-zero', kind: 'unit', command: 'node -e process.exit(0)', required: true, timeoutMs: 10_000 }`. The command has no quoting and runs on every host with Node on the path.

`test/skeleton.test.ts` copies the fixture to a temporary directory per test and drives `startRun` with the three stubs:

1. **Hello at L1.** `ok: true`; `gate.verdict === 'pass'`; one `CheckResult` with `exitCode === 0`; `next` is `{ ok: true, next: 'review' }`; `state.station === 'verify'`, `state.tasks[id] === 'passed'`, `state.evidenceRefs` holds the returned ref; `vault.read(evidence)` parses to a bundle with `collectedBy === 'runtime'` and the stub's claim beside it.
2. **A failing check.** The same fixture with `command: 'node -e process.exit(3)'`: `gate.verdict === 'fail'`, `checks[0].exitCode === 3`, `next.reason === 'gate-failed'`, `state.tasks[id] === 'failed'`. The verdict follows the exit code and nothing the driver said.
3. **A required check with an expected suite count.** `expectedSuiteCount: 1` and the stub's `suiteCount: null`: `'fail'`. Unknown is not enough (I5).
4. **Tamper between `spec` and `build`.** A `Vault` wrapper whose `verifyLocks` first rewrites `spec.md` in the workspace, then delegates: `ok: false`, `reason: 'refused'`, `at: 'build'`, `transition.reason === 'lock-tamper'`; `state.violations` has one ref, and reading it gives an `IntegrityViolation` of kind `'lock-tamper'`.
5. **Above L1.** L2 and L3 with the stubs: `unsafe-above-l1`, four names. (The registry assertion in §7 is the one that counts; this test is the package's own.)
6. **Nothing wrote.** After the L2 refusal, `vault.readRunState(runId)` throws: the refusal happened before anything was committed.

Each stub package carries its own unit tests (§2–§4).

---

## 9. Acceptance Criteria

```
pnpm typecheck && pnpm lint && pnpm test && pnpm conformance
pnpm --filter @olympus-ai/api test
git ls-files -- .plan/                       # prints nothing
wc -l packages/vault/src/stub/vault.ts packages/sandbox/src/stub/provider.ts packages/core/src/driver/stub/driver.ts
```

- The hello fixture runs `spec → build → verify` and produces a `GateResult` with verdict `'pass'` (test 1).
- A run requested at L2 or L3 with any stub wired is refused, and the refusal names the stub (§7, test 5).
- The registry report shows `I5.unsafe-component-refused-above-l1`, `I5.stubs-declare-unsafe`, and `I9.api-never-touches-a-terminal` live, every pending count unchanged, and `pending-baseline.json` unchanged in the diff.
- `TaskResult` has no status field and none was added anywhere: the I2 fixtures still pass, and the driver stub's result has the contract's six keys.
- The three stub files total under roughly 400 lines. If they come out materially larger, that is a signal about the contracts: report it in the pull request's review notes with the lines that grew, and do not absorb it by relaxing an interface.
- Every package change has a changeset: `@olympus-ai/api` (new), `core`, `vault`, `sandbox`, and `conformance`.
- Every judgment call is in `docs/decisions.md` under `D-S1-nn`, including any of finding 4 that the implementation had to take a position on.

**STOP after this unit.** Human review before P1, P2, P3, or P8 starts.
