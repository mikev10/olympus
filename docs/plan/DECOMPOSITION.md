# Olympus v2 — Decomposition

**Read `docs/plan/F1-spine.md` first.** This document breaks M1 into units. One unit per Claude Code session. The maintainer's master plan is not in the repository and is never loaded into a working session; it is reference material for the maintainer, not context for implementation.

---

## Units

| ID | Unit | Phase | Owner | Depends on | Size |
|---|---|---|---|---|---|
| F1 | Spine | 0 | maintainer | — | done |
| F2 | Contracts | 0 | maintainer | F1 | 1 session |
| F3 | Conformance harness + repo scaffold | 0 | maintainer | F2 | 1–2 |
| S1 | Walking skeleton | 1 | maintainer | F2, F3 | 1–2 |
| P1 | Vault | 2 | contributor | F2, F3 | 2–3 |
| P2 | Sandbox (local Docker) | 2 | contributor | F2, F3 | 2–3 |
| P3 | Policy engine | 2 | contributor | F2, F3 | 2 |
| P4 | Station machine | 2 | maintainer | P1, P3 | 3–4 |
| P5 | Driver: Claude Code | 2 | maintainer | P2, P10 | 2–3 |
| P6 | Verification + evidence | 2 | maintainer | P1, P2, P8 | 3 |
| P7 | Tamper detection | 2 | **contributor — best first issue** | P8 | 2 |
| P8 | Adapters (TypeScript) | 2 | contributor | F2, F3 | 2–3 |
| P9 | API + CLI | 2 | contributor | P4 | 2 |
| P10 | Sandbox egress allowlist | 2 | maintainer | P2 | 2 |
| P11 | Sandbox network probe + HTTP behavioral | 2 | maintainer | P8, P10 | 2 |
| P12 | Credential at the egress layer | 2 | maintainer | P5, P10 | 2 |
| I1 | Integration + M1 proof | 3 | maintainer | all | 2–3 |

**Parallel after F3 and S1:** P1, P2, P3, P8 have no sibling dependencies and can be worked simultaneously.

---

## Phase 0

### F2 — Contracts
**Spec:** `docs/plan/F2-contracts.md` (complete; transcribe, do not redesign)
**Deliver:** `v2` branch, pnpm monorepo, changesets, TS strict, the nine type files.
**Out of scope:** every function body, every test beyond typecheck, every package not listed.
**Accept:** `pnpm -r typecheck` clean with `strict: true`, zero `any`, no cross-package `src/` imports.
**STOP after this unit.** Human review of all nine files before Phase 1.

### F3 — Conformance harness + repo scaffold
**Scope:** the shared test kit that lets any package prove its invariants alone, plus the contribution surface.
**Deliver:**
- `packages/conformance/` — helpers for asserting invariants I1–I10 in isolation
- **Invariant registry**: each of I1–I10 maps to at least one executable assertion (I8). A registry test fails if an invariant has no test.
- `README.md` including the OSS boundary statement (D24): everything in this repo is MIT and stays MIT; the hosted control plane is a separate product in a separate repo
- `CONTRIBUTING.md` — the five-part sub-plan rule from F1
- CI: typecheck, lint, test, conformance registry
**Accept:** a deliberately broken invariant fails CI; the registry rejects an unasserted invariant.

---

## Phase 1

### S1 — Walking skeleton
**Spec:** `docs/plan/S1-skeleton.md` (complete; build to it, do not redesign)
**Scope:** the thinnest path through the line, entirely stubs, so the shape is proven before any real component exists and later units have a running system to attach to.
**Deliver:**
- `StubVault` (in-memory) in `packages/vault/src/stub/`. Implements `Vault` exactly as specified: no generic write, named operations only, real SHA-256 locks. The store is in-memory; the interface is not relaxed.
- `StubSandboxProvider` in `packages/sandbox/src/stub/`. Executes locally, no container. It cannot enforce a mount table, egress, or limits, and declares each rather than pretending.
- `StubDriver` in `packages/core/src/driver/stub/`. Returns a canned `TaskResult`. No model call.
- Three stations wired end to end, `spec` → `build` → `verify`, producing a `GateResult` from one fixture task; locks re-verified at each transition.
- A programmatic entry point, `startRun` in the new `packages/api`, plus the test that drives it against the `hello` fixture.
- **Stubs fail closed.** Every stub declares itself unsafe through a property on its interface, and so does the line itself. The runtime refuses to start a run above L1 when any component in the graph is unsafe, and names each offending component in the refusal. This is I5 applied to the skeleton: a stub that can silently survive into M1 is the failure mode this unit would otherwise create.
**Out of scope:** containers; real model calls; real integrity checks (tamper analysis, suite enumeration, claim/evidence diff); persistence; a CLI (P9 owns it; a throwaway here would be rewritten); a policy engine or approvals; stations beyond the three named; any modification to the contract files; any pending registry entry beyond what the spec names.
**Conformance:** `I5.unsafe-component-refused-above-l1` executes the entry point with every stub wired and requires the refusal at L2 and L3, naming all four components, and a passing `GateResult` at L1; `I5.stubs-declare-unsafe` is the compile-ok fixture that pins each declaration; the I9 terminal scan is widened to `packages/api`. No pending entry is added or paid; the baseline is untouched.
**Accept:** a fixture task runs `spec` → `build` → `verify` and produces a `GateResult`; a run requested above L1 with any stub present is refused, naming it; `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm conformance` all pass; `git ls-files -- .plan/` prints nothing. Target under roughly 400 lines across the three stub files; if it comes out materially larger, that is a signal about the contracts and is reported in the pull request, not absorbed.
**Why first:** replaces months of unverified infrastructure with a running system in one sitting.
**STOP after this unit.** Human review before any Phase 2 unit starts.

---

## Phase 2

