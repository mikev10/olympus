# Decisions

Calls made while executing a unit where the spec was silent, ambiguous, or in
tension with the environment. Each entry records what was unclear, what was
chosen, why, and how to reverse it. Newest units at the bottom.

## F2: Contracts

### D-F2-01: The untracked v2 `CLAUDE.md` was kept and committed

- **Ambiguous:** the branch instructions said the tree must show only `.git` and `.plan` after clearing, but the root `CLAUDE.md` (the v2 project instructions) was never tracked on `main`, so `git rm` could not remove it and deleting it by hand would have destroyed the only copy.
- **Chosen:** keep it and commit it to `v2` in the first commit.
- **Why:** it is the file every session and contributor reads first; losing it is unrecoverable, committing it is trivially reversible.
- **Reverse:** `git rm CLAUDE.md` and commit.

### D-F2-02: Uncommitted edits on `main` were stashed, not discarded

- **Ambiguous:** `main` had uncommitted edits to `.gitignore` (adds `.plan`) and `.mcp.json` (removes several MCP servers). `git rm -rf .` on the orphan branch would have discarded both silently.
- **Chosen:** `git stash push` of those two paths before the orphan checkout. The stash is named `main: uncommitted edits preserved before v2 orphan (...)`.
- **Why:** preserving unsaved work costs nothing; discarding it is irreversible.
- **Reverse:** on `main`, `git stash pop` to restore, or `git stash drop` to discard.

### D-F2-03: v1 leftovers git never tracked were moved out of the repo

- **Ambiguous:** ignored and untracked v1 state survived the clear (`.env.local`, the v1 dogfooding install under `.claude/`, local RAG data in `lancedb/` and `models/`, `aidlc-docs/`, and similar). None of it is recoverable from git.
- **Chosen:** delete only regenerable build output (`node_modules/`, `dist/`, `coverage/`, `docs/build/`, `docs/.docusaurus/`, `docs/node_modules/`, an empty `.olympus-test/`). Move everything else, structure preserved, to the sibling directory `../olympus-v1-untracked/` so the working tree holds only `.git`, `.plan`, and v2 files. (First attempt hid them with `.git/info/exclude`; the maintainer asked for a genuinely clean tree.)
- **Why:** `.env.local` holds secrets and the `.claude/` install drove the v1 session; a move is reversible, a delete is not.
- **Reverse:** move the paths back, or delete `../olympus-v1-untracked/` once nothing in it is needed.

### D-F2-04: Six packages, no CLI package yet

- **Ambiguous:** the session brief named the CLI package (`olympus-ai`) and the scope for everything else (`@olympus-ai/<name>`) but also said to create only the packages the contract spec lists.
- **Chosen:** create exactly the six packages the nine files live in: `core`, `vault`, `integrity`, `sandbox`, `triggers`, `adapters`. No `cli`, no `conformance`, no `drivers/*`.
- **Why:** the spec's package list is binding; the naming rule applies when P9 creates the CLI. Note for P9: the v2 CLI must publish at a version above the v1 line (4.5.16), so 5.0.0 or higher.
- **Reverse:** add a package directory; the workspace glob picks it up.

### D-F2-05: Cross-package imports resolve through each package's published entry

- **Ambiguous:** the rule "never import a sibling's `src/`" versus a repo with no build step yet.
- **Chosen:** every package's `main` and `types` point at `./src/index.ts`. Sibling packages are imported only by published name (`@olympus-ai/vault`), never by path. TypeScript resolves the name through pnpm's workspace link to that entry.
- **Why:** the import sites are already what they will be after a build exists; only the package entry changes. The publish shape (dist, exports map, build tool) belongs to the unit that adds a build.
- **Reverse:** repoint `main`, `types`, and an `exports` map at `dist/` when the build lands. No import site changes.

### D-F2-06: The contract's type graph was cyclic; core is now the root

