# Contributing to Olympus

Olympus is built one unit at a time. A unit is a piece of the runtime that one
person can finish and verify alone, without running the rest of the factory.
This document is the rule every unit follows, the units that are open, and
how to prove your unit holds the invariants.

Read [README.md](README.md) first. It states the mission, the claim, the ten
invariants, and the open-source boundary. Everything a contributor needs is in
the README, this file, `CLAUDE.md`, the planning documents under
[docs/plan](docs/plan), and the package you are working in.

The planning documents are three kinds of file. The spine
([F1-spine.md](docs/plan/F1-spine.md)) states the invariants, the frozen
vocabulary, and the dependency graph between units. The decomposition
([DECOMPOSITION.md](docs/plan/DECOMPOSITION.md)) is every unit with its scope,
deliverables, out-of-scope list, conformance obligations, and acceptance
criteria; the table below is a summary of it. A unit that needs more than an
entry has its own spec beside them (`F2-contracts.md`, `S1-skeleton.md`).

## The five-part rule

Every unit ships with all five of these, written down before the code:

1. **Scope.** What this package owns. One paragraph, no more.
2. **Consumed interfaces.** What it imports from the contracts in `core` and
   the other contract packages, and nothing else from a sibling. A unit that
   needs a sibling's implementation to run is decomposed wrong.
3. **Out of scope.** An explicit list, so you know where to stop. The list is
   binding: adjacent work becomes an issue, not a commit.
4. **Conformance suite.** Tests that prove the package works in isolation,
   with no factory run required, and that register the invariants it is
   responsible for. See below.
5. **Acceptance criteria.** Locally verifiable by someone who has read only
   the README, this file, and the unit's own description. Usually a list of
   commands and what they must print.

Put the five parts at the top of the unit's pull request description, and
keep them current as the work changes shape. A reviewer checks the code
against them, not against what they imagine the unit should do.

## Units

Phase 0 (contracts, conformance) is done and Phase 1 (the walking skeleton)
is next; both are maintainer work. Phase 2 is contributor-shaped. Each unit
below depends only on the contracts and on the units in its "after" column,
so the four with no sibling dependency can start in parallel once the
skeleton lands.

| Unit | Package | After | Notes |
|---|---|---|---|
| P1 | `vault` | skeleton | Locked artifacts, evidence, run state with optimistic concurrency. |
| P2 | `sandbox` | skeleton | Local Docker provider. Enforces the single-rw-mount rule (I1). |
| P3 | policy engine (`core`) | skeleton | Resolves autonomy and capabilities; default deny, fail closed. |
| P4 | station machine (`core`) | P1, P3 | The ten station contracts and the transitions between them. |
| P5 | `drivers/claude-code` | P2 | The first driver. |
| P6 | verification + evidence (`integrity`) | P1, P2, P8 | Runs pinned checks in a fresh sandbox; derives status (I2). |
| P7 | tamper detection (`integrity`) | P8 | **Best first issue.** Assertion weakening, skip markers, suite shrink. |
| P8 | `adapters` | skeleton | TypeScript stack: enumerate suites, parse assertions, coverage. |
| P9 | `api` + `cli` | P4 | The runtime as a service; the CLI as its client (I9). |

Each unit's pending assertions are listed in the registry report
(`pnpm conformance`) under the unit's id. Those are part of the unit's
acceptance criteria: when the unit lands, its pending entries become live
assertions.

Any package that carries tests must list `test` in the `include` array of its
`tsconfig.json`, beside `src`. Lint runs through typescript-eslint's project
service, which refuses a file that no tsconfig covers, so a test directory
outside the include fails `pnpm lint` with a parsing error before any rule
runs. Including it also puts the tests inside the package's program, where
`pnpm typecheck` and the I7, I9, and I10 scans see them. This is a standing
constraint on every Phase 2 unit, not a detail of the skeleton; the edit to
`tsconfig.json` is a protected path and carries `gate-change`. The package's
`test` script resolves `vitest` from the workspace root and declares no
devDependency of its own for it.

## Writing a conformance suite

The kit lives in `packages/conformance`. It gives you three kinds of
assertion and one place to register them.

**Compile-error assertions.** Most invariants are type-level: the contract
makes the violation unrepresentable. The assertion is a fixture that
constructs the violation and annotates the exact diagnostic the compiler
must produce, line by line:

```ts
// packages/conformance/fixtures/types/i1/write-boundary-vault-never.ts
import type { WriteBoundary } from '@olympus-ai/core';

export const append: WriteBoundary = {
  workspaceGlobs: ['src/**'],
  vault: 'append', // expect-error TS2322: Type '"append"' is not assignable to type '"never"'
  protectedPathPolicy: 'escalate',
};
```

The fixture is compiled on its own with the same strictness as the
contracts. Every annotation must be met, and no unannotated diagnostic may
appear. A fixture with no annotations must compile cleanly. An annotation
names the error code and a fragment of the message, so a typo in the fixture
cannot pass as the invariant holding. Register it with `compileError` (or
`compileOk`) in the invariant's file under `src/registry/`.