### P1 — Vault
**Scope:** `Vault` from F2 §3, over the local filesystem. Content-addressed files, not a database: an evidence bundle, a lock manifest, and a violation are write-once and immutable, and an auditor must be able to verify one with `sha256sum` alone — without Olympus, and without trusting the tool that produced it. A database puts that behind an opaque file and trades away the property the claim rests on. Run state is the only mutable record, and it needs compare-and-swap, not queries. SQLite stays a later option behind the `Vault` interface, for the unit that has a real query workload; nothing at M1 has one.
**Deliver:** lock/verify with SHA-256, evidence write, violation record, run state with optimistic concurrency on `version`.
**Out of scope:** hosted storage, cross-repo aggregation, retention policy, a database of any kind.
**Concurrency, binding:** `commitRunState` is a genuine atomic primitive, never read-compare-write. Exclusive create (`wx`) of a version-named file, so the filesystem arbitrates and the loser gets `EEXIST`. No `current` pointer beside it: a pointer written after the create is a second, non-atomic step, and a writer that dies between the two wedges the run. The current version is derived by scanning for the highest version file, so the exclusive create *is* the commit. Hand-rolled concurrency is this unit's real risk: its conformance assertion must run **concurrent** commits from separate processes or workers against the same `ifVersion` and require exactly one winner. Tested sequentially, or with `await`s in one process, it passes while broken.
**Conformance:** lock a file → modify it → `verifyLocks` returns tampered. No exported path mutates the Vault outside the named operations. Concurrent `commitRunState` with a stale version is rejected.
**Accept:**
- a locked file modified on disk makes `verifyLocks` return `ok: false` naming the path, its expected hash and its actual one; a deleted one is reported the same way
- a second `lock` for the same run preserves the first's entries and refuses to rebase an already-locked path's hash
- `commitRunState` with a stale `ifVersion` is rejected and stores nothing; concurrent commits from one version leave exactly one winner
- evidence and violations read back byte-identical through their `VaultRef`; an unknown ref throws
- a Vault reopened over the same root reads back what a previous process wrote
- `I3.lock-verification-detects-change` and `I3.lock-preserves-earlier-entries` are live registry assertions, and `pending-baseline.json` lowers I3 from 3 to 1
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm conformance` all pass
- `git ls-files -- .plan/` prints nothing

### P2 — Sandbox (local Docker)
**Scope:** `LocalDockerProvider` from F2 §7.
**Deliver:** container lifecycle, mount table with exactly one `rw` mount, symlink and path-escape resolution before mounting, `deny-all` egress default, CPU/memory/PID/wall-clock limits.
**Out of scope:** remote workers, pools, hosted providers — all M4b.
**Conformance:** a write outside the Workspace fails at the mount layer; a symlink escape fails; a `MountTable` with two `rw` entries is rejected at construction; blocked egress is refused and logged.
**Requires a Docker daemon, and fails closed without one.** The assertions that prove I1 at the mount layer cannot be proven by a host that has no containers, and an assertion that skips itself proves nothing while reporting green — the failure mode I5 exists to refuse. A host without a daemon gets a failing suite that names the requirement, never a silent pass.
**Accept:**
- a `MountTable` carrying a second `rw` entry is refused at construction, naming the offending mount; the workspace slot's own `rw`/`ro` mode is honoured as given
- every mount source is resolved through symlinks and `..` *before* the containment check, so a source that is a symlink into a Vault path is refused, naming the declared path and what it resolved to
- a mount whose resolved source is a Vault path, sits inside one, or contains one is refused at any mode, `ro` included; a source that does not exist is refused rather than created
- inside a provisioned sandbox, a write outside the workspace fails, and a write inside a workspace the table marks `ro` fails the same way
- a `deny-all` sandbox has no egress channel at all: its only interface is loopback, a route attempt reports the network unreachable, and the applied control is recorded beside the exact `docker run` argv. An `allowlist`, which this provider cannot enforce, is refused by name. Per-connection logging of blocked attempts is **not** delivered and is recorded as a known limit — see `docs/decisions.md`
- each of `cpus`, `memoryMb`, `pids` and `wallClockMs` is applied to the container, and a command that exceeds the wall clock is terminated with the limit named
- provisioning is refused, not degraded, when a `SandboxSpec` asks for a capability the provider does not have (I5)
- `I1.mount-layer-enforcement` is a live registry assertion and `pending-baseline.json` lowers I1 from 2 to 1; the five `sandbox.*` claims are live and each lowers from 1 to 0
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm conformance` all pass
- `git ls-files -- .plan/` prints nothing
**This unit carries I1.** It is the substrate everything else's safety rests on.