- **Ambiguous:** as specified, `core` imported `VaultRef` and `TriggerRef`; `vault` and `triggers` imported `RunId` and `StationId` from `core`; `vault` imported `CheckResult` from `integrity`, which imported `IntegrityViolation` from `vault`. pnpm 12 refuses to run `-r` tasks across a cycle, and TypeScript project references cannot express one.
- **Chosen (approved at the F2 review gate):** every type that run state or policy refers to lives in `core`. Moved into `core/src/run/types.ts`: `VaultRef`, `VaultRefKind`, `TriggerKind`, `AuthorTrust`, `TriggerLineage`, `TriggerRef`. Moved into `core/src/policy/types.ts`: `TriggerPolicy`. Moved into `integrity/src/types.ts`: `IntegrityViolation` (integrity produces it; the Vault only stores it). The graph is now `core -> sandbox`, `integrity -> core`, `triggers -> core`, `vault -> core, integrity`, `adapters -> integrity, sandbox`. The interim `ignoreWorkspaceCycles` flag is gone.
- **Why:** an ordered build and project references both need an acyclic graph, and the rule "core owns the vocabulary" is easy to apply to every later unit.
- **Reverse:** move a type back to the package that implements it and re-add the edge; the flag would then be needed again.

### D-F2-07: `CompiledRole` is declared in `core/src/driver/contract.ts`

- **Ambiguous:** `Driver.emitArtifacts(roles: CompiledRole[], ...)` references a type the spec never defines, and the compiler package that would own it is out of scope until M2.
- **Chosen:** declare a minimal `CompiledRole { role: RoleId; instructions: string }` beside the driver contract. Capability grants are deliberately left out so policy, via `TaskRequest`, stays the single source of truth for what a role may do (I4).
- **Why:** the file cannot typecheck without it, and drivers consume it, so the compiler will depend on `core` rather than the reverse.
- **Reverse:** the compiler unit extends or replaces it; additions are non-breaking.

### D-F2-08: `@types/node` lives at the workspace root

- **Ambiguous:** as specified, only `vault` used a Node type (`Buffer`), but every package's typecheck pulls every imported package's sources into its own program.
- **Chosen:** one root `@types/node` and `types: ["node"]` in the base tsconfig. Kept as the baseline for a Node service (I9) even though, after R-F2-06 below, no contract file needs a Node type.
- **Why:** a per-package copy would be invisible to the other packages' programs and fail their typecheck.
- **Reverse:** move it into each package that needs it once builds emit `.d.ts` files and programs stop crossing package boundaries.

### D-F2-09: Toolchain versions

- **Ambiguous:** no versions were specified.
- **Chosen:** TypeScript 7.0.2, pnpm 12.3.4 (installed with `npm install -g` because `corepack enable` needs administrator rights on this machine), `engines.node >= 22`, `@types/node` 22.
- **Why:** each is the current stable line. Node 20 reached end of life in April 2026, so a new runtime should not promise support for it.
- **Reverse:** edit `package.json`; nothing in the nine files depends on a version.

### D-F2-10: Compiler settings beyond `strict`