**Runtime assertions.** A function that throws. Use it for things that are
true of the repository or the toolchain rather than of a type: the I7
assertions read ESLint's resolved configuration and lint a fixture, I9 scans
`core` for terminal use, I10 scans every package for Greek names. Register
with `runtime`.

**Assertions in your own package.** When your package has an implementation,
its invariant assertions belong in its own test suite, next to the code they
exercise. Write them with `invariantTest` from the kit and register them in
the central registry as external. **Today the registry refuses every
external assertion**: it can check that a file quotes an id, and a comment or
a skipped test satisfies that, so presence is not evidence. The first unit
that needs one must first land `I8.external-assertion-execution-reconciled`
(pending, owner P2): the registry reconciles the external ids it lists
against the tests the owning package actually ran and passed. The shape
below is the target that unit builds toward.

```ts
// packages/sandbox/test/mount-table.test.ts
import { invariantTest } from '@olympus-ai/conformance';

invariantTest('I1.mount-rejects-second-rw', 'a second rw mount is refused', async () => {
  // ...
});
```

```ts
// packages/conformance/src/registry/i1.ts
external({
  id: 'I1.mount-rejects-second-rw',
  level: 'runtime',
  title: 'a second rw mount is refused',
  package: '@olympus-ai/sandbox',
  file: 'test/mount-table.test.ts',
});
```

Your package's `test` script runs the assertion itself. The kit has no
dependency on any other package, so your package may depend on the kit
without creating a workspace cycle. Until reconciliation exists, an
assertion that needs your implementation stays a pending entry owned by your
unit, and your acceptance criteria include replacing it.

**Pending entries.** An assertion that cannot exist yet is recorded as
pending, with the unit that owes it and the reason:

```ts
pending({
  id: 'I1.mount-layer-enforcement',
  owner: 'P2',
  reason: 'There is no provider to run that against until P2.',
});
```

Pending entries are printed with every run so the count is visible, and
every count is ratcheted against `packages/conformance/pending-baseline.json`,
which holds the number of pending entries each invariant and each claim may
carry. Adding a pending entry without raising its number fails CI; raising
the number is a deliberate edit that a reviewer sees in the diff. A decrease
is always allowed and the report shows the delta. When your unit lands,
replace its pending entries with live assertions and lower the numbers it
paid down in the same pull request, so the ratchet stays tight.

**Capability claims.** Every key of `DriverCapabilities` and
`SandboxCapabilities` is a claim, and each has a registry entry under
`driver.*` or `sandbox.*`. If you add a key to either interface, the registry
fails until you add the claim; if you implement a driver or provider, its
claims move from pending to asserted.

**The four states.** An invariant is `asserted` when it has live assertions
and nothing pending, `partial` when it has live assertions and at least one
pending entry, `pending` when it has only pending entries, and `missing`
otherwise. `missing` fails CI; `partial` is a report that coverage is real
but incomplete, not a gate. Adding an invariant to the registry requires
adding it to the `InvariantId` type; the registry is a total record over that
type, so omitting one is a compile error.

## Conventions

- TypeScript strict, with the flags in `tsconfig.base.json`. No `any`. No
  non-null assertion without a comment naming the invariant that guarantees
  it.
- Never import from a sibling package's `src/`. Import its published name.
- Branded types (`RunId`, `UntrustedPayload`, `SandboxHandle`,
  `ModelFamily`) are load-bearing. Do not widen them to `string`.
- Literal types encode invariants (`vault: 'never'`, `collectedBy:
  'runtime'`). Do not generalize them.
- Greek names never appear in code: not in identifiers, file paths, config
  keys, or policy fields. The npm scope is the one exemption. Documentation
  and CLI output may use them.
- Never reintroduce the retired v1 vocabulary for what a run produces or
  passes through: Unit (now Spec), Bolt (now Task), Inception, Construction,
  Operations (now stations), or a status token a model emits to declare
  itself done. "Unit" in this document means a unit of contribution, never a
  type.
- One ESLint configuration governs the workspace (`eslint.config.js`). Three
  typed rules are load-bearing for I7 and the registry asserts they stay
  active: `restrict-plus-operands`, `restrict-template-expressions`, and
  `no-base-to-string`. No package source outside a `fixtures/` directory may
  carry an `eslint-disable` comment that names one of them or names no rule,
  nor an inline `/* eslint ... */` configuration comment that names one; the
  registry fails on any. If you need the rule off, the answer is a
  configuration change behind the `gate-change` label, not a comment.
- The manifests and the test and compiler configuration CI reads (root and
  per-package `package.json`, `pnpm-workspace.yaml`, per-package
  `tsconfig.json`, any `vitest.config.*`) are protected paths: a change to
  them needs the `gate-change` label, like a change to the workflows or the
  conformance package.
- Every package change gets a changeset (`pnpm changeset`).

## Pull requests

- One unit per pull request. Stay inside its scope; file an issue for
  anything adjacent.
- CI runs `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm conformance`.
  All four must pass. Run them locally first; they need nothing but Node 22
  and pnpm 12.
- Record any decision the unit's description did not settle in
  `docs/decisions.md`: what was unclear, what you chose, why, and how to
  reverse it.
- Stop where the unit says stop. A maintainer reviews before the next unit
  starts.
