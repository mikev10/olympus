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
| P5 | Driver: Claude Code | 2 | maintainer | P2 | 2–3 |
| P6 | Verification + evidence | 2 | maintainer | P1, P2, P8 | 3 |
| P7 | Tamper detection | 2 | **contributor — best first issue** | P8 | 2 |
| P8 | Adapters (TypeScript) | 2 | contributor | F2, F3 | 2–3 |
| P9 | API + CLI | 2 | contributor | P4 | 2 |
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
**Scope:** parse and evaluate `policy.yaml`.
**Deliver:** `resolveAutonomy`, `resolveCapabilities`, schema validation, default-deny, protected-path list, shipped default `globalCap: 2`.
**Conformance:** an over-request is **refused, not downgraded** (I5); an ungranted tool is absent, not merely warned; an unknown policy key fails validation rather than being ignored.

### P4 — Station machine
**Scope:** station registry, transitions, gate evaluation, write-boundary enforcement, Ascent bounds per task, resume from run state.
**Deliver:** the ten `StationContract`s (M1 uses 1–8), transition function, `test-design` context restriction (locked spec only), review context restriction (never `author-narrative` or `plan`).
**Conformance:** a station missing a required driver capability fails closed; a locked-artifact write during `build` hard-fails the run; a resumed run reaches an identical state.

### P5 — Driver: Claude Code
**Scope:** `Driver` from F2 §2.
**Deliver:** `stablePrefix`/`variableSuffix` split for cache economy, explicit `ModelIdentity.family`, event capture (commands, file writes, tool calls, network), usage including cache tokens, `emitArtifacts` writing `.md` agents / `SKILL.md` / hooks.
**Out of scope:** the compiler's neutral role format (M2) — emit from hardcoded roles for now.
**Conformance:** `TaskResult` has no status field and none can be synthesized; declared capabilities match observed behavior; cache-read tokens are non-zero on a second task in the same run.

### P6 — Verification + evidence
**Scope:** the mechanism behind I2.
**Deliver:** execute `VerificationManifest` in a **fresh** sandbox at base+diff, capture a `CheckResult` per check with its own exit code, detect shrunken suite enumeration, assemble `EvidenceBundle`, compute `claimEvidenceDiff`.
**Conformance:** an agent that runs one passing test file and exits 0 still fails the gate; a missing required check fails closed; a claim/evidence mismatch is recorded as a violation.

### P7 — Tamper detection — **best first contributor issue**
**Scope:** `TamperReport` from F2 §6. Pure functions over diffs; no system knowledge required.
**Deliver:** AST assertion comparison (operators and arguments, not counts), skip/xfail/only detection, deletions including renames, moves, and case-set reduction, snapshot regeneration, coverage delta, protected-path touches.
**Conformance:** a fixture suite of taxonomy items — `assertEqual(x,5)` → `assertTrue(x)` is caught, and a rename that drops three cases counts as a deletion.

### P8 — Adapters (TypeScript)
**Scope:** `AdapterSet` from F2 §9 for vitest and jest.
**Deliver:** `TestFrameworkAdapter`, `CoverageAdapter` (c8/istanbul), `ManifestAdapter`, `BehavioralAdapter` for CLI and HTTP.
**Out of scope:** `MutationAdapter` — M3. Return `null` and list it in `unavailableControls()`.
**Conformance:** `unavailableControls()` is non-empty and L3 is refused when a control is missing (I5).

### P9 — API + CLI
**Scope:** the runtime as a service (I9).
**Deliver:** HTTP surface for run lifecycle — create, status, approve, cancel, stream events — and a CLI that is purely a client of it.
**Out of scope:** auth beyond a local token, multi-user, the hosted control plane.
**Conformance:** every CLI command works against a remote API URL; no import from `core` assumes a TTY.

---

## Phase 3

### I1 — Integration + M1 proof
**Deliver:** replace every S1 stub with the real component; run on the canary repo.
**Accept (M1 criteria):**
- one real feature reaches a merged PR
- modifying a locked test fails the run
- writing to the Vault fails at the mount layer
- cost and cache-hit rate reported per run
- `unavailableControls()` correctly refuses L3

---

## Working Rules

1. **One unit per session.** Load `F1-spine.md`, `CLAUDE.md`, and this unit's section. Nothing else.
2. **Stop at the boundary.** A unit's out-of-scope list is binding. Adjacent work becomes an issue, not a commit.
3. **Conformance before implementation.** Write the unit's conformance suite first; it is the acceptance criteria in executable form.
4. **Invariants outrank convenience.** A change that makes a unit easier and weakens I1–I10 is wrong, however clean.