### P3 — Policy engine
**Scope:** validate and evaluate the policy document. The engine takes an already-parsed value and is the only path from the sparse `PolicyDocument` a human authors to the total `Policy` the runtime consumes. Where the bytes came from is not its concern: resolution needs no file, and the parser is the half with the attack surface.
**Deliver:** `resolvePolicy`, `resolveAutonomy`, `resolveCapabilities`, schema validation that narrows `unknown` to a `PolicyDocument` and refuses an unknown key, default-deny, protected-path list, `validateToolGrants` with a mandatory inventory, shipped default with `globalCap: 2`.
**Out of scope:**
- **the YAML parser and file loading.** The engine's input is an already-parsed value, so no package gains a third-party runtime dependency here — least of all `core`, which every package imports, to serve a loader only the CLI path needs. Owed to **P9**, the first unit that must read a policy artifact from disk: P4 is handed a resolved `Policy` and reads no file, and `packages/api` is the run-creation path P9 owns. Tracked as `I5.policy-document-load-is-hardened`, which names the hardening the loader owes; if a unit before P9 turns out to need a Vault-resident policy at run time, it inherits the entry by editing the owner.
- **the driver-side tool inventory.** `validateToolGrants` takes the inventory as a mandatory argument; nothing in this repo can yet produce a real one, because `DriverCapabilities` holds feature flags and no tool list. Owed to **P5** as `I4.driver-tool-inventory-validated`.
- the station machine's consumption of a resolved `Policy` (P4); writing or hashing a `Policy` into the Vault — `Vault` has no policy operation and adding one is an amendment owed to the first unit that stores one (P4); role definitions and the role compiler (M2), so the shipped default carries an empty `roles` map, which is default-deny and correct; approval *evaluation*, since P3 resolves the forty-key table and P4 reads it; trigger admission (M2); a CLI surface for policy (P9); any modification to the contract files, `packages/core/src/policy/types.ts` included — P3's own result types live beside the implementation.
**Conformance:** an over-request is **refused, not downgraded** (I5); an ungranted tool is absent, not merely warned; an unknown policy key fails validation rather than being ignored; a tool grant checked against an empty inventory is refused, so a validator called without a real inventory cannot pass.
**Accept:**
- an unknown key at any level is refused, naming the key and the path it sits at; it is never ignored, and a document that is not an object at all is refused rather than treated as empty
- a value outside its domain is refused naming the field and what was wrong: `globalCap: 4`, a station that is not one of the ten, an `ApprovalKey` that is not `station:level`, an `ApprovalOutcome` that is not one of the three, a negative budget
- `resolvePolicy` returns all forty `station:level` approval keys; every key the document omitted reads `human-required`, and no key reads `auto` that the document did not state
- `resolveAutonomy` above `stationCaps[station]` or above `globalCap` returns `{ ok: false, reason: 'exceeds-cap' }` naming the requested and the effective level, and never returns a lower `level`; a level equal to the cap is allowed
- `resolveCapabilities` for a role the policy does not define refuses with `capability-missing`, since no scope exists to grant anything; for a station outside a defined role's `stations` it refuses with `station-forbidden`. An ungranted tool, egress host, or trigger kind is absent from the resolved scope rather than warned about
- `validateToolGrants(policy, inventory)` requires the inventory: it has no default and is not optional, so the call does not compile without one. An empty inventory against a non-empty grant refuses, naming the role and the tool — it never reads as allow-all
- a resolved `Policy` is not aliased to the document it came from, and a resolved scope is not aliased to the policy: mutating either returned value changes nothing, and a second call returns the same grants
- the shipped default resolves, carries `globalCap: 2` and `triggers.enabled: ['human']`, names its protected paths, and grants nothing else
- **the ledger.** Paid: `I4.unlisted-capability-refused`, `I4.omitted-approval-is-human-required`, `I5.over-request-refused`. Added live: `I4.tool-grant-requires-an-inventory` (compile-error) and `I4.empty-inventory-refuses-every-grant` (runtime). Added pending: `I4.driver-tool-inventory-validated` (P5), `I5.policy-document-load-is-hardened` (P9). So `pending-baseline.json` lowers I4 from 2 to 1 and leaves I5 at 4, and the diff in `registry/i4.ts` and `registry/i5.ts` shows each swap
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm conformance` all pass
- `git ls-files -- .plan/` prints nothing
**Invariants:** I4 is this unit's whole subject; I5 is what makes an over-request a refusal instead of a downgrade.

### P4 — Station machine
**Scope:** station registry, transitions, gate evaluation, write-boundary enforcement, Ascent bounds per task, resume from run state.
**Deliver:** the ten `StationContract`s (M1 uses 1–8), transition function, `test-design` context restriction (locked spec only), review context restriction (never `author-narrative` or `plan`).
**Where it lives:** the machine is pure and lives in `packages/core/src/station/`: the contract table, the transition function, capability, approval, and review-seat evaluation, and context filtering, with no I/O. `vault` and `integrity` both depend on `core`, so `core` cannot import either and the machine takes what it needs as arguments. `packages/api` is where it meets the Vault, the sandbox, and the drivers: the S1 line is re-cut to run stations 1–8 through the machine, and gains `resumeRun` and an in-process `approveStation` that P9 later puts behind HTTP.
**Contract amendments, landed in this unit's pull request** (D-P4-01), each an `A-P4-nn` entry in `docs/decisions.md`:
- `StationRefusal` gains arms for an approval cell that is `blocked`, one that is `human-required` with no recorded grant, and a same-family reviewer at L3; `parked.cause` closes into a set (A-S1-01 left it to P4)
- the review seat is recorded in run state: the authors' and the reviewer's `ModelIdentity` and whether independence is reduced. Not in `GateResult`, which nothing persists (A-P4-02)
- a write-once admission record in the Vault holds the `Run`, the resolved `Policy`, and the artifact paths each station locks with their hashes at admission; every `TaskResult` is recorded in the Vault as it returns, so a task's claim and the author's model family survive a resume or a wait for approval between `build` and `verify`; and `RunState` references both and carries what a resume needs: per-task attempt counts, recorded approvals, review seats, and whether the current station's work is complete. A resume reads its level, policy, and bounds from there; the caller cannot restate them
**Out of scope:**
- the work inside a station beyond what moving a run needs. No prompts or role definitions (P5, M2): `spec`, `test-design`, and `plan` lock artifacts the caller placed in the workspace rather than asking a model to write them, and `plan` validates and locks the task graph it is given
- verification beyond S1's check execution, suite enumeration, and the claim/evidence diff (P6); tamper analysis (P7). `SKELETON_LINE` keeps the two lines that describe those and loses the two this unit pays, so a run above L1 is still refused until P6
- `integrate`'s merge and pull request (I1); a run ends at `integrate`. `observe` and `learn` get contracts and are never entered
- the multi-seat review panel (M3); a contract with `requiresPanel: true` is refused, not seated with one reviewer
- parallel task execution and conflict retries: tasks run one at a time in dependency order. A known limit, not a registry entry; no invariant rests on parallelism
- enforcing a role's `writableGlobs` inside the workspace. It needs the runtime-collected diff, which P6 produces. Owed as `I4.writable-globs-enforced-on-the-diff` (D-P4-01)
- compositional provenance for unsafe declarations (D-S1-07). It becomes necessary when `SKELETON_LINE` is deleted, which P6 does. Owed as `I5.unsafe-declaration-survives-composition` (D-P4-01)
- policy file loading and the HTTP surface for approve, cancel, and status (P9); unparking a parked task (P9)
**Conformance:** a station missing a required driver capability fails closed; a locked-artifact write during `build` hard-fails the run; a resumed run reaches an identical state.
**Accept:**
- a station whose driver lacks a capability its contract `requires` is refused with `capability-missing`, naming the station and the capability, at admission and again on resume, before anything is locked or run
- every transition re-verifies the locks. A locked artifact changed during `build` records a `lock-tamper` violation and fails the run, and a resume of that run refuses with `violation` rather than continuing
- the effective approval for a station exit is the stricter of the contract's `exitGate.approval` and `policy.approvals[station:level]`. `blocked` refuses and the run does not advance; `human-required` refuses until `approveStation` records a grant, after which a resume advances; `auto` advances
- a review seat whose reviewer shares the author's `ModelIdentity.family` is refused at L3 and the run does not advance; at L0–L2 it is seated and run state records reduced independence. A reviewer of a different family records full independence
- `test-design` may be granted the locked spec alone, and a review seat never `author-narrative` or `plan`. Both are compile errors in the contract table and runtime refusals in context filtering, and a reviewer's `TaskRequest` carries none of the author's narrative
- a task whose gate keeps failing parks with `iterations-exhausted` after the contract's `maxIterations`; one whose driver or sandbox keeps failing parks with `retries-exhausted` after `retry.max`; one whose driver is invoked more times than any uninterrupted run of the station could invoke it parks with `starts-exhausted`. All three counts live in run state, so a resume cannot reset them
- a run killed after any committed run state and resumed ends in the same station, task statuses, iteration and retry counts, approvals, and review seats as the same run uninterrupted, and never invokes a driver fewer times than the work required. A kill *inside* an attempt is the exception it looks like: the resume runs the driver again, spends a start for it, and the run does not reach the same invocation count — that is the bound working, not drifting (A-P4-06). A resume takes no level, policy, or artifacts, and reads them from the admission record; starting an admitted run again, at any level, is refused
- an over-request at any station the run will enter is refused at admission, naming the station, before anything is written
- **the ledger.** Paid: `I3.transition-reverifies-locks`, `I4.approval-outcome-gates-the-station`, `I6.review-seat-family-check`. Added live: `I2.resume-derives-state-from-the-vault`, `I3.station-locks-the-admitted-artifact`, `I3.test-design-context-is-the-locked-spec` (compile-error), `I5.station-missing-capability-refused`, `I5.task-attempts-are-bounded`, `I5.over-request-refused-at-admission`, `I6.review-context-excludes-author-material` (compile-error), `I6.reviewer-receives-no-author-material`. Added pending: `I4.writable-globs-enforced-on-the-diff` (P6), `I5.unsafe-declaration-survives-composition` (P6). So `pending-baseline.json` lowers I3 from 1 to 0 and I6 from 1 to 0, leaves I4 at 2, and raises I5 from 4 to 5, each a deliberate edit in the diff
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm conformance` all pass
- `git ls-files -- .plan/` prints nothing
**Invariants:** I3, I4, and I6 are paid here; I5 is every refusal above; I2 is that a resume derives state from the Vault and never from its caller. I1 and I9 must not regress: the machine is pure, and nothing it adds writes to the Vault except through named operations.
**Known limit, stated now:** the L3 half of the review-seat assertion runs against the machine, not through `startRun`, because `SKELETON_LINE` refuses every run above L1 until P6. The L0–L2 half runs end to end.

