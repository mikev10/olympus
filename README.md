# Olympus

Olympus is a software factory runtime: a provider-neutral engine that carries
work from intent to merged code through a fixed line of stations, where policy
decides when work advances.

This is the v2 rewrite, on the `v2` branch. `main` is the frozen v1 line and
nothing here builds on it.

## Mission and claim

**Mission.** A fully autonomous software factory that defines, builds, and
ships working code.

**Claim, today.** Olympus produces auditable, tamper-resistant evidence that
autonomous work is real, and measurably reduces false-done failures: the
runtime derives what happened from checks it ran itself, and a model's own
account of its work is stored as a claim beside the evidence, never as the
verdict.

The two are kept apart on purpose. The runtime is designed for the mission and
only the claim is asserted. Olympus does not claim lights-off autonomy. Every
autonomy level is capped by a policy file a human authors, an approval the
policy leaves unstated resolves to human-required, and the highest level is
not part of the first milestone.

## Open-source boundary

Everything in this repository is MIT licensed and stays MIT: the runtime, the
contracts, the drivers, the conformance kit, and the command line. See
[LICENSE](LICENSE).

The hosted control plane is a separate product in a separate repository.
Nothing in this repository depends on it, and no capability here is gated by
it.

## Status

| Unit | What it delivered | State |
|---|---|---|
| F2 | The type contracts for every package: runs, tasks, the driver contract, policy, stations, the Vault, integrity checks, the sandbox mount table, the trigger envelope, stack adapters. Types only. | done |
| F3 | The conformance kit, the invariant registry, this contribution surface, and CI. | done |
| S1 | A walking skeleton: stub driver, in-memory Vault, three stations, one task reaching a gate verdict. | next |

There is no runtime implementation yet. The contracts and the assertions
that protect them exist so that the implementation can be built in parallel,
one package at a time, by people who have not seen the rest.

## How the line works

Work moves through ten stations, in order:

| # | Station | What happens |
|---|---|---|
| 1 | `intake` | A trigger enters. The payload is data inside an envelope; it selects a pre-declared template and supplies parameters only. |
| 2 | `spec` | One shippable capability is written and locked. |
| 3 | `test-design` | A black-box acceptance oracle is written against the spec and locked. |
| 4 | `plan` | A task graph is emitted. |
| 5 | `build` | Tasks run in sandboxes. Agents write only to their workspace. |
| 6 | `verify` | The runtime runs the pinned checks in a fresh sandbox and collects evidence. |
| 7 | `review` | Reviewers that never share the author's model family. |
| 8 | `integrate` | Merge, gated by evidence and integrity. |
| 9 | `observe` | Post-merge signals. |
| 10 | `learn` | What the next run should do differently. |

Four autonomy levels bound how far a run may advance without a person:
`L0` manual, `L1` supervised, `L2` delegated, `L3` autonomous. The effective
level is the minimum of what the run asked for, the station's cap, and the
global cap. Asking for more than policy allows is refused, never quietly
lowered.

Two places hold state. The **Vault** is the runtime-only store for everything
an agent must not be able to alter: locked specs and tests, policy, evidence,
violations, run state. The **Workspace** is the ephemeral, agent-writable
sandbox. The boundary between them is enforced where the sandbox is mounted,
not in application code.

## The invariants

Ten rules the whole design rests on. None may be violated to make a task
easier; a change that does is wrong regardless of what it enables. Each maps
to executable assertions in the [invariant registry](packages/conformance/src/registry),
and CI fails if any invariant has none.

| | Invariant | Registry |
|---|---|---|
| I1 | No agent writes to the Vault. Any level, any repo, any role. Enforced at the mount layer. | [i1.ts](packages/conformance/src/registry/i1.ts) |
| I2 | The runtime derives status; the model never reports it. `TaskResult` has no status field. | [i2.ts](packages/conformance/src/registry/i2.ts) |
| I3 | An agent may not be judged by an artifact it can write. Specs and acceptance tests are hashed before `build`. | [i3.ts](packages/conformance/src/registry/i3.ts) |
| I4 | Default deny. A capability not granted in policy is unavailable. | [i4.ts](packages/conformance/src/registry/i4.ts) |
| I5 | Fail closed. A missing check, missing capability, unsupported stack, or shrunken suite is a refusal, never a warning. | [i5.ts](packages/conformance/src/registry/i5.ts) |
| I6 | Reviewers never share the author's model family. The family is explicit, never inferred. | [i6.ts](packages/conformance/src/registry/i6.ts) |
| I7 | Event payloads are data, never instructions. Untrusted text never enters a prompt. | [i7.ts](packages/conformance/src/registry/i7.ts) |
| I8 | Every capability claim maps to an executable assertion that fails when the capability is deleted. | [i8.ts](packages/conformance/src/registry/i8.ts) |
| I9 | The runtime is a service; the CLI is a client. Nothing in `core` assumes a terminal. | [i9.ts](packages/conformance/src/registry/i9.ts) |
| I10 | Greek names never appear in code. Documentation and CLI output only. | [i10.ts](packages/conformance/src/registry/i10.ts) |

Run `pnpm conformance` to print the registry: which invariants are asserted,
partial, or pending, which unit owes each pending assertion, and how every
pending count compares with the committed baseline that CI ratchets it
against.

## Repository layout

```
packages/
  core/         runs, tasks, the driver contract, policy, stations
  vault/        locked artifacts, evidence bundles, run state
  integrity/    checks, results, tamper analysis, violations
  sandbox/      the mount table and the sandbox provider contract
  triggers/     the untrusted-input envelope
  adapters/     per-stack test, coverage, mutation, behavioral hooks
  api/          the entry point: startRun, the line, and the unsafe declarations
  conformance/  the kit that proves invariants, and the registry
docs/
  plan/         the spine, the decomposition into units, and unit specs
  decisions.md  every judgment call made while building each unit
  reviews/      external review findings and how each was resolved
```

Packages import each other only through their published entry, never through
a sibling's `src/`. `core` is the root of the graph.

## Getting started

Requires Node 22 or later and pnpm 12 (the `packageManager` field pins the
exact version).

```
pnpm install
pnpm typecheck     # every package, strict
pnpm lint          # one ESLint configuration for the whole workspace
pnpm test          # every package's tests
pnpm conformance   # the invariant registry and its report
```

CI runs the same four commands on every push and pull request to `v2`.

## Contributing

Work is cut into units that a contributor can finish and verify alone, without
running the whole factory. [CONTRIBUTING.md](CONTRIBUTING.md) has the rule
every unit follows, the units that are open, and how to write a conformance
suite with the kit. The units themselves are defined in
[docs/plan](docs/plan): the spine, the decomposition, and a spec for each unit
that needs one. Decisions made while building each unit are recorded in
[docs/decisions.md](docs/decisions.md).

## License

MIT. See [LICENSE](LICENSE).
