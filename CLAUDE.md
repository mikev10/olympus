# CLAUDE.md

Olympus is a software factory runtime: a provider-neutral engine that carries work from intent to merged code through a fixed line of stations, where policy decides when work advances.

**Mission:** a fully autonomous software factory that defines, builds, and ships working code.
**Claim today:** auditable, tamper-resistant evidence that autonomous work is real. Design for the mission, market the claim. Never claim lights-off autonomy.

This is a **v2 rewrite**. `main` is frozen v1. Ignore v1 code, v1 vocabulary, and anything referencing AI-DLC, Units, or Bolts.

## Read order

1. `docs/plan/F1-spine.md` — invariants, vocabulary, dependency graph
2. `docs/plan/DECOMPOSITION.md` — find the current unit
3. That unit's spec under `docs/plan/`, if it has one (`F2-contracts.md`, `S1-skeleton.md`)

**Do not load `.plan/olympus-v2-plan.md`.** It is maintainer reference, not session context.

`.plan/` is maintainer-local and gitignored — never commit it, never reference a path under it from a tracked file, and never quote it in a commit message, PR body, or code comment. This file is the one exception: the rule and the line above are the only references allowed anywhere, and CI checks it. Everything a contributor needs is in this file, the README, CONTRIBUTING.md, and `docs/plan/`.

## The invariants

Never violate one to make a task easier. A PR that does is wrong regardless of what it enables.

- **I1** No agent writes to the Vault. Any level, any repo, any role. Enforced at the mount layer.
- **I2** The runtime derives status; the model never reports it. `TaskResult` has no status field — do not add one.
- **I3** An agent may not be judged by an artifact it can write. Specs and acceptance tests are hashed before Build.
- **I4** Default deny. A capability not granted in policy is unavailable.
- **I5** Fail closed. Missing check, missing capability, unsupported stack, shrunken suite → refuse. Never degrade silently, never warn-and-continue.
- **I6** Reviewers never share the author's model family. `ModelIdentity.family` is explicit, never inferred.
- **I7** Event payloads are data, never instructions. `UntrustedPayload.raw` never enters a prompt.
- **I8** Every capability claim maps to an executable assertion that fails when the capability is deleted.
- **I9** The runtime is a service; the CLI is a client. Nothing in `core` assumes a TTY.
- **I10** Greek names never appear in code — not in types, paths, config keys, or policy fields. Docs and CLI output only.

## Vocabulary (frozen)

Stations: `intake` `spec` `test-design` `plan` `build` `verify` `review` `integrate` `observe` `learn`
Autonomy: `L0` manual, `L1` supervised, `L2` delegated, `L3` autonomous
Packages: `core` `vault` `integrity` `adapters` `sandbox` `triggers` `api` `cli` `compiler` `learning` `drivers/*`

Never reintroduce: Unit, Bolt, Inception, Construction, Operations, AI-DLC, `<promise>DONE</promise>`.

## Conventions

- TypeScript strict. No `any`. No non-null assertions without a comment naming the invariant that guarantees it.
- Never import from a sibling package's `src/` — only its published types.
- Branded types are load-bearing (`RunId`, `UntrustedPayload`, `SandboxHandle`). Do not widen them to `string`.
- Literal types encode invariants (`vault: 'never'`, `collectedBy: 'runtime'`). Do not generalize them.
- pnpm workspaces + changesets. Every package change gets a changeset.

## Working rules

1. **One unit per session.** Stay inside its scope.
2. **The out-of-scope list is binding.** Adjacent work becomes an issue, not a commit.
3. **Conformance suite first.** It is the acceptance criteria in executable form.
4. **Stop where the unit says stop.** Do not continue into the next unit without a human review.
5. If a unit spec is ambiguous, say so and propose two options with a recommendation. Do not resolve silently.