### P5 — Driver: Claude Code
**Scope:** `Driver` from F2 §2, implemented against the Claude Code CLI. The first real driver, and the first unit whose conformance cannot be satisfied without a model call.
**Depends on P10, which P5 itself found, and which has shipped.** The CLI runs inside the sandbox, and a `deny-all` container cannot reach the API, so five of the seven capability claims were unprovable until an egress allowlist existed. Running the CLI on the host instead is not the workaround it looks like: it is the failure `I1.driver-executes-inside-the-sandbox` was registered to prevent. P10 delivered the allowlist and is tagged `reviewed/P10`; this line is kept as the reason the two units are ordered the way they are.
**Deliver:** `stablePrefix`/`variableSuffix` split for cache economy, explicit `ModelIdentity.family`, event capture (commands, file writes, tool calls, network), usage including cache tokens, `emitArtifacts` writing `.md` agents / `SKILL.md` / hooks.
**Where it lives:** `packages/drivers/claude-code`, the first package under a directory the workspace glob does not cover; `pnpm-workspace.yaml` gains `packages/drivers/*`. It depends on `@olympus-ai/core` for the contract and `@olympus-ai/sandbox` for the provider, and on nothing else in the workspace. The driver never runs the CLI on the host: it is constructed with the `SandboxProvider` that provisioned the handle in `TaskRequest.sandbox`, and every command it issues goes through `provider.exec`, so the mount table is the only filesystem the model can reach (I1). This unit builds and pins the image that carries Node and the CLI, beside the one `packages/sandbox` pins for its own suite; the two are independent and neither follows the other. Credentials arrive as an environment variable on the exec, never as a mount and never inside a prompt, and egress is an allowlist of the API host alone — the allowlist P10 delivers, which nothing could enforce when this entry was written.
**Contract amendments, landed in this unit's pull request**, each an `A-P5-nn` entry in `docs/decisions.md`:
- `Driver` gains `declaredTools(): readonly string[]` — the driver-side half of the tool-grant gap D-P3-04 split. `validateToolGrants(policy, inventory)` has taken a mandatory inventory since P3 and nothing in the repository could produce one, because `DriverCapabilities` holds feature flags and no tool list. A driver that names its tools closes it for every driver, so the Codex driver (M2) satisfies it rather than reopening it. `StubDriver` declares the empty list, which refuses every grant: default deny where no model runs (I4)
- `SandboxProvider.exec` gains an optional `ExecOptions` whose `env` carries names and values an implementation must keep out of every argument vector, and the provider's refusal layers gain `environment`. Not foreseen when this entry was written: the entry requires the credential to reach the CLI as an environment variable on the exec, and `exec(h, cmd)` had nowhere to put one. The alternatives were a mount, which this entry forbids, or a secret in an argv, which any process listing can read. `LocalDockerProvider` passes `--env NAME` and sets the value on the `docker` process it spawns, so the secret travels through the daemon API and appears in no argv on either side of the container
**Out of scope:**
- the compiler's neutral role format (M2) — emit from hardcoded roles for now
- wiring the driver into the station line. `packages/api` keeps `StubDriver`, and `SKELETON_LINE` still refuses every run above L1 until P6. Replacing the stub with the real component is I1's deliverable, stated there in those words; a driver that ships already wired would be judged by the line rather than by its own suite
- prompt and role *content* beyond what one task needs to run. The driver renders whatever `CompiledRole.instructions` it is handed; what those instructions should say is the compiler's (M2)
- cost and cache reporting above `Usage`. The driver measures one task; per-run aggregation and the rate it implies are R2
- standing up computer use inside the sandbox. `computerUse` is declared `false` and the assertion proves the absence, the same way `sandbox.computerUse` does; a container with a display is R3
- the Codex driver (M2). One driver is enough to prove the contract is neutral; two are what prove reviewer independence, and F1 already says M1 must not claim that
**Conformance:** `TaskResult` has no status field and none can be synthesized; declared capabilities match observed behavior; cache-read tokens are non-zero on a second task in the same run.
**Accept:**
- a task's commands run inside the provisioned sandbox and nowhere else: with the provider's containers observed, a completed task leaves its traces in the container and none on the host, and a driver constructed without a provider cannot be constructed at all
- every key of `DriverCapabilities` has an assertion that drives the real CLI and compares what it observed against what `capabilities()` declared, refusing in both directions — declaring one the CLI does not give is a false claim, giving one it does not declare is an undeclared capability. `subagents`, `hooks`, `mcp`, `parallelism`, `steering`, and `stablePrefixCaching` are proven by running tasks; `computerUse` is declared `false` and proven absent
- the stable prefix is read from cache on a second task that shares it: with a prefix no earlier session has presented, the first task writes cache, the second reads strictly more than the first, and the second writes strictly less. The two tasks differ only in `variableSuffix`, so the difference between the two reads is the prefix itself. A driver that concatenated the two would leave the cacheable span unchanged between tasks and the numbers would not move. Stated as zero-on-the-first until P5 measured it: the CLI's own system prompt is cached account-wide, so a first task reads thousands of tokens before it has done anything (D-P5-19)
- `ModelIdentity.family` is a value the driver assigns, and no code path derives it from the driver id, the provider string, or the model name. `TaskResult.model` reports the identity the task actually ran under (I6)
- a tool the policy grants that `declaredTools()` does not name is refused by `validateToolGrants` before any task starts, and the CLI is invoked with the granted list and no wider one: a tool outside the grant is unavailable to the model, not merely unused (I4)
- the registry accepts an external assertion only after reconciling it against the owning package's own test run: an id no test carries, a test that was skipped, a test that failed, a report that does not belong to the tree being evaluated, and a missing report are five distinct refusals, each named. Until a reconciled report exists every external assertion stays refused, exactly as today
- **the ledger.** Paid: `I1.driver-executes-inside-the-sandbox`, `I4.driver-tool-inventory-validated`, `I8.external-assertion-execution-reconciled`, and all seven `driver.*` claims — ten entries, more than any unit before it, because no driver existed to prove any of them. So `pending-baseline.json` lowers I1 from 1 to 0, I4 from 2 to 1, I8 from 1 to 0, and every `driver.*` claim from 1 to 0. Any entry added in exchange is a deliberate edit to the same file, named in the pull request body and visible in the diff
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm conformance` all pass
- `git ls-files -- .plan/` prints nothing
**Invariants:** I8 is this unit's whole subject — seven capability claims that have been declarations with nothing behind them since F2, and the mechanism that lets an assertion in another package's suite count at all. I1 is where a driver could quietly run the model on the host instead of inside the mount table. I4 is the tool inventory and the grant that is refused without it. I2 is that `TaskResult` carries no status and the driver has no place to put one. I6 rests on `family` being assigned here and never inferred. I5 is every refusal above: a missing credential, an unreachable daemon, and an unreconciled report each refuse rather than degrade.
**Known limit, stated now:** the seven claim assertions call a real model, so they cost money and require a credential and a Docker daemon. They are never skipped when either is absent — they refuse, for the reason `local-sandbox.ts` already gives for the mount assertions: an assertion that skips itself leaves the registry reporting a claim as asserted on the strength of a test that did not run, which is worse than reporting it pending.

### P6 — Verification + evidence
**Scope:** the mechanism behind I2.
**Deliver:** execute `VerificationManifest` in a **fresh** sandbox at base+diff, capture a `CheckResult` per check with its own exit code, detect shrunken suite enumeration, assemble `EvidenceBundle`, compute `claimEvidenceDiff`.
**Where it lives:** `packages/api`, beside the line whose `verify` station it replaces, in its own module; it depends on `@olympus-ai/adapters` for suite enumeration and tree diffing and on nothing new otherwise. `packages/integrity` stays types-only, because `adapters` already depends on it and a verifier there would close a cycle.
**Base and diff are trees the runtime owns.** Today every task and every check mounts `run.repo`, the author's own working copy, so "base+diff" names nothing the code can point at. P6 makes it concrete, and never by spawning `git`, whose repository config an agent can write (D-P8-04):
- at admission the runtime snapshots the working tree into a directory it owns, outside the Vault and outside every mount, and records the snapshot's tree digest
- each build task runs over a fresh copy of base plus the diffs of every task already passed, in the order they passed, and never over `run.repo`
- when the task ends the runtime diffs that copy against what it was handed, in process, through the adapters' `diffTrees` (`packages/adapters/src/files.ts`, exported for this; today it is internal). That diff is the task's output: a write the diff does not carry does not propagate, whatever the driver's events say
- `verify` materializes base plus the diff into another fresh directory, mounts it read-only in a fresh sandbox with `deny-all` egress, and runs the checks there. The agent never ran in that tree, and nothing it left running can reach it
- `.git` is copied into each workspace and excluded from every diff, so nothing an agent writes under it outlives the task
**Contract amendments, landed in this unit's pull request**, each an `A-P6-nn` entry in `docs/decisions.md`:
- `CheckSpec.command` becomes an argument vector, `readonly [string, ...string[]]`. A string with an invented grammar is not representable, and a check that needs a shell names it — `['sh', '-c', '…']` — so the shell is part of what was pinned rather than something the runtime added. A manifest read from the Vault whose command is not a non-empty array of strings is refused, naming the check
- `EvidenceBundle` gains `unstarted: readonly { checkId: string; reason: string }[]`, a record for a check that produced no result. `CheckResult.exitCode` stays a real process's exit code and is never invented for a check that did not start
- `EvidenceBundle` gains the digests of the base tree and of the diff it verified, and the diff itself is written to the Vault beside it. `baseCommit` alone does not say which tree the checks ran over: the working copy admitted can differ from the commit, and the diff is what the verdict is about
- `SandboxSpec` gains the uid and gid a container runs as, so the provider can match the container to the workspace it was handed. `LocalDockerProvider` refuses a workspace that user cannot write, on hosts where the daemon enforces host ownership, rather than mounting it and letting the task fail quietly
**Out of scope:**
- tamper analysis, and the `SKELETON_LINE` line that says it is missing (P7). P6 removes its own line, the claim/evidence diff, and leaves P7's. Whichever of the two removes the last line puts `I5.unsafe-declaration-survives-composition`'s gap in its place, because an empty declaration is refused by `safety.ts` and a missing one would lift the L1 cap before provenance is compositional
- deleting `SKELETON_LINE`, and component provenance that survives composition (I1, which replaces every stub with the real component)
- an L3 run refused at admission end to end, naming each missing control. It cannot fail for the right reason while `SKELETON_LINE` refuses every run above L1 (I1)
- keeping the model credential out of the container (P12). Authentication belongs at the egress layer, which is the sandbox's, the proxy's, and the driver's, not verification's
- coverage that cannot be forged by the suite it measures (M3). The suite and the coverage writer share a process, so where the report is written does not decide whether its hit counts are true; mutation testing is the control that does not trust a hit count. Until then a coverage figure is evidence about a suite that cooperated, and nothing P6 builds calls it more
- tamper-style reading of the diff: weakened assertions, skip markers, deleted tests (P7). P6 counts suites; P7 reads what is in them
- the merge at `integrate` (I1), per-run cost aggregation (R2), and a verification cache
**Conformance:** an agent that runs one passing test file and exits 0 still fails the gate; a missing required check fails closed; a claim/evidence mismatch is recorded as a violation.
**Accept:**
- a task's status is derived from the `CheckResult`s of the checks P6 ran and nothing else: a driver that exits 0 and claims success after running one passing test file, while a required check fails, leaves the task `failed`, and no field of `TaskResult` or `AgentClaim` changes the outcome
- a driver's `TaskResult` is checked against the contract's exact key set where the line receives it, and a result carrying any other key — `status` among them — is refused before it is recorded (D-F3-22)
- a required check with no result fails the gate, and the evidence bundle shows it in `unstarted` with the reason; a `suiteCount` below `expectedSuiteCount` fails the gate. `suiteCount` is counted by the adapters' `enumerateSuites` over the verified tree on the host, never read from the test runner's output, which the code under test can write. A tree whose suites cannot be enumerated fails the check rather than reporting `null` as a pass
- `claimEvidenceDiff` names every file the claim lists that the diff does not change, and every file the diff changes that the claim does not list. A non-empty diff records an `IntegrityViolation` of kind `claim-mismatch` in the Vault and is not entered in `RunState.violations`, every entry of which halts the run (`packages/core/src/station/machine.ts`): a halt the claim can trigger would let the model's story decide the outcome. The task's status is unchanged by it, and review sees it beside the evidence. The narrative is never parsed: it is model text, and the file list is the only part of a claim with a fact to compare against
- a change outside the task's writable globs — the role's `writableGlobs` intersected with the station's `workspaceGlobs` — is refused from the runtime-collected diff, naming each path, before any check runs
- a process an earlier task left running is not running during a later task, and a later task's workspace holds only base and accepted diffs: an assertion detaches a writer in one task and requires the next to find neither the process nor anything it wrote after the diff was taken
- the review seat is provisioned over base plus the diff under review, minus every admitted artifact its contract does not grant: a reviewer that opens the admitted task graph and an author-written file outside the diff is refused both
- a workspace owned by another uid is refused at provisioning rather than mounted unwritable
- a manifest command that is not a non-empty argument vector is refused, naming the check; an argument containing a space reaches the process as one argument
- admission records the adapter set's unavailable controls, a resume reads them from the Vault and never from its caller, and the admission function refuses L3 naming each one. Asserted against admission directly; the end-to-end half is I1's
- `SKELETON_LINE` no longer names the claim/evidence diff and still names tamper analysis, so every run above L1 is still refused
- **the ledger.** Paid: `I2.status-derived-from-check-results`, `I2.unstarted-check-is-in-the-evidence`, `I4.task-capabilities-do-not-outlive-the-task`, `I4.writable-globs-enforced-on-the-diff`, `I5.workspace-is-writable-by-the-task`, `I5.missing-check-or-shrunken-suite-refuses`, `I5.check-command-has-a-grammar`, `I5.adapter-refusal-enforced-at-admission`, `I6.review-seat-reads-only-its-grants`. Added live: `I2.task-result-key-set-enforced`. Re-owned before this unit starts, in the ledger commit that lands with this entry, which raises the I5 baseline from 6 to 7 for the split: `I5.unsafe-declaration-survives-composition` to I1; `I4.model-credential-not-readable-by-the-task` to P12; `I3.coverage-report-is-not-writable-by-the-suite` to M3; and a new pending `I5.adapter-refusal-refuses-l3-end-to-end`, owned by I1, split from the admission entry. So `pending-baseline.json` lowers I2 from 2 to 0, I4 from 3 to 1, I5 from 7 to 3, and I6 from 1 to 0, and leaves I3 at 1
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass; then `pnpm --filter @olympus-ai/driver-claude-code test` runs once, because any change under `packages/` makes its reconciled report stale and it calls a real model; then `pnpm conformance` passes
- `git ls-files -- .plan/` prints nothing
**Invariants:** I2 is the subject — status from runtime-run checks alone, a claim stored beside the evidence and diffed against it, and a result that cannot smuggle a field in. I3 is that the checks run in a tree the agent never ran in, so nothing it can write judges it. I4 is the writable globs enforced on the only honest input, and a task's reach ending with the task. I5 is every refusal above: an unstarted check, a shrunken suite, an unrepresentable command, an unwritable workspace. I6 is the review seat that can read only what it was granted. I1 must not regress: the snapshots are runtime-owned and never mounted writable anywhere a later task or check can see, and nothing P6 adds writes to the Vault except through named operations.
**Known limit, stated now:** each task and each verification copies the whole tree, dependencies included, because a `deny-all` verification cannot install them. That costs time and disk on a large repository and nothing in correctness; a copy-on-write or overlay mount is the optimisation, and it is not taken here. A build task that installs dependencies changes paths outside most globs and is refused, which is fail-closed and will read as friction until a role grants them.

### P7 — Tamper detection — **best first contributor issue**
**Scope:** `TamperReport` from F2 §6. Pure functions over diffs; no system knowledge required.
**Deliver:** AST assertion comparison (operators and arguments, not counts), skip/xfail/only detection, deletions including renames, moves, and case-set reduction, snapshot regeneration, coverage delta, protected-path touches.
**Conformance:** a fixture suite of taxonomy items — `assertEqual(x,5)` → `assertTrue(x)` is caught, and a rename that drops three cases counts as a deletion.
**`SKELETON_LINE`:** P7 removes the tamper-analysis line. If it is the last line left, P7 puts the composition gap in its place rather than deleting the declaration, because deleting it is I1's (see P6).

### P8 — Adapters (TypeScript)
**Scope:** `AdapterSet` from F2 §9 for vitest and jest. The per-framework knowledge the rest of the line consumes: P6 enumerates suites and reads coverage through it, P7 compares assertions and finds skip markers through it, and R1 derives a ceiling from what it lacks.
**Deliver:** `TestFrameworkAdapter` for vitest and for jest, `CoverageAdapter` over the istanbul JSON report that c8 and istanbul both emit, `ManifestAdapter`, `BehavioralAdapter` for CLI, stack detection that builds an `AdapterSet` for a repository, and the L3 refusal as a pure function over a set.
**Where it lives:** `packages/adapters`. The test, coverage, and manifest adapters run on the host and execute nothing: they parse test files to an AST (`typescript`, pinned exactly to the workspace's version), enumerate test files without loading any config, read a coverage report some other process produced, and diff two directory trees in process. `base` and `head` are those two trees, never git refs, and the package never spawns `git`, whose repository config an agent can write. A framework config file is code, so it is parsed and never loaded: the settings that decide which files are tests are read where they are literals, and a config that sets them in a way the parser cannot resolve is refused rather than enumerated with the framework's defaults, which would under-count without saying so. Only `BehavioralAdapter` touches a sandbox, because its signature already takes a `SandboxHandle`: it is constructed with the `SandboxProvider` that provisioned the handle, as the P5 driver is.
**The judge runs on the host.** The CLI adapter runs the scenario's argument vector through `provider.exec` and compares the raw `ExecResult` against `expected` in the runtime's own process. Nothing that decides the verdict runs inside the container: the sandbox passes no `--read-only` and no `--user`, and its image is the caller's choice, so a comparator inside it could be replaced by anything that ran there first — the product, or an install script — and would forge every verdict after it.
**Contract amendments, landed in this unit's pull request**, each an `A-P8-nn` entry in `docs/decisions.md`:
- `CheckResult` gains a required `expectation`: the runtime's comparison of what a behavioral check observed against what it expected, or `null` for a check whose exit code is its whole result. `CheckResult` had no field but `exitCode` to carry a verdict, and a behavioral check's exit code is the product's, which can be 0 while the output is wrong. Required, not optional, for the reason `suiteCount` is: omission is not representable. The S1 gate fails a check whose expectation did not hold, whatever its exit code
- `ExecOptions` gains `stdin`. A CLI scenario that feeds input had nowhere to put it, and the alternative — a shell wrapper in the container — puts part of the scenario where the product can reach it. `LocalDockerProvider` passes `--interactive` and writes the bytes to the `docker` process; `StubSandboxProvider` writes them to its local child
**Out of scope:**
- `MutationAdapter` — M3. Return `null` and list it in `unavailableControls()`.
- a `BehavioralAdapter` of kind `http` (P11). An HTTP request has to originate on the sandbox's network, and a client inside the product's container is a client the product can replace, so what it observed would be the product's report of itself. P11 adds a probe that shares the sandbox's network and not its filesystem. Until then `unavailableControls()` names `behavioral:http`, the gap stated rather than filled with a judge that can be forged
- a `BehavioralAdapter` of kind `browser` (R3). `unavailableControls()` names it, so the gap is stated rather than hidden
- wiring the L3 refusal into run admission. The admission record would have to carry the set so a resume cannot restate it, and `SKELETON_LINE` refuses every run above L1 until P6 deletes it, so an admission assertion could not fail for the right reason before then. Owed to P6 as `I5.adapter-refusal-enforced-at-admission`
- assembling a `TamperReport`: renames, moves, snapshot regeneration, coverage delta, protected-path touches (P7). P8 supplies the framework-specific parsing P7 compares with
- executing a `VerificationManifest`, filling `CheckResult.suiteCount`, and the fresh sandbox at base+diff (P6)
- readiness probes and the ceiling they derive (R1)
- any stack other than TypeScript with vitest or jest
**Conformance:** `unavailableControls()` is non-empty and L3 is refused when a control is missing (I5).
**Accept:**
- stack detection builds the vitest set for a vitest repository and the jest set for a jest one; a repository with neither, or with both, gets `test: null` and a set that names it — never a guess
- `unavailableControls()` names every `null` slot and every behavioral kind the set does not carry. `mutation`, `behavioral:http`, and `behavioral:browser` are named for every set P8 can build, so no set clears L3 at M1
- the L3 refusal refuses a set with any unavailable control, naming each, and does not refuse at L0–L2. It refuses or allows; it never returns a lower level
- for both frameworks: `expect(x).toBe(5)` changed to `expect(x).toBeTruthy()` is `weakened`; a deleted assertion is `removed`; `toBeCloseTo(v, 5)` changed to `toBeCloseTo(v, 2)` is `toleranceWidened`; an unchanged file compares empty
- `detectSkipMarkers` names `.skip`, `.only`, `.todo`, `xit`/`xtest`/`xdescribe`, `fit`/`fdescribe`, `skipIf`/`runIf`, vitest's `.fails`, and jest's `.failing`
- `enumerateSuites` returns test files — a suite is one file, which is what jest's own "Test Suites" line counts — and deleting one shrinks the list. A config's literal include and exclude settings are honoured; a config that sets them to anything the parser cannot resolve is refused, naming the file and the setting
- `changedLineCoverage` reads an istanbul JSON report; a changed line in a file the report does not mention counts as uncovered; a missing or malformed report refuses rather than returning a number
- `detectConfigChanges` names every config file added, removed, or modified between two trees
- a behavioral scenario whose `input` or `expected` has an unrecognised shape is refused, naming the field. A CLI scenario runs inside the sandbox, its stdin reaches the process, and the comparison runs on the host: a scenario whose process exits 0 with output that does not match yields `expectation.held: false`, and the gate fails it. Requires a Docker daemon and fails closed without one, as P2's suite does
- a `CheckResult` that omits `expectation` does not compile, and one whose exit code is 0 with an expectation that did not hold fails the gate
- no file in `packages/adapters` executes repository code on the host
- **the ledger.** Paid: `I5.unsupported-stack-is-loud`. Added live: `I1.adapters-execute-nothing-on-the-host`, `I2.unmet-expectation-fails-the-gate`, `I2.check-result-declares-expectation` (compile-error). Added pending: `I5.adapter-refusal-enforced-at-admission` (P6). So `pending-baseline.json` leaves I5 at 6, and the diff in `registry/i5.ts` shows the swap
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm conformance` all pass
- `git ls-files -- .plan/` prints nothing
**Invariants:** I5 is the subject — a stack that lacks a control says so and cannot run autonomously, and a missing coverage report is a refusal, never a zero. I1 is where an adapter could quietly run agent-written code on the host by loading a config or spawning a tool. I2 is that a behavioral verdict is the runtime's comparison, made where the product cannot reach it, and never the product's exit code standing in for one. I3 is that `expected` comes from locked acceptance criteria; the adapter takes it as given and cannot check its source.