- **Ambiguous:** only `strict: true` and zero `any` were required.
- **Chosen:** `module` and `moduleResolution` set to `NodeNext` (so relative imports carry `.js` extensions), `lib` limited to `ES2022` with no DOM, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, `noImplicitOverride`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`.
- **Why:** the runtime is a Node service (I9), and the extra flags make indexing and optional fields fail closed at the type level (I5 in spirit).
- **Reverse:** remove a flag from `tsconfig.base.json`.

### D-F2-11: Transcription cleanups in comments

- **Ambiguous:** the spec's comments cite section and decision markers from the maintainer plan (for example `§10`, `§16`, `D10`) and one undefined term, "Ascent bound".
- **Chosen:** keep every type and every field verbatim; in comments, replace markers with the plain meaning, replace "Ascent bound" with "per-task iteration bound", use plain hyphens instead of em dashes, and avoid the word `any` in prose so a grep for it stays clean. Added short invariant annotations where the spec had none: I3 on `LockEntry`, I8 on `DriverCapabilities` and `SandboxCapabilities`, I9 and I10 in the `core` index header.
- **Why:** contributors cannot see the maintainer plan, so those references would dangle; the acceptance criteria ask that every invariant be either a type or an annotation naming its enforcer.
- **Reverse:** edit the comments.

### D-F2-12: Changesets configuration

- **Ambiguous:** `changeset init` in v3 is interactive and cannot run under this session's null stdin; the base branch and initial versions were unspecified.
- **Chosen:** wrote `.changeset/config.json` from the package's own default file with `access: public` and `baseBranch: v2`. All six packages start at `0.0.0` with one `minor` changeset, so the first release is `0.1.0`.
- **Why:** scoped packages must opt into public access; `main` is frozen v1 and cannot be the comparison branch.
- **Reverse:** edit `config.json`; delete or rewrite the changeset file.

### D-F2-13: Line endings and license field

- **Ambiguous:** development happens on Windows with `core.autocrlf=true`; CI will run on Linux.
- **Chosen:** `.gitattributes` forces LF everywhere. Every package declares `"license": "MIT"`; the `LICENSE` file itself arrives with F3's contribution surface.
- **Why:** mixed endings are the first thing a Linux CI job trips on; the license field matches the stated OSS boundary.
- **Reverse:** edit `.gitattributes`; add or change the license.

## F2 review gate: approved changes to the contract spec

The maintainer reviewed the nine files and approved the recommendations below.
Each changes a signature relative to the original contract spec. D-F2-06 above
records the package moves approved at the same gate.

### R-F2-01: `PolicyEngine` interface replaces two ambient function declarations

- **Problem:** `export declare function resolveAutonomy` and `resolveCapabilities` produced module exports with no runtime binding; importing either before the policy unit lands would yield `undefined` silently. Every other contract is an interface.
- **Change:** `PolicyEngine { resolveAutonomy(...): PolicyResolution; resolveCapabilities(...): CapabilityResolution }`.
- **Reverse:** restore the declarations; the policy unit must then implement them in that exact module.

### R-F2-02: `resolveCapabilities` returns a discriminated `CapabilityResolution`

- **Problem:** `CapabilityScope | PolicyResolution` had two success shapes, one of them (`{ ok: true; level }`) meaningless for a capability lookup, and no discriminant on the scope.
- **Change:** `PolicyRefusal` is the shared failure shape. `PolicyResolution = { ok: true; level } | PolicyRefusal` and `CapabilityResolution = { ok: true; scope } | PolicyRefusal`. Both narrow on `ok`.
- **Reverse:** return `CapabilityScope | PolicyRefusal` and discriminate with `'ok' in result`.

### R-F2-03: `GateResult.passed` removed

- **Problem:** `passed: boolean` and `verdict: 'pass' | 'fail' | 'escalate'` were two sources of truth; `passed: true` with `verdict: 'escalate'` was representable.
- **Change:** `verdict` alone. "Passed" is `verdict === 'pass'`.
- **Reverse:** add the field back and document which one wins.

### R-F2-04: `UntrustedPayload.raw` is an opaque `UntrustedText`, not a `string`

- **Problem:** the I7 comment claimed the brand kept untrusted text out of prompts, but `raw: string` flowed anywhere a string does, and a branded string subtype would too.
- **Change:** `UntrustedText = { readonly __brand: 'UntrustedText' }` with no string in it. Passing `raw` to anything typed `string` is now a compile error. Reading it requires a deliberate cast that only the extractor may contain (F3 conformance). Two gaps stay open at the type level, `+` concatenation and template interpolation, and F3's lint must enable `restrict-plus-operands` and `restrict-template-expressions` to close them.
- **Reverse:** `raw: string` and rely on lint alone.

### R-F2-05: `ModelIdentity.family` is a branded `ModelFamily`

- **Problem:** a free `string` let a driver pass its id or provider as the family by accident, which is exactly the inference I6 forbids.
- **Change:** `ModelFamily = string & { readonly __brand: 'ModelFamily' }`; assigning one requires a deliberate cast at the driver.
- **Reverse:** `family: string`. A closed union was rejected because adding a family would then be a contract change.

### R-F2-06: `Vault.read` returns `Uint8Array`

- **Problem:** `Buffer` tied the contract to Node's type for no benefit.
- **Change:** `Promise<Uint8Array>`. Node's `Buffer` satisfies it, so implementations lose nothing.
- **Reverse:** `Promise<Buffer>`.

### Not changed

- `Policy.approvals` still requires all forty `station:level` keys. Left as specified pending confirmation that every policy file must enumerate them.
- `collectedBy: 'runtime'` and `vault: 'never'` are unchanged. Their comments now say what the type does (make the other value unrepresentable) rather than who is prevented from writing it.
