# Olympus v2 — Spine

**Unit:** F1 (Phase 0, foundation)
**Read this first, every session.** Short by design. If it grows past three pages, something belongs in a sub-plan instead.

This document is the stable extract of the maintainer's master plan, and it is what every sub-plan and every Claude Code session assumes. The master plan itself is maintainer-local and not in the repository; the section markers (`§n`) and decision markers (`Dn`) that appear in the documents under `docs/plan/` cite it. Nothing a contributor needs is behind one of those markers: the invariants, the vocabulary, and the graph below are complete on their own.

---

## Mission and Claim

**Mission:** a fully autonomous software factory that defines, builds, and ships working code.

**Claim (what we assert today):** Olympus produces auditable, tamper-resistant evidence that autonomous work is real, and measurably reduces false-done failures.

Design for the mission. Market the claim. Never collapse the two.

---

## The Invariants

Non-negotiable. No sub-plan may violate one, and any PR that does is wrong regardless of what it enables. Each is testable, and each has an owning conformance suite (F3).

**I1 — No agent writes to the Vault.** Any autonomy level, any repo, any role, any trigger. Enforced at the mount layer (F2 §7), not in application code.

**I2 — The runtime derives status; the model never reports it.** `TaskResult` has no status field. An agent's narrative is a *claim*, stored separately from *evidence*, and the two are diffed.

**I3 — An agent may not be judged by an artifact it can write.** Specs and acceptance tests are hashed before Build and re-verified at every station transition.

**I4 — Default deny.** A capability not granted in policy is not available. Adding one is an explicit, versioned edit to a Vault file.

**I5 — Fail closed.** A missing required check, an absent driver capability, an unsupported stack, or a shrunken suite enumeration is a refusal — never a silent degrade, never a warning that lets the run continue.

**I6 — Reviewers never share the author's model family.** Where only one family is available, the system reports reduced independence rather than claiming the guarantee.

**I7 — Event payloads are data, never instructions.** Untrusted text enters inside an envelope and is never concatenated into a system or role prompt. Triggers select pre-declared templates; payloads supply parameters only.

**I8 — Every capability claim maps to an executable assertion that fails when the capability is deleted.** Documentation asserting a subsystem is wired is not evidence that it is.

**I9 — The runtime is a service; the CLI is a client.** Nothing in `core` may assume a terminal, a TTY, or a foreground process.

**I10 — Greek names never appear in code.** Not in type names, file paths, config keys, or policy fields. Documentation, CLI output, and marketing only.

---

## Frozen Vocabulary (D26)

Changing anything here means revising this section first, deliberately, and updating every sub-plan.

### Stations

`intake` · `spec` · `test-design` · `plan` · `build` · `verify` · `review` · `integrate` · `observe` · `learn`

Ordered 1–10. `test-design` runs before `plan` and is strictly black-box.

### Autonomy levels

`L0` manual · `L1` supervised · `L2` delegated · `L3` autonomous

Effective level = `min(run.requested, policy.stationCap, policy.globalCap)`. Over-request fails closed; it never silently downgrades.

### Artifacts

| Term | Meaning | Location |
|---|---|---|
| Spec | One shippable capability. Locked at `spec`. | Vault |
| Acceptance tests | Black-box oracle. Locked at `test-design`. | Vault |
| Task graph | DAG of tasks emitted by `plan`. | Vault |
| Lock manifest | Hashes of locked artifacts. | Vault |
| Policy | `policy.yaml` — capability scope and gates. | Vault |
| Verification manifest | `verify.yaml` — the exact checks the runtime runs. | Vault |
| Evidence bundle | Runtime-collected proof for one task. | Vault |
| Integrity violation | A detected circumvention of a control. | Vault |
| Run state | Station, tasks, attempts, evidence refs, lineage. | Vault |
| Workspace | Ephemeral container + worktree. Agent-writable. | Sandbox |

### Packages

`core` · `vault` · `integrity` · `adapters` · `sandbox` · `triggers` · `api` · `cli` · `compiler` · `learning` · `drivers/claude-code` · `drivers/codex`

### Retired

`Unit` → Spec. `Bolt` → Task. `Inception`/`Construction`/`Operations` → stations. `AI-DLC` → gone entirely. `<promise>DONE</promise>` → deleted; see I2.

---

## Dependency Graph

```
F1 Spine
  └─ F2 Contracts ──────────────────────────────┐
       ├─ F3 Conformance harness + repo scaffold │
       └─ S1 Walking skeleton (stubs)            │
            └─ Phase 2, parallel: ───────────────┘
                 P1 Vault
                 P2 Sandbox (Docker)
                 P3 Policy engine
                 P4 Station machine   [P1, P3]
                 P5 Driver: Claude Code  [P2]
                 P6 Verification + evidence  [P1, P2, P8]
                 P7 Tamper detection  [P8]
                 P8 Adapters (TypeScript)
                 P9 API + CLI  [P4]
                      └─ I1 Integration + M1 proof
```

Everything blocks on F2. After F2 and S1, P1/P2/P3/P8 start immediately and in parallel; P4/P5/P6/P7/P9 follow their bracketed dependencies.

---

## Sub-Plan Rules

Every Phase 2 unit is contributor-shaped (D23) and ships with all five:

1. **Scope** — what this package owns
2. **Consumed interfaces** — what it imports from F2, and nothing else from siblings
3. **Out of scope** — explicit, so contributors stop at the boundary
4. **Conformance suite** — proves the package works *in isolation*, with no factory run required
5. **Acceptance criteria** — verifiable locally by someone who has read only this document and their sub-plan

A package that cannot be verified without the rest of the system is decomposed wrong.

---

## M1 Scope Boundary

**In:** stations 1–8, local Docker, Claude Code driver, TypeScript adapters, C1/C2/C3, trust boundary, policy engine, API + CLI, cost and cache measurement, L2, human trigger only.

**Out:** Codex driver (M2), compiler (M2), trigger framework (M2), learning (M3), review panel (M3), mutation testing (M3), L3 (M3 canary), distributed execution (M4b), control plane (M5).

Test Design at M1 is single-family. The full green-on-green defense does not exist until M2 and M1 must not claim it.