### P11 — Sandbox network probe + HTTP behavioral
**Scope:** a `BehavioralAdapter` of kind `http`, and the sandbox capability it needs: a probe the provider starts and owns, joined to a sandbox's network namespace and never to its filesystem, so the client that observes the product is out of the product's reach.
**Why it is its own unit:** P8 found it. An HTTP request has to originate on the sandbox's network, and a `deny-all` sandbox has only loopback, so the client runs beside the product — and a client in the product's container is one the product can replace. Folding the probe into P8 would make one pull request that both changes the sandbox's network posture and adds adapters, the shape P10 was split out to stop.
**Depends on:** P8 (the `BehavioralAdapter` shape and `CheckResult.expectation`), P10 (the provider-owned sidecar pattern the probe follows).
**Specified when it starts.** Scope, out of scope, conformance, and acceptance are written before any code, as P5's and P8's were.

### P12 — Credential at the egress layer
**Scope:** the model credential never enters the container. The driver's CLI is pointed at an endpoint the provider owns, and the provider authenticates the upstream request; the sandbox holds a placeholder, a short-lived token, or nothing.
**Why it is its own unit:** P5's external review found that the credential, passed as an environment value on the exec, is readable by any tool the task runs, and P6 found it is not verification's to close. It spans the sandbox, the P10 proxy, and the driver, the shape P10 and P11 were split out for.
**Depends on:** P5 (the driver and its exec), P10 (the provider-owned proxy the credential moves into).
**Pays:** `I4.model-credential-not-readable-by-the-task`, re-owned from P6.
**Specified when it starts.** Scope, out of scope, conformance, and acceptance are written before any code, as P5's and P8's were.

### P9 — API + CLI
**Scope:** the runtime as a service (I9).
**Deliver:** HTTP surface for run lifecycle — create, status, approve, cancel, stream events — and a CLI that is purely a client of it.
**Out of scope:** auth beyond a local token, multi-user, the hosted control plane.
**Conformance:** every CLI command works against a remote API URL; no import from `core` assumes a TTY.

### P10 — Sandbox egress allowlist
**Scope:** `EgressPolicy.mode: 'allowlist'` in `packages/sandbox`, which P2 refused by name because enforcing one needs a filtering proxy the container is forced through (D-P2-07, whose reverse reads "implement the proxy, then accept the mode").
**Why it is its own unit:** P5 found it. The Claude Code CLI has to run inside the sandbox — a driver that runs the model on the host is outside the mount table, which is the whole of `I1.driver-executes-inside-the-sandbox` — and inside a `deny-all` container it cannot reach the API. So five of P5's seven capability claims are unprovable until a container can reach exactly one host and nothing else. Folding the work into P5 would make one pull request that both changes the sandbox's network posture and adds a driver, which is the shape the `gate-change` label exists to stop passing casually.
**Deliver:** a forced filtering proxy, allowlisted by host, with the container on a network whose only route out is that proxy; `appliedControls()` extended to record the allowlist and the proxy as applied evidence, beside the `docker run` argv it already records; `checkEgress` accepting `allowlist` and still refusing a `deny-all` that carries `allow` entries.
**Where it lives:** `packages/sandbox/src/local/`. The proxy is a container the provider starts and owns, torn down with the sandbox it serves, and it is never reachable by a `deny-all` sandbox.
**Out of scope:**
- per-connection logging of blocked attempts. P2 recorded it as a known limit arriving "with the proxy or not at all"; it arrives with the proxy if it is cheap, and stays a known limit if it is not. Either way it is stated, never claimed
- TLS interception of any kind. The proxy allows or refuses a host and reads nothing inside the connection. An agent's traffic to an allowed host is not the runtime's to inspect, and a man-in-the-middle with the workspace's credentials in it is a larger risk than the one it would close
- egress for the stub provider. `StubSandboxProvider` declares it cannot enforce a mount table, egress, or limits, and that declaration stays true
- any driver, credential handling, or model call. P5 owns those and resumes after this unit
**Conformance:** a container under an `allowlist` reaches an allowlisted host and fails to reach every other, by name and by address; the refusal for a host outside the list is the network's, not the application's; a `deny-all` sandbox still has loopback and nothing else; removing the proxy from the path makes the allowlist assertion fail rather than pass permissively.
**Accept:**
- a sandbox provisioned with `mode: 'allowlist'` and one host reaches that host and no other; an attempt to a second host fails inside the container, and it fails the same way when the second host is given as an address rather than a name, so the refusal is not DNS alone
- bypassing the proxy is not possible from inside the container: the direct route does not exist, rather than existing and being asked politely not to be used. An assertion that unsets every proxy environment variable and tries again still fails
- an empty `allow` list under `mode: 'allowlist'` is refused, not treated as deny-all and not as allow-all — the same rule `validateToolGrants` follows for an empty inventory
- a `deny-all` sandbox is unchanged: `--network none`, loopback only, no proxy started, and `appliedControls()` still records `network: 'none'`
- the proxy container is destroyed with the sandbox it serves, and a leaked one fails the assertion
- **the ledger.** Pays `sandbox.egress-allowlist-enforced` as a new live assertion under I5, and closes D-P2-07 by reversing it. Adds nothing pending; if the blocked-attempt log is not delivered it stays a known limit with no registry entry, exactly as P2 left it
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm conformance` all pass
- `git ls-files -- .plan/` prints nothing
**Invariants:** I5 is the subject — an unenforceable control is a refusal, and this unit makes one enforceable rather than relaxing the refusal. I1 must not regress: the proxy adds a network route and no mount, and the single-rw-mount rule is untouched. I4 is the allowlist itself: a host not granted is not reachable.

---

## Phase 3

### I1 — Integration + M1 proof
**Deliver:** replace every S1 stub with the real component; run on the canary repo.
**Accept (M1 criteria):**
- one real feature reaches a merged PR
- modifying a locked test fails the run
- writing to the Vault fails at the mount layer
- cost and cache-hit rate reported per run
- `unavailableControls()` correctly refuses L3: an L3 run is refused at admission end to end, naming each missing control (`I5.adapter-refusal-refuses-l3-end-to-end`, split from P6's admission entry)
- component provenance survives composition, and `SKELETON_LINE` is deleted only after it does: a stub wrapped without forwarding its declaration is still refused above L1 (`I5.unsafe-declaration-survives-composition`, re-owned from P6)

---

## Beyond M1

Not part of M1 and not startable inside it. Recorded here so adjacent work
found during an M1 unit has somewhere to go that is not a commit, and so the
order between these three is settled before any of them is picked up.

| ID | Unit | Milestone | Depends on | Spec |
|---|---|---|---|---|
| R1 | Readiness | M2 | P2, P8, P3 | `docs/plan/R1-readiness.md` |
| R2 | Outcome measurement | M2 | P4, P9 | — |
| R3 | Behavioral breadth (browser) | M3 | P8, P5 | — |

### R1 — Readiness

Scans one target repository and derives the highest `AutonomyLevel` it can
support, from probes that executed, with the probe that holds the ceiling
named. Subtractive only: a scan lowers a cap or does nothing, and never grants
what policy withheld. Spec is complete and both of its open decisions are taken
(D-R1-07, D-R1-08): a `readiness` package, and a fourth term in F1's
effective-level formula. Still blocked on P8, whose `AdapterSet` it consumes.

### R2 — Outcome measurement

Autonomy ratio (the share of tasks completed at their requested level with no
approval consumed), cycle time from `intake` to `integrate`, and cost per
merged change. Every input already exists in run state and the usage figures
P5 captures, so this is derivation and a reporting surface, not collection.
Bounded by the same rule as R1: derived by the runtime, never reported by a
model. Blocked on P4 and P9 because it reads finished runs through the API.

It also owes the number the spine's claim is waiting on:

- **Caught false-done rate.** No task reports its own status, so the only
  "done" an agent ever asserts is ending its attempt. A false-done is an
  attempt the agent ended whose runtime-derived status is not passing, or one
  that recorded a `claim-mismatch` violation. The baseline comes from the same
  runs: a pipeline that trusted the agent's end of turn would have accepted
  every one of those attempts. Deriving it from the same tasks and the same
  model, rather than from a separate control run, leaves no confound to argue
  over.
- **Rework.** Attempts per task (already bounded and recorded in run state)
  and the share of changes `review` returned. Cycle time without rework
  hides the cost of the attempts it took.
- **Escaped false-done is not measured.** A change that passed every gate and
  failed later needs a post-merge signal, which `observe` provides (M2+). R2
  reports the caught rate and says that the escaped rate is not established. It
  never implies zero.

A reduction is claimed only as the caught rate over a stated window of runs,
and the README and spine wording changes in the same pull request that first
reports it.

### R3 — Behavioral breadth (browser)

`BehavioralAdapter.kind` already admits `'browser'` and P8 ships only `'cli'`
and `'http'`, so the contract needs no amendment and `unavailableControls()`
already names the gap correctly today. This unit implements the browser case:
a scenario drives the running product and its expectation comes from locked
acceptance criteria, never from the implementation. M3, with the rest of the
QA surface.

### Recorded constraint: the Codex driver (M2)

Not specified, and not a unit here. It is recorded so the choice is settled
before anyone picks up the driver. The Codex driver runs the Codex CLI inside
the Olympus sandbox, as P5 runs Claude Code, and not a vendor-hosted agent
harness. The mount-layer Vault protection, the egress allowlist (P10), and the
credential held at the egress layer (P12) all require the agent to run in a
container Olympus provisions. A harness running on the vendor's infrastructure
is outside every one of them. A driver built that way anyway declares those
controls unavailable, and `unavailableControls()` refuses it above L1. It never
runs with weaker guarantees than its level claims.

---

## Working Rules

1. **One unit per session.** Load `F1-spine.md`, `CLAUDE.md`, and this unit's section. Nothing else.
2. **Stop at the boundary.** A unit's out-of-scope list is binding. Adjacent work becomes an issue, not a commit.
3. **Conformance before implementation.** Write the unit's conformance suite first; it is the acceptance criteria in executable form.
4. **Invariants outrank convenience.** A change that makes a unit easier and weakens I1–I10 is wrong, however clean.
