# Decisions

Calls made while executing a unit where the spec was silent, ambiguous, or in
tension with the environment, and calls taken outside any unit where what
changed was the gates or the tooling that runs them. Each entry records what was
unclear, what was chosen, why, and how to reverse it. Newest units at the
bottom.

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
- **Chosen:** TypeScript 7.0.2, pnpm 12.3.4 (installed with `npm install -g` because `corepack enable` needs administrator rights on this machine), `engines.node >= 22`, `@types/node` 22. The TypeScript choice is superseded by D-F2-14 below.
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

- `Policy.approvals` still requires all forty `station:level` keys. Left as specified pending confirmation that every policy file must enumerate them. Resolved by R-F2-08 below.
- `collectedBy: 'runtime'` and `vault: 'never'` are unchanged. Their comments now say what the type does (make the other value unrepresentable) rather than who is prevented from writing it.

## F2 amendment: maintainer review of the nine files

The maintainer reviewed the nine files after the gate and asked for three
type-only edits plus a record of the gaps left open. Each entry below is a
change relative to the files as they passed the gate.

### R-F2-07: `Task.status` removed; `RunState.tasks` is the sole authority

- **Problem:** `Task.status` (inside the `TaskGraph`) and `RunState.tasks: Record<TaskId, TaskStatus>` both held a `TaskStatus`. They could disagree and nothing said which won: the same defect R-F2-03 removed from `GateResult`, missed in a second place.
- **Change:** `Task` is the static definition (identity, run, station, role, dependencies, base commit, dependency set, worktree, attempt). `RunState.tasks` alone holds mutable status, so a `RunState` on its own is enough to resume a run. `TaskStatus` is unchanged and stays where it was.
- **Reverse:** add the field back and document which one wins.

### R-F2-08: `PolicyDocument` split from `Policy`; `PolicyEngine.resolvePolicy` added

- **Problem:** `Policy.approvals` required all forty `station:level` keys, which no one can author by hand. Making it `Partial` would have been worse: a missing key means something downstream must decide, and a default of `auto` grants autonomy silently.
- **Change:** `PolicyDocument` is what a human authors and what `policy.yaml` parses to; `approvals` and `stationCaps` are `Partial`. `Policy` is the resolved form the engine consumes; `approvals` is the total forty-key record (`ApprovalKey` names the key type) and nothing else changed. `PolicyEngine.resolvePolicy(doc): Policy` runs once at load, and every approval the document omits resolves to `human-required`, never `auto`. The resolved `Policy` is what is hashed into the Vault, not the sparse document, so an auditor reads the effective table rather than a config plus a defaulting rule.
- **Reverse:** delete `PolicyDocument`, `ApprovalKey`, and `resolvePolicy`; every policy file must then enumerate all forty keys.

### Known gaps

Recorded, not fixed, so that no comment in the contract reads as though one of these is closed. Each names the unit that owns it.

- **`TriggerEvent.extracted` has no field schema** (owner: triggers unit, M2). `UntrustedText` keeps `raw` out of prompts, but `extracted` is the only path from a payload into a run and it is a free `Record<string, string>`. Once the extractor casts and reads `raw`, whatever it pulls through becomes ordinary trusted strings, and the type constrains neither which fields exist nor what they contain. An over-permissive extractor that copies the payload into a field defeats I7 entirely, and no type notices. Per-kind field schemas with length caps and character-class validation are required before any non-human trigger is enabled. The comment on the field now says this; it previously called `extracted` "the sole path into a run" as though being the only path made it safe.
- **`CapabilityScope.tools` has no relation to `DriverCapabilities`** — *split by P3, see D-P3-04*. `tools: string[]` is a free list, so a policy can grant a tool no driver exposes and nothing notices. The engine-side half is closed: P3 ships `validateToolGrants(policy, inventory)`, asserted by `I4.tool-grant-requires-an-inventory`. The driver-side half is open and owned by **P5**: `DriverCapabilities` holds feature flags and no tool inventory, so nothing in the repo can yet produce the argument that function requires. Tracked as `I4.driver-tool-inventory-validated`.
- **`commitRunState(s, ifVersion)` carries the version twice** (owner: P1, Vault). `ifVersion` is a parameter while `s.version` also holds one, and the contract does not say which the optimistic-concurrency check compares against. P1 must document which is authoritative before implementing it.
- **`StationContract.allowedContext` restricts review context by comment only** (owner: P4, station machine). The rule that review seats never see `author-narrative` or `plan` is a comment on the field, where I1's write boundary got a literal type (`vault: 'never'`). Inconsistent; revisit at P4 when the ten contracts are written.

### D-F2-14: TypeScript pinned to 6.0.3; supersedes the TypeScript line of D-F2-09

- **Problem:** typescript-eslint 8.70.0 (and its canary) declares `typescript >=4.8.4 <6.1.0`. TypeScript 7.0.2 ships no stable programmatic API (a new one is expected in 7.1), and typescript-eslint's TypeScript 7 tracking issue is blocked on it. The two rules R-F2-04 relies on, `restrict-plus-operands` and `restrict-template-expressions`, therefore cannot run against TypeScript 7, and I7 would have two open holes with no compensating control.
- **Chosen (decided at the F2 review gate):** pin `typescript` to exactly `6.0.3` at the workspace root, with no caret, so the version cannot drift without an explicit edit. Node stays `>=22`; pnpm, `@types/node`, and every compiler flag are unchanged. `pnpm -r typecheck` passes with no tsconfig changes.
- **Rejected:** the npm-alias arrangement Microsoft documents for the 6/7 transition (`typescript` aliased to `@typescript/typescript6` for lint, TypeScript 7 aliased under another name for `tsc`). Typed lint would then analyze a different compiler than the one that typechecks the shipped code, so the control I7 depends on would not be looking at what ships. That is a silent degrade, which I5 forbids. TypeScript 7's benefit is compile speed, and on a repo of pure type declarations there is nothing to speed up.
- **Reverse:** revisit only when both hold: TypeScript 7.1 ships its stable programmatic API, AND typescript-eslint declares support for it in its `typescript` peer range. Then bump the pin and confirm the two lint rules still run.

## F3: Conformance harness + repo scaffold

### D-F3-01: Compile-error assertions are annotated fixtures compiled through the TypeScript API

- **Ambiguous:** the brief allowed `expect-type`, `@ts-expect-error` fixtures, or an equivalent, and asked that the mechanism serve both compile-error and runtime assertions.
- **Chosen:** a fixture is a `.ts` file under `packages/conformance/fixtures/types/` that constructs the violation and annotates each offending line with `// expect-error TSnnnn: message fragment`. The kit's `FixtureCompiler` compiles the fixture alone, with the conformance package's compiler options, and requires the diagnostics to match the annotations exactly: every annotation met (same line, same code, message contains the fragment), no diagnostic unannotated. A fixture without annotations is a compile-ok fixture and must be clean. Each fixture is one vitest test, so compile-error and runtime assertions run through one runner and one registry.
- **Rejected:** `@ts-expect-error` is satisfied by any error on the next line, so a fixture with a typo passes as the invariant holding; and it runs under `tsc`, invisible to the test runner and unverifiable by the registry. `expectTypeOf` is a no-op at run time and only fails under `tsc` or vitest's typecheck mode, with the same visibility problem. Both were tried in thought, not code.
- **Cost:** the first fixture in a worker pays for parsing `@types/node` (about 0.8s); the compiler caches every non-fixture source file, so the rest take about 50ms each.
- **Reverse:** the registry only requires an assertion to be a function that throws; a different mechanism can sit behind `compileError` without touching the registry.

### D-F3-02: Three states per invariant, derived from live assertions and pending entries

- **Ambiguous:** whether an invariant with type-level assertions and an enforcement that cannot exist yet (I1: the types are asserted, the mount layer needs P2) is `asserted` or `pending`.
- **Chosen:** an entry holds both a list of assertions and a list of pending entries. State is `asserted` if it has any live assertion, else `pending` if it has any pending entry, else `missing`. Every pending entry is printed with its owner regardless of the invariant's state, and the total is printed on its own line, so the debt is visible even when the invariant counts as asserted. The count is not pinned in a test: the manifest diff is the review surface, and printing is what the brief asked for.
- **Why:** calling I1 `pending` would hide three real assertions; calling it `asserted` with nothing else would hide that the invariant's actual enforcement does not exist. Both facts are true and both are reported.
- **Reverse:** make state a declared field and validate it against the lists.
- **Superseded in part by D-F3-14:** `asserted` now requires nothing pending; an entry with both live assertions and pending entries is `partial`. The unpinned count is superseded by the ratchet in D-F3-13.

### D-F3-03: Capability claims are registry entries, and a generated fixture keeps them equal to the interface keys

- **Ambiguous:** I8 says every capability claim maps to an executable assertion, and the F2 contracts say the conformance suite must hold one assertion per key of `DriverCapabilities` and `SandboxCapabilities`; the brief's registry was described in terms of I1-I10 only.
- **Chosen:** the registry has a second section, `claims`, keyed `driver.<key>` and `sandbox.<key>`, evaluated with the same three states. All twelve are pending today (P5 owes the driver claims, P2 the sandbox claims). Two compile-ok assertions under I8 generate `Record<keyof DriverCapabilities, 0>` and `Record<keyof SandboxCapabilities, 0>` literals from the registry's keys, so a key added to either interface without a registry entry is a missing-property error and a registry entry with no key is an excess-property error.
- **Reverse:** delete the `claims` section and the two generated assertions.

### D-F3-04: The kit depends on no sibling package; fixtures resolve siblings through a `paths` map to their published entries

- **Ambiguous:** fixtures import `@olympus-ai/core` and the others, which normally needs a package.json dependency for pnpm to link them. But a Phase 2 package must be able to devDepend on the kit for `invariantTest`, and pnpm 12 refuses `-r` runs across a workspace cycle (D-F2-06).
- **Chosen:** `packages/conformance/package.json` declares no `@olympus-ai/*` dependency. Its tsconfig carries a `paths` entry per sibling pointing at that sibling's published entry (`../core/src/index.ts`, the `types` field of its package.json). `tsc`, typed ESLint, and the fixture compiler all read that tsconfig, so all three resolve the same files. `I8.fixture-paths-match-published-entries` asserts that every non-conformance package is mapped and that each target equals the package's `types` entry, so when a build moves the entry to `dist/` the map must follow or CI fails. Assertions that need a sibling's implementation live in that package's own tests and are registered as `external`, which the meta-test verifies statically (package present, file present, id named in the file).
- **Why:** the graph stays acyclic in both directions; fixtures still assert against the real contracts, resolved the way D-F2-05 says they are published.
- **Reverse:** add the six packages as devDependencies of the kit and delete `paths`; Phase 2 packages then cannot use the kit.

### D-F3-05: Test and lint toolchain

- **Ambiguous:** no versions or tools were specified beyond the two lint rules.
- **Chosen:** Vitest 4.1 (5.0.0 shipped five days before this unit; a scaffold should not adopt a major on release week), ESLint 10.10 with flat config, typescript-eslint 8.70 (declares `eslint ^10` and `typescript <6.1`), `@eslint/js` 10. One `eslint.config.js` at the root; every package's `lint` script is `eslint .`, which finds the root config by ancestor lookup, so a package lints alone with the same rules. Config: `strictTypeChecked` plus `stylisticTypeChecked`, `projectService` for typed rules, `reportUnusedDisableDirectives: 'error'`, `array-type: array-simple` (the contracts' existing style), `consistent-type-definitions` off (the contracts use `type` for branded shapes on purpose, and the nine files may not be edited). Root scripts: `typecheck`, `lint`, `test` (`pnpm -r test`), `conformance` (the registry file alone, so its report closes the CI log).
- **Reverse:** each is a version bump or a rule edit; nothing in the kit depends on a Vitest or ESLint major beyond the `ESLint` class API.

### D-F3-06: I7 registers three lint rules, not two; the remaining sinks are deferred to a type-aware rule that M2 owns

- **Ambiguous:** the brief named `restrict-plus-operands` and `restrict-template-expressions`. Neither covers `String(raw)` or `raw.toString()`.
- **Chosen:** `@typescript-eslint/no-base-to-string` is the third rule, registered under I7 with the other two. Two assertions cover them: `I7.lint-rules-active` resolves ESLint's configuration for every TypeScript file under `packages/` (fixtures/types excluded, since they are ignored by design) and requires all three at `error`; `I7.lint-rules-fire` lints a fixture with inline configuration ignored and requires each rule to fire on its annotated line. The fixture carries `eslint-disable-next-line` comments so the ordinary lint run passes, and `reportUnusedDisableDirectives` makes those comments fail the ordinary run too if a rule stops firing.
- **Deferred (rewritten at the F3 review):** two paths still compile, pass lint, and contain no cast for the scan to see. `JSON.stringify(raw)` yields the text as a string. Widening `raw` to `unknown`, by annotation (`const u: unknown = raw`) or by parameter (`f(raw)` where `f(x: unknown)`), followed by a cast from `unknown`, is not a cast from `UntrustedText` at any node. Probed against the current configuration: `[raw].join()` and `raw.toString()` are already reported by `no-base-to-string`; `structuredClone(raw)`, listed here before, keeps the `UntrustedText` type and is not a string sink. The path that closes both remaining sinks is a type-aware custom ESLint rule in the workspace configuration that rejects an expression typed `UntrustedText` or `UntrustedPayload` as an argument to `JSON.stringify` and as the source of any assignment, argument, or return whose target type is `unknown` or `object`. typescript-eslint's type services under the pinned TypeScript 6.0.3 (D-F2-14) make that rule writable today; the F3 review asked that it not be written in F3. It is registered as the pending assertion `I7.untrusted-sink-lint-rule`, owner **M2**: the trigger framework is where a non-human payload first flows, `I7.extracted-field-schemas` is owed there too, and both controls must exist before a non-human trigger is enabled. P5, where prompts are first assembled, was considered and rejected as owner: at M1 every trigger is human, and the rule guards the payload path, not the prompt path. Until M2 the brand, the three rules, and the cast scan (including `I7.cast-scan-sees-through-unknown`, D-F3-15) are the controls.
- **Reverse:** drop the third rule from `I7_LINT_RULES` and the fixture line; delete the pending entry and lower I7's number in `pending-baseline.json` by one.

### D-F3-07: I10's word list and its one exemption

- **Ambiguous:** I10 says no Greek names in code, and the package scope is `@olympus-ai/*` (D-F2-04), which appears in every cross-package import.
- **Chosen:** the scan strips exactly the scope prefix `@olympus-ai/` and the exact CLI package name `olympus-ai` before splitting, so `@olympus-ai/core` passes and `olympusRunState` does not. It reads identifiers, string literals, and template text through each package's own program, file paths under `packages/`, and every key and non-prose value of each package's `package.json` and `tsconfig.json`. The word list is curated to names that read as branding; common English words that are also Greek names (atlas, echo, iris, pan, muse, phoenix, oracle, ajax) are left out so the rule never fires on ordinary vocabulary. The list file and its unit test are the two files exempt from the scan.
- **Reverse:** edit `GREEK_NAMES` or `WORD_LIST_FILES`.

### D-F3-08: I9's scan covers `core` only, and Node's own globals are not DOM

- **Ambiguous:** which packages I9 binds, and which globals count as "assuming a terminal".
- **Chosen:** the scan runs over `@olympus-ai/core` (the invariant's text), flagging imports of terminal modules (`tty`, `readline`, `inquirer`, `chalk`, `commander`, and similar), property chains rooted at `process.stdin/stdout/stderr/exit/exitCode/argv`, any `.isTTY`, and any `console.*`. The DOM fixture uses only names Node's types do not declare: `navigator` and `localStorage` exist in `@types/node` 22 and were removed from the fixture after the compiler showed they compile.
- **Reverse:** widen the package list in `i9.ts`.

### D-F3-09: The conformance package is private, and the registry runs twice in CI

- **Chosen:** `@olympus-ai/conformance` is `private: true`. It is a workspace tool, and publishing it can be decided when an external driver package wants it. `pnpm test` runs it with everything else; the separate `pnpm conformance` step re-runs the registry file so its report is the last thing in the CI log. The overlap costs about five seconds.
- **Reverse:** remove `private`, add `publishConfig`; or drop the separate CI step.

### D-F3-10: LICENSE copyright holder

- **Ambiguous:** no holder name was given.
- **Chosen:** "Olympus contributors", year 2026.
- **Reverse:** edit the line; the MIT text is unchanged either way.

### D-F3-11: CI guards tracked-but-ignored files instead of naming the maintainer-local directory

- **Ambiguous:** the acceptance check is that nothing from the maintainer-local planning directory is tracked, but tracked files may not reference that directory's path.
- **Chosen:** a CI step fails if `git ls-files --cached --ignored --exclude-standard` prints anything: no tracked file may match `.gitignore`. That covers the planning directory through the ignore rule that already names it, and every other ignored path as well.
- **Reverse:** delete the step.

### D-F3-12: Pending owners are unit ids, plus two milestones

- **Chosen:** `UnitId` is `S1`, `P1` to `P9`, `M2`, `M3`. The milestones own assertions for features the M1 boundary defers (the trigger framework's field schemas, the review panel). The Phase 3 integration unit shares the name `I1` with an invariant and is not an owner; nothing pending belongs to it.
- **Reverse:** extend the union.

## F3 amendment: maintainer review of the conformance kit

The maintainer reviewed F3 and asked for three changes and one answer. D-F3-06 above was rewritten in place; the rest is below.

### D-F3-13: Every pending count is ratcheted against a committed baseline

- **Problem:** `validateEntry` checked that a pending entry names a real unit and a non-empty reason, and nothing bounded how many pending entries exist. A later unit could add one, CI would stay green, and owed work would accumulate behind a passing check.
- **Chosen:** `packages/conformance/pending-baseline.json` holds one allowed count per invariant and per capability claim, and is total over both: a registry entry with no baseline number is a problem, and so is a baseline key with no registry entry, so adding a claim forces a baseline edit. `evaluateRegistry` takes the baseline as an option; the meta-test and `I8.registry-complete` pass the committed file, and a count above its number is a problem, which fails the meta-test's `no problems` assertion. A count below its number is allowed and the report prints the delta beside the entry and beside the total (`pending 0 (baseline 1, -1)`). A missing file is an error, never an empty baseline; a top-level key other than `invariants`, `claims`, and `$comment` is rejected, so a misspelled section cannot read as absent. `I8.pending-count-never-exceeds-baseline` covers the mechanism itself: it checks the real registry against the file, then raises I1 to one entry above its number with the same baseline and requires the refusal, so deleting the ratchet fails the registry.
- **Demonstrated:** a pending entry added to I10 with no baseline edit fails `pnpm conformance` with `I10: pending count 1 exceeds baseline 0; raise it deliberately in packages/conformance/pending-baseline.json`, in the meta-test and in both I8 assertions; reverted before commit.
- **Known slack:** after a unit pays entries down the number stays until someone lowers it, so a later addition back up to the old number would pass. The delta line makes the slack visible on every run, and CONTRIBUTING asks that the number be lowered in the pull request that pays the work down. Not closed automatically because the review asked that decreases always be allowed and that the baseline change only by a deliberate edit.
- **Reverse:** delete the file, the `baseline` option, the two call sites, and the assertion; `readPendingBaseline` fails closed if any call site remains.

### D-F3-14: `partial` is the fourth state; supersedes the state rule of D-F3-02

- **Problem:** `stateOf` returned `asserted` whenever any assertion existed. I1 read `asserted` while its enforcement (no agent writes to the Vault) is owed entirely to P2, and I8 read `asserted` while all twelve capability claims were pending. The counts line, which is what a person reads, overstated coverage.
- **Chosen:** `partial` is assertions and pending both non-empty; `asserted` now means assertions and nothing pending. The report and the counts line distinguish all four states. CI still fails only on `missing`; this is a reporting change, not a gating change. Today the registry reads 2 asserted (I8, I10), 8 partial, 12 pending (every capability claim), 0 missing.
- **Reverse:** return `asserted` from `stateOf` whenever assertions exist.

### D-F3-15: The cast scan sees through a double cast, and a fixture now proves it

- **Question (from the review):** does `castsFrom` catch `raw as unknown as string`, or only a direct assertion from the branded type?
- **Finding:** it catches it. The scan visits every `as`, angle-bracket, and `satisfies` node and types that node's operand. A double cast is two nodes: the outer one's operand is `raw as unknown`, typed `unknown`, and is not reported; the inner one's operand is `raw`, typed `UntrustedText`, and is. The same holds for `<string>(<unknown>raw)` and `raw as never as string`, and for `payload as unknown as { raw: string }`, reported as `UntrustedPayload`. The unit test in `test/kit/scan.test.ts` already asserted the `as unknown as string` form against a same-file type alias; nothing in the registry exercised the scan against the real `UntrustedText` import or would have failed if the scan regressed on the nested form.
- **Chosen:** a fixture kind for scans. `fixtures/types/i7/untrusted-text-double-cast.ts` compiles cleanly (every line is one the type system allows) and carries `// expect-cast <TypeName>` annotations. `castFixture` builds it with the fixture compiler, runs `castsFrom` with the real import, and requires exactly the annotated lines: every annotation met with the named type, and no cast reported on an unannotated line (a cast of the plain `source` field and an unrelated `1 as unknown as number` sit in the fixture for that reason). Registered as `I7.cast-scan-sees-through-unknown`. `FixtureCompiler.build` now returns the program, source file, and text alongside the outcome so a scan can run over a fixture; `compile` is unchanged.
- **What the scan does not see:** an escape with no cast expression at all, widening to `unknown` by annotation or parameter and casting from there. That is one of the two sinks the deferred rule in D-F3-06 closes. `CAST_ALLOWLIST` stays empty.
- **Reverse:** delete the fixture and the assertion; `build` can stay.

## F3 amendment: external adversarial review

An external reviewer with no repository access returned 16 findings against
the conformance kit, the two workflows, and the lint configuration. The
maintainer triaged them; `docs/reviews/2026-09-08-f3-external.md` records
each finding, whether it held, and why it was or was not acted on. The
entries below are the decisions the six fixes and the limits record needed.

### D-F3-16: The manifests and the test and compiler configuration are protected paths; the label check is exact

- **Problem:** CI runs its four checks through root `package.json` scripts, and each package's `typecheck` script and `tsconfig.json` decide what the typecheck reads. None of those files was a protected path, so rewriting a script to `process.exit(0)` made CI green while running nothing and tripped no guard. Separately, the label check joined the label names into one string and matched `*" gate-change "*`, so a label named `not gate-change approved` passed.
- **Chosen:** `protected-paths.yml` covers root and per-package `package.json`, `pnpm-workspace.yaml`, per-package `tsconfig*.json`, and any `vitest.config.*` or `vitest.workspace.*`. Per-package `tsconfig.json` is beyond the review's list: `tsc -p` reads its `include`, and an empty `include` typechecks nothing, which is the same attack. The label test is `contains(github.event.pull_request.labels.*.name, 'gate-change')`, which GitHub evaluates over an array as element equality; the shell reads the boolean only.
- **Not chosen:** having CI call `tsc`, `eslint`, and `vitest` directly instead of through scripts. The scripts are what a contributor runs locally, and CI adding nothing they cannot reproduce is a property worth keeping; protecting the scripts keeps both.
- **Demonstrated:** the guard's pattern block, run over a synthetic diff touching those five kinds of file, matched nothing at the previous commit and matches all five now.
- **Reverse:** delete the patterns; restore the `join` and the `case`.

### D-F3-17: An inline suppression of an I7 rule in a package source is a registry failure

- **Problem:** the ordinary lint run honours inline configuration. `I7.lint-rules-active` reads the resolved configuration, which does not see comments, and `I7.lint-rules-fire` lints only the fixture with inline configuration ignored. So `// eslint-disable-next-line @typescript-eslint/no-base-to-string` in `packages/core/src/index.ts` silenced the rule while `pnpm lint` and `pnpm conformance` both passed. `reportUnusedDisableDirectives` was already `'error'` (D-F3-05) and does not help: the directive is used.
- **Chosen:** `I7.lint-rules-not-suppressed-inline`. The kit parses every comment in every `.ts`, `.mts`, `.cts`, `.js`, `.mjs`, and `.cjs` file under each package, outside any `fixtures/` directory, from the parsed file so a directive inside a string or a regular expression is not one, and the assertion fails on an `eslint-disable`, `-line`, or `-next-line` comment that names an I7 rule or names no rule (which disables every rule), and on a `/* eslint ... */` configuration comment that names one. The last two are beyond the review's wording; both defeat the rules by another spelling of the same comment.
- **Not chosen:** `linterOptions.noInlineConfig: true` for package sources, which would make the ordinary run ignore every directive. It would also forbid a legitimate disable of an unrelated rule and would itself be one configuration edit away from off. The assertion is narrower and is a registered control, so removing it is visible.
- **Demonstrated:** the planted comment passes `pnpm lint` and `pnpm conformance` at the previous commit and fails `pnpm conformance` now, naming the file and line.
- **Reverse:** delete the assertion and the three kit functions (`inlineConfigComments`, `suppressesAny`, `inlineSuppressions`).

### D-F3-18: Compile-ok assertions refuse annotations and require zero diagnostics

- **Problem:** `compileOk` refused a fixture carrying `expect-error` annotations; `compileOkSource` did not, so a generated source with an annotated error would match its diagnostic and pass. The zero-diagnostics requirement was implicit in `assertFixture`.
- **Chosen:** both constructors share `requireClean`: annotations are refused first, then `assertFixture`, then an explicit zero-diagnostics check.
- **Reverse:** inline the old bodies.

### D-F3-19: Capability key equality is bidirectional and requires a finite, non-empty key set; supersedes the mechanism of D-F3-03

- **Problem:** `Record<keyof T, 0> = { ...registered }` is one-directional. When `T` loses every key, `keyof T` is `never` and `Record<never, 0>` is the empty object type, which accepts any literal; when `T` has a string index signature, `keyof T` is `string | number` and accepts any key. Both compiled cleanly under TypeScript 6.0.3, and emptying `DriverCapabilities` left `I8.driver-capability-keys-registered` passing.
- **Chosen:** `keysEqual`, a kit constructor over `compileOkSource`. The generated source computes `Exclude<Actual, Registered>` and `Exclude<Registered, Actual>` and requires both to be `never`, each wrapped in a tuple so `never` does not distribute; an empty registered set is emitted as `never` rather than an empty union; `string`, `number`, and `symbol` index signatures are rejected; and an empty `keyof` is rejected, since a capability interface with no keys makes the claims section vacuous and I5 says refuse rather than pass vacuously. Each check is a constant typed `true` on success and as the offending keys on failure, so the diagnostic names them.
- **Demonstrated:** the emptied interface now fails the registry; unit tests cover each direction, both empty cases, and both index-signature kinds.
- **Reverse:** generate the `Record` literal again.

### D-F3-20: External assertions are refused until execution reconciliation exists; the reconciliation is owed to P2

- **Problem:** `verifyExternalAssertion` checked that the package was in the workspace, the file existed, and the file contained the quoted id. A README with the id in an HTML comment satisfied it; so did a skipped test. It verified presence, not execution, and the registry counted such an assertion as coverage.
- **Chosen:** every external assertion is a registry problem naming `I8.external-assertion-execution-reconciled`; the meta-test fails it as a test of its own; `stateOf` counts local assertions only, so an entry with nothing but a refused external assertion is `missing`; `verifyExternalAssertion` and the `root` evaluation option are deleted rather than kept for reuse. The `ExternalAssertion` type, the `external` constructor, and `invariantTest` stay so the owing unit has a shape to target. The reconciliation is a pending entry under I8 (baseline raised from 0 to 1, so I8 now reads `partial`; D-F3-14's "2 asserted" count is historical). Its owner is **P2**: it is owed to the first Phase 2 unit that needs an implementation-backed assertion, and by the dependency graph P1, P2, P3, and P8 start together, so the choice fell to the unit that already owes `I1.mount-layer-enforcement`, the first invariant assertion that must run inside another package, and whose test file is CONTRIBUTING's own example. If another Phase 2 unit lands first, it inherits the entry by editing the owner.
- **What reconciliation must do (for the owner):** read the owning package's own test-run output, confirm that every external id the registry lists ran and passed there as a test named `[<id>] ...`, and refuse an id that did not run.
- **Demonstrated:** at the previous commit the static check accepted the README comment; now a registry holding any external assertion reports the refusal.
- **Reverse:** restore the static check. Do not.

### D-F3-21: The I6 seat obligation is conjunctive; L3 refuses a same-family reviewer

- **Problem:** `I6.review-seat-family-check` read "refuse a reviewer whose family equals the author's, or record reduced independence when only one family is available". The spine's I6 text has the same "or". The second branch is satisfied while a same-family reviewer is seated, which is the violation the invariant exists to prevent.
- **Chosen:** reduced independence is reportable at L0-L2 only: the seat may be filled by the same family and the gate result must record it. At L3 a same-family reviewer is refused and the run does not advance; reduced independence is not reportable at L3. The pending reason states both halves and P4 must assert both. A meta-test pins the wording so the "or" cannot quietly return.
- **Not chosen:** splitting the obligation into two pending entries. The maintainer asked for one entry stating both; the meta-test gives the same protection against the weaker branch being paid alone.
- **Reverse:** edit the reason and the meta-test together.

### D-F3-22: Known limits: type-level fixtures prove a construction is illegal, not that a value cannot exist

The review exposed a structural ceiling that no single fix closes. A compile-error fixture proves that one way of writing a violation does not typecheck. It does not prove that no value of the violating shape can reach the runtime, because TypeScript's checks are on expressions, not values, and a scan over syntax sees only the forms it was written to see. Each limit below names the unit that owes the enforcement that would close it.

- **`TaskResult` can carry a `status` at run time (I2).** The fixture `i2/task-result-has-no-status.ts` proves a fresh object literal cannot name `status`. Under TypeScript 6.0.3 the literal-with-spread form the review cited (`{ ...result, status: 'passed' }` assigned directly) is also rejected, with TS2353; but the same literal assigned to a variable first, a cast to `TaskResult & { status: string }`, or a generic parameter bounded by `TaskResult` all compile and deliver a value carrying the field. A driver is code the runtime calls, and nothing in the types stops its result from carrying whatever it likes. **Owed to P6:** validate a driver's `TaskResult` at the boundary against the contract's exact key set and refuse extras, in the same place status is derived.
- **The I7 cast scan is a syntax scan (I7).** It reports `as`, angle-bracket, and `satisfies` nodes whose operand is typed `UntrustedText` or `UntrustedPayload`, and it sees through a double cast (D-F3-15). It does not see widening to `unknown` by annotation or parameter, erasure through a generic (`erase<T>(x: T): unknown`, then `as string`), or a type predicate (`x is string` narrows `raw` to `UntrustedText & string`, which is a `string`). All three compile and none contains a cast from the branded type. **Owed to M2:** the type-aware sink rule `I7.untrusted-sink-lint-rule`, which judges the value's type at the sink rather than the syntax on the way there.
- **The pending ratchet has slack (I8).** A count lowered without lowering its baseline can rise back to the baseline without a review. Accepted in D-F3-13: decreases are always allowed and the baseline changes only by a deliberate edit; the delta line and CONTRIBUTING's instruction to lower the number in the same pull request are the mitigation. No further change.
- **The scans run over an inventory that can be incomplete (I7, I9, I10).** `workspacePackages` reads one directory level under `packages/`, and `packageProgram` reads each package's `tsconfig.json` `include`. Every non-conformance package today includes only `src`, so a `test/` directory in one of them is outside its program and outside every scan; a package nested deeper than `packages/*`, which is where the spine's `drivers/claude-code` would go, is outside the workspace glob and the scan both. **Owed to P5**, the first unit that adds such a package: derive the inventory from `pnpm-workspace.yaml`'s globs, and assert that every `.ts` file under a package directory (outside `node_modules`, `dist`, `coverage`, and `fixtures/types`) is in that package's program.
- **The I9 terminal scan matches spellings, not bindings (I9).** It reports dotted chains rooted at `process` and `console` and imports of terminal modules. `const { stdout } = process; stdout.write(...)`, an alias (`const p = process`), or a re-export from another module contain none of those spellings and pass. **Owed to P9:** resolve each identifier through the checker to the `process` and `console` globals and the terminal modules, so a binding is what is matched. The S1 external review (finding 9) adds a construction with no terminal spelling at all: `readFileSync(0, 'utf8')` through `node:fs` reads foreground stdin, and `/dev/tty` opens the same way. The blacklist was not extended for it; `I9.api-runs-headless`, pending for P9, is the behavioural assertion that closes the class. What S1 did add (D-S1-16) is a refusal when a package's tsconfig leaves any `.ts` under `src` out of the scanned program, so the scan cannot be emptied by configuration.
- **The I10 scan is finite and partial (I10).** The precise policy, in place of the invariant's broad wording: the assertion reads identifiers, string literals, and template text in every file of every package's program; file paths under `packages/`; and every key and non-prose value of each package's `package.json` and `tsconfig.json`; it strips the npm scope `@olympus-ai/` and the CLI package name `olympus-ai`; it exempts the word-list file and its unit test; and it matches against the curated `GREEK_NAMES` list, which leaves out names that are ordinary English words (atlas, echo, iris, pan, muse, phoenix, oracle). It does not read comments, files outside a package's program (see the inventory limit), root configuration, workflows, changesets, or Markdown, and it cannot find a name the list lacks. Adding a name to the list is a one-line edit; adding a surface is a scan over that file kind. Neither is owed to a unit today; the policy is what I10's assertion asserts, and the invariant's wording in the README and CLAUDE.md is the broader intent.

## F3 amendment: planning documents tracked

Between the F3 review and the start of S1, the maintainer asked that the
planning documents contributors need be tracked, and that the S1 entry be
expanded from a summary to a spec (`docs/plan/S1-skeleton.md`).

### D-F3-23: The spine, the decomposition, and the unit specs are tracked under `docs/plan/`; the CI check names the maintainer-local directory. Supersedes D-F3-11

- **Problem:** `CLAUDE.md` and all three skills pointed at planning documents inside the maintainer-local directory, which is gitignored. A contributor was told to read a file that was not in their clone, and `start-unit` could only work for the maintainer. The decomposition exists so that contributors can pick up units (F1's sub-plan rule), and the document that decomposes was invisible to them. Nothing in the spine, the decomposition, or the contract spec is sensitive: invariants, vocabulary, a dependency graph, a work breakdown, the type signatures already in the repository.
- **Chosen:** `F1-spine.md`, `DECOMPOSITION.md`, and `F2-contracts.md` moved to `docs/plan/` and are tracked; `S1-skeleton.md` was written there directly. The maintainer-local directory keeps only the master plan (competitive analysis, positioning, the open-source/paid seam, risk assessment), still ignored. Every path reference in `CLAUDE.md`, the three skills, `CONTRIBUTING.md`, and the README now points at `docs/plan/`. The section and decision markers those documents cite (`§n`, `Dn`) refer to the master plan; the spine's header says so, and says that nothing a contributor needs is behind one.
- **The check:** `ship-unit` ran `git ls-files | grep -i plan`, which now matches `docs/plan/` and would report a false positive on every ship. Replaced with `git ls-files -- .plan/`, scoped to the directory. CI gains a step of the same scope beside the tracked-but-ignored check D-F3-11 chose: nothing under the maintainer-local directory is tracked, and no tracked file names a path under it, where a reference is the directory followed by a file name. `CLAUDE.md` is the one file excluded from the reference check, because it holds the rule itself and the one standing exception (the instruction never to load the master plan). D-F3-11's reasoning, that naming the directory in a tracked file was itself forbidden, no longer applies: the rule now says what the exceptions are, and the check enforces it as stated.
- **Also changed:** `review-request` excludes `docs/plan/` from the review bundle. The reviewer works from source alone, and the skill's clean-room rule would otherwise have been weakened by the move as a side effect. Its bundle check moved from a substring search for the directory name, which `CLAUDE.md`'s own rule would now trip, to a check of the bundle's file headers.
- **Reverse:** move the three files back and restore the paths; delete the CI step.

## S1: Walking skeleton

The spec (`docs/plan/S1-skeleton.md`) is complete and was built to as
written. The entries below are the calls it left open, and the positions the
implementation took on the contract findings it records.

### D-S1-01: `StubVault.lock` refuses an empty path list

- **Problem:** The spec says `verifyLocks` must throw for a run with no manifest, because `{ ok: true }` is never the answer to "nothing was locked". It does not say what `lock(runId, [], by)` does. Accepting it would store an empty manifest, and every later verification of that run would pass with nothing checked: the same hole, one call earlier.
- **Chosen:** `lock` throws on an empty list and stores nothing (I5).
- **Reverse:** delete the guard and the test `throws on an empty path list`.

### D-S1-02: a deleted locked artifact verifies as tampered, with `actual: 'missing'`

- **Problem:** The spec covers a changed file (one `tampered` item) and a missing manifest (throw), not a locked file that no longer exists. Throwing would turn a detectable tamper into an exception the line never records as a violation; hashing an empty byte string would report a deletion as an empty file.
- **Chosen:** the entry is reported in `tampered` with `actual` set to the literal `missing`, which no hex digest can equal. The line records the violation and refuses like any other mismatch.
- **Reverse:** throw instead. P1 owns the real Vault and may pick either.

### D-S1-03: a `VaultRef` is looked up by run, kind, and hash together

- **Problem:** The spec stores evidence and violations "under their SHA-256" and says an unknown ref throws. A store keyed by hash alone would answer a ref whose `kind` or `runId` is wrong as long as the bytes exist.
- **Chosen:** the key is the triple; a ref with a wrong kind or run is unknown. Identical bytes written twice for the same run and kind still return the same ref, as the spec requires.

### D-S1-04: the stub vault hands out copies

- **Problem:** An in-memory store returns object references by default. A caller that mutates a returned `RunState`, or the one it passed in, would be editing the vault's memory directly, which is the kind of write path I1 exists to close, even in a stub.
- **Chosen:** `commitRunState`, `readRunState`, `lock`, and `read` return copies (`structuredClone`; a fresh `Uint8Array` for `read`). The test `what is stored is a copy` pins it.

### D-S1-05: a check that cannot be started has no result, and a required one fails the gate by name

- **Problem:** The spec's verdict rule fails a required check that "has no result", and finding 4c forbids inventing an exit code. It does not say where the reason goes. Swallowing the error would leave a missing result with no explanation; propagating it would end the run with an exception instead of a committed state and a gate.
- **Chosen:** `StubSandboxProvider.exec` rejects when the process cannot be spawned. The verify station records no `CheckResult` for that check, runs the rest, and fails the gate when the check is required. The refusal's `detail` names every shortfall: no result with the spawn error, a non-zero exit code, or a suite count that is unknown or short. A check that is not required never fails the gate. Test: `a required check that cannot be started has no result and fails the gate, naming it`.
- **Reverse:** P6 owns the verification runtime; if `CheckResult` gains a way to record an unstarted check, use it.

### D-S1-06: what the spec left blank in `Run`, `SandboxSpec`, `TaskRequest`, and the violation record

- `Run.repo` is the workspace path: there is no repository yet, and the fixture directory is what the run operates on.
- `SandboxSpec.image` is the literal `none`: the stub mounts nothing and ignores it. The unit that adds a real image hands P2's provider one.
- `TaskRequest.stablePrefix` is the locked files' text joined by a newline, read from the workspace after verification. There is no prompt format to follow until the compiler (M2), and the stub driver does not read it.
- `IntegrityViolation.detail` carries `station` beside `tampered`, so a violation read back on its own says where it was detected.

### D-S1-07: `unsafeComponents` throws on a malformed declaration

- **Problem:** The declaration is read structurally. A component whose `unsafe` property is not a well-formed declaration (not an object, no name, an empty `cannotEnforce`) is neither declared nor undeclared. Ignoring it would let a component that tried to declare pass as safe.
- **Chosen:** it throws, naming the slot and the component, and the run does not start (I5).
- **Known limit, sharpened by the S1 external review (finding 5 and its framing finding):** a wrapper around a stub that does not forward `unsafe` carries no declaration. The fixture pins the exported stubs, not what wraps them; the skeleton's own tests wrap stubs deliberately, at L1 only. This is not a route above L1 today: `SKELETON_LINE` is appended unconditionally and any non-empty list refuses. The question P4 inherits is therefore not whether a hidden stub can get above L1 now, it cannot, but whether the mechanism will still refuse one once the line cap is removed. For this code the answer is no. **Requirement for P4:** before `SKELETON_LINE` is deleted, component provenance must be compositional, so that a wrapper cannot drop a declaration: trusted metadata a wrapper must propagate, a graph-construction layer that owns provenance, or an equivalent. P4 decides whether that becomes a pending registry entry.

### D-S1-08: tests live inside each package's program

- **Problem:** `core`, `vault`, and `sandbox` had no tests and no `test` script, and their `tsconfig.json` included `src` only, which D-F3-22 records as an inventory limit of the scans. The stubs need tests, and untypechecked tests are not evidence.
- **Chosen:** each of the three gains `test/`, a `test` script, and `"include": ["src", "test"]`, like `api` and `conformance`. Every test is typechecked with the contracts' strictness and sits inside the I7, I9, and I10 scans. The `include` edit is not optional: with a test file outside every tsconfig, `pnpm lint` fails with a parsing error, because typescript-eslint's project service refuses a file no project covers. Neither the three packages nor `api` declares a `vitest` devDependency of its own; the `test` script resolves it from the workspace root, which was verified in each package by removing the declaration, reinstalling, and running the suite. The `conformance` manifest's own declaration predates S1 and is untouched. These are manifest and compiler-configuration edits, so the pull request carries `gate-change`.

### D-S1-09: the paths reader moved out of `registry/i8.ts`; not required by an S1 deliverable

- **Problem:** §7 requires `vitest.config.ts` to derive `resolve.alias` from the same `paths` map the fixtures typecheck against, so the config needs a reader for that map. The only reader was `readPathsMap`, a private function inside `registry/i8.ts` behind `I8.fixture-paths-match-published-entries`. The config cannot reach a private function, and importing a registry module from the vitest config would load the whole registry at config time.
- **What would have been duplicated:** the fifteen-line parse of `tsconfig.json` through `ts.readConfigFile` and the narrowing of `compilerOptions.paths` to `Record<string, string[]>`. A second copy in the config would have been the minimal change and would have touched no existing file.
- **Chosen:** the function moved to `kit/paths.ts` as `conformancePathsMap`, `i8.ts` now imports it, and `conformanceAliases` beside it turns the map into absolute alias targets for the config. The `i8.ts` edit was a consolidation made during S1 because the two readers must never disagree about the map, and one parser is the simplest way to make that true. It was not required by any S1 deliverable; the deliverable was the alias derivation. The module is not re-exported from the kit's index: the config imports it by relative path and nothing else consumes it.
- **Reverse:** restore `readPathsMap` inside `i8.ts` and give the config its own copy.

### D-S1-10: host-conditional tests for the sandbox stub

- `capabilities()` throws on a host the `os` union cannot name (finding 4a). The test asserts the value on Linux and macOS and the refusal elsewhere, selected by `test.runIf` on the platform; CI on Linux and a Windows workstation between them cover both branches.
- A process that ends by signal is refused by name (finding 4c). On Windows a child that kills itself exits with a code and no signal, so that test is skipped there and runs in CI.

### D-S1-11: positions on the contract findings

Findings 4a, 4c, and 4d are implemented exactly as the spec states: `capabilities()` throws on an unnamed host, `exec` throws on a signal, the vault takes its root at construction. Finding 4b: `CheckSpec.timeoutMs` is carried in the fixture and not applied; the skeleton's checks are short, and the line does not provision one sandbox per check to work around the contract. Finding 4e: the empty `TamperReport` is built fresh per gate, and `SKELETON_LINE` is the statement that no analysis ran. Nothing was absorbed by relaxing an interface, and the three stub files total 325 lines.

## S1 amendment: external adversarial review

An external reviewer (ChatGPT, clean room, bundle only) returned ten
findings, a configuration note, and a framing finding; every one held
against the tree. The verbatim findings and the triage are in
`docs/reviews/2026-09-09-S1-walking-skeleton-adversarial-review.md` and
`...-triage.md`. The entries below record what changed and why; D-S1-07 and
D-F3-22 were amended in place for findings 5 and 9.

### D-S1-12: duplicate check ids are refused, and results are correlated by position

- **Problem:** the verify station matched each `CheckSpec` to its result with `checks.find` by id. Two required checks sharing an id both saw the first result, so a second that exited non-zero or never started was masked by a first that exited zero (review finding 1, reproduced).
- **Chosen:** `startRun` refuses a manifest with a duplicate id as `invalid-request` before anything is locked, provisioned, or committed. The verify station keeps results in a position-aligned array beside the specs and never matches by id afterwards, so the correlation cannot alias even without the guard.
- **Reverse:** neither half depends on the other; keep the guard if the correlation is ever rewritten.

### D-S1-13: the locks are re-verified after the checks; the writable workspace during verification is a contract limit

- **Problem:** the locks were verified on entry to `verify` and not again. The checks run in the workspace with the mount `rw`, so a check that rewrote `spec.md` and exited zero reached a passing gate with the locked artifact changed (finding 2, reproduced with the reviewer's command).
- **Chosen:** after the checks and before evidence is written or state committed, `verifyLocks` runs again. A mismatch records an `IntegrityViolation` whose detail carries `phase: 'after-checks'` and the check results, commits the task as failed at `verify`, writes no evidence, and returns the `lock-tamper` refusal. Evidence collected over a changed artifact is not evidence.
- **Recorded for P6, with P2:** the reviewer's stronger remedy, locked paths unwritable during verification, is unreachable from the skeleton: `MountTable.workspace` is typed `mode: 'rw'` with no other value, so every provider mounts the verification workspace writable. Whether verification should run against a read-only workspace, and what the contract needs for that, is P6's question and P2's enforcement.
- **Reverse:** delete the second `refuseIfTampered` call and the regression test `finding 2`.

### D-S1-14: the task is validated and snapshotted before the first `await`; `invalid-request` is a fourth outcome

- **Problem:** `checks: []` was a passing gate; the caller's array was held by reference and could be shrunk after `startRun` began, because `readonly` is erased; a `required` that was not a boolean read as optional through `!check.required` (finding 3, all three reproduced).
- **Chosen:** `validate.ts` refuses, as a new `RunOutcome` variant `{ reason: 'invalid-request', problems }`, a manifest with no check, with no required check, or with a check whose id is empty or duplicated, whose command is empty, whose `required` is not a boolean, or whose `expectedSuiteCount` is present and not a non-negative integer; the locked-path rules of D-S1-15 run in the same pass. The line then works from a copy of the task. A structured outcome rather than a throw, because this is caller input, not a component defect (contrast D-S1-07), and P9 will surface it.
- **Kept with P6:** the authoritative manifest, pinned at `test-design` and read from the Vault rather than the caller, is what closes the class; `I5.missing-check-or-shrunken-suite-refuses` already owes it. The validation here is the least the skeleton can insist on, not a substitute.
- **Reverse:** remove the variant and the `taskProblems` call; keep the snapshot regardless.

### D-S1-15: locked paths are validated as workspace-relative; the previous behaviour was fail-closed by accident

- **Problem:** the vault resolved a locked path with `resolve(root, path)` and the build station read it with `join(workspace, path)`, so an absolute path named two different files and a `..` segment escaped the root in both (finding 7, reproduced).
- **What actually happened before the fix, stated plainly:** an absolute path outside the workspace was locked by the vault, then `build` threw `ENOENT` for `workspace/<absolute>`. The run did not refuse; it threw an unstructured error after the lock, recorded no violation, and left the run state at `running`. That is fail-closed by accident, not by design. An exception that happens to stop a run is not a control: it holds only until someone adds a `catch`, and it leaves the record inconsistent. P1 (the vault's root) and P2 (the mount layer, which the contract requires to resolve symlinks and path escapes) will meet the same shape and should not read the old behaviour as precedent.
- **Chosen:** `startRun` refuses, as `invalid-request`, a locked path that is absolute on either platform, empty, duplicated, or contains a `..` segment, before the lock. Both readers now call `resolve`. Symlink and realpath containment stay with P1 and P2.
- **Reverse:** remove the locked-path rules from `validate.ts`; the two readers should stay on one resolver.

### D-S1-16: the I9 scan refuses a program that omits source files; the general inventory stays with P5

- **Problem:** the scan's only enumeration guard was `files.length === 0`. A tsconfig `include` naming one safe file kept the program non-empty while `src/run.ts`, `line.ts`, and `safety.ts` left it, and the label on `tsconfig.json` is process control, not executable evidence (finding 10).
- **Chosen:** `sourceFilesOutsideProgram` in `kit/scan.ts` names every `.ts` under a package's `src` that its program does not contain, and both I9 assertions refuse when it is non-empty. S1 widened this scan, so S1 owns the hole. The general assertion, that every `.ts` under every package directory is in that package's program, is a different inventory and stays with P5 as D-F3-22 records.
- **Reverse:** delete the guard and the `sourceFilesOutsideProgram` test; P5's assertion would then be the only cover.

### D-S1-17: I8 refuses a package whose `main` and `types` name different files

- **Problem:** `workspacePackages` exposed one entry, `types` or else `main`, and `I8.fixture-paths-match-published-entries` compared the paths map to it. The two could diverge and the fixtures would typecheck against a file the runtime never loads (review configuration note).
- **Chosen:** `WorkspacePackage` carries `main` and `types` separately; `entryDivergence` reports a package whose two resolve to different files, and the I8 assertion adds it to its problems. Every package today sets both to `./src/index.ts`.
- **Reverse:** drop the field pair and the call.

### D-S1-18: a pending entry under I3 for lock append-versus-replace, owed to P1; the I3 baseline raised from 2 to 3

- **Problem:** `StubVault.lock` replaces the run's manifest on every call, as spec §2 says it must, so S1 is correct as built. The reviewer (finding 6) showed what that means for the full line: `spec` locks the spec, `test-design` locks the acceptance tests, and the second lock drops the first's entries, while I3 requires both locked and re-verified at every transition. Replace semantics make I3 unsatisfiable, and the `Vault.lock` contract is silent on which it means.
- **Chosen, by maintainer direction:** not a decisions-only note. `I3.lock-preserves-earlier-entries` is a pending registry entry owed to P1, and `pending-baseline.json` raises I3 from 2 to 3 in the same change. The S1 spec's out-of-scope rule against adding pending entries was set aside for this one by the maintainer, deliberately and in the diff. P1 must make a later lock preserve earlier entries and assert that a re-lock cannot rebase a locked artifact's hash.
- **Reverse:** P1 pays the entry and lowers the baseline in the same pull request.

## Amendments surfaced by S1

`docs/plan/WORKFLOW.md` names three work types; these are amendments: changes
to contract files that a unit surfaced by being the first real use of them.
They do not run the unit loop and they land on `v2` before P1 starts. Each
entry names what S1 hit, what changed, how the conformance assertion changed
in the same commit, and what deferring would have cost. Ids are `A-S1-nn`.
The four contract findings S1 recorded that are not amendments are at the end
of this section, each with the unit that owes it.

### A-S1-03: `RunState`, `TaskResult`, and `AgentClaim` are read-only records

- **Surfaced by S1:** the stub vault clones on every read and commit (D-S1-04) and the stub driver copies its claim, because the types let anything holding one of the runtime's records mutate it, and the store's own memory with it. P1 would face the same choice with a real store, and every later consumer would inherit mutable records.
- **Chosen:** `readonly` on every property of the three, `Readonly<Record<TaskId, TaskStatus>>` for `tasks`, and `readonly T[]` for `evidenceRefs`, `violations`, `events`, and `filesChanged`. A new state is a new record, committed through the Vault; that is the only way status or station changes (I2). The stubs keep cloning: `readonly` is erased at run time (the lesson of D-F3-22), a cast is one keystroke, and the copy is what stops a careless consumer's write reaching the store. The two tests that prove the copies now mutate through a cast, which is the point.
- **Conformance, same commit:** `I2.records-are-readonly`, a new compile-error fixture: assignment to `station`, to a `tasks` entry, `push` on the three arrays, reassignment of `claim` and `narrative` are all refused with the read-only diagnostics, and a new state built by spread compiles. Shown failing against the mutable types, then passing.
- **Not changed:** `Usage`, `ModelIdentity`, `DriverEvent`, `VaultRef`, `CheckResult`, `GateResult`, and `EvidenceBundle` were not named and are untouched. P1 and P6 may extend the same treatment to what they own.
- **Cost of deferring:** P1 decides clone-or-trust for the real Vault against mutable types, P4 and P6 build on whichever it picks, and P9 serializes them; adding `readonly` after that touches every consumer at once instead of two stubs and two tests.
- **Reverse:** remove the modifiers; the fixture fails on every annotated line.

### A-S1-02: `MountTable.workspace` admits `ro`; I1 restated as "at most one rw mount, and it is the workspace"

- **Surfaced by S1:** the external review's finding 2. Verification ran against a tree the checks could modify, because `workspace: MountEntry & { mode: 'rw' }` made a writable workspace mandatory, which put I1 and I3 in tension inside the type itself. D-S1-13 recorded that as a limit for P6 with P2; this amendment supersedes that part of D-S1-13.
- **Chosen:** `workspace: MountEntry & { mode: 'rw' | 'ro' }`. `others` is unchanged and admits ro only. The invariant at the substrate is restated: at most one mount may be rw, and if one is, it is the workspace. The line now mounts the workspace rw for `build` and ro for `verify`; the re-verification of the locks after the checks (D-S1-13) stays, because the table asking for ro is only true when a provider enforces it, which the stub does not and P2's provider will.
- **Strength, compared:** the old type guaranteed two things: no rw mount outside the workspace slot, and the workspace slot rw. The second was a restriction on the workspace, not a protection of anything I1 names. The restated type keeps the first exactly: an rw entry in `others` and a two-rw table are still compile errors, in the same places, with the same diagnostics. Nothing I1 protects is weaker.
- **Conformance, same commit:** `I1.mount-table-single-rw` rewritten. Valid: a build table (workspace rw, others ro) and a verify table (workspace ro, others ro). Refused: an rw mount in `others` while the workspace is ro (the one rw mount is not the workspace), a two-rw table (workspace rw plus an rw other), and a mode outside the union. Demonstrated in order: the fixture failed against the old contract, because the two ro-workspace constructions were unexpected errors; passed after the widening; and with `others` weakened to `MountEntry[]` it failed again naming both bad tables (the rw other and the second rw of the two-rw table) as violations that now compile. A second mutation, `workspace: MountEntry & { mode: string }`, was a null mutation: the intersection with `MountEntry` kept the mode narrow, so it demonstrated nothing and is not counted. The pending `I1.mount-layer-enforcement` (P2) now also requires the provider to mount the workspace with the mode the table gives it.
- **Also:** the sandbox stub's declaration says a workspace the table marks ro is as writable as one it marks rw, so the L1 cap covers the new gap until P2.
- **Cost of deferring:** P2 would build the Docker provider around a workspace that is always rw; P6 would design verification around a writable tree with re-hashing as the only defence; and the change would then touch a provider, a verification runtime, and the contract at once, with a Docker mount option to add under review, instead of one type, one fixture, and two lines of the skeleton.
- **Reverse:** narrow the mode back to `'rw'`; the fixture's verify table becomes an error and the line's verify mount fails to typecheck.

### A-S1-01: `StationTransition` refusals carry a typed payload per reason, with a message beside it

- **Surfaced by S1:** `detail: string` did two jobs, and S1's tests read gate verdicts with regular expressions (`/hello-exit-zero/`, `/cannot-start/`, `/spec\.md/`) because there was nothing else to read. Every later unit would have inherited that, and P9's HTTP surface would have handed clients prose to parse.
- **Chosen:** the failure arm is `StationRefusal`, a discriminated union on `reason`, each arm carrying its own payload and a `message: string` for display: `gate-failed` carries `failed: FailedCheck[]` (`checkId`, `exitCode: number | null`, `cause`); `lock-tamper` carries `tampered: TamperedPath[]` (`path`, `expected`, `actual`); `violation` carries the recorded `VaultRef`s; `unsafe-above-l1` carries the component names in order; `capability-missing` carries the station and the `DriverCapability`; `parked` carries a cause and the retry count. `StationTransition` is the advance arm or a `StationRefusal`. Structure for machines, prose for humans, never one string doing both.
- **Judgment calls:** `FailedCheck.exitCode` is `number | null` with a `cause` beside it, because a check that could not be started has no exit code and inventing one is what I5 forbids, and a suite-count shortfall fails with exit code 0, so the code alone would not say why. `parked.cause` is a string: P4 owns parking and should close it into a set when it knows the causes; recorded here so it is not mistaken for a finished shape. The api's own `unsafe-above-l1` outcome, returned before any station, keeps the full declarations, which carry more than the names the contract arm holds. The api's `invalid-request` outcome, an S1 shape and not a contract, had the same fault one level up (`problems: string[]`), so it became `RequestProblem { path, code, message }` in the same change; every regression test now asserts a field path and a code.
- **Conformance, same commit:** `I5.transition-has-no-warn-and-continue` rewritten. Valid: an advance, a gate-failed with two failed checks, a lock-tamper, an unsafe-above-l1. Refused: an advance with warnings or a degraded flag (TS2353), a softer reason (TS2322), a prose-only refusal with no payload (TS2322, missing `failed`), a payload that belongs to another reason (TS2353), and a payload with no message (TS2322). Shown failing against the old contract, then passing.
- **What still matches prose:** `packages/api/test/safety.test.ts` matches `SKELETON_LINE.unsafe.cannotEnforce` lines with regular expressions. Those are the declarations S1 §1 defines as one line per control, for the refusal to print, not a gate verdict; no test reads a verdict or a refusal by pattern any more. If a machine ever needs to reason about which controls a component lacks, `cannotEnforce` wants a closed set of control ids beside the lines, and that question belongs with P4's compositional provenance (D-S1-07).
- **Cost of deferring:** P4 would produce prose from the station machine, P6 from verification, P9 would serialize it, and every test written between now and then would parse it; the change would then rewrite three producers and every consumer instead of one line and its tests.
- **Reverse:** restore `detail: string`; the tests go back to regular expressions, which is the point.

### Owed, not amended: the three contract gaps that wait for the unit that knows what completes them

A contract that is merely incomplete waits for the unit that knows what
completes it. These three were first recorded here as prose. By maintainer
direction, and for the reason that made the review's finding 6 a registry
entry (prose nobody counts, against an owned, ratcheted, visible obligation),
each is a pending registry entry under the invariant it protects, and the
baselines rose with them: I1 from 1 to 2, I2 from 1 to 2, I5 from 3 to 4. The
unit that pays one lowers its baseline in the same pull request.

- **`CheckSpec.command` grammar: `I5.check-command-has-a-grammar`, owed to P6.** The command is one string, so the runtime had to invent a grammar: the skeleton splits on whitespace with no shell, which mangles any quoted argument. Under I5 because a pinned check the runtime cannot execute exactly as pinned must be refused, never approximated. P6 owns the verification manifest and decides whether a command is an argv array, a shell string with a declared shell, or something an adapter produces, and asserts that an unrepresentable command is refused.
- **`CheckResult` cannot represent a check that could not start: `I2.unstarted-check-is-in-the-evidence`, owed to P6.** The evidence bundle simply lacks an entry; `FailedCheck.cause: 'no-result'` says so in the transition, and the spawn error lives only in `message`. Under I2 because a verdict derived from a fact the evidence does not carry is not auditable. P6 decides the shape of the record and asserts that the gate fails on it and the bundle shows it.
- **`TaskRequest.sandbox` hands a driver a handle it cannot exec in: `I1.driver-executes-inside-the-sandbox`, owed to P5 with P2.** Nothing in the contract lets a driver run a command inside the sandbox it was given; the stub driver does not care, and a real one will on its first task. Under I1 because a driver with no path into the sandbox runs the model on the host, outside the mount table where I1 is enforced. P5 meets it first and asserts that a task's commands run inside the sandbox and nowhere else; P2 owns the provider side.

## P1: Vault

The unit entry in `DECOMPOSITION.md` was underspecified in two ways and was
fixed before any code was written: the scope line named a storage substrate
that turned out to be wrong, and the entry carried four of the five sub-plan
parts F1 requires, with no acceptance criteria. Both are recorded below.

### D-P1-01: the Vault stores files, not SQLite; the scope line was corrected

- **Problem:** the unit entry said "over the local filesystem plus SQLite". Taken literally that meant a database under the component that holds audit evidence, and the choice of binding (`node:sqlite` or `better-sqlite3`) looked like the only open question.
- **Chosen, by maintainer direction:** files, and the scope line rewritten to say so. Evidence bundles, lock manifests, and violations are write-once and immutable, so files are the right shape — and an auditor verifying one with `sha256sum`, without Olympus and without a database, is *part of the audit claim* rather than a compromise. A row inside an opaque `.db` puts the tool back in the trust path that the claim exists to remove. Run state is the only mutable record: one small object needing compare-and-swap, which is not a database workload.
- **Against `better-sqlite3`:** a native module under every contributor and every CI runner. When a prebuild is missing for some Node-version-by-platform pair, a first-time contributor lands in `node-gyp`. That cuts against the distribution constraint and against decomposing for contributors.
- **Against `node:sqlite`:** an experimental API under the component holding audit evidence. Its upside is query, and nothing at M1 queries; that need arrives with the control plane, when the access patterns are known rather than guessed.
- **Asserted:** `an object file verifies as its own name` in `packages/vault/test/local.test.ts` recomputes the SHA-256 of the bytes on disk and requires it to equal the hash in the file's name. That test is the audit property, not a formality.
- **Reverse:** SQLite remains a later option behind the `Vault` interface. Nothing outside `packages/vault/src/local/` knows how the store is laid out.

### D-P1-02: the Vault takes two roots, and refuses a nested pair

- **Problem:** S1 finding 4d left this to P1: `Vault.lock(runId, paths, by)` gives the locked paths no base, and `StubVault` took a single `root` at construction. That one root was doing two jobs — where the Vault keeps its own files, and what a locked path resolves against. The second is the workspace, which is the tree an agent writes.
- **Chosen:** `new LocalVault({ store, artifacts })`. The constructor resolves both and throws if either contains the other, or if they are the same directory. A store inside the artifact root is a Vault an agent can reach, which is the arrangement I1 exists to prevent, and it is worth refusing in the one place the Vault can see it even though the real enforcement is P2's mount layer.
- **Note for P2 and P4:** this is a constructor-time guard, not the mount table. It stops a misconfiguration, not an attacker; `I1.mount-layer-enforcement` is still owed.
- **Reverse:** collapse to one root; the `two roots` tests fail.

### D-P1-03: the run-state CAS is an exclusive create, and nothing reads before it writes

- **Problem, named rather than treated as solved:** hand-rolled concurrency is this unit's real risk. A compare-then-write loses an update whenever two writers interleave between the read and the write, and — this is the part that makes it dangerous — it passes a sequential test while doing so.
- **Chosen:** `commitRunState` computes the next version from `ifVersion` alone and creates `state/<next>.json` with the `wx` flag. That single filesystem operation is the entire concurrency control: of any number of writers holding the same `ifVersion`, exactly one creates the file and the rest get `EEXIST` and are refused. No version is read in order to decide whether to write.
- **No `current` pointer.** The current version is derived by scanning for the highest `<n>.json`. A pointer file written *after* the record it points at is a second, non-atomic step: a writer that died between the two would leave a record no reader can see and a version no writer can take, wedging the run with no recovery path. Scanning costs a `readdir` and has no such state.
- **Demonstrated, not assumed:** with the flag changed from `wx` to `w`, `I5.stale-commit-is-refused-under-contention` fails with *8 processes committed run state from version 0 and 8 succeeded* — seven lost updates. Restored, it passes.
- **Reverse:** there is no safe reverse. Any change here that reads a version, decides, and then writes reintroduces the lost update; the assertion is what catches it.

### D-P1-04: `ifVersion` is authoritative, and a version that was never current is refused

- **Problem:** the contract left open which of `ifVersion` and `s.version` wins (S1 spec section 2). Separately, computing the next version from `ifVersion` alone means a caller passing a fabricated future version would create a valid file and leave a hole in the run's history.
- **Chosen:** `ifVersion` wins and `s.version` is ignored and overwritten, which is what `StubVault` did and what P4 will already have been written against. A precondition refuses an `ifVersion` that was never current — zero when state already exists, or a number above the highest committed.
- **Why the precondition does not weaken D-P1-03:** it is an additional refusal checked before the create, not the control. Two writers at the same live version both pass it and still race on the exclusive create, where exactly one wins. It rejects the fabricated case that the create alone would accept.
- **Reverse:** drop the precondition; the test `a version that was never current is refused` fails and a run may skip forward.

### D-P1-05: a lock adds a generation, and an already-locked path is refused outright

- **Problem:** `I3.lock-preserves-earlier-entries`, owed to P1 by D-S1-18. Replace semantics make I3 unsatisfiable: `spec` locks the spec, `test-design` locks the acceptance tests, and the second lock drops the first while I3 requires both re-verified at every transition.
- **Chosen:** each lock writes `locks/<generation>.json` with the same exclusive create, carrying every earlier entry plus the new ones. Nothing is ever rewritten, so the lock history is itself auditable, and a partial write cannot corrupt the manifest that is the tamper baseline. A concurrent second lock for the same generation is refused rather than merged.
- **The stricter half:** re-locking a path that is *already* locked is refused, not merely refused when the hash differs. Re-locking is how a tamper would launder itself — edit the artifact, lock it again, and the manifest agrees with the disk. The station and instant of the first lock are the audit record. The looser reading (permit an idempotent re-lock at the same hash) would still overwrite `lockedAt` and `lockedBy`, losing provenance for no gain.
- **Reverse:** compare hashes and allow a same-hash re-lock. `I3.lock-preserves-earlier-entries` asserts the refusal, so this cannot change quietly.

### D-P1-06: a locked path that comes to resolve outside the artifact root is tampered, not followed

- **Problem:** D-S1-15 left symlink and realpath containment to P1 and P2. A locked file replaced by a link to an identical file elsewhere would otherwise hash clean, and the artifact an agent is judged by would no longer be the artifact that was locked.
- **Chosen:** hashing resolves the real path and requires it to sit under the real artifact root. A path that escapes is reported in `tampered` with `actual: 'escaped'`, beside `'missing'` for a deletion (D-S1-02). Both are sentinels no hex digest can equal. Reporting rather than throwing keeps an escape on the path that records a violation and refuses, like any other mismatch.
- **Asserted on both platforms, by maintainer direction:** `I3.locked-artifact-cannot-be-substituted` picks its mechanism by platform — a file symlink on POSIX, a directory junction on Windows, which grants junctions without elevation and withholds file symlinks (this workstation returns `EPERM` for `symlink`). Both reach the same `realpath` containment check. There is no `runIf` and no `catch`: if a platform's own mechanism cannot be created, the assertion fails there, because a containment check that silently goes unexercised on a platform is worse than no check at all. The assertion also proves the escape is real, by comparing `realpath` of the locked path against the target before asking the Vault anything, so the verdict cannot pass for the wrong reason.
- **Why it lives in the registry rather than the package suite:** the mechanism is in the assertion's title, and `pnpm conformance` is the one suite CI runs with `--reporter=verbose`, so the CI log states which mechanism ran on which platform instead of leaving it to be assumed. A `console.log` in a package test does not appear at all under the default reporter, which is what `pnpm test` uses. An earlier version of this test lived in `packages/vault/test/local.test.ts` and wrapped the symlink in a `catch` that fell back to asserting a deletion; on this workstation that meant the escape branch never ran and the test passed anyway. That is the failure this arrangement exists to prevent.
- **Verified by mutation:** with the containment check disabled, the substituted file verifies as `{ ok: true }` and the assertion fails naming it.
- **Reverse:** hash the path without resolving it; the assertion fails on both platforms.

### D-P1-07: the implementation module imports nothing at run time but Node builtins

- **Problem:** the contention assertion must run *separate processes*, because two commits inside one process interleave only where the code happens to yield, and a compare-then-write that never yields between its two halves would pass such a test while being broken. A child process therefore has to load the real `commitRunState` — but Node's type stripping does not rewrite a `.js` specifier to the `.ts` file beside it, so `packages/vault/src/index.ts`, which re-exports `./types.js` at run time, cannot be loaded outside a bundler.
- **Chosen:** every cross-file import in `src/local/vault.ts` is type-only, so all of them erase and the file loads directly under `node`. The child imports that module by absolute path. This is a standing requirement on the file, recorded because it looks incidental: adding one value import to a sibling would break the assertion in a way whose cause is not obvious from the failure.
- **Cost if it must change:** the alternative is compiling the package before the registry runs, which puts a build step in front of the conformance suite.
- **Reverse:** none available without that build step.

### D-P1-08: the class carries exactly seven methods; helpers are module-level

- **Problem:** the unit's conformance line requires that no exported path mutates the Vault outside the named operations. The type-level fixture `I1.vault-has-no-generic-write` cannot see this: a TypeScript `private` method is fully public at run time, so an internal helper on the prototype is an undeclared write path.
- **Chosen:** every helper is a module-level function and the class holds `#store` and `#artifacts` as ECMAScript private fields, so `LocalVault.prototype` carries the seven named operations and nothing else. `I1.vault-implementation-exposes-only-named-operations` enumerates the prototype and fails on any extra name, quoting the `private`-is-not-private reason so the next person adding a helper knows where to put it.
- **Reverse:** delete the assertion; nothing then stops a helper from becoming a write path.

### D-P1-09: the contention assertion is registered under I5, not I2

- **Considered:** I2 owns run state as the single authority for task status, and a lost update corrupts exactly that.
- **Chosen:** I5. I2 is about *who produces* status — the runtime, never the model — and concurrency has nothing to do with the model. The invariant actually at risk is that a stale write is refused rather than quietly applied, which is I5's "never a silent degrade" verbatim. The assertion additionally requires every loser to carry a reason, because a refusal that says nothing is a silent failure wearing a different hat.

### D-P1-10: what P1 did not touch

- **`StubVault` stays.** The comment on it says "P1 replaces this file", but `I5.unsafe-component-refused-above-l1` and `I5.stubs-declare-unsafe` both still execute it, and stub replacement is I1 (Phase 3), which the decomposition assigns to the integration unit. `LocalVault` lands beside it. Nothing in `packages/api` was rewired.
- **No contract file changed.** `packages/vault/src/types.ts` is untouched; the `Vault` interface was implemented as written.
- **`LocalVault` carries no `unsafe` declaration**, because it is not a stub. The skeleton line still refuses above L1 on the three stubs and its own declaration, so nothing about the L1 cap changes.

### Known limits

- **The store grows without bound.** One file per state version per run, one per lock generation, one per object, and nothing prunes them. Retention policy is explicitly out of scope for P1 and has no owning unit today. This is the cost of dropping the database and is worth naming rather than discovering.
- **Serialization is not canonicalized.** Objects are stored as `JSON.stringify` produced them, so the content address is over *those bytes*. Two logically identical bundles built with different property insertion order hash differently. This is correct for the audit property, which is byte-level, but it means deduplication is byte identity and not semantic identity.
- **Records are validated structurally, not fully.** A file that is not a run state or not a manifest is refused rather than returned as a partial record, but individual field types beyond the load-bearing few are trusted. The Vault wrote these files; the check is against corruption, not against a hostile store.

## P1 amendment: external adversarial review

An external reviewer (Gemini 3.1 Pro Extended Thinking, clean room, bundle
only) returned three findings. All three held against the tree; two were
fixed and one is recorded below as a known limit with an owning unit. The
verbatim findings and the triage are in
`docs/reviews/2026-09-10-P1-vault-adversarial-review.md` and
`...-triage.md`.

### D-P1-11: a locked artifact that cannot be read is `unreadable`, a third sentinel, and never an exception

- **Problem:** `isAbsent` covered `ENOENT` and `ENOTDIR` only, so `EISDIR` (a locked file replaced by a directory), `ELOOP` (a symlink cycle), and `EACCES` (permissions removed) escaped `hashArtifact` as unhandled exceptions. Reproduced: substituting a directory for a locked `spec.md` threw `EISDIR` out of `verifyLocks`. Replacing a file with a directory requires no privilege.
- **Why this mattered more than the reviewer's framing:** the reviewer predicted a pipeline crash through `api/src/line.ts`, which is wired to `StubVault` and not to this Vault, so nothing crashes today. The real objection is D-S1-15's, recorded during S1 and reintroduced here by the component whose job is detecting tampering: an exception that happens to stop a run is not a control. It holds only until someone adds a `catch`, it records no violation, and it leaves the run state mid-flight.
- **Chosen:** `UNREADABLE`, beside `MISSING` and `ESCAPED`. Every failure to resolve or read a locked artifact is a sentinel in `tampered`, never a throw, because an artifact the runtime cannot read is not the artifact that was locked — a mismatch like any other, which the line records and refuses on. `lock` refuses an unreadable path outright.
- **Not chosen:** catching in `line.ts` and converting to a `lock-tamper` refusal, as the reviewer suggested. That leaves the Vault throwing and obliges every caller to remember a `catch`, which is the same fragility one level up.
- **Also changed:** the artifact root now resolves once in `lock` and `verifyLocks` instead of once per entry. A root that cannot be resolved is an operational failure rather than a verdict about one path, and it now fails loudly and once.
- **Known, not owned by P1:** `StubVault.hashFile` carries the identical `ENOENT`/`ENOTDIR`-only guard. S1 owns that file and I1 deletes it; it is recorded so it is not inherited.
- **Reverse:** restore the rethrow; the test `a locked artifact replaced by a directory is tampered, not an exception` fails.

### D-P1-12: records read back from the store are validated in full, not in part

- **Problem:** `requireRunState` checked `runId`, `station`, `version`, and `tasks` and omitted `evidenceRefs` and `violations` entirely; `requireManifest` checked that `entries` was an array but never that its elements were entries. Both then cast. A partial record survived validation and failed later in whichever caller spread it (`api/src/line.ts:249-250`), turning a corrupt store into a `TypeError` somewhere else; a manifest of junk entries surfaced as `The "paths[1]" argument must be of type string` from inside `resolve()`, with nothing naming the Vault or the run.
- **Chosen:** both boundaries validate every field a consumer reads without checking. `evidenceRefs` and `violations` must be arrays, `tasks` must be a non-array object, and every manifest entry must carry `path`, `sha256`, `lockedAt`, and `lockedBy` as strings. Refusal names the file.
- **Scope of the check, unchanged:** this is a guard against a corrupt or partial store, not against a hostile one. The Vault wrote these files, and the mount layer is what keeps anything else from writing them.
- **Reverse:** drop the added clauses; the three tests under `records read back from the store` fail.

### Known limit, owed to P2: the TOCTOU window in `hashArtifact`

`realpath` and `readFile` are two syscalls, and a locked path can be swapped
between them, so a read can follow a link that did not exist when containment
was checked (review finding 3). It is recorded rather than fixed, for the
reason the reviewer itself gives: passing the gate through that window
requires a file whose bytes hash to the locked artifact's SHA-256, which means
already holding the locked content, at which point writing it into the
workspace legitimately is simpler. No privilege is gained.

Descriptor-based reads would narrow the window inside the Vault, but the
window exists only because the tree is writable while it is being verified.
A-S1-02 widened `MountTable.workspace` to admit `ro` precisely so verification
can run against a read-only workspace, and `I1.mount-layer-enforcement`
already obliges P2 to mount the workspace with the mode the table gives it.
That closes the class; narrowing the syscall gap closes one instance of it. No
new pending entry is added: the obligation P2 already carries covers it, and
this note names the case so P2 meets it deliberately.

## P2: Sandbox (local Docker)

The unit entry carried four of the five sub-plan parts F1 requires, with no
acceptance criteria — the same defect P1 had. It was fixed in
`DECOMPOSITION.md` before any code was written, and the two decisions inside
that block that were the maintainer's are recorded below.

### D-P2-01: the unit entry gained acceptance criteria before work started

- **Problem:** `Scope`, `Deliver`, `Out of scope` and `Conformance` were present; `Accept` was not. F1 requires all five, and a unit whose done-when is only implied is a unit that argues about done at the end.
- **Chosen:** an `Accept` block on the P2 entry, written from the `Deliver` and `Conformance` lines it already had, plus the registry obligations P2 owns and the four commands every unit ends on.
- **Reverse:** delete the block; the unit is underspecified again.

### D-P2-02: no Docker daemon is a failing suite, not a skipped one

- **Problem:** the assertions that prove I1 at the mount layer need a real daemon. A host without one could skip them, and `pnpm conformance` would print green having proven nothing about the substrate every other package's safety rests on.
- **Chosen, by maintainer direction:** fail closed. A missing daemon fails the assertion and names the requirement. CI runs on `ubuntu-latest`, which has Docker, so the proof runs on every pull request; a contributor without Docker gets a red suite and a message, never a quiet pass.
- **Rejected — `test.runIf` on daemon presence:** it is warn-and-continue with a report line in front of it. I5 names exactly this: never degrade silently, never let a run continue past a missing check. The one suite that proves I1 is the last place to make an exception.
- **Rejected — an env-var escape hatch:** it would let a contributor work without Docker, and it would also let CI be configured past the check. Something that can be set will be.
- **Reverse:** the daemon probe is one function; make it return a skip instead of throwing.

### D-P2-03: the Docker-backed assertions are local to the conformance package; I8's reconciliation entry is re-owned, not silently deferred

- **Problem:** `packages/sandbox` could own these assertions in its own suite and register them with the registry as `external` — but the registry refuses every external assertion until `I8.external-assertion-execution-reconciled` lands, and that entry names P2 as its owner.
- **Chosen, by maintainer direction:** register them as local `runtime` assertions inside `packages/conformance`, which imports `@olympus-ai/sandbox` and drives the provider directly. This is the shape P1 already used for `I1.vault-implementation-exposes-only-named-operations`, so it needs no new mechanism, and it keeps the proof of I1 in the package whose job is proving invariants.
- **Cost, paid explicitly:** `pnpm conformance` now requires Docker (D-P2-02), and P2 does not pay `I8.external-assertion-execution-reconciled`. That entry is not left pointing at a unit that declined it: its owner and reason are amended in this unit's diff to name the first unit that actually needs an assertion it cannot run locally. Deferring an owned entry by saying nothing is the thing the ratchet exists to prevent.
- **Reverse:** build the reconciliation mechanism, move the assertions into `packages/sandbox/test`, and register them with `external()`.

### D-P2-04: the provider is built by `create()`, which probes the daemon first

- **Problem:** `capabilities()` is synchronous and claims `os: 'linux'` and `remote: false`. A provider constructed without ever reaching a daemon would have to answer both with a guess, and every assertion resting on it would be asserting the guess.
- **Chosen:** a static async `LocalDockerProvider.create()` is the only way to build one. It runs `docker info` and `docker context inspect`, and refuses unless there is a daemon, it serves Linux containers, and its endpoint is a local socket or pipe. The constructor is private and takes the probed facts. `capabilities()` then reports what was established rather than what was hoped.
- **Consequence:** a remote or Windows-container daemon is a refusal at construction, not a degraded provider. Both are M4b or later, and a provider that provisioned on a remote worker while declaring `remote: false` would break I8 directly.
- **Reverse:** make the constructor public and default the facts; the three `create` tests fail.

### D-P2-05: the Docker CLI, not the daemon socket

- **Chosen:** every daemon call is `spawn('docker', argv, { shell: false })`. No shell is involved, so nothing a caller supplies can be read as shell syntax, and `appliedControls().runArgs` is the exact argv, which a reviewer can paste into a terminal to get the same container.
- **Against a socket client:** a hand-rolled HTTP client over a named pipe or Unix socket puts the container's configuration behind code nobody reads, and the flags that carry the limits are the documented, stable surface. The cost is one process per call, which is nothing beside pulling an image.
- **Reverse:** replace `docker.ts`; nothing outside `src/local/` knows how the daemon is reached.

### D-P2-06: `mountTable` takes an unvalidated shape, and returns the validated one

- **Problem:** typing the validator's input as `MountTable` made its own checks unreachable — the compiler called `entry.mode !== 'ro'` impossible, and lint failed on it, while a second `rw` mount arriving through a cast is exactly the case the check exists for.
- **Chosen:** `MountTableSpec` carries `mode: string`. Loose in, strict out. The type-level guarantee is not weakened by this and is asserted separately by the compile-error fixture behind `I1.mount-table-single-rw`; this function is the run-time half, for values that reached the process through a cast, a parsed document, or JavaScript.
- **Also:** `provision` re-validates `spec.mounts` through the same function rather than trusting the `MountTable` it was handed, for the same reason.
- **Reverse:** narrow `MountTableSpec`; the four cast-driven refusal tests become unreachable.

### D-P2-07: an `allowlist` egress policy is refused

- **Problem:** `EgressPolicy.mode` admits `allowlist`, and enforcing one needs a filtering proxy the container is forced through. Nothing at M1 provides that.
- **Chosen:** refuse it, at the `egress` layer, naming why. Treating it as deny-all would break a run silently; treating it as allow-all would grant the whole network to a policy that asked for a subset. Either is the silent degrade I5 forbids. `deny-all` carrying `allow` entries is refused too — the policy contradicts itself, and half-applying it is a guess.
- **Reverse:** implement the proxy, then accept the mode. Nothing else changes.
- **Reversed by P10 (D-P10-01).** The proxy exists, the mode is accepted, and the refusal now fires only for an allowlist that names nothing or an entry that is not one host. The `deny-all` half of this decision is unchanged and still stands.

### D-P2-08: the wall clock bounds the sandbox, not the command

- **Chosen:** `limits.wallClockMs` is a budget measured from `provision`. Each `exec` is bounded by what remains; on expiry the container is destroyed and the refusal names the limit. An `exec` started after the budget is spent is refused rather than run.
- **Why the container goes with it:** killing only the `docker exec` client leaves whatever it started running inside the container, so the limit that was supposed to bound the work would not have bounded it.
- **Why not per command:** a station provisions once and runs many commands. A per-command bound puts no ceiling on the total, which is what a runaway agent actually consumes.
- **A terminated command throws rather than returning an exit code**, following the same reasoning as S1 finding 4c: `ExecResult.exitCode` cannot represent "killed", and inventing one would be a lie.
- **Reverse:** move the deadline into `exec`; two limit tests fail.

### D-P2-09: path comparison is case-insensitive on every platform

- **Chosen:** every comparison in `local/paths.ts` folds case, including on Linux. Each one decides a refusal, and refusing a pair that only a case-sensitive filesystem would call distinct is the fail-closed direction. The reverse — a Vault path reachable because two spellings looked different — is the failure I1 exists to prevent.
- **Cost:** on Linux, `/srv/vault` in the deny list refuses a mount of a genuinely different `/srv/Vault`. Rare, and harmless when it happens.
- **Reverse:** make the fold conditional on `process.platform`.

### D-P2-10: a path carrying a comma or an equals sign is refused

- **Problem:** `--mount` is comma-separated `key=value` pairs, so neither character can be expressed in a source or target. The CLI does not document a quoting form for them.
- **Chosen:** refuse. Guessing at a quoting grammar risks a mount landing somewhere other than where the table says, which is the failure the whole module exists to prevent.
- **Reverse:** if a quoting form is ever documented, apply it and drop the check.

### D-P2-11: what is proven behaviourally and what is proven by configuration

- **Behaviourally, inside a container:** the mount modes (a write to an `ro` mount fails, a write to the `rw` workspace lands on the host), the absence of a network (the only interface is `lo`, and a route attempt reports `Network unreachable`), persistence across `exec`, the kernel's name, and the absence of a display and a GPU device.
- **By the container's own `HostConfig`:** `--cpus`, `--memory` and `--pids-limit`, read back with `docker inspect` rather than from the arguments that were sent, so the assertion sits on what the daemon applied.
- **Not proven behaviourally:** that the cpu, memory and pid limits *bite*. Provoking them means a fork bomb or a deliberate allocator overrun, which are slow and flaky in CI and would be testing the kernel's cgroup implementation rather than this provider's use of it. Reading them back from `HostConfig` establishes the provider's whole contribution: the limit was requested and the daemon accepted it.
- **The assertions were mutation-tested rather than assumed.** Twelve deliberate breakages — dropping the `readonly` flag, skipping the Vault containment check, dropping `--network none` and `--pids-limit`, downgrading a second `rw` mount instead of refusing it, letting an over-budget command report success, letting Docker create an absent mount source, and flipping each of the five capability declarations — were each caught by at least one assertion.

### D-P2-12: an ended sandbox keeps its record, and the wall-clock refusal is never masked by a failed removal

- **Problem:** `#end` deleted the handle's record, so `Sandbox.ended` was written and never read, and a sandbox the runtime had itself destroyed on its wall clock reported "not a handle this provider issued" on the next call — the least informative answer available for the most likely real failure. A second defect sat beside it: the timeout path awaited a removal that throws, so a `docker rm` failure replaced the wall-clock refusal with a removal error and the breach went unreported.
- **Chosen:** the record survives its container. A later `exec` or `destroy` refuses at the `lifetime` layer naming why the sandbox ended, `#require` still refuses a handle that was never issued at the `handle` layer, and `appliedControls()` keeps answering — what was enforced on a sandbox outlives the sandbox, which is the shape an audit needs. `#remove` returns its failure instead of throwing it, so the timeout path reports the breach *and* the failed removal in one refusal rather than trading one for the other.
- **Cost:** one small record per sandbox, never freed for the life of the provider instance. Accepted: the record is a handful of strings, and losing the evidence of what a sandbox enforced the moment it stops running is the worse trade for a component whose purpose is auditable enforcement. If a long-lived provider ever provisions enough sandboxes for this to matter, the fix is to age records out, not to delete them at destruction.
- **Reverse:** delete the record in `#end`; the two lifecycle tests naming the `lifetime` layer fail.

### Known limit, and an acceptance criterion narrowed to match: blocked egress is refused, not itemised

The `Accept` bullet on this unit was narrowed during the work, which is
recorded here rather than done quietly. It first read "a network call from
inside a `deny-all` sandbox fails, and the refusal is recorded rather than
merely dropped", written from the entry's original conformance line. What is
delivered is stated below; the bullet now says that instead.

The unit's conformance line asks for blocked egress to be "refused and logged".
The refusal is real and recorded: an unenforceable `allowlist` is refused by
name, and `appliedControls()` records `network: 'none'` beside the exact
`docker run` argv, which is the evidence that deny-all was applied rather than
assumed. What does not exist is a log line per blocked connection. `--network
none` is enforced by the kernel, which drops the attempt before any userspace
component of ours could see it; itemising attempts needs the same filtering
proxy `allowlist` needs. Recorded here rather than claimed, and it arrives with
the proxy or not at all.

## P2 amendment: external adversarial review

An external reviewer (Gemini, temporary chat, bundle only) returned six
findings. Four hold and were fixed on the unit branch; two hold in part and are
recorded below. The full triage, with the verification evidence for each, is
`docs/reviews/2026-09-11-P2-sandbox-adversarial-triage.md`.

One was a genuine I1 bypass: a running container was handed the Vault,
read-write, with every containment check passing.

### D-P2-13: the grammar check runs on the resolved path, because that is the path Docker is given

- **Problem:** `refuseUnrepresentable` ran on the path the caller declared; `mountArgument` interpolated the path after `realpath`. A comma-free declared source resolving to a comma-bearing one reached `docker run` intact, and Docker's `--mount` grammar splits on the comma and mounts the *prefix before it* — a different directory from the one every check validated, created by Docker if absent. A sibling of the Vault named `vault,readonly` truncates to the Vault. `containsPath` is right to find no overlap between the two, which is what made the hole invisible.
- **Chosen:** check the resolved path as well, inside `resolveSource`, before it can reach an argument. The rule is that whatever string ends up in the argv is the string the grammar check must have seen.
- **Note on the finding:** the reviewer described this as overriding the `target=` key. That is not constructible — a `target` payload needs a `/`, which no filesystem allows in a path component — and fixing what was described would have left the real hole open. The conclusion was right, the mechanism was not, and only running it settled which.
- **Asserted:** a mount-layer test, and `I1.mount-layer-refuses-a-vault-mount` drives the decoy through the real provider. Both fail when the check is reverted.
- **Reverse:** drop the second `refuseUnrepresentable` call; both assertions fail.

### D-P2-14: the wall clock arms a timer at provision; supersedes the enforcement half of D-P2-08

- **Problem:** D-P2-08 made `wallClockMs` the sandbox's lifetime budget, but it was only ever consulted inside `exec`. A task that started background work and was never called again outlived its budget entirely. Measured: a 1500 ms sandbox still running after 4000 ms.
- **Chosen:** `provision` arms a `setTimeout` that destroys the container when the budget expires, independent of any call. It is `unref()`d, because under I9 the runtime is a service and a pending timer must never be what keeps its process alive. `#end` clears it; `#expire` records a removal failure on the sandbox rather than raising an unhandled rejection, since nothing awaits it.
- **Why here and not in an orchestrator,** which is what the reviewer asked: `wallClockMs` is a field of `SandboxSpec` and this unit's deliverables name the wall-clock limit among the controls the provider applies. A limit the provider accepts and does not enforce is the silent degrade I5 refuses. An orchestrator-level budget is a fine additional control; it cannot be the reason this one is missing.
- **The budget semantics of D-P2-08 stand.** Only the enforcement mechanism changed, from lazy to self-firing.
- **Reverse:** disarm the timer; the regression test in `local.test.ts` fails.

### D-P2-17: ending a sandbox is one removal, awaited by whoever asks second

- **Problem, found by CI and not locally:** D-P2-14's timer and an `exec` that outlives its budget expire at the same instant and both wanted the container gone, so both issued `docker rm --force` for it. The second returns as soon as the first has marked the container, while removal is still in progress, and a caller checking immediately afterwards still finds it. The pre-existing wall-clock assertion caught this on the Linux runner; a Windows daemon removes fast enough that it does not reproduce there.
- **Chosen:** `Sandbox.ending` holds the single in-flight removal. `#end` returns it to whoever arrives second instead of starting another, so both callers wait for the same `docker rm` and neither returns before the container is gone.
- **A test was written for this and then deleted.** It raced two `destroy` calls, which are already serialised by the `ended` flag set before the first `await`; it passed with the fix reverted and so proved nothing. A safety test that cannot fail is worse than none, because the suite then reports coverage it does not have. The guard is the wall-clock assertion in `local.test.ts`, which is where the failure actually surfaced, and its comment now says so.
- **Honest limit:** that guard is timing-dependent and enforces this on Linux CI rather than on every host.
- **Reverse:** drop the `ending` guard; CI fails on Linux and the local suite does not.

### D-P2-15: an absent Vault root is canonicalised, not passed through unresolved

- **Problem:** a Vault root that did not exist yet had its `realpath` failure caught and the unresolved path returned, so containment compared a resolved mount source against an unresolved Vault string and found no overlap. An agent could hold read-write on the directory where the Vault was about to be created, and the refusal would arrive only once it existed — a fail-open on an I1 check, which is the one category that must fail closed.
- **Chosen:** `canonicalise` resolves the deepest existing ancestor and appends the missing tail, so an absent root still compares as the location it will occupy.
- **Rejected — dropping an unresolvable Vault path:** a Vault root that does not exist yet still names somewhere nothing may mount.
- **Asserted:** the refusal, plus a control that an unrelated absent Vault root does not become a refusal of everything.
- **Reverse:** restore the `catch { return absolute; }`; two tests fail.

### D-P2-16: every mount entry is frozen, not only the containers holding them

- **Problem:** `mountTable` froze the returned object and the `others` array, leaving the `workspace` entry writable. The reviewer named that; it stopped one short, because the `others` entries were unfrozen too.
- **Chosen:** freeze every entry as well as both containers. A validated table whose entries can still be edited afterwards is worth nothing, and that is as true of `others` as of `workspace`.
- **Severity, honestly:** defence in depth, not a live bypass — the table does not currently escape to untrusted scope.
- **Reverse:** freeze only the containers; the extended freeze assertion fails.

### Known limit, owed elsewhere: the Vault prototype assertion is narrow

`I1.vault-implementation-exposes-only-named-operations` enumerates
`Object.getOwnPropertyNames(LocalVault.prototype)`, so it would not see methods
reached through a superclass, exposed as symbols, or assigned to the instance in
the constructor. The observation is correct and identifies no present defect:
`LocalVault` has no superclass, no symbol-keyed members and no instance
properties, so the narrow check and a broad one return the same answer today.
The gap would open if inheritance were ever added.

Not fixed here. It is P1's assertion, untouched by this unit, and in the review
bundle only because `registry/i1.ts` was edited beside it. A review does not
widen a unit. Recorded rather than made a pending registry entry because it
names no unasserted capability — the invariant is asserted; the assertion could
be broader — and because inventing an owner for work no decomposition unit
carries would put a name on the ratchet that nothing redeems.

### Known limit: `sandbox.remote` verifies the declaration, not the fact

The assertion compares `capabilities().remote` against the endpoint
`probeDaemon` read from `docker context inspect`. It is not tautological — it
fails when the declaration is flipped, which was confirmed by mutation — but
`probeDaemon` has already refused a non-local endpoint by the time it runs, so
the comparison can only catch a mis-declaration, never a provider that
misidentifies a remote daemon as local.

The reviewer's suggested remedy, observing locality from inside the container,
does not work: the container runs with `--network none` and has no interface but
loopback, and nothing visible from inside establishes where its daemon lives.
The only honest local/remote discriminator available is comparing the
container's view of a known host path against the host's own — a new mechanism
rather than a tightening, and out of scope for this unit.

### Unreviewed, and named so the next review can cover it

The reviewer left prompt items 3 (fail-open conditions) and 4 (language-level
escape hatches) empty. Item 3 was covered in substance anyway — finding 3 is a
fail-open. Item 4 was not touched, and it is what this unit most needed a second
opinion on: D-P2-06 deliberately widened an input type to `mode: string` so the
run-time guards would not be compiled away, and the tests reach those guards
through `as unknown as` casts. Nothing in this review examined that choice.

## P3: Policy engine

### D-P3-01: the engine takes an already-parsed value; the loader and its hardening are owed to P9

- **Ambiguous:** P3's scope line read "parse and evaluate `policy.yaml`", which is two jobs. Resolution — sparse `PolicyDocument` to total `Policy`, cap arithmetic, default-deny lookup — needs no file and no parser. Reading bytes off a disk does, and no package in the repo has a third-party runtime dependency yet.
- **Chosen:** the engine's input is an already-parsed value, typed `unknown` and narrowed by this unit's own validator. Schema validation, unknown-key refusal, and every domain check stay here, because that is the substance; only the YAML text-to-object step and the file read are deferred. `DECOMPOSITION.md` now says object-only in the scope line itself, so the next session does not have to rediscover it.
- **Why not add `yaml` to `core`:** the cost is placement, not the dependency. `core` is what every package imports, and it would inherit a parser to serve a loader only the CLI path needs. When the loader lands it belongs beside the thing that reads files.
- **Why not JSON instead:** `policy.yaml` is named in F1's frozen artifact table. Revising frozen vocabulary to avoid a dependency decision is the wrong reason to touch it.
- **Owner, checked rather than assumed:** P4 is handed a resolved `Policy` and reads no file; `packages/api` is the run-creation path, and `packages/api/src/safety.ts` already declares the absent policy engine as an unsafe component. The first unit that must read a policy artifact from disk is **P9**. If a unit before P9 turns out to need a Vault-resident policy at run time, it inherits the entry by editing the owner — the arrangement D-F3-14's successor set for `I8.external-assertion-execution-reconciled`.
- **The obligation is written down now, not left as "load policy.yaml":** `I5.policy-document-load-is-hardened` names what the loader owes — an exact version pin with no caret, `maxAliasCount` 0 so an alias bomb cannot expand, a byte cap on the document, a nesting-depth limit, and each of those four asserted as a *refusal* rather than as a configured option. A parser is the first code to touch untrusted-shaped bytes on the way into the Vault, and hardening that ships unasserted is the silent degrade I5 refuses.
- **Reverse:** add the parser to this unit; `core` gains a runtime dependency and every package inherits it.

### D-P3-02: this unit's result types live beside the implementation, not in the contract file

- **Problem:** validation needs a result type, and `PolicyRefusal.reason` is `'exceeds-cap' | 'station-forbidden' | 'capability-missing'` — none of which describes a malformed document. Widening that union means editing `packages/core/src/policy/types.ts`, an F2 contract file, which is an amendment rather than unit work.
- **Chosen:** the new types go in `packages/core/src/policy/validation.ts`, exported through the package index. The contract file is untouched. `PolicyRefusal` keeps its three reasons and stays what `resolveAutonomy` and `resolveCapabilities` return; a document defect is a different shape because it is a different failure.
- **Reverse:** move them into the contract file as an amendment, with the reason union widened deliberately.

### D-P3-03: the runtime string lists are derived from total records, so the union cannot drift from them

- **Problem:** validating a station or an autonomy level needs those unions as runtime values, and `core`'s contract types are type-only. A hand-written array beside a union silently rots the moment the union gains a member — and a validator that does not know about a new station accepts it nowhere, which fails closed, or rejects it everywhere, which fails a legitimate policy.
- **Chosen:** each list is `Object.keys` of a `Readonly<Record<T, true>>` literal. The total record makes an omitted member a compile error and an invented one a compile error too, so the runtime list cannot disagree with the type. Membership is tested with `Object.hasOwn`, never `in`, so a prototype key such as `toString` is not a valid station.
- **Reverse:** replace with plain arrays; the drift guard is gone and nothing notices a new station.

### D-P3-04: `validateToolGrants` takes a mandatory inventory, and the owed gap is split in two

- **Problem:** the known gap at F2 (`CapabilityScope.tools` has no relation to `DriverCapabilities`) was recorded with owner P3. It cannot be closed here as written: `DriverCapabilities` holds feature flags and no tool list, so there is nothing to validate against, and inventing `declaredTools()` with only `StubDriver` to satisfy it would guess at a shape P5 discovers for real and then need amending twice — the `CheckSpec.command` reasoning from S1, where a merely incomplete contract waits for the unit that knows what completes it.
- **Chosen:** split the gap. P3 ships the engine-side half, `validateToolGrants(policy, inventory)`, which refuses any `tools` entry the inventory does not cover. P5 owes the driver-side inventory as `I4.driver-tool-inventory-validated`. Two entries with distinct reasons, so the ratchet records that P3 paid something and P5's obligation is specific rather than inherited. One entry handed down a third time is the pattern that made `I8.external-assertion-execution-reconciled` worth flagging.
- **The inventory is mandatory, and that is the point.** No default, no optional parameter, no "empty means allow all". A validator that can be called without a real inventory and still pass validates nothing, and every caller between now and P5 would take that path. An empty inventory against a non-empty grant list is a refusal. Both halves are asserted: `I4.tool-grant-requires-an-inventory` is a compile-error fixture that the one-argument call and an explicit `undefined` both fail, and `I4.empty-inventory-refuses-every-grant` is the runtime refusal.
- **Reverse:** give `inventory` a default of the granted tools; the compile fixture stops diagnosing and the runtime assertion passes vacuously.

### D-P3-05: the shipped default grants nothing

- **Ambiguous:** P3 ships a default carrying `globalCap: 2`, but no role exists anywhere in the repo — `RoleId` is a brand with no registry, and P5 says it emits from hardcoded roles "for now".
- **Chosen:** the default carries `globalCap: 2`, `triggers.enabled: ['human']`, its protected paths, and `roles: {}`. An empty role map means every `resolveCapabilities` call refuses, which is what default deny means (I4): a shipped policy that grants a role something before any role is defined would be a grant nobody authored. P4 and P5 add roles when they have them.
- **Rejected — a plausible builder role:** it would be the first capability grant in the system, written by the unit least able to say what a builder needs.
- **Reverse:** add roles to the default; every one is a grant that must be justified in the diff.

### D-P3-06: an omitted station cap is no cap, not L0

- **Ambiguous:** F1 gives the effective level as `min(requested, stationCap, globalCap)`, and `stationCaps` is `Partial`. Nothing says what an omitted station means. Under I4 the default-deny reading is L0, which would deny every station a document does not enumerate.
- **Chosen:** an omitted station cap adds no restriction; the bound is the tightest of the global cap, the station cap where the document sets one, and the role's own `autonomyCeiling`. R-F2-08 made `approvals` total precisely because a missing approval would leave something downstream to decide, and it deliberately left `stationCaps` sparse **in the resolved `Policy` too** — the contract saying a station cap is a tightening control rather than a grant. Omitting one cannot widen anything: the global cap and the role ceiling still bound the request, the role must be defined at all and must list the station, and every approval still reads `human-required` until a document says otherwise. So no capability is granted by omission, which is what I4 asks.
- **Rejected — omitted means L0:** it makes `globalCap` dead in the shipped default, and forces every author to enumerate all ten stations to get any autonomy at all. That is the ergonomics problem R-F2-08 rejected for approvals, reintroduced one field over; and unlike approvals, the omission here cannot grant.
- **Asserted:** `resolveAutonomy` at the global cap with an empty `stationCaps` is granted, one above it is refused, and a station cap tighter than the global cap bites at that station only.
- **Reverse:** treat a missing entry as 0 and make `Policy.stationCaps` total in the same edit, since a resolved policy would then have a defaulting rule an auditor could not read off the table.

### D-P3-07: a defect report names a role as a plain string

- **Problem:** `UngrantedTool` needs to say which role holds an unoffered tool. `Record<RoleId, CapabilityScope>` is not indexable by a plain string and `Object.keys` over it yields `string[]`, so recovering a `RoleId` from the policy's own keys would take a cast to a branded type — and the brands are load-bearing (CLAUDE.md), so casting into one to build a message is the wrong trade.
- **Chosen:** `UngrantedTool.role` is `string`. The value is read out of the policy for a message; a defect report is not a capability, and nothing downstream uses it to look anything up.
- **Reverse:** brand it and add the cast, with a comment naming what guarantees it.

## P3 amendment: external adversarial review

An external reviewer (Grok, temporary chat, bundle only — the first xAI review,
so family rotation was met) returned five findings plus three inventory
sections. Three hold as descriptions of the code and were reproduced by
execution; two are observations that name no defect. Two were fixed on the unit
branch, one is recorded as a boundary with a new pending registry entry. The
full triage, with the verification evidence for each, is
`docs/reviews/2026-09-13-P3-policy-engine-adversarial-triage.md`.

The review's most valuable content was not a finding. Item 7 asked which later
callers may treat this engine's answer as sufficient — see D-P3-10.

### D-P3-08: an egress entry names one host

- **Problem:** `validateEgress` refused the bare string `'all'` or `'*'`, then
  accepted any non-empty string *inside* the array. `{ egress: ['*'] }`
  validated, resolved, and came back out of `resolveCapabilities` as the grant.
  So did `'*.example.com'`, `'0.0.0.0/0'`, and `'https://example.com'`. The
  authored form reads as an explicit allowlist while denoting every host.
- **Consequence, separated from the defect:** not a live bypass today, and the
  reviewer was right to ask for that to be confirmed before treating it as
  high. `CapabilityScope.network.egress` and `SandboxSpec.egress` are different
  types, no code maps one to the other, and `LocalDockerProvider` refuses
  `allowlist` by name (D-P2-07). A wildcard host list therefore cannot reach an
  enforcement point. It is a schema gap and a trap laid for whichever unit can
  enforce an allowlist.
- **Chosen:** refuse an entry containing a glob wildcard, a path or
  prefix-length separator, a backslash, or whitespace. The rule is narrow and
  statable — *an entry denotes a single host* — and it is enforced where the
  document is read rather than where it is applied.
- **Rejected — a hostname grammar:** label lengths, permitted characters, IDN,
  and whether a port or a CIDR range is admissible are decisions for the unit
  that can actually enforce an allowlist, and inventing them here would refuse
  legitimate values on a guess.
- **Honest limit:** the rule catches entries that denote *every* host and
  entries that are not hosts. It does not catch a narrower range written
  without a slash, and it is not a validation that a host exists or is
  reachable. `10.0.0.0/8` is refused because of the slash, not because the
  range was understood.
- **Asserted:** `I4.egress-entry-names-one-host`, live, with a literal-host
  control so the assertion cannot pass by refusing every list. Mutation-checked:
  accepting any non-empty entry fails it.
- **Reverse:** drop the `isHostLiteral` filter; the assertion and three unit
  tests fail.

### D-P3-09: resolvePolicy validates its own input, because the parameter type is a claim

- **Problem:** `resolvePolicy(doc: PolicyDocument)` trusted the type. A caller
  writing `junk as PolicyDocument` reached it with `globalCap: 99`, a role
  ceiling of 99, or a station id that is not one of the ten, and every one flowed
  through resolution into a grant. Reproduced: `globalCap: 99` resolved, and
  `resolveAutonomy(3, 'build', …)` then returned `{ ok: true, level: 3 }`. The
  narrowing was optional at the only runtime entry that matters.
- **Chosen:** `resolvePolicy` runs `validatePolicyDocument` on its argument and
  throws, naming the defects, when it does not validate. I5 says fail closed,
  and a control that holds only while every caller remembers to compose two
  functions in the right order is not closed. It runs once at load, so the cost
  of re-validating an already-validated document is one pass.
- **Why a throw:** `PolicyEngine.resolvePolicy(doc): Policy` returns a `Policy`,
  not a result union, and widening it is an edit to an F2 contract file — an
  amendment, and on this unit's out-of-scope list. A throw is the fail-closed
  option available without one.
- **The stronger fix, not taken here:** brand the validated document so
  `resolvePolicy` accepts only a value `validatePolicyDocument` produced, the
  way `UntrustedPayload` works. That makes the composition unskippable at
  compile time rather than caught at run time. It changes the contract
  signature, so it is an amendment and belongs between units, not inside one.
  Recorded here so it is not lost.
- **Asserted:** `I5.malformed-document-refused-at-resolve`, live, four rogue
  documents plus a genuine one as the control. Mutation-checked: reverting the
  guard fails it.
- **Reverse:** remove the validation call; the assertion and six unit tests
  fail.

### D-P3-10: no later caller may treat this engine's answer as sufficient

- **The reviewer's question,** and the most useful thing in the review: "which
  later readers are allowed to treat `resolveAutonomy` / `resolveCapabilities`
  as sufficient, and which must still consult approvals, trigger caps, and the
  tool inventory? If any caller only asks the engine, findings 2 and 3 become
  the production bypass."
- **The answer: none.** `resolveAutonomy` answers cap arithmetic over three
  bounds and nothing else. It does not read `approvals` and does not read
  `triggers.maxAutonomy`, so a policy carrying `approvals['build:2'] = 'blocked'`
  and `triggers.maxAutonomy.human = 0` still returns `{ ok: true, level: 2 }`.
  Reproduced. This is by design — approval evaluation is P4 and trigger
  admission is M2, both on this unit's out-of-scope list — but "by design" is
  not a control.
- **Chosen:** three things rather than a comment. The boundary is pinned by
  tests, so a later change that makes the engine consult either table fails them
  and is therefore deliberate. The obligation on the consuming unit is a pending
  registry entry, `I4.approval-outcome-gates-the-station`, owned by P4, which
  raises the I4 baseline from 1 to 2 — a deliberate edit, visible in the diff,
  and the instrument that counts where prose does not. And this entry records
  the answer so P4 does not have to re-derive it.
- **Not fixed here:** making `resolveAutonomy` consult the approvals table would
  absorb P4's work into P3 on a reviewer's suggestion. The out-of-scope list is
  binding, and a review does not widen a unit.
- **Reverse:** have `resolveAutonomy` read `approvals` and `triggers.maxAutonomy`;
  the three boundary tests fail and the pending entry should then be paid here
  rather than by P4.

### Findings that named no defect

- **The `as Record<ApprovalKey, ApprovalOutcome>` in `totalApprovals`** (finding
  4). The reviewer confirmed the runtime count check makes the assertion honest
  and that a drift between the two lists throws at resolve time — fail loud, not
  fail open — and suggested optionally building the record without the
  assertion. Not taken: TypeScript cannot prove a loop assigned every key of a
  union, `Object.fromEntries` returns an index-signature type that is not
  assignable to the total record, and a forty-entry literal would defeat the
  derivation the record exists for. The assertion plus the throw is the honest
  arrangement. No change.
- **Shallow freeze** (finding 5). The reviewer traced `cloneScope` and concluded
  it freezes the arrays and the nested `network` and `budget` objects, and that
  what freeze does not stop — a caller replacing the `Policy` reference it holds
  — is not a widen of the engine's copy. Agreed, and not preventable by any
  means available to a function that returns a value. No change.

## P3 amendment: second external review

A second external reviewer, run against the **same bundle** as the first so the
two are comparable, returned five findings. Two reproduce the first review's
(and had already been fixed by the time it arrived); **two are findings the
first review did not make at all** and were fixed here; one is an ambiguity now
owned by M2. The full triage is
`docs/reviews/2026-09-13-P3-policy-engine-second-adversarial-triage.md`.

The case for running a second review of one unit is settled by the result: the
prototype-chain grant (D-P3-11) and the malformed autonomy level (D-P3-12) were
both invisible to the first family, and the second review's framing answer
produced D-P3-14, which neither the unit nor the first review had written down.

### D-P3-11: the prototype chain is not an authority on what a policy grants

- **Problem:** `cloneRoles` built the role map with `Object.fromEntries`, an
  ordinary object, and both lookups read `policy.roles[role]`. Two consequences,
  both reproduced. With `Object.prototype.reviewer` set to a scope-shaped value
  anywhere in the process, `resolveCapabilities('reviewer', 'build', policy)`
  returned **a grant** for a role the policy does not define. And with no
  pollution at all, an ungranted role named `toString` or `constructor` resolved
  to an inherited function and then threw a `TypeError` at
  `scope.stations.includes(...)` instead of refusing with `capability-missing`.
- **Why it matters more than its reachability suggests:** the grant half needs
  prototype pollution elsewhere, which is a real but conditional precondition.
  The throw half needs only an unvalidated role id. Neither is acceptable: I4's
  default deny has to be *total*, and a lookup that consults the prototype chain
  is not total. An exception is also not the refusal the contract promises — it
  carries no reason, and a caller that catches it has nothing to record.
- **The irony worth recording:** `validateRoles` already refuses `__proto__`,
  `constructor` and `prototype` as authored role ids (`RESERVED_ROLE_IDS`). The
  validator worried about prototype names while the runtime lookup handed the
  prototype back its authority. Guarding the input and not the lookup is half a
  control.
- **Chosen:** build the role map on `Object.create(null)`, and read it only
  through `scopeFor`, which uses `Object.hasOwn`. Both, not either: the null
  prototype closes it now, and the `hasOwn` keeps it closed if a later edit
  rebuilds the map with an ordinary prototype. `ownStationCap` does the same for
  the station caps, which were reachable by the same route and were saved only
  by an ordering accident that put the station check first.
- **Asserted:** `I4.role-lookup-ignores-the-prototype-chain` — a polluted
  prototype, four prototype-named roles, the null-prototype check, and a real
  grant as the control. Mutation-checked: restoring either the plain object or
  the plain index fails it.
- **Reverse:** restore `Object.fromEntries` and `policy.roles[role]`; the
  assertion and seven unit tests fail.

### D-P3-12: an autonomy level that is not one refuses rather than being compared

- **Problem:** `resolveAutonomy` compared `requested > cap` with no runtime
  guard, and the parameter type is erased. `NaN > 3` is `false`, so
  `resolveAutonomy(NaN, …)` returned `{ ok: true, level: NaN }`. Reproduced —
  and it is broader than the review reported: `-1` and `2.5` were also answered
  with success carrying themselves as the level. Only `Infinity` was refused,
  and only because `Infinity > 3` happens to be true.
- **Why success is the worst possible answer here:** this unit's entire I5 story
  is that an over-request is refused rather than downgraded, because a caller
  that receives a level proceeds believing it was granted what it asked for. A
  caller receiving `{ ok: true, level: NaN }` does exactly that, with a level
  nothing can honour.
- **Chosen:** guard `requested` with the `isAutonomyLevel` predicate the package
  already had, and throw. `PolicyRefusal.reason` has no arm for a malformed
  argument, and widening the union is an edit to an F2 contract file — an
  amendment, on this unit's out-of-scope list. A throw is the fail-closed option
  available without one, and it matches D-P3-09's precedent: a value that lies
  about its type gets an exception, not a refusal object.
- **Not guarded, and why:** `station` needs no guard, because an invented
  station fails `scope.stations.includes(station)` and refuses with
  `station-forbidden` — a correct refusal reached by the normal path.
- **Asserted:** `I5.malformed-autonomy-level-refused`, with all four real levels
  as the control. Mutation-checked.
- **Reverse:** delete the guard; the assertion and five unit tests fail.

### D-P3-13: the trigger maps are partial by contract, and admission owes the relational check

- **Ambiguous, and the reviewer was right to flag it:** `TriggerPolicy` fields
  are validated independently. `enabled: ['ci-failure']` with empty
  `taskTemplate`, `entryStation`, `maxAutonomy` and `minAuthorTrust` is a valid
  document, and the shipped default enables `human` with an empty
  `taskTemplate` — which D-P3-05 chose deliberately, because naming a template
  no registry declares would be a fiction that reads as wiring.
- **Chosen:** the maps stay partial, and `enabled` means "this kind is not
  switched off", not "this kind is fully admissible". The relational check
  belongs at admission rather than in the validator, because admission is the
  only place that knows whether a named template exists — a validator enforcing
  relational completeness against a template registry that does not exist would
  be checking a name against nothing.
- **But the hole is real,** and I7 holds only while a trigger selects a
  pre-declared template. An enabled kind with no declared template is precisely
  the gap a permissive admission implementation would fill from the payload. So
  it is registered rather than described: `I7.enabled-trigger-declares-a-template`,
  owner M2, raising the I7 baseline from 2 to 3.
- **Reverse:** make the validator require an entry in each per-kind map for
  every enabled kind; the shipped default must then name a template, and
  D-P3-05 is reversed with it.

### D-P3-14: the threat model this unit's argument depends on

- **The reviewer's framing answer,** and the most valuable thing in either
  review: the adversarial question is right "if the adversary controls
  policy/request data but not arbitrary code in the process… if `as any`,
  forged `Policy` objects, or arbitrary prototype mutation are considered
  attacker capabilities, TypeScript types cannot be part of the security
  argument".
- **Stated, because it was written down nowhere:** the adversary this unit
  defends against controls **the policy document and the arguments to the
  engine's methods**. It does not control code running inside the runtime's own
  process. An adversary who does control in-process code does not need a policy
  bypass, because the runtime is the thing enforcing the policy. But the
  corollary is what matters: **no type in this package is part of the security
  argument.** Types stop mistakes; runtime checks stop bypasses.
- **What follows, and what was done about it.** Every exported method that
  answers an authorization question now carries a runtime check that does not
  depend on its parameter types: `resolvePolicy` validates its document
  (D-P3-09), `resolveAutonomy` guards its level (D-P3-12), role lookup is
  own-property only (D-P3-11), and `validateToolGrants` requires an inventory
  whose absence refuses rather than admits.
- **A correction to D-P3-09.** That entry called branding the validated document
  "the stronger fix". The reviewer is right that it is not: "a TypeScript brand
  alone is not a security boundary because it can also be asserted away." A
  brand raises the cost of the mistake and documents the intent; it is not a
  control. The runtime validation is the control, and a brand would be an
  ergonomic improvement on top of it. Recorded here rather than quietly edited
  into D-P3-09, because overstating what a type buys is the exact error this
  decision exists to name.
- **Known limit, stated plainly:** a forged `Policy` handed directly to
  `resolveAutonomy` or `resolveCapabilities` is not revalidated. Validating a
  whole policy on every lookup moves a load-time cost onto every call, and under
  the threat model above a `Policy` comes from `resolvePolicy`, which validates.
  If the threat model ever widens to in-process adversaries this is the first
  thing that must change — and by then the types would have to leave the
  argument entirely.
- **Reverse:** narrow the threat model to trusted documents only; the runtime
  guards above become belt-and-braces rather than controls.

### The second review's other conclusions

- **Finding 1 (egress wildcards) and finding 4 (resolution separable from
  validation) had already been fixed** by the first triage, as D-P3-08 and
  D-P3-09. Two families independently finding the same two things is the
  strongest evidence either review produced, and it is the whole reason the
  rotation exists.
- **One residual from finding 1 is rejected.** The reviewer asked for `['all']`
  to be refused alongside `['*']`. It is not: `all` is a syntactically valid DNS
  label denoting one host, and refusing it would be guessing at semantics —
  `any`, `everything` and `world` would have equal claim. The bare string
  `'all'` is refused because the only valid bare string is `'none'`, not because
  `all` is special. D-P3-08's rule is *an entry denotes a single host*, and
  `all` does.
- **The reviewer's note that the mandatory-inventory conformance fixture is a
  compile-time check and not a runtime boundary is correct,** and it checked the
  runtime behaviour rather than assuming: omitting the argument in JavaScript
  makes `new Set(undefined)` empty, so a policy with tool grants is refused
  rather than admitted. Fails closed. No change.
- **On the I7 half of the prompt being premature:** accepted. There is no
  payload-to-template-to-prompt path in this unit, and the next review request
  for a policy-shaped unit should ask the narrower question the reviewer
  proposed instead of restating I7 in full.

## P4: Station machine

The unit entry carried scope, deliverables, and a conformance line, and no
out-of-scope list, acceptance criteria, invariants, or ledger — the defect P1,
P2, and P3 each had. It was fixed in `DECOMPOSITION.md` before any code was
written. Reading the contracts against the deliverables also showed that the
unit cannot be built without amending them, which is a stop condition; the
maintainer settled that and three scope questions before work began.

### D-P4-01: the entry gained its five parts, and four questions were the maintainer's

- **Problem:** besides the missing parts, four things were not decisions a
  session should make alone. (1) `StationRefusal` has no arm for an approval or
  a same-family reviewer, `GateResult` cannot record reduced independence, and
  `RunState` holds nothing a resume can trust for the level, the policy, or the
  retry count, and no Vault operation stores a `Run`: contract changes, which
  are amendments. (2) Which of two resume designs. (3) D-S1-07 left P4 to decide
  whether compositional provenance becomes a registry entry. (4) What
  "write-boundary enforcement" can honestly mean before the runtime collects a
  diff.
- **Chosen, by the maintainer:** (1) the amendments land in this unit's pull
  request as their own commits, one `A-P4-nn` entry each, under the
  `gate-change` label, as A-S1-01 did; the external review then covers them
  with the code that needed them. (2) A write-once admission record in the Vault
  holding the `Run` and the resolved `Policy`, referenced from `RunState`, with
  per-task attempt counts in run state: a resume can neither raise its own level
  nor reset its retry bound. The rejected design had the caller restate both on
  resume. (3) A pending entry, `I5.unsafe-declaration-survives-composition`,
  owned by P6, the unit that deletes `SKELETON_LINE`'s last lines; I5's baseline
  rises from 4 to 5. P4 narrows the line and does not delete it, so the risk the
  entry names is not live until P6. (4) P4 re-verifies locks at every transition
  and hard-fails the run on a mismatch; checking a role's `writableGlobs`
  against the runtime-collected diff is owed to P6 as
  `I4.writable-globs-enforced-on-the-diff`. Checking against the driver's
  `file-write` events was rejected: it is blind to any write the driver does not
  observe, so it would read stronger than it is.
- **Session calls inside the entry, recorded so they are not mistaken for the
  maintainer's:** the effective approval is the stricter of the contract's
  `exitGate.approval` and the policy cell, because a contract that says a gate
  needs a human must not be relaxed by a policy that says `auto`; a contract
  with `requiresPanel: true` is refused at M1 rather than seated with one
  reviewer; tasks run one at a time. Where the amendments landed differs in two
  places from how the question put them, both recorded where they are made:
  the seat is recorded in run state rather than `GateResult` (A-P4-02), and
  every `TaskResult` is recorded in the Vault (A-P4-03), because an author
  family or a claim held only in memory is lost by exactly the resume this unit
  delivers.
- **Reverse:** revert the entry. The amendments and both pending entries go with
  it, and the unit is underspecified again.

### A-P4-01: `StationRefusal` gains the approval and seat arms, and `parked` names its task and a closed cause

- **Surfaced by P4:** the station machine has three refusals the contract could
  not type. A `blocked` approval cell and a `human-required` cell with no
  recorded grant (`I4.approval-outcome-gates-the-station`) had no arm, and the
  nearest, `gate-failed`, carries `FailedCheck[]`, so either would have been
  reported as a check that never ran. A same-family reviewer at L3
  (`I6.review-seat-family-check`) had none either. And `parked` carried
  `cause: string` and `retries: number`, which A-S1-01 left open for P4 to close
  once the causes were known.
- **Chosen:** `approval-blocked` and `approval-required`, each carrying the
  `ApprovalKey` it read; `same-family-reviewer`, carrying the review task and
  the shared `ModelFamily`; and `parked` now carries the task, a `ParkCause`
  (`iterations-exhausted` | `retries-exhausted`), and the `limit` it reached.
  The two causes are the two bounds a contract states: `maxIterations`, spent
  by a gate that keeps failing, and `retry.max`, spent by a driver or sandbox
  that keeps failing. `retries` became `limit` because an iteration bound is
  not a retry count.
- **Not chosen:** one `approval` arm with the `ApprovalOutcome` beside it. A
  `blocked` cell ends the run and a `human-required` one waits for a grant, so a
  consumer would have to branch on a second field to learn which, and the arm
  would admit `outcome: 'auto'`, which is not a refusal at all.
- **Conformance, same commit:** `I5.transition-has-no-warn-and-continue` gains
  the three arms as valid constructions, and refuses a free-text park cause
  (TS2322), an advance that carries an approval as a note (TS2353), and an
  approval refusal with no key (TS2322).
- **Reverse:** drop the arms and restore `cause: string`; the fixture fails.

### A-P4-02: the review seat is recorded in run state, not in `GateResult`

- **Surfaced by P4:** `I6.review-seat-family-check` asks that reduced
  independence be recorded "in the gate result". `GateResult` is returned to a
  caller and stored nowhere: the evidence bundle carries the checks, and
  nothing else in the Vault holds a gate. A record of reduced independence that
  exists only in a return value is a claim of the guarantee to everyone who
  reads the run afterwards, which is what I6 forbids.
- **Chosen:** `ReviewSeat { task, authors, reviewer, independence }` in
  `core/src/station/types.ts`, and `RunState.reviews: readonly ReviewSeat[]`.
  Run state is committed through the Vault's exclusive create, and every
  version is kept, so the seat is durable and auditable, and a resume reads it
  back. `authors` is a list because a review task may cover several build
  tasks; a seat is `reduced` when the reviewer's family is any author's.
- **Where it differs from the maintainer's question:** the question offered
  "GateResult independence". The field would have been a record nobody can read
  after the call returns; run state is the record. The obligation's substance,
  that the run records reduced independence rather than claim the guarantee, is
  unchanged, and the meta-test that pins its wording tests L0-L2 and L3, not
  the word "gate".
- **Reverse:** move the seat to `GateResult` and persist gate results; the run
  state field then duplicates it.

### A-P4-03: a write-once admission record and recorded task results make run state resumable

- **Surfaced by P4:** a resume had nothing to trust. `RunState` held no
  requested level, base commit, policy, artifact list, or attempt count, and no
  Vault operation stored a `Run`, so a resumed run would take its level from
  whoever called resume, and a crash would reset the retry bound. Separately,
  the claim `verify` stores beside its evidence existed only in memory between
  `build` and `verify`; a crash, or a human approval of the build exit that
  arrives a day later, would lose it. The same is true of the author's
  `ModelIdentity`, which a review seat compares.
- **Chosen:** two named Vault operations and the run state a resume reads.
  - `recordAdmission(AdmissionRecord)`: the `Run`, the resolved `Policy`, and
    each station's artifacts with their hashes at admission. Once per run: the
    local Vault creates `runs/<id>/admission.json` exclusively, and `read` of an
    `admission` ref checks the bytes against the ref's hash, because the file is
    named by its run and not by its content. A second admission stores nothing.
  - `recordTaskResult(runId, TaskResult)`: content-addressed like evidence.
    `verify` reads the claim from here and a review seat reads the author's
    model identity from here.
  - `RunState` gains `admission`, `phase` (`working` | `exiting`), `attempts`
    (`iterations`, `retries` per task), `results` (the latest result ref per
    task), `approvals` (`ApprovalGrant`s), and `reviews` (A-P4-02).
    `VaultRefKind` gains `admission` and `task-result`.
- **Why the artifact hashes:** a station locks the artifact it was admitted
  with. A lock whose hash differs from the admission hash is refused as a
  tamper, so the window between admission and a station's lock is closed and
  the verification manifest and task graph validated at admission are the
  bytes the run later executes. P5 revisits this when a spec agent writes the
  spec after admission.
- **Not chosen:** putting the graph and the manifest inline in the admission
  record. `plan` and `test-design` would then lock nothing, and P5, where a
  model writes both, would move them back out.
- **Conformance, same commit:** `I1.vault-implementation-exposes-only-named-operations`
  now names nine operations; the contention assertion's child writes a whole
  run state, because the local Vault refuses a partial one on read.
- **At this commit `packages/api` does not compile:** the S1 line builds the old
  `RunState`. The line is what this unit re-cuts, and the commit that does so
  follows; making the old line compile against a record it is about to stop
  using would be work written to be deleted.
- **Reverse:** drop the two operations and the six fields; resume then trusts
  its caller.

### D-P4-02: the machine is pure and lives in `core`; the line in `api` performs its steps, and start and resume share one path

- **Problem:** CONTRIBUTING places the station machine in `core`, and `core` cannot import `vault` or `integrity`, both of which depend on it. A machine that locks, verifies, and commits cannot live there.
- **Chosen:** `core/src/station/` holds the contract table and pure functions: `transition`, `effectiveApproval`, `seatReviewer`, `grantedContext`, `capabilityRefusal`, `stationCapRefusal`, `parkRefusal`, and `nextStep`. `nextStep` reads only a committed `RunState` and the admitted task graph and names the next step. `packages/api/src/line.ts` performs that step and commits what happened. `startRun` admits a run and enters the loop; `resumeRun` enters the same loop from the stored state. Resume has no code path of its own to drift from, which is what makes `I2.resume-derives-state-from-the-vault` provable by stopping a run after every one of its commits.
- **Reverse:** move the loop into `core` behind a Vault-shaped port. That would be a second copy of the Vault contract inside `core`.

### D-P4-03: the effective approval is the stricter of contract and policy; `integrate` needs a human at M1; a grant is exact

- **The rule:** a station exit needs the stricter of the contract's `exitGate.approval` and `policy.approvals[station:level]`, raised to `human-required` when a protected path was touched. A contract that says a gate needs a human must not be relaxed by a policy cell that says `auto`, and a policy must be able to tighten any gate.
- **`integrate` states `human-required` as its own floor.** Every M1 run therefore ends waiting for a human at `integrate`, whatever the policy says. M1 claims no lights-off autonomy, and this makes the claim structural rather than a default. The unit that brings L3 (M3) is the one that lowers it.
- **A grant is exact and standing for the run.** `approveStation` records a grant only for the exit the run is waiting at: the current station, the admitted level, an effective approval of `human-required`, and no grant already held. A `blocked` exit cannot be approved, and a grant for another station or level is refused, because it would be a standing approval of something nobody has seen. Once recorded, a grant for `build:2` satisfies every later exit of `build` in that run, since the build and verify stations alternate while tasks are rebuilt.
- **A move back up the line is not an advance.** Leaving `verify` for `build` to rebuild a failed task re-verifies the locks and needs no approval.
- **Reverse:** make the policy the sole authority. Then `integrate`'s floor is a default a policy line removes.

### D-P4-04: the agent stations require `parallelism`; the runtime's own stations require nothing

- **Problem:** "a station missing a required driver capability fails closed" is vacuous against a table that requires nothing. Declaring a capability the stub driver lacks (`hooks`, `stablePrefixCaching`) would make every stub run refuse. Declaring one the line does not use would be a placeholder dressed as a requirement.
- **Chosen:** `build` and `review` require `parallelism`, a count that is missing below one. The line runs a task through the driver there, and a driver that declares it can run no task at a time cannot run this one. The requirement is real, the stub declares one, and a driver declaring zero is refused at admission and on resume. Every other station requires nothing, and `contractTableProblems` refuses a table where a station no driver runs at requires something. P5 adds requirements when the line starts using the capabilities behind them.
- **Reverse:** empty `requires` everywhere; the assertion then only exercises the machine function.

### D-P4-05: `StubVault.lock` adds to the manifest, as `LocalVault` does

- **Found by P4's own test:** a spec rewritten after `plan` locked the task graph verified clean. `StubVault.lock` replaced the run's manifest, and its test pinned that ("replaces an earlier manifest"). P1 fixed replace semantics in `LocalVault` (D-P1-05); the stub kept them, and the skeleton never noticed, because its line locked once. A line that locks at `spec`, `test-design`, and `plan` drops the spec from verification at the second lock.
- **Chosen:** the stub accumulates entries and refuses an already-locked path, and its test now asserts both. The stub stays unsafe-declared, so this is correctness of the L1 path rather than a new guarantee.
- **Reverse:** restore replace semantics; the line's lock tests fail on the stub.

### D-P4-06: what an attempt is, when it is counted, and what a resume re-runs

- **Iterations** count builds of a task. Each is committed as the build starts, before the driver is called, and is bounded by the build contract's `maxIterations`. A gate that fails with iterations left returns the task to `build`; one that fails on the last iteration parks it with `iterations-exhausted`.
- **Retries** count driver or sandbox failures within the current iteration, bounded by the current station's `retry.max`, with `retry.backoffMs` between attempts. A new iteration starts at zero, so a task's total attempts are bounded by `maxIterations × (retry.max + 1)`. Past the bound the task parks with `retries-exhausted`.
- **A task found `running` on resume** was in flight when the run stopped. It is run again without being counted, because its iteration was already counted before the driver was called. This is what makes a resumed run reach the same counts as an uninterrupted one. Each re-run needs an external resume, so a crash loop is not autonomous.
- **Parked is terminal at P4.** A resume refuses a parked run with `parked`, whatever driver it brings. Unparking is lifecycle, and lifecycle is P9's.
- **Reverse:** count a crash re-run as a retry. Resumed runs then diverge from uninterrupted ones on every stop between a build's start and its result.

### D-P4-07: the graph and the manifest are workspace artifacts, validated at admission and bound to it by hash

- **Chosen:** a run request names four artifacts: spec files, acceptance tests, a verification manifest (`{ checks }`), and a task graph (`{ tasks }`). All four are read and hashed at admission, and the manifest and graph are parsed from the same bytes. The admission record keeps each hash, and the station that locks an artifact refuses a lock whose hash differs (A-P4-03). A resume re-reads the manifest and graph and refuses bytes that no longer hash to admission.
- **Graph rules at M1:** tasks at `build` or `review` only; a build task depends only on build tasks; a review task depends on at least one build task and nothing else; every build task is covered by a review task, so no work reaches `integrate` unreviewed; the dependencies are acyclic, so the graph can finish. A role the graph schedules is resolved at admission against its station, so an undefined role or one without that station is refused before anything is written.
- **Scheduling:** one task at a time, in graph order. `build` builds every task whose dependencies have passed, `verify` verifies what `build` left verifying, and leaving `verify` returns to `build` while any build task has not passed.
- **What `passed` means for a review task:** the seat was assembled, its independence recorded, and the reviewer's result recorded. The runtime does not interpret a reviewer's verdict. A verdict is model output, and deriving task status from it would be the model reporting status (I2). A rubric and panel that turn review into checks are M3's. Until then the human at the `integrate` floor reads the recorded review.
- **Reverse:** pass the graph and checks inline in the request, as S1 did. `plan` and `test-design` then lock nothing, and a resume trusts its caller for both.

### D-P4-08: a violation with no task in flight names the last task that ran, or no role

- **Problem:** `IntegrityViolation.role` is required. A tamper found at an exit, or before any task has run, has no task in flight to attribute it to.
- **Chosen:** the role of the task in flight; else the role of the last task with a recorded result; else `unattributed`. At M1 no agent runs before `build`, so a mismatch there cannot be an agent's. The record says so rather than naming a role that did not act.
- **Reverse:** make `role` nullable, which is a contract change.

### D-P4-09: SKELETON_LINE is narrowed, not deleted; the I6 L3 half is asserted on the machine

- **Chosen:** `SKELETON_LINE` loses the policy-engine and missing-station lines this unit pays, and keeps the two P6 and P7 owe: tamper analysis (so `integrate` never escalates for a protected path) and the claim/evidence diff. Every run above L1 is therefore still refused. A reviewer at L3 cannot be seated through `startRun` until P6, so the L3 half of `I6.review-seat-family-check` runs against `seatReviewer`, and the L0-L2 half runs end to end. The assertion's title says which half is which.
- **Reverse:** delete `SKELETON_LINE` now. That would lift the L1 cap over a line that still fakes tamper analysis, and `I5.unsafe-declaration-survives-composition` is unpaid.

### D-P4-10: every new assertion was shown to fail with its control removed

- **Demonstrated, not assumed (I8):** each control was deleted in turn, the assertion that owns it was run, and the file was restored. All eleven deletions were caught: the exit lock re-verification (`I3.transition-reverifies-locks`); the admission-hash comparison at a lock (`I3.station-locks-the-admitted-artifact`); the human-required check, and separately the contract floor, in `transition` (`I4.approval-outcome-gates-the-station`); the admission capability check (`I5.station-missing-capability-refused`); the retry bound (`I5.task-attempts-are-bounded`); the admission policy check (`I5.over-request-refused-at-admission`); the no-recount of an in-flight task (`I2.resume-derives-state-from-the-vault`); the L3 refusal in `seatReviewer`, and separately the recording of the seat in run state (`I6.review-seat-family-check`); and context filtering at the review seat (`I6.reviewer-receives-no-author-material`).

### A-P4-04: an approval crosses one exit, and a spent grant stays on the record

- **Surfaced by P4's external review, finding 3.** A grant was identified by
  `station:level` alone, and `transition` accepted any grant with that key. A
  failed verify sends a task back to `build`, which is a rebuild and needs no
  approval; the second exit from `build` is a fresh human-required gate, and it
  found the first visit's grant still sitting in run state. A human who approved
  one build had, without being asked, approved every later build of the same
  task at the same level. `approveStation` made it worse by refusing to record a
  second grant for a key it already held, so the human could not have approved
  the second visit even on purpose. Reproduced before the fix: two builds, one
  grant, no second approval sought.
- **Chosen:** `ApprovalGrant` gains `usedAt: string | null`. `transition`
  requires an *unspent* grant, and a successful human-required advance returns
  the key it spends, which the line marks used in the same commit as the station
  move — so a stop between the two leaves the grant unspent and the gate is
  evaluated again. `approveStation` records a new grant when no unspent one
  exists. A spent grant is never removed: it is the record that a human
  approved, and deleting it would destroy the audit trail to fix the gate.
  `I4.approval-outcome-gates-the-station` gained the rebuild case and was shown
  to fail when the `usedAt` check is deleted.
- **Reverse:** bind the grant to a gate instance — station, level, and a hash of
  the work being approved. Stronger, and it needs an exit nonce in run state
  that nothing else wants yet. `usedAt` says the same thing for the one way a
  station is re-entered at M1.

### A-P4-05: judged bytes are hashed as they are read, the review seat cannot write, and a tamper names who acted

- **Surfaced by P4's external review, findings 5, 6, and 10.** Three separate
  defects in what the line hands a station, each reproduced before the fix:
  - **The bytes verified were not the bytes read.** `build` called `verifyLocks`
    and then read the spec and acceptance tests from their paths. A swap in
    between reached the model while every lock comparison still saw the admitted
    hash. Demonstrated: the model received a spec the run never admitted, and no
    violation was recorded.
  - **The review seat was mounted read-write** over the author's whole working
    copy, although the `review` contract grants no workspace glob at all.
  - **A tamper found before a task ran was attributed to that task's role**, and
    the provenance recorded was always the build driver's, even at `review`.
    A mismatch found before the reviewer ran named the reviewer.
- **Chosen:** `readText` hashes the bytes it read and compares them to the
  admission hash, so what is hashed is exactly what is handed over; a mismatch
  is a `lock-tamper` violation at phase `context`, recorded before the iteration
  is spent. `runTask` takes the mount mode from the station contract's
  `writeBoundary`: a station granted no glob gets a tree it cannot write.
  `recordTamper` takes the suspect separately from the task it fails — a
  before-the-task mismatch passes null and falls back to the last task that
  actually ran, or `unattributed` (D-P4-08) — and records the provenance of the
  driver at the station where the mismatch was found.
- **Reverse:** snapshot every locked artifact into content-addressed storage at
  admission and serve those bytes to models and checks. That closes the check
  execution window too, and it needs Vault and sandbox operations that do not
  exist. The read-and-hash closes the window this unit opened.

### A-P4-06: an attempt counts the work, a start counts the invocation

- **Surfaced by P4's external review, finding 4**, and left open in the triage
  because closing it needed a contract change rather than a review fix. The
  triage recommended counting every invocation as an iteration; that is not what
  landed, and the reason is worth keeping.
- **What was wrong:** `startAttempt` returned early for a task already
  `running`, so a run killed between the commit that marks a task running and
  the commit that records its result invoked the driver again for free.
  Reproduced: three kills in that window, three driver calls, one recorded
  iteration, and a budget of three untouched. Neither existing assertion could
  see it — `I5.task-attempts-are-bounded` tested uninterrupted failures and the
  resume of an already-parked run, and the resume assertion placed its kills
  only after commits.
- **Why it is worth fixing, which is not what the finding said.** Framed as an
  attack it is weak: timing kills into that window repeatedly needs host-level
  control, and anything with host-level control has better levers. Framed as
  spend it is strong: an OOM on a large context, or a restart loop during a
  deploy, lands in that window by itself, with no attacker, and bills for every
  replay while recording none of them.
- **Chosen:** `TaskAttempts` gains `starts`, incremented before *every* driver
  invocation including a replay, and bounded by `maxStarts(contract)` —
  `maxIterations * (retry.max + 1)`, the most an uninterrupted run of that
  station could invoke a driver. Past it the task parks with a new `ParkCause`
  arm, `starts-exhausted`. `iterations` and `retries` keep their meaning
  exactly: they measure work, and a replay costs neither.
- **Why two counters rather than one.** Counting a replay as an iteration is a
  line of code, and it makes a crash cost a unit of *work*: `build.maxIterations`
  is 3, so three unlucky restarts would park a task that was going to pass,
  turning a transient infrastructure failure into a parked run needing an
  operator. Separating them keeps the crash budget loose and the work budget
  tight. It is also the more honest record: an auditor reading run state can see
  that a task took three iterations and five invocations, and the gap is the
  fact — not something to collapse into one number.
- **What the accept criterion now says.** It named "attempt counts" and meant
  all of them, which made "identical after a resume" and "bounded invocations"
  contradictory — one says a kill costs nothing, the other says it must cost
  something. It now names which counts must match (iterations and retries) and
  what must hold of the other (`starts` never below the work required). The
  purpose it was written for — a resume cannot reset a bound — is unchanged and
  strictly better served. `comparable()` splits the same way, and the assertion
  was shown to fail with the replay count removed.
- **Reverse:** count a replay as an iteration, and drop `starts`. Simpler by one
  field, and it prices a power cut at a third of a task's budget.

### D-P4-11: the external review's ten findings, and what each one earned

- **Six held and were reproduced as tests** before anything was changed:
  findings 3, 4, 5, 6, 7, and 10. Two more held as accurate statements about
  code that this unit deliberately does not own (2, 9), one holds as a latent
  gap owned elsewhere (8), and one is about the review prompt rather than the
  code (1). **None was rejected as not holding.**
- **Fixed here:** 3 (A-P4-04), and 5, 6, and 10 (A-P4-05).
- **Recorded, not fixed:** 2 is `approveStation` taking `approvedBy` on trust,
  which the unit assigns to P9 and the signature says so. 9 is a required check
  bound to nothing, which P6 owns. 7 was already written down in this file
  before the review, under Known limits. 8 was too, under the same heading. The
  half of 5 that P4 cannot close — the plan is a file in the tree the reviewer
  is mounted — is now `I6.review-seat-reads-only-its-grants`, owned by P6, and
  the pending baseline for I6 rises from 0 to 1 to carry it.
- **Open at triage, since resolved:** finding 4. It needed a contract amendment
  rather than a review fix, so it was left for the maintainer, who took it.
  Landed as A-P4-06 above, after P4 merged.
- **Finding 1 is about the prompt**, and it is the most useful thing in the
  reply. The threat model said the motivated party controls the arguments to the
  exported entry points, and `ComponentGraph` and `Vault` *are* arguments, so it
  granted that party the ability to substitute the Vault the gates are checked
  against. That contradicts the same paragraph's claim that the party does not
  control code running inside the runtime. The review-request prompt now states
  that the components are runtime-selected and trusted, and names what the party
  does control: model output, workspace bytes, request data, and stop timing.

### Known limits, stated now

- **A crash between a Vault write and the run state that records it.** Between a station's `lock` and its commit, a resume re-locks and the Vault refuses the already-locked path. Between `recordAdmission` and the first run state, no resume can find the run. Both fail closed, loudly, and neither is silent; both need an operator. The first would be closed by a Vault read of the lock manifest, the second by a lookup of an admission without state. Neither exists, and neither is added here.
- **Review verdicts are recorded, not interpreted** (D-P4-07).
- **Protected-path escalation has no input** until tamper analysis exists (P7). The machine consumes `protectedPathsTouched`, and the line passes an empty list; `SKELETON_LINE` says so.
- **Tasks do not run in parallel**, and `concurrency.maxParallelTasks` and `maxConflictRetries` are not consulted. No invariant rests on parallelism.
- **A `Policy` handed straight to a machine function is not revalidated** (D-P3-14's threat model). `startRun` validates the request's policy and re-resolves it, and `resumeRun` validates the admitted policy, so every policy that reaches the line has passed validation.
- **A driver that reports another model than it runs** is held to the identity its result reports. The seat is checked against `resolveModel` before the reviewer runs and against `TaskResult.model` after. Whether a driver's identity is true is P5's claim to prove.

## R1 planning: readiness specified, not started

Calls made while writing `docs/plan/R1-readiness.md` and registering the three
"Beyond M1" units. No package changed and no unit ran; these are the decisions
a session would otherwise have made silently on the way in.

### D-R1-01: Readiness outputs an `AutonomyLevel`, not a second scale

- **Ambiguous:** the maturity model this unit draws its pillars from numbers its levels L1–L5, and this repository's autonomy levels are `L0`–`L3`. Both are ordered, both are called levels, the numerals overlap, and `L3` is the top of one scale and the middle of the other.
- **Chosen:** readiness derives an `AutonomyLevel` — the existing type, the existing four values. The eight pillars survive only as a grouping for probes in reports, carrying no weight and no scale of their own.
- **Why:** two ordered scales sharing a word and a numeral range is a defect that lands in config keys, CLI output, and every conversation afterwards. Reusing the existing type also makes the output directly consumable by the policy engine instead of needing a mapping nobody would agree on.
- **Reverse:** define a separate readiness scale and a mapping into `AutonomyLevel`. Anything that does must not call its values levels.

### D-R1-02: The ceiling is subtractive, and an absent scan is not a pass

- **Ambiguous:** a readiness result could plausibly inform autonomy in either direction — a well-scoring repository "earning" a higher cap is the obvious reading of a maturity model.
- **Chosen:** a scan lowers an effective cap or does nothing. It cannot raise one, grant a capability policy withheld, or make an ungranted tool available. A repository with no scan keeps the ceiling policy already gave it, and the type does not permit an optional ceiling an absent value could satisfy.
- **Why:** a score that raises a cap is a grant, and I4 says a grant is an explicit versioned edit to a Vault file, not a derived number. The absent-scan half is I5: the failure mode is a scan that fails to run and reads as clearance.
- **Reverse:** nothing to reverse without also reversing I4. If readiness is ever to grant, it becomes a policy authoring input a human reviews, never a runtime term.

### D-R1-03: Package placement left to the maintainer, with a recommendation

- **Ambiguous:** F1 freezes the package list and `readiness` is not on it, so the unit either amends that list or lives in a package already named.
- **Chosen:** recorded both options in §1 with a recommendation (a new `readiness` package) and did not take either. The spec assumes the recommendation and marks where the alternative differs.
- **Why:** F1's package list is frozen vocabulary, and a planning document is the wrong place to quietly extend it. The recommendation is the one that keeps the dependency direction honest — readiness consumes `adapters`, so folding it into `adapters` inverts that.
- **Reverse:** pick the other option; §1 names what changes. **Taken by D-R1-07 below: the new package.**

### D-R1-04: The F1 effective-level formula was not amended

- **Ambiguous:** a readiness ceiling has to reach `resolveAutonomy` somehow, and the natural form is a fourth term in `min(run.requested, policy.stationCap, policy.globalCap)` — which is frozen vocabulary that F1 says must be revised deliberately, first.
- **Chosen:** state the amendment in `R1-readiness.md` §4 with both ways to take it and a recommendation, and leave the spine's formula untouched. F1's M1 boundary gained the pointer, not the edit.
- **Why:** working rule 5 — an ambiguous spec gets two options and a recommendation, never a silent resolution. This one changes a line every later unit reads.
- **Reverse:** take the amendment, or take the alternative in §4 and have the caller lower `globalCap` before resolution. **Taken by D-R1-08 below: the amendment.**

### D-R1-05: The portfolio metric stays out of this repository

- **Ambiguous:** the headline metric of the model these pillars come from is an organisational one — the share of repositories at or above a level — and it is the number a buyer asks for first.
- **Chosen:** out of scope, named explicitly in §5. This package scans one repository and returns one result.
- **Why:** it aggregates across repositories, which is the hosted control plane, a separate product in a separate repository under D24. A rollup here would pull cross-repository state into the MIT runtime and blur a boundary that was drawn deliberately.
- **Reverse:** the control plane consumes per-repository results; nothing here needs to change for it to.

### D-R1-06: Remediation is not R1's, and must not be whoever owns the probes

- **Ambiguous:** scaffolding a repository up to a ceiling is the obvious next step after measuring it, and the two are usually sold together.
- **Chosen:** out of scope, and recorded with the reason rather than as a bare exclusion: if it is ever built, it is not built by whoever owns the probes.
- **Why:** I3. A component that satisfies a probe it also authored is judging itself, and the fact that remediation and measurement are natural neighbours is exactly what makes the violation easy to miss.
- **Reverse:** none available that keeps I3. A remediation unit needs a different owner and its probes hashed before it runs.

## R1 amendment: the two open decisions, taken

The maintainer took both recommendations. This is an amendment in the sense
`WORKFLOW.md` gives the word — a change to the spine, landed on its own,
before the unit that needs it starts. No unit ran and no package changed.

### D-R1-07: `readiness` is a package, and F1's frozen package list says so

- **Ambiguous:** D-R1-03 left placement open between a new `readiness` package and an extension of `packages/adapters`.
- **Chosen:** the new package. `readiness` is appended to F1's frozen package list in the same edit as D-R1-08, and `R1-readiness.md` §1 now states it rather than offering it.
- **Why:** readiness consumes `AdapterSet`, so housing it in `adapters` inverts the dependency, and it would give a package whose job is to *describe a stack* a second job *judging a repository* — plus a `sandbox` dependency it does not otherwise need. The vocabulary amendment is the smaller cost, and the list already spans milestones (`compiler` and `learning` are both beyond M1).
- **Reverse:** remove the entry from F1, move the implementation into `adapters`, and give that package the `sandbox` dependency. Nothing else refers to the package name yet.
- **Also edited:** `CLAUDE.md` carries a condensed copy of the frozen package list, and it is the file every session reads first. Amending F1 without it would have left the two disagreeing, with the more-read copy the stale one. `CLAUDE.md` is a protected path, so the pull request carrying this amendment takes the `gate-change` label — correctly: the mirror exists so a session need not open the spine, which is exactly why it must not be allowed to drift.

### D-R1-08: The effective-level formula names readiness, as a fourth term

- **Ambiguous:** D-R1-04 left open whether to amend F1's `min(run.requested, policy.stationCap, policy.globalCap)` or to keep three terms and have the caller lower `globalCap` before resolution.
- **Chosen:** amend. The formula reads `min(run.requested, policy.stationCap, policy.globalCap, readiness.ceiling)`, with the subtractive rule, the absence rule, and the not-yet-wired note stated beside it.
- **Why:** the alternative works and hides why a run was capped, folding readiness into a number an auditor cannot attribute. For a repository whose claim is auditable evidence, an unattributable cap is the wrong trade.
- **Reverse:** restore the three-term formula and lower `globalCap` at the call site. Nothing reads the fourth term yet, so the reversal costs one edit for as long as that holds.

### What the amendment obliges, and of whom

- **P3 owes nothing.** It shipped against three terms and its refusals are correct for them. Recorded explicitly so a later reader does not treat the spine change as a retroactive finding against a merged unit.
- **R1 owes the attribution.** With four terms, a bare `exceeds-cap` no longer identifies what refused, so `I5.refusal-names-the-bounding-term` joins R1's conformance table and I5's pending count rises by two rather than one.
- **R1 owes an explicit absence.** A run on an unscanned repository keeps the ceiling policy gave it, so the term is genuinely absent — but the type must make absence visible rather than let an optional value vanish inside a `min` and read as clearance.
- **Nobody owes the wiring yet.** The term is stated and unread until the run-creation path takes it, as the spine names ten stations while M1 runs eight. `R1-readiness.md` §5 keeps that out of R1's scope.

## P5 amendment: the egress allowlist becomes P10

P5 began, stated its boundary, and stopped before writing the driver. The
reason is worth recording where the next reader of the plan will find it,
because it changes the unit order.

The Claude Code CLI has to run inside the sandbox. A driver that runs the
model on the host runs it outside the mount table, which is exactly the
failure `I1.driver-executes-inside-the-sandbox` was registered to prevent.
But `LocalDockerProvider` gives every container `--network none` and refuses
`mode: 'allowlist'` by name: D-P2-07 records that enforcing one needs a
filtering proxy the container is forced through, that nothing at M1 provided
it, and that the reverse is "implement the proxy, then accept the mode". No
unit owned that reverse.

So a container cannot reach the model API, and five of P5's seven capability
claims — `subagents`, `hooks`, `mcp`, `parallelism`, `stablePrefixCaching` —
cannot be proven at all. The decision taken before P5 started was that a
capability claim is proven against a real model call or it is not claimed, so
there is nothing to trade away here.

**P10 — Sandbox egress allowlist** is added to `DECOMPOSITION.md` with all
five parts, to F1's dependency graph, to `CONTRIBUTING.md`, and to the
`UnitId` union. P5 depends on P2 and P10, and resumes when P10 has shipped
and been reviewed.

Two alternatives were rejected. Folding the proxy into P5 makes one pull
request that changes the sandbox's network posture *and* adds a driver —
the shape the `gate-change` label exists to stop passing casually — and the
assertion that a non-allowlisted host is unreachable is about the sandbox,
not about a driver. Shipping P5 with five claims pending is the state I8
exists to end; a specific new reason does not change that it is the second
hand-off of the same entries.

This is an amendment in the sense `WORKFLOW.md` gives the word: a change to
the plan, landed on its own, before the unit that needs it starts. The
decisions P5 took on its own branch are recorded there under `D-P5-01`
onwards; this section is the part the plan documents depend on.

## P10: Sandbox egress allowlist

### D-P10-01: the allowlist is enforced by routing first and by the proxy second

- **Ambiguous:** the unit entry asks for "a forced filtering proxy ... with the container on a network whose only route out is that proxy", and separately that "bypassing the proxy is not possible from inside the container: the direct route does not exist, rather than existing and being asked politely not to be used". A proxy alone cannot deliver the second. Proxy environment variables are a request to a client, and a process that ignores them is not disobeying a control.
- **Chosen:** two mechanisms, in that order. The sandbox joins one Docker network created `--internal`, which leaves the container with no default route at all — measured, not assumed: `ip route` inside such a container lists only the on-link subnet, and any address off it answers `Network unreachable` from the kernel immediately. The proxy is the only other thing on that network, and is separately attached to a second, ordinary bridge network where its own route out lives. The sandbox is never on that second network and nothing forwards between the two: the proxy terminates the connection and opens its own.
- **Why:** the routing table is what makes the claim true, and the proxy is what makes it useful. With only the proxy, "the allowlist is enforced" would mean "enforced for clients that read `http_proxy`", which is a configuration, not a control. With only the internal network there is no egress at all, which is deny-all. The assertion that unsets every proxy variable and tries again is aimed exactly at the seam between the two, and it passes because of the first mechanism, not the second.
- **Reverse:** create the internal network without `--internal`. The container then has a default route and the bypass assertion fails rather than passing permissively, which is the outcome the criterion asks for. This was verified by mutation: dropping `--internal` fails `the direct route does not exist`, and making the proxy permit every host fails `the allowlisted host is reached and every other host is refused`.

### D-P10-02: the proxy is Node source passed on the command line, not an image that is built

- **Ambiguous:** the unit entry says the proxy is "a container the provider starts and owns" and does not say where its program comes from. Three options: build and pin an image, pull a third-party proxy image and configure it, or run source the package carries.
- **Chosen:** a Node script the package holds as `PROXY_SOURCE`, handed to a digest-pinned `node:22-alpine` with `node --eval`. One argv element, no shell, no mount, no build step, and the container runs `--read-only` with `--cap-drop ALL`.
- **Why:** the filter is the thing under review, and this way it is a file in the repository that a reviewer reads, diffs, and mutates in a test — rather than a config dialect interpreted by a binary nobody in this repository has read. Building an image would add a Dockerfile, a build, and a registry step to a unit that needs none of them; a third-party proxy image would put the enforcement of I4 inside software the project does not control. No mount matters on its own: the proxy container has no filesystem shared with anything, so the single-rw-mount rule is untouched (I1).
- **Why a second image at all:** the sandbox image is alpine, which carries no runtime that could serve a proxy. The digest is pinned in `src/`, not in `test/`, because it is production configuration; `LocalDockerOptions.proxyImage` overrides it so an air-gapped host can name a mirror, not so a different filter can be substituted — the behaviour is `PROXY_SOURCE`, which whatever image is named is handed and runs.
- **Reverse:** build an image and pin it; `PROXY_SOURCE` becomes its entrypoint and nothing else changes.

### D-P10-03: `AppliedControls.network` becomes `AppliedControls.egress`, a discriminated union

- **Ambiguous:** the unit entry asks that `appliedControls()` be "extended to record the allowlist and the proxy as applied evidence", and separately that a `deny-all` sandbox "still records `network: 'none'`". The existing field is typed with the literal `'none'`, which is exactly right for a provider that only did deny-all and cannot hold a network name.
- **Chosen:** replace the field with `egress: AppliedEgress`, a discriminated union. The `deny-all` branch carries `network: 'none'` as a literal and nothing else; the `allowlist` branch carries the internal network name, the normalised host list, and the proxy. A deny-all sandbox still records `network: 'none'`, now at `controls.egress.network`, where the type is what guarantees it.
- **Why:** widening the field to `string` would have generalised a literal that encodes an invariant, which the conventions forbid. Keeping `network` beside a new `egress` object would have put the same fact in two places, which is the shape I2's single-source rule rejects everywhere else. The union is strictly stronger than what it replaces: before, nothing at the type level tied `'none'` to the mode that earned it; now `deny-all` cannot carry a network name and `allowlist` cannot exist without the proxy that enforces it. The registry assertion had to stop comparing `network !== 'none'` because the compiler proved it dead, and reads the `--network none` in the recorded argv instead — what Docker was told, rather than what the provider says it told it.
- **Reverse:** flatten the union back to `network: 'none'` and delete the allowlist branch; every reader in `packages/sandbox` and `packages/conformance` moves back with it. Nothing outside those two packages read the field.

### D-P10-04: the hostname grammar D-P3-08 deferred lands here

- **Ambiguous:** P3 validates that a policy's egress entry "names one host" by refusing wildcards, paths, prefix lengths, and whitespace, and D-P3-08 says explicitly that a hostname grammar "belongs to whichever unit can actually enforce an allowlist". Nothing said whether the sandbox re-validates what policy already checked.
- **Chosen:** it does. `allowedHosts` accepts a hostname, an IPv4 dotted quad, or an IPv6 literal, lower-cases it, and de-duplicates; anything else is refused at the `egress` layer, naming the entry. A `SandboxSpec` may be built by a cast or parsed from a document, so the check runs where the grant is applied and not only where it was authored.
- **Why:** the proxy matches an entry exactly. An entry it cannot match exactly is a grant it cannot honour, and applying it anyway would allow or deny a host nobody wrote — `*.example.com` read as a literal denies everything the author meant to allow, and read as a pattern allows things they did not. Refusing rather than filtering matters for the same reason: a list that came back shorter than it went in is an allowlist the caller never wrote, and the entry that vanished is the one somebody looks for later and does not find.
- **What is deliberately not shared with P3:** the two checks are separate code in separate packages. `packages/sandbox` has no workspace dependency at all, and adding one to `core` to share a regular expression would buy less than the edge it costs. They enforce the same rule at two layers and are allowed to diverge only by becoming stricter here.
- **Reverse:** delete `egress.ts`'s grammar and accept any non-empty string; the proxy then matches whatever it is given, literally.

### D-P10-05: an empty `allow` under `mode: 'allowlist'` is refused, although P3 accepts an empty policy list

- **Ambiguous:** P3's validator accepts `egress: []` on a role and reads it as granting nothing, which is right for a policy document. The unit entry requires that an empty `allow` under `mode: 'allowlist'` be refused, "not treated as deny-all and not as allow-all".
- **Chosen:** both, at their own layers. A policy granting no host is a policy; a `SandboxSpec` asking for an allowlist and naming nothing is refused.
- **Why:** they are different statements. `egress: []` says what a role may reach — nothing. `{ mode: 'allowlist', allow: [] }` asks the provider to stand up a route out and then names nowhere for it to go; a caller that wanted no egress asks for `deny-all`, and a caller that asked for an allowlist and named nothing has not finished writing the policy. This is the rule `validateToolGrants` already follows for an empty inventory. The proxy fails closed on the same condition independently: it exits non-zero rather than start a server with no allowlist, so a misconfigured proxy is a sandbox that never comes up rather than a route out that grants everything.
- **Noted, not fixed:** `packages/api/src/line.ts` maps a scope's `egress` to a `SandboxSpec`, so a role granting `egress: []` produces `{ mode: 'allowlist', allow: [] }` and is now refused with this unit's message rather than the old "not enforceable" one. The outcome is unchanged — it was refused before and is refused now — so nothing regressed, but the mapping arguably ought to produce `deny-all`. That is `packages/api`, which P9 owns; it is a note here and not a commit.
- **Reverse:** return `{ mode: 'allowlist', hosts: [] }` for an empty list and let the proxy refuse to start. The refusal moves from provision time to start time and stops naming what is wrong.

### D-P10-06: the proxy logs each connection, and that is stated rather than claimed

- **Ambiguous:** the unit's out-of-scope list keeps per-connection logging of blocked attempts out — "it arrives with the proxy if it is cheap, and stays a known limit if it is not. Either way it is stated, never claimed."
- **Chosen:** it was cheap, so it arrives. The proxy writes one line per connection to its own stdout — `opened`, `tunnelled`, or `refused`, with the host — readable with `docker logs` for as long as the sandbox lives. A package test asserts both an allow line and a refusal line, and then asserts the container is gone after `destroy`.
- **What is not claimed:** nothing collects those lines into an evidence bundle, and they are destroyed with the proxy container, which is destroyed with the sandbox. So this is readable during a run and is not evidence after one. It gets no registry entry and no capability claim; evidence collection is P6's. The blocked-attempt log therefore remains a known limit in the sense P2 recorded it, and this unit narrows it rather than closing it.
- **Reverse:** delete `record()` and its three call sites; the proxy still refuses, silently.

### D-P10-07: a teardown the provider could not finish is reported, not swallowed

- **Problem:** the proxy's outbound network cannot be removed while anything is still attached to it. This was found by a test of this unit's own making — one that destroyed a sandbox while the test's origin container was still on that network — and the provider threw rather than leaving a leak unremarked.
- **Chosen:** keep that. `#dismantle` removes the sandbox container, then the proxy, then both networks, attempting every step even after one fails, and returns the first failure to whoever called `destroy`. A network that outlives its sandbox is a leak, and the provider says so.
- **Why not force it:** disconnecting endpoints the provider did not create, to remove a network it did, would make the provider responsible for containers that are not its own. In a real run nothing else ever joins a sandbox's outbound network; when something has, the honest answer is the error. The test ordering was the thing that was wrong, and it was fixed.
- **Reverse:** disconnect every remaining endpoint before removing the network. Teardown then always succeeds and stops reporting the one case worth knowing about.

### D-P10-08: the suite proves reachability against an origin it starts, never against the internet

- **Ambiguous:** "a sandbox provisioned with `mode: 'allowlist'` and one host reaches that host" needs a host. Using a real one makes every run depend on the network CI happens to have.
- **Chosen:** the suite starts an origin container on the proxy's own outbound network and allowlists it by name. The sandbox is never on that network, so the only path to it is through the proxy. Nothing in this unit's tests reaches the internet.
- **Why it is stronger, not weaker:** the denied cases can then be things the proxy demonstrably *can* reach. The sharpest assertion allowlists the origin by name and then asks for it by address: the proxy reached that exact host a moment earlier, and refuses it now for the one reason under test — the address is not on the list. A denied host that was merely unreachable would pass against a provider with no allowlist at all. The counterfactual is asserted too: stopping the proxy container makes the allowed host unreachable, so the earlier success is known to have come through the proxy rather than around it.
- **Verified once, outside the suite:** an allowlist naming a real public host was provisioned by hand and the tunnel opened — `CONNECT example.com:443` answered `200 Connection Established`, a plain `GET` through the proxy returned the real document, and a second real host was refused with 403. That is the path P5 needs and it works. It is deliberately not a test: a suite that reaches the internet fails for reasons that have nothing to do with the allowlist.
- **What is not separately asserted:** TLS over the tunnel. `CONNECT` is byte-blind by decision, so there is nothing between the client and the origin for a test to observe; asserting that the tunnel opens is asserting the whole of what this unit does for an HTTPS request.
- **Reverse:** allowlist a public host and require the network. The assertions read the same and become dependent on CI's egress.

### D-P10-09: the assertion is `I5.sandbox-egress-allowlist-enforced`, not `sandbox.egress-allowlist-enforced`

- **Ambiguous:** the unit entry's ledger line says the unit "pays `sandbox.egress-allowlist-enforced` as a new live assertion under I5". That id cannot be registered under I5. `validateEntry` requires every assertion in an entry to carry that entry's own prefix, so an id under I5 must begin `I5.`; and the `sandbox.` namespace is the capability-claim namespace, whose keys are held equal to `keyof SandboxCapabilities` by a generated compile-ok fixture. Registering `sandbox.egress-allowlist-enforced` under I5 is a registry problem, and registering it as a claim would need a new key on `SandboxCapabilities`, which is a contract change and therefore an amendment rather than unit work.
- **Chosen:** `I5.sandbox-egress-allowlist-enforced` — the required prefix, then the entry's own words. It is a live runtime assertion in I5's list, and the ledger line is otherwise met exactly: nothing pending was added, and the baseline is untouched at 23.
- **Why this reading and not a contract change:** an allowlist is not a capability the sandbox declares. `SandboxCapabilities` answers "what can this provider do at all" — `gpu`, `persistent`, `remote` — and every key is asserted against a provisioned container. Egress is per-sandbox policy, not per-provider capability: the same provider applies `deny-all` to one sandbox and an allowlist to the next, so a boolean on the provider could not be true or false for it. The entry's own text agrees — it says "under I5", and I5 is where fail-closed lives.
- **Flagged rather than silently resolved:** the entry as written names an id the registry would reject, which is a defect in the entry and not in the registry. It is stated here and in the pull request body so a reviewer sees the divergence rather than discovering it.
- **Reverse:** add an `egress` key to `SandboxCapabilities` and register the claim there. That is an F2 amendment, and it would be registering policy as capability.

## P10 amendment: external adversarial review

Three findings, three verified, three held, none rejected. The full triage,
with the reproductions, is
`docs/reviews/2026-09-18-P10-egress-allowlist-adversarial-triage.md`. Two
choices inside the fixes were not forced by the findings and are recorded here.

### D-P10-10: the received `Host` header is rewritten, not checked for a match

- **Problem:** the proxy forwarded `req.headers` verbatim, so an absolute-form request to an allowlisted host could carry someone else's `Host` and be served by whatever infrastructure sits in front of that host. Reproduced: the upstream reported `HOST-SEEN=evil.example`. The connection never leaves the granted host, so this selects a different site behind a granted address rather than reaching a new one — which, for the model APIs this unit exists to reach, is the normal shape and not an exotic one.
- **Chosen:** discard the received `Host` and rebuild it from the request target, which is what RFC 7230 §5.3.2 requires of a proxy given an absolute-form target.
- **Why not the reviewer's other suggestion:** it offered rewriting *or* validating that the two match. Refusing a mismatch would break correct clients — a proxied request has no reason to carry a `Host` at all — to catch a case that rewriting removes outright. A control that refuses legitimate traffic to catch illegitimate traffic it could simply have corrected is the wrong trade here.
- **What is not claimed:** `Host` is now the proxy's, but an origin configured to route on `X-Forwarded-Host` or similar could still be steered by one. That is the origin's trust configuration, and a forward proxy cannot fix it without rewriting headers it has no contract for. The HTTPS equivalent is unreachable by design, because this unit does not terminate TLS — the reviewer said so itself, and the out-of-scope list already said it.
- **Reverse:** pass `req.headers` through again. The assertion added with this fix then fails, which is the point of adding it.

### D-P10-11: a malformed authority is refused; the proxy does not catch its way out of it

- **Problem:** `split()` took everything after the first colon as the port, so `CONNECT allowed:8080@elsewhere` produced a host that is on the allowlist and a port of `8080@elsewhere`. `Number` of that is `NaN`, and `net.connect` throws `ERR_SOCKET_BAD_PORT` synchronously inside an event handler. Reproduced: the proxy container exited and the sandbox lost egress entirely, with nothing refused and nothing recorded.
- **Chosen:** validate the port where the authority is parsed. One to five digits, in range, or the authority is unreadable and the target is refused — `split` returns `null` and the request gets a 403 saying it did not name one host and one port. Both upstream-connect sites are additionally wrapped, so a future parse slip ends one request rather than the process.
- **Why not a global `uncaughtException` handler:** it would have closed the same symptom and is the obvious cheap fix. A proxy that swallows arbitrary throws and keeps serving is warn-and-continue, which this project refuses everywhere else; it would also have left the `NaN` in place, so the next malformed authority would take a different path to the same place.
- **What the failure actually was:** it failed closed — the sandbox could reach nothing afterwards — but silently. The provider did not notice, `exec` kept working, and the run would have failed later somewhere else for a reason nothing in the evidence explains. Silence was the defect, not unavailability.
- **Reverse:** delete `portOf` and parse with `Number` again.

## P5: Driver: Claude Code

### D-P5-01: The unit spec was completed before the code, not after

- **Ambiguous:** `DECOMPOSITION.md`'s P5 entry had Scope, Deliver, Out of scope, and Conformance, and none of the other five parts F1 §"Sub-Plan Rules" requires — no acceptance criteria, no invariant line, no ledger, no statement of where the package lives, no list of the contract changes it needs.
- **Chosen:** write all five first, in their own commit, and take the three decisions they turn on with the maintainer before any code: capability claims are proven against a real model call inside the sandbox and never skipped; `Driver` gains `declaredTools()` in this unit's pull request; the driver holds the `SandboxProvider` that provisioned its handle.
- **Why:** P4's entry gained the same five before P4 started. An acceptance criterion written after the implementation is a description of what was built, not a test of it, and the ledger in particular only constrains anything if it is fixed before the work that would edit it.
- **Reverse:** the commit is documentation only; revert it and the entry is thin again.

### D-P5-02: An external assertion is reconciled against a report the package writes, not by re-running it

- **Ambiguous:** `I8.external-assertion-execution-reconciled` requires the registry to read "that package's own test run" and refuse an id that did not run, without saying how the registry gets it. The registry cannot import a sibling's tests (D-F3-04, the workspace cycle).
- **Chosen:** the owning package adds `ConformanceRunReporter` to its vitest config; the reporter writes `.conformance/run.json` at the end of every run, passing or failing, holding each test that carried an assertion id, its state, its file, and a hash over every input file in the package. `kit/reconcile.ts` recomputes that hash and accepts the assertion only when the named test passed, in the named file, against the tree being evaluated. Ten refusals, each with its own name and message.
- **Why:** the alternative — the registry spawning each owning package's suite itself — needs no artifact and cannot go stale, but it runs every external assertion twice. For P5 that is a second set of model calls for an answer the first run already has, and for P2 a second container fleet. A content hash buys the same freshness guarantee for one run. An mtime comparison would not: a checkout, a cache restore, and a clock skew all move mtimes without moving content.
- **Why the reporter and not a wrapper script:** it runs in-process on every outcome, so a failing suite overwrites the report a passing one left instead of leaving it behind to vouch for code that no longer passes. And `vitest.config.*` is a protected path, so adding it to a package is an acknowledged edit rather than a quiet one.
- **Reverse:** delete `kit/reconcile.ts`, `kit/run-report.ts`, and `kit/reporter.ts`, restore the unconditional refusal in `validateEntry`, and re-register the pending entry with P5 as owner.

### D-P5-03: The report is a build artifact and is never committed

- **Ambiguous:** nothing said whether a run report belongs in the repository. It is evidence, and this repository tracks evidence — review bundles are tracked deliberately.
- **Chosen:** `.conformance/` is gitignored.
- **Why:** a review bundle is what a reviewer saw, fixed forever. A run report is what one machine's run recorded a moment ago, and it is meaningless away from the tree it hashes. A committed one would be a claim about a run nobody can see, asserted by the party being judged — the shape I2 rejects everywhere else. The tree hash makes a stale one harmless anyway: it is refused, not believed.
- **Reverse:** remove the `.gitignore` entry. Nothing reads a report from git.

### D-P5-04: Workspace discovery follows the globs in `pnpm-workspace.yaml`

- **Ambiguous:** `workspacePackages()` scanned `packages/` one level deep, which was the whole workspace until P5 put a package at `packages/drivers/claude-code`.
- **Chosen:** read the globs from `pnpm-workspace.yaml` and expand each. Only a trailing `/*` is supported; any other pattern throws rather than matching nothing.
- **Why:** a hard-coded level would have stopped seeing a package pnpm does see, and every scan built on the list — the fixture-path map, the I9 source inventory, the inline-suppression scan — would have skipped it and reported clean. A silently smaller inventory is the failure mode worth spending a parser on. Throwing on an unsupported pattern is the same rule one level up: an empty result must never be mistaken for an empty workspace (I5).
- **Reverse:** restore the single-level scan; the driver package then needs to move up a level.

### D-P5-05: `Driver` gains `declaredTools()`, landed early on the unit branch

- **Ambiguous:** `I4.driver-tool-inventory-validated` says P5 owes "the driver-side half — a Driver that declares its tools". Where that declaration lives was not settled: a method on the contract, a field on `DriverCapabilities`, or an export from the driver package alone.
- **Chosen:** a method on `Driver`. `StubDriver` returns the empty list, and `DelegatingDriver` and the line's test double forward it.
- **Why:** `validateToolGrants(policy, inventory)` is generic over drivers, so the inventory has to be obtainable from a `Driver` and not from one package that happens to export it — otherwise the Codex driver (M2) reopens the gap instead of satisfying it. `DriverCapabilities` was rejected because it holds feature flags: "MCP works" is a different statement from "these are the tools", and mixing them makes the keys-registered assertion nonsense.
- **Why empty for the stub:** the stub runs no model and offers no tool. An empty inventory refuses every grant, which is default deny (I4). A stub that claimed an inventory would let a grant pass validation against a driver that cannot honour it.
- **Reverse:** delete the method and the three implementations; `validateToolGrants` then has no caller that can produce its argument, as before.

### D-P5-06: P5 stops at the scaffold; the egress allowlist becomes P10

- **Problem:** the Claude Code CLI has to run inside the sandbox — a driver that runs the model on the host is outside the mount table, which is the whole of `I1.driver-executes-inside-the-sandbox`. `LocalDockerProvider` gives every container `--network none` and refuses `mode: 'allowlist'` by name (D-P2-07, "enforcing one needs a filtering proxy the container is forced through... Reverse: implement the proxy, then accept the mode"). No unit owned that reversal. So a container cannot reach the model API, and five of P5's seven capability claims — `subagents`, `hooks`, `mcp`, `parallelism`, `stablePrefixCaching` — cannot be proven.
- **Chosen:** stop P5, add **P10 — Sandbox egress allowlist** to `DECOMPOSITION.md` and to F1's dependency graph, make P5 depend on it, and resume P5 on this branch once P10 has shipped and been reviewed.
- **Why not fold it into P5:** it is a change to the sandbox's network posture, in another unit's package, and bundling it with a new driver makes one pull request where a reviewer has to hold both in mind at once — the shape the `gate-change` label exists to stop passing casually. It also needs its own conformance: that a non-allowlisted host is unreachable is an assertion about the sandbox, not about a driver.
- **Why not ship P5 with five claims pending:** that is what the ledger was fixed in advance to prevent. Five capability claims left as declarations with nothing behind them is the state I8 exists to end, and handing them forward a second time with a new reason is still handing them forward.
- **What stays on the branch:** the reconciliation mechanism (D-P5-02 through D-P5-04) and `declaredTools()` (D-P5-05). Both are independent of egress and correct as they stand.
- **Reverse:** delete P10 from the three documents and the `UnitId` union, and decide again between the two rejected options.

### D-P5-07: The credential is an environment value on the exec, and the exec contract grows a slot for one

- **Ambiguous:** the unit entry says credentials "arrive as an environment variable on the exec, never as a mount and never inside a prompt", and `SandboxProvider.exec(h, cmd)` has nowhere to put one. Three readings were open: amend `exec`, amend `SandboxSpec` so the value is set when the container is created, or wrap the command in `sh -c 'KEY=... claude ...'` and change no contract.
- **Chosen:** `exec(h, cmd, options?: ExecOptions)`, with `env` a name-to-value map. The provider passes `docker exec --env NAME` — the name alone — and puts the value in the environment of the `docker` process it spawns, so the secret travels through the daemon API and appears in no argument vector: not the one this process spawns, not the one the command runs under inside the container. Landed in this pull request as **A-P5-02**.
- **Why not `SandboxSpec`:** that is the machinery P10 already uses for the proxy variables, so it was the cheaper edit. But it puts the secret in `docker create`'s argv and then in the container's configuration for its whole life, readable by anything that can inspect it, and it contradicts the entry's own words. A credential that outlives the command it was for is a credential with a longer window than it needs.
- **Why not the shell wrapper:** it changes no contract and leaks the secret twice — into the host's `docker exec` argv and into the process table inside the container. An argv is world-readable to anything that can list processes, and a credential is exactly what this exists to carry.
- **What the provider refuses:** a name that is not a plain environment-variable name, and a name with no value. Both are the fail-closed case (I5): a command that lost its credential does not fail where the credential was lost, it fails later inside the model runner with an authentication message that says nothing about the provider having dropped it. A new `environment` refusal layer names which control declined, so an assertion can require the right refusal rather than merely some error.
- **Reverse:** delete `ExecOptions`, the `environment` layer, and `environmentPassthrough`; the driver then has no way to authenticate that is not a mount or a prompt.

### D-P5-08: The image is built by this package, from two pinned inputs

- **Ambiguous:** every other image in the repository is pulled by digest — `packages/sandbox` pins an alpine, P10 pins a node. No published image carries the Claude Code CLI, so the same pattern was not available.
- **Chosen:** a `Dockerfile` in this package, built on demand, with the base pinned by digest and the CLI pinned to an exact version. The tag carries the version, so raising the version builds a different image rather than replacing one under the same name.
- **Why pinned to an exact version and never a range:** a range makes the image a function of the day it was built, and the tool inventory asserts against what that image's CLI offers. An inventory checked against a moving CLI proves nothing about the CLI a run will use.
- **Why nothing from the repository is copied in:** the workspace arrives at run time as the sandbox's one writable mount, so a stale image cannot serve a task an old copy of the tree. The image holds the runner, never the work.
- **Why the build runs on the host:** it needs a package registry, and the sandbox's allowlist grants the model API alone. Building inside the sandbox would mean widening egress to npm for every run, which is a larger hole than the build is worth.
- **Reverse:** publish an image carrying the CLI and pin it by digest like the others; `ensureImage` then becomes a pull.

### D-P5-09: The tool grant reaches `--tools`, which decides what exists, not `--allowedTools`, which decides what needs approval

- **Ambiguous:** the CLI has two flags that both look like a grant. `--allowedTools` pre-approves uses of tools that are present; `--tools` sets which built-in tools the session has at all.
- **Chosen:** `--tools`, with the granted list and nothing else. An empty grant produces `--tools ''`, which is a session with no tools.
- **Why:** the acceptance criterion is that "a tool outside the grant is unavailable to the model, not merely unused". `--allowedTools` leaves the tool in the session and changes what happens when it is used, which is a different and weaker statement. Default deny is about what exists (I4).
- **What this made visible:** the CLI silently drops a tool name it does not know — `--tools "Read,NoSuchTool"` produces a session with `Read`. So a policy could grant a tool that never existed and read as though the grant had taken effect. The driver therefore refuses a grant outside `declaredTools()` before the task starts, rather than relying on the CLI to notice.
- **Reverse:** pass `--allowedTools` instead. The narrow-grant assertion then fails, because the session still holds the tools.

### D-P5-10: The stable prefix is appended to the default system prompt, with the per-machine sections moved out of it

- **Ambiguous:** `TaskRequest.stablePrefix` could replace the CLI's system prompt (`--system-prompt`) or be appended to it (`--append-system-prompt`). Either is identical across a run, so either could be cached.
- **Chosen:** append, plus `--exclude-dynamic-system-prompt-sections`.
- **Why append:** replacing the default prompt removes the instructions that make the tools usable, so the session stops behaving like the CLI whose capabilities this unit is asserting. The driver renders what it is handed (the compiler's content is M2's); it should not also be deciding that the runner's own prompt is unwanted.
- **Why the dynamic sections are excluded:** cwd, environment information, memory paths and git status sit in the default prompt and change between tasks. Left in, they sit *before* the appended prefix and break the cacheable span, so two tasks in one run would each write the cache and neither would read it. The cache-read assertion turns on this flag, which is why it is not a tuning detail.
- **Reverse:** use `--system-prompt` and drop the exclusion; the caching assertion then measures a prefix the CLI composes rather than the one the contract splits.

### D-P5-11: `parallelism` is 1, and the driver enforces it rather than declaring it

- **Ambiguous:** the CLI can run several sessions in one container, so a number above one was available. The claim's text is "the driver runs the declared number of tasks concurrently under one provenance id", which says nothing about which number.
- **Chosen:** `parallelism: 1`, with one in-flight invocation per sandbox handle. A second task on the same sandbox waits.
- **Why not a larger number:** the container's CPU, memory and PID limits come from the `SandboxSpec`, which the driver does not choose. A driver claiming four concurrent tasks would be claiming something the sandbox, not the driver, decides — and I8 asks for a claim that fails when the capability is deleted, not one that fails when the limits are tight.
- **Why enforced rather than merely declared:** a declared number nothing enforces is a capability claim with nothing behind it, which is the state this unit exists to end. The assertion counts invocations inside the sandbox rather than timing the caller's promises, because two `runTask` calls created together begin at the same instant whatever the driver does.
- **Reverse:** delete the per-sandbox lock and raise the number; the assertion then has to observe that many invocations overlapping, and the sandbox's limits become part of what it is testing.

### D-P5-12: `steering` is false, and `steer()` is absent rather than present and throwing

- **Ambiguous:** the CLI can take a message mid-turn over `--input-format stream-json`, so `steering: true` was reachable with more work. The contract makes `steer()` optional.
- **Chosen:** declare false and omit the method. The driver runs one CLI invocation per task and does not hold a session open to deliver a message into.
- **Why absent and not throwing:** a method that exists and refuses is a capability declared false and present, which is the direction the assertion refuses as firmly as the other. `'steer' in driver` is the check, and it reads the same as the declaration.
- **Why not implement it:** holding the session open changes the shape of every invocation — stdin stays attached, the process outlives the call, and cancellation becomes the driver's problem — for a capability nothing in M1 uses. A capability is what the driver does, not what the tool could do.
- **Reverse:** hold the session open over `--input-format stream-json`, add `steer()`, and flip the flag. The assertion's second half then has to change, because absence would no longer be what it is asserting.

### D-P5-13: MCP servers belong to the driver; the request's grants choose which of them start

- **Ambiguous:** the claim says "the MCP servers named in `TaskRequest.tools` are reachable from a task, and no other server is", but `TaskRequest` carries tool names and no server configuration. An `mcp__<server>__<tool>` grant names a server that has to come from somewhere.
- **Chosen:** the servers are a driver option; the request's grants select from them. The session is started with `--strict-mcp-config` and a configuration holding only the servers its grants actually name.
- **Why the grants select rather than the driver loading all of them:** "no other server is loaded" is then a fact about the session rather than about what the model chose to use. A server nothing granted is absent, not merely unused (I4).
- **Why a grant naming an unheld server refuses:** the CLI drops an unknown MCP tool the same way it drops an unknown built-in, so without the refusal a policy could name a server that does not exist and get a session that looks configured.
- **Why the MCP names are not in `declaredTools()`:** they belong to whichever server a request configures, not to the driver. Naming them in the inventory would be claiming an inventory the driver does not have. They are checked against the server map instead.
- **Reverse:** add an MCP field to `TaskRequest` and let the request carry its own servers. That is an F2 amendment, and it would give a request a way to start a process the policy layer never saw.

### D-P5-14: A run that never reached the model is a refusal, never a `TaskResult`

- **Ambiguous:** the CLI exits zero on an authentication failure. It retries ten times over about three minutes and then writes a result message with `is_error: true`, `api_error_status: 401`, and an apology in the `result` field. Read naively, that is a completed task whose narrative says it failed.
- **Chosen:** refuse. An API status the CLI gave up on, a session that never started, a credential from a source this driver did not arrange, and a missing result message are each a refusal with its own message.
- **Why:** a `TaskResult` says a task ran, and the runtime derives status from evidence that assumes one did (I2). Returning a result whose narrative is "Failed to authenticate" hands the runtime a claim to diff against evidence that does not exist, and the failure then surfaces somewhere that cannot explain it. The driver knows why, here, and says so (I5).
- **What is *not* a refusal:** a task that ran and concluded something disappointing. The model's verdict on its own work is a claim and goes in `AgentClaim`, where the runtime can disagree with it.
- **Reverse:** return a `TaskResult` for any run that produced a result message. The refusals become narratives and the evidence layer inherits them.

### D-P5-15: The reporter is named as a string in `vitest.config.ts`, not imported into it

- **Problem:** importing `ConformanceRunReporter` into a package's vitest config fails at load. A config file is bundled and loaded by Node before vite's resolver exists, so the kit's `./run-report.js` specifiers are resolved by Node against files that are `.ts`.
- **Chosen:** `@olympus-ai/conformance` gains two subpath entries — `./vitest` and `./reporter` — and a package names the reporter as `reporters: ['default', '@olympus-ai/conformance/reporter']`. Vitest then loads the module through its own runner, which resolves `.js` to `.ts`.
- **Why subpaths rather than importing the package root:** the root re-exports the registry, which imports every sibling package, so typechecking a driver package would drag the whole registry in with it. `./vitest` and `./reporter` reach nothing but `node:` modules and two kit files. Published entries, not a sibling's `src/`, so the import rule holds.
- **Reverse:** remove the `exports` block and the default export on the reporter; a package contributing external assertions then has no way to write a run report.

### D-P5-16: A claim id is not kebab-case, and `invariantTest` had never been told

- **Problem:** `validateAssertionId` required every id to be `<family>.<kebab-name>`, so `driver.computerUse` was refused outright. Every claim id is held equal to a key of `DriverCapabilities` or `SandboxCapabilities` by a generated fixture, and those keys are camelCase.
- **Chosen:** two shapes. An invariant assertion stays `I<n>.` plus kebab-case; a claim is `driver.` or `sandbox.` plus a capability key exactly as the interface spells it.
- **Why it went unnoticed:** the registry constructs its own claim entries directly and never goes through `invariantTest`, and no package had contributed a claim from its own suite before. The first real use of an interface is where the friction is, which is the reason `WORKFLOW.md` treats amendments as expected rather than exceptional.
- **Reverse:** restore the single kebab-case shape; no claim id can then be written by a contributing package.

### D-P5-17: The declared inventory omits a tool the CLI sometimes offers

- **Ambiguous:** the CLI's default tool set is not stable between sessions — one probe of the pinned version offered `DesignSync` and another did not, from the same image and the same flags. Granting it by name produced a session without it.
- **Chosen:** leave it out of `DECLARED_TOOLS`. The driver always passes `--tools`, so a tool outside the inventory is never in a session, and a policy that granted it would be refused before the task started.
- **Why leaving it out is the fail-closed direction:** declaring a tool the CLI will not reliably grant would make the inventory assertion flaky and, worse, would let policy grant something that silently is not there. An inventory that is smaller than what the runner can do costs a capability; one that is larger costs the meaning of a grant.
- **Reverse:** add it and require the assertion to tolerate its absence, which is the same as not asserting the inventory.

### D-P5-18: An MCP server's other tools are named as disallowed, after asking the CLI what they are

- **Problem, found by running it rather than reasoning about it:** `--tools` governs the built-in set only. An MCP server contributes its whole tool list to a session, so a request granting `mcp__probe__ping` against a server that also offers `mcp__probe__ungranted` produced a session holding both. Reproduced against the pinned CLI: the session's own startup report listed `["mcp__probe__ping","mcp__probe__ungranted"]`. That is a tool available to the model that policy never granted, which is exactly what I4 forbids, and no narrower grant fixes it because the names come from the server rather than from the driver.
- **Chosen:** the driver asks the CLI what the servers offer before it runs the task, and names every tool beyond the grant in `--disallowedTools`. The inspection starts a session with no tools and reads the list it prints; the CLI prints its session before it calls anything, so this costs a process and no tokens, and it is bounded by `timeout` so a CLI that cannot start does not sit retrying until the sandbox's wall-clock limit ends it.
- **Why named one by one:** a server-wide pattern was tried first and is worse than useless. `--disallowedTools mcp__probe` empties the session of that server's tools, and a following `--allowedTools mcp__probe__ping` does not bring the granted one back — the session comes up with nothing. Exact names are the only form that removes a tool and leaves its sibling.
- **Why removal and not refusal of use:** `--disallowedTools` with an exact name takes the tool out of the session's list entirely, so this is absence rather than a denial at use time. That is the same standard `--tools` meets for the built-ins, and it is what "unavailable to the model, not merely unused" asks for.
- **Why an inspection rather than a declared inventory:** the driver cannot know a server's tools — that is the server's business, and a driver that hard-coded them would be wrong the first time a server was upgraded. Asking is the only honest way to get the list, and the answer is the CLI's rather than the model's.
- **What happens when the inspection fails:** the task is refused and not started. Running it would mean offering the model tools nobody can enumerate, which is the fail-closed case (I5) and not a reason to proceed with a narrower claim.
- **Why no pending entry was added in exchange:** the gap was found inside this unit and closed inside it. The ledger is unchanged: I4 drops from 2 to 1 and stays there.
- **Reverse:** delete `#ungrantedMcpTools` and the `--disallowedTools` argument. A granted server's other tools are then in every session that loads it, and the `driver.mcp` assertion fails on the tool it expects to be absent.

### D-P5-19: "zero on the first task" is not measurable, and the assertion measures the growth instead

- **Problem:** the acceptance criterion reads "`cacheReadTokens` is zero on the first task of a run and non-zero on a second task that shares its `stablePrefix`". Run against the real API, the first task read 6373 tokens from cache. The criterion is not wrong about the mechanism; it is wrong about what a first task can observe. The CLI's own system prompt is large, identical between sessions, and cached account-wide with a short time-to-live, so by the time this assertion runs, six earlier assertions in the same suite have already warmed it. A "first" task is only first within its own two-task pair.
- **Chosen:** the stable prefix carries a nonce generated once per harness, so the exact prefix has never been presented to the cache by any session before this run. Three assertions replace the zero: the first task must *write* cache, the second must read strictly more than the first, and the second must write strictly less than the first.
- **Why that is the stronger test, not the weaker one:** the difference between the two reads is the stable prefix, and it exists only because the prefix sits in the cacheable span. A driver that concatenated the prefix and the suffix into one turn would leave the CLI's system prompt unchanged between the two tasks, so both would read the same amount and the comparison would not move. The zero-based form could not distinguish those two drivers at all once the account was warm — it would fail for both, for a reason that has nothing to do with either.
- **Why a nonce rather than a cold account:** waiting out the cache's time-to-live would make the assertion take minutes and would still be a race against anything else using the same account. A prefix nobody has ever sent is cold by construction, on any account, at any time.
- **What is not claimed:** an absolute number. How many tokens the second task reads depends on the CLI's own prompt, which this unit does not control and should not pin. The assertion is about the direction the numbers move when the prefix is shared, which is what the contract's split exists to produce.
- **The entry should be corrected:** `DECOMPOSITION.md`'s P5 acceptance line still says zero on the first task. It is amended to the growth form, with this entry as the reason, rather than left to read as a criterion that was quietly not met.
- **Reverse:** drop the nonce and assert zero again. The assertion then passes only against an account that has made no Claude Code call in the preceding few minutes, which is a property of the machine rather than of the driver.

## P5 amendments to the contracts

### A-P5-01: `Driver` gains `declaredTools()`

Landed earlier on this branch and recorded as **D-P5-05**. The driver-side half of `I4.driver-tool-inventory-validated`: `validateToolGrants(policy, inventory)` has taken a mandatory inventory since P3 and nothing in the repository could produce one.

### A-P5-02: `SandboxProvider.exec` gains `ExecOptions`, and the refusal layers gain `environment`

`exec(h, cmd, options?: ExecOptions)`, where `ExecOptions.env` is a name-to-value map the implementation must keep out of every argument vector. Reasoned in **D-P5-07**.

Not named in P5's entry, which listed `declaredTools()` alone. It is named here, in the pull request body, and in the entry itself, because a contract change nobody flagged is the kind that passes review by not being looked at. The entry's own requirement — that the credential reach the CLI as an environment variable on the exec — could not be met without it; the alternatives were a mount, which the entry forbids, or a secret in an argv.

Both implementations and the test wrapper carry the parameter: `LocalDockerProvider` passes `--env NAME` and sets the value on the `docker` process, `StubSandboxProvider` sets it on the child it spawns, and `DelegatingSandbox` forwards it. `ExecOptions` is optional, so every existing call site is unchanged.

## P5 amendment: external adversarial review

Nineteen findings across two reviewers, seventeen held in full, two in part,
none rejected. Sixteen were fixed on the branch. The full triage, with the
reproductions, is `docs/reviews/2026-09-20-P5-driver-claude-code-triage.md`.
Three limits could not be closed inside this unit and are recorded here.

### D-P5-20: the credential is kept out of every argv, and that is all it is kept out of

- **Problem:** the driver passes the model credential as an environment value on the exec, and both the code and its tests read as though that made it unreachable. It does not. Demonstrated in a container during the review: a child of the credentialed process printed it, and a *later* exec that was given no credential at all read it out of `/proc`. The CLI and every tool a task runs share a user, so anything the model can run can read it.
- **What the mechanism does buy, stated exactly:** the value is in no argument vector on the host or in the guest, so it is not visible to anything that can only list processes; and it is not on the mount table, so it does not persist for the sandbox's life or appear in a diff of the tree. Against the alternative the unit entry forbade — a mounted secret — that is a real improvement. It is not confidentiality from the model, and the comments claimed otherwise.
- **Chosen:** correct the claim rather than weaken the check. The comments now say what holds, and the limit is registered as `I4.model-credential-not-readable-by-the-task`, pending, owned by P6.
- **Why not fix it here:** the fix is that the credential never enters the container. P10 already interposes a proxy on the only route out, so the natural shape is authentication at that layer, with the sandbox holding a short-lived token or nothing. That spans the sandbox, the proxy and the driver; it is an architecture change, not a review fix, and doing half of it in the driver would produce a control that reads as complete and is not.
- **Reverse:** move authentication to the egress layer and delete `CREDENTIAL_VARIABLE` from the driver. The pending entry is then paid.

### D-P5-21: a task's processes outlive the task, and the driver is the wrong place to fix it

- **Problem:** `#serialized` bounds one foreground `provider.exec` per sandbox handle. It does not bound what a task leaves behind, and a sandbox is persistent by declaration (P2). Demonstrated: a process detached by one exec was still running when a later exec looked. A task granted `Bash` can leave a process that keeps reading and writing the workspace, and reaching whatever the sandbox permits, while a later task holding a narrower grant runs beside it.
- **Why that matters and is not merely untidy:** the later task's grant is then not what is running in its sandbox. Default deny is a statement about what a task can reach, and a process from the previous task is something it can reach that policy never granted it.
- **Chosen:** register `I4.task-capabilities-do-not-outlive-the-task`, pending, owned by P6, and raise the baseline for it.
- **Why not a sweep in the driver:** killing stray processes between tasks is a few lines and would close the demonstrated case. It would also be a control the driver cannot actually enforce — it races anything started between the sweep and the next invocation, and it cannot see a process that re-parents itself. A partial control that reads like a complete one is worse than a stated limit, because the limit is visible in the registry and the sweep would not be.
- **Why P6:** it collects base and diff in a fresh sandbox, so it is the first unit whose correctness depends on a task's sandbox holding nothing from an earlier one.
- **Reverse:** give the sandbox a per-task process boundary, or one container per task, and pay the entry.

### D-P5-22: what the run report still does not bind, said plainly

- **Problem:** the review's second reframing was that "does the report hash match the current package" is the wrong question, and the right one is whether the report identifies one completed execution of that assertion against the complete inputs being evaluated. Three of the four gaps it named are now closed — the hash covers every workspace package the run executes, it is taken before the run as well as after, and the reported test must be the assertion the registry registers rather than any test carrying its id.
- **What is still not bound:** the root configuration and the lockfile, and the identity of the container image the assertions ran in. The image is bound from the other direction — its tag is now derived from the Dockerfile, the base digest and the CLI version, so different inputs cannot share a tag — but the report does not record which image ran, so a report cannot be checked against one.
- **Chosen:** state it here rather than add a fourth pending entry. The registry's pending list is for work an invariant is waiting on; this is a known incompleteness in a mechanism that already has an assertion, and the assertion's own text names what it covers.
- **Why not close it now:** recording the image digest means the reporter knowing which image the tests used, which means the harness telling it, which is a channel that does not exist. Hashing the lockfile is easy and was not done for a worse reason — it would make every report in the workspace mismatch on any dependency change, including ones the package does not use. Both want a decision about how coarse the binding should be, and that decision belongs with whoever next touches reconciliation rather than to a review fix.
- **Reverse:** extend `packageTreeHash` to the root manifests and record the image digest in the report.

### D-P5-23: `pnpm -r test` cannot go green from cold, and the order is not incidental

- **Found during P5's acceptance run.** The recursive test command runs packages in dependency order, and `@olympus-ai/conformance` is a dependency of the driver package, so conformance runs *first*. Conformance reconciles the driver's external assertions against a run report only the driver's own suite writes. From a cold tree there is no fresh report, conformance refuses all nine, and pnpm aborts the recursive run before the driver package ever runs — so the command cannot repair itself by running again.
- **Chosen:** state the order rather than engineer around it. The acceptance sequence is the driver package's suite first, then `pnpm -r test`, then `pnpm conformance`.
- **Why not make the driver a dependency of conformance so pnpm orders it first:** that is the workspace cycle D-F3-04 exists to prevent. The kit deliberately has no package dependency on any sibling, which is what lets any package devDepend on the kit; inverting it for scheduling would trade a structural guarantee for a convenience.
- **Why not have conformance run the owning package's suite itself:** that is the option D-P5-02 rejected, and for the same reason — it would re-run every external assertion, which for this driver means a second set of model calls for an answer the first run already has.
- **What this is, honestly:** a rough edge in a mechanism that is otherwise doing exactly what it should. The refusal is correct every time it fires; it is the recovery that is awkward, because the command that would fix the state is the one the failure prevents from running.
- **Reverse:** a root script that runs the owning suites before the registry, so one command has the order built into it. Worth doing when a second package contributes external assertions; with one, a documented order costs less than a script that hides it.

## Amendment: CI gets a credential, and the order the gate needs

P5 shipped nine assertions that call a real model and refuse rather than skip
without a credential. CI had none, so `v2` went red the moment P5 merged. This
is the amendment WORKFLOW.md expects between a unit and the next one.

### D-A-CI-01: an Actions secret, not identity federation

- **Ambiguous:** the console offers workload identity federation, which lists GitHub Actions among its providers, and a short-lived token beats a long-lived secret on every axis that matters. It was the recommendation until it was checked.
- **Why it does not work here:** federation is detected by the Anthropic SDKs and the `ant` CLI, which read `ANTHROPIC_FEDERATION_RULE_ID` and friends and exchange a JWT. The thing that authenticates in this unit is neither — it is the Claude Code CLI running inside a container, whose own documentation says authentication is `ANTHROPIC_API_KEY` or an `apiKeyHelper` command. The driver then *refuses* a session whose reported `apiKeySource` is anything else, deliberately (D-P5-07): a credential the driver did not arrange is one it cannot account for.
- **Chosen:** `secrets.ANTHROPIC_API_KEY`, passed as an environment value to the two steps that need it.
- **What it would take to change later:** the CLI accepting a federated identity, the driver forwarding the federation variables through `ExecOptions.env`, and the `apiKeySource` check learning a second acceptable answer. Each is small; none can be assumed, and the first is not ours.
- **Use a separate key for CI, with a spend limit.** P5's own review established that the credential is readable by anything a task runs (D-P5-20). In CI that task is running model-generated commands on a machine nobody is watching, which is a worse place to hold a key than a laptop is. A key scoped to CI can be revoked without touching a developer's.
- **Reverse:** delete the two `env:` blocks. CI goes red again, honestly.

### D-A-CI-02: the driver's suite runs before the recursive test command

- **Problem:** a credential alone would not have fixed CI. From a cold checkout there is no run report, so conformance refuses all nine external assertions, and `pnpm test` aborts on that failure before it reaches the package whose suite writes the report. The command cannot repair itself — D-P5-23, met in the one place it actually bites.
- **Chosen:** an explicit step that runs the driver package's suite first, with a comment saying why it cannot be reordered away.
- **The cost, stated:** `pnpm test` then runs that suite a second time, so a CI run makes roughly eighteen model calls rather than nine. They are small calls on the cheapest model and the duplication buys the workflow staying the same four commands a contributor runs locally. A root script that owned the order would remove the waste and hide the constraint; that trade is worth making when a second package contributes external assertions, not before.
- **Reverse:** delete the step. CI fails from cold on every run.

### D-A-CI-03: the image's user is fixed, and a workspace owned by anyone else is read-only

- **Found by CI, not by the machine it was written on.** `I1.driver-executes-inside-the-sandbox` passed locally and failed on a GitHub runner with an empty workspace: the marker the task was asked to write never appeared. Nothing about the assertion was wrong — the task genuinely could not write.
- **Cause:** the image runs as its base's `node` user, uid 1000. A bind mount carries the host's ownership through unchanged, and a GitHub-hosted runner is uid 1001, so the workspace was owned by a user the container is not. The reasoning when `USER node` was chosen (D-P5-08's commit) was that 1000 "is the uid a checkout on an ordinary Linux host and on CI already belongs to". That is true of many hosts and false of the one that matters here.
- **Chosen now:** the test harness makes its temporary workspace world-writable before provisioning. That makes the fixture usable and changes nothing about what the assertion requires — the marker must still appear on the host carrying the *container's* hostname, which is the whole of the claim.
- **What is not fixed, and is the real limit:** a runtime that creates a workspace as a uid the image does not run as hands the agent a read-only workspace. The agent then fails to write for a reason nothing in the evidence explains, which is precisely the silent degrade I5 exists to prevent — it would look like a model that chose not to write. Closing it properly means the sandbox spec carrying the user a container runs as, so the provider can match the container to the workspace it was given. That is a contract change in `packages/sandbox`, not a driver change.
- **Why not run the container as root instead:** it removes the problem and removes the property the non-root user buys — a model that rewrites the CLI it is running under is currently refused by the filesystem rather than by trust.
- **Why not chmod in the driver:** the driver does not own the workspace. Something handed it a mount table; widening permissions on a caller's directory is not a driver's decision to make silently.
- **Reverse:** drop the `chmod` and the assertion fails on any host whose uid is not 1000.
- **Promoted to the ledger before P6 starts.** This entry began as prose, which is findable and not counted. `I5.workspace-is-writable-by-the-task` is now a pending registry entry owned by P6, and the I5 baseline rises from 5 to 6 to say so in the diff. The reason is D-P5-01's: a ledger only constrains the work if it is fixed before the work that would edit it, so an obligation written after P6 starts is a description of what P6 did rather than a claim on it.

## P8: Adapters (TypeScript)

### D-P8-01: The unit spec was completed before the code, and one of its decisions was reversed before any code

- **Ambiguous:** `DECOMPOSITION.md`'s P8 entry had scope, a delivery line, one out-of-scope item, and a conformance line. It had no acceptance criteria, no ledger, and no statement of where its adapters run.
- **Chosen:** the missing parts were written first and committed to `v2` (7ab5fe0), on three decisions taken with the maintainer: test, coverage, and manifest adapters parse on the host and execute nothing (D-P8-04); the L3 refusal ships as a pure function and its wiring is owed to P6 (D-P8-03); and a behavioral verdict is decided by a runner inside the sandbox.
- **The third was wrong, and was reversed before code (2db255c).** It was recommended because it needed no contract change, which is the cost of an option, not a reason to choose it. Checked against the provider afterwards: `LocalDockerProvider` passes no `--read-only` and no `--user` (`packages/sandbox/src/local/provider.ts`, `runArgsFor`), and the image is the caller's, so anything that ran in the container before the runner — the product, an install script — could replace it and forge every verdict after it. The judge moved to the host (D-P8-02), which costs two amendments (A-P8-01, A-P8-02), and HTTP became P11 because its client cannot leave the product's network.
- **Reverse:** the two commits are documentation only.

### D-P8-02: A behavioral scenario runs in the sandbox and is judged on the host

- **Ambiguous:** `BehavioralAdapter.run` returns a `CheckResult`, whose only verdict-bearing field is `exitCode`, "the check's own process". For a behavioral check the process is the product, whose exit code says nothing about whether its output was right.
- **Chosen:** the CLI adapter runs the scenario's argument vector through `provider.exec`, with its stdin, and compares the raw `ExecResult` against `expected` in the runtime's process. The outcome goes in `CheckResult.expectation` (A-P8-01); the exit code stays the product's and is evidence.
- **Why not a runner in the container:** see D-P8-01. A comparator inside the container is reachable by the code it judges, and whether it can be replaced depends on image properties the sandbox does not enforce.
- **Why not synthesise the exit code on the host:** it would record a number no process returned, in a project whose claim is evidence an auditor can trust.
- **What remains in the container:** the product and its interpreter. What a scenario observes is what running that command in that container produces, which is the behavior under test.
- **`expected.exitCode` defaults to 0.** A scenario that says nothing about exit status has not agreed to a crash, and one that tests a failure states the code it expects.
- **Reverse:** return to a runner (D-P8-01's original option) and drop A-P8-01.

### D-P8-03: The L3 refusal is a pure function; wiring it into admission is P6's

- **Ambiguous:** the entry's conformance line says "L3 is refused when a control is missing" without saying where.
- **Chosen:** `adapterAdmission(set, level)` in `packages/adapters`, refusing at L3 with every missing control named and never returning a lower level. The controls are derived from the set's slots and unioned with its own `unavailableControls()`, so a set that under-reports is still refused.
- **Why not wire it now:** the admission record would have to carry the set so a resume cannot restate it (P4's rule), which is a Vault-side change; and `SKELETON_LINE` refuses every run above L1 until P6 deletes it, so an admission assertion could not fail for the right reason before then. P6 is the unit that deletes `SKELETON_LINE`, so the wiring lands with it, as `I5.adapter-refusal-enforced-at-admission`.
- **Reverse:** wire it into `startRun` admission and pay the pending entry.

### D-P8-04: A config is parsed, never loaded

- **Ambiguous:** a framework config is code, and running it is the only way to know every value it produces.
- **Chosen:** `packages/adapters/src/static.ts` reads a config module's syntax tree. Readable: literals, arrays and objects of them, top-level `const` bindings, `as`/`satisfies`/parentheses, `defineConfig`/`defineProject` from vitest or vite with an object or a synchronous arrow returning one, and `configDefaults`/`defaultInclude`/`defaultExclude` from vitest and `defaults` from `jest-config`, resolved for the declared major. Anything else a discovery setting depends on is refused as `unresolvable-config`, naming the file and the setting.
- **Three rules keep a static read honest.** A `const` is followed only when nothing else in the module refers to it, because a second reference is a place it could be changed before the framework reads it (`config.test.include.push(...)`). An imported known value read more than once must be copied at every reference — spread — because a plain read hands out the framework's own array: `const holder = { list: configDefaults.exclude }` reads plainly and pushes to it through `holder.list`, and vitest 4.1.11 freezes `configDefaults` but not the arrays inside it (external review, codex-7). And the module's export is read only where nothing else mentions `module` or `exports`: `module.exports = { testMatch: [...] }` followed by `module.exports.testMatch = [...]` exports the second value while stating the first.
- **A config that imports repository code is refused** (external review, gemini-4). The config is parsed here and loaded for real inside the sandbox, and everything it imports is loaded with it: a side-effect import can mutate a default the config spreads, or reach into the runner, from a file that is not a config file by path and whose change is therefore reported by nothing. A bare package specifier is left alone for the reason `node_modules` is not walked (D-P8-11): what a package holds is decided by the manifests and lockfiles this adapter does report. A type-only import runs nothing and is read.
- **Why:** loading the config runs agent-written code on the host, which is the whole of `I1.adapters-execute-nothing-on-the-host`. Running it in the sandbox instead would answer from a file the agent can edit, about which files it will be judged by.
- **The cost:** a config that computes its test settings is refused. That is loud, and it is the right answer for a tree whose author is the agent being judged.
- **Reverse:** none that keeps the property. Loading configs inside the sandbox is the alternative, with the cost above.

### D-P8-05: Discovery rules are copied from each supported major's published source

- **Ambiguous:** "vitest and jest" names no versions, and the defaults differ between majors: vitest 3 excludes `dist/` and config files where vitest 4 excludes only `node_modules` and `.git`; jest 30 treats `.mts` and `.cts` as tests where jest 29 does not.
- **Chosen:** vitest 3 and 4, jest 29 and 30. Each rule was read from the published package, not from documentation: vitest 4.1.11 and 3.2.4 `dist/chunks/defaults.*.js` and `constants.*.js`; jest-config 30.2.0 `build/index.js` and 29.7.0 `build/Defaults.js`/`constants.js`; jest-util `globsToMatcher` and @jest/core `SearchSource` at both versions; jest-runtime's haste options for the crawl. A repository whose declared range selects any other major, or more than one (`*`, `>=3`, `^3 || ^4`, a tag, a URL, `workspace:`), is refused as `unsupported-version`.
- **Why the declared range and not the lockfile:** the lockfile is exact, but three formats would need parsing and the range already names the major for every range a real project writes. A range that does not name one is refused, not guessed.
- **Reverse:** add a major by adding its rules to `versions.ts`, copied from its own source.

### D-P8-06: Two departures from framework fidelity, both toward the safe side

- **Symbolic links are never followed.** vitest's glob follows them by default; here `followSymbolicLinks: false`. jest ignores them unless `haste.enableSymlinks` is set, and that setting is refused. A link in an agent-written tree can name any file the runtime's user can read.
- **Every directory a config names must resolve inside the repository, and be reached without passing through a link.** `root`, `test.dir`, `rootDir`, and `roots` outside it are refused rather than walked. Containment was first checked on the text of the path alone, which reads as inside the repository while the directory is outside it: `roots: ['<rootDir>/linked/tests']`, where `linked` is a link, enumerated and read a tree the repository does not contain, because `lstat` and `O_NOFOLLOW` protect a path's last component and say nothing about its ancestors (external review, codex-1). Every component below the repository root is now checked. The root itself is the runtime's own path and is not, since the runtime may legitimately sit under a system link.
- **A vitest `include` pattern that climbs out of the repository, or names an absolute path, is refused** (external review, gemini-1). vitest globs wherever the pattern reaches, and `include: ['../../../**/*.ts']` had the host enumerate and parse files outside the tree under analysis. The results are checked for containment as well as the patterns, because the answer is what the rest of the runtime acts on.
- **A `vitest.workspace` or `vitest.projects` file is refused under vitest 4**, where the runner itself ignores it. Over-strict by one inert file, and loud; several projects are not enumerated by this package in any case.
- **`<rootDir>` inside a jest regex is substituted escaped.** jest substitutes it raw, so a root containing a regex metacharacter matches differently there; escaped is what the pattern's author meant.
- **Reverse:** each is a one-line option in `discovery.ts`.

### D-P8-07: A suite is a test file

- **Ambiguous:** `enumerateSuites(dir): string[]` and `CheckSpec.expectedSuiteCount` do not say whether a suite is a file, a `describe` block, or a test.
- **Chosen:** a file. It is what jest's own "Test Suites" line counts, it is what both frameworks' discovery produces, and it can be counted without running anything. Case-level reduction inside a file is visible through `parseAssertions` and `compareAssertions`, which is how P7 finds it.
- **Reverse:** a finer unit would need the framework's own collection, which runs the tests.

### D-P8-08: An assertion that changed is weakened unless its new form provably checks at least as much

- **Ambiguous:** `AssertionDelta` has `weakened`, `removed`, and `toleranceWidened` and no definition of any of them.
- **Chosen:** identical assertions pair first, wherever they moved, so line shifts, reordering, and a renamed file lose nothing. What remains pairs by subject, same file first and then nearest line. A pair differing only by a wider tolerance is `toleranceWidened`. A pair is dropped only when the new form provably implies the old: an existence check turned into an equality against a value that existence check would have accepted, a message added to `toThrow`, stricter equality on the same arguments, `toHaveBeenCalled` turned into `toHaveBeenCalledWith`. Every other difference — a new negation, a negation removed, looser equality, fewer arguments, a changed expected value — is `weakened`. A `before` assertion with no pair is `removed`.
- **Two of those rules were wrong as first written, and the external review found both (codex-4).** "A negation removed" was listed as provably implying the old check. It does the opposite: `expect(x).not.toBe(5)` becoming `expect(x).toBe(5)` pins the subject to the one value the old assertion ruled out, and the suite accepted it silently, with a test asserting that it should. Under a negation every other rule runs backwards too — a looser matcher negated is a stronger claim — so a negated pair that is not identical is now reported rather than reasoned about. And "an existence check turned into an equality" ignored the value: `toBeTruthy()` becoming `toBe(0)`, or `toBeDefined()` becoming `toBe(undefined)`, was dropped as a strengthening. The implication now has to be provable from the new expected value read as a literal; anything this cannot read as a literal fails closed and is reported.
- **A tolerance is read against its negation.** `not.toBeCloseTo(v, 2)` becoming `not.toBeCloseTo(v, 3)` narrows the band the value must stay outside, so more values pass: what `toleranceWidened` reports is the change that lets more through, in either direction (codex-4).
- **Whitespace is collapsed between tokens and never inside a literal.** Reformatting a file still changes no assertion, and `toBe('a  b')` becoming `toBe('a b')` is the changed expectation it is (codex-11).
- **A subject's own type arguments are part of the assertion, and a standalone `assertType<T>(v)` is one.** `expectTypeOf<Actual>()` and `expectTypeOf<any>()` are not the same check, and deleting an `assertType` deletes one (codex-6).
- **Why a changed expected value is weakened:** the locked assertion no longer checks what it did, which is the false-done this unit's consumers exist to catch. It is reported for a reviewer rather than assumed to be a legitimate edit.
- **Why fail closed on unknown pairs:** a matcher this package has no rank for is compared conservatively; the cost is a report a reviewer dismisses, not a weakening nobody saw.
- **Reverse:** `atLeastAsStrong` in `assertions.ts`.

### D-P8-09: Changed-line coverage counts what istanbul counts, and a file the suite never loaded is uncovered

- **Chosen:** a changed line of `head` counts when a statement starts on it, istanbul's own line rule (lib-coverage `getLineCoverage`), and is covered when the report records a hit on it. Test files, config files, and declaration files are not lines the suite must cover. When no executable line changed, the answer is 1.
- **The report may add obligations and never remove one** (external review, codex-2 and gemini-2). The denominator was taken from the report wherever the report mentioned the file, which let the file being judged decide what counted: an entry with an empty statement map left nothing to cover and returned 1, and an `istanbul ignore` comment thinned the map to the same effect — the repository's own exclusions, which the paragraph below says are not honoured, honoured through the back door. The denominator is now the union of the report's statement lines and the executable lines read from the head tree on the host. What the report is still believed about is which of those lines ran, and that much cannot be established by reading it: it is owned by the run that writes it (**D-P8-14**).
- **Executable lines are read the way istanbul instruments, not the way TypeScript parses** (codex-3). A variable declaration carries no counter of its own — the counter sits on each declarator's initialiser, which may be a line below the `const` — an arrow function with an expression body has that body counted, and a class property's initialiser is counted. Read as "a TypeScript statement starts here", `export const f = () =>\n  2;` had no executable line at all on the line that changed, and an uncovered change in a file the suite never loaded scored 1.
- **The report's paths are the container's.** `sourceRoot` is required and names the directory the report's paths are under (e.g. `/workspace`). A report that names files and none under it is refused as a report on another tree.
- **The repository's own coverage exclusions are not honoured.** They are config the agent can write. A changed line in an excluded file counts as uncovered; policy thresholds, not this adapter, decide what that is worth.
- **Reverse:** `coverage.ts`.

### D-P8-10: Changed lines are computed in process, bounded

- **Chosen:** Myers's O(ND) algorithm over the span left after the common prefix and suffix, capped at 1000 edits. A larger change is a rewrite, and every line in the rewritten span counts as changed: it can only count a line that did not change, never miss one that did. Two hundred generated cases assert it agrees with a longest-common-subsequence oracle.
- **Why not `git diff`:** a repository's `.git/config` is agent-writable and can name an external diff program or a text converter that git runs.
- **Reverse:** `line-diff.ts`.

### D-P8-11: Config files are named by path pattern; files a config names by path are policy's

- **Chosen:** `config-files.ts` lists manifests and lockfiles, package-manager config (`.npmrc`, `.pnpmfile.cjs`), compiler, test-runner, coverage, lint, and format configs, `.gitignore`, `.gitattributes`, and `.env*`, at any depth. `node_modules` is not walked: what is installed is decided by the manifests and lockfiles this adapter reports, and by the install the verification run performs.
- **Not listed:** setup files, custom transformers, and test environments a config names by path. They are code that runs inside the test process and can neuter an assertion, and which of them an agent may touch is the policy's protected-path list, which P7 enforces. Noted for P7.
- **Reverse:** edit the list.

### D-P8-12: A jest pattern is matched in one pass, not handed to a backtracking engine

- **Problem found while writing discovery:** `testRegex`, `testPathIgnorePatterns`, and `modulePathIgnorePatterns` are regular expressions the runtime evaluates on the host, against paths the same agent chose. `(a+)+$` against a crafted path hangs the matcher, and the matcher is the service (I9).
- **First chosen, and wrong:** refuse a pattern whose quantified group contains a quantifier or an alternation, or which uses a backreference. That is a list of the shapes that go exponential, and the external review gave one that is not on it: `a*a*a*a*a*a*a*a*b$` has no group at all, passed the check, and costs about the seventh power of the path's length — 42 ms at 24 characters, and roughly a quarter of an hour at a hundred, on a thread the service needs (codex-12). Refusing shapes was always the wrong axis: the cost of a backtracking engine depends on the pattern in ways a syntactic check cannot enumerate.
- **Chosen:** `packages/adapters/src/pattern.ts` compiles the pattern to a state machine and runs the states together in one pass over the path — Thompson's construction with Pike's simulation — so matching costs the pattern's size times the path's length, whatever the pattern. There is no backtracking to provoke, and the shapes the old check refused are now matched safely instead. What cannot be run that way is refused: backreferences, lookahead and lookbehind, unicode property escapes, and a counted repetition that expands past 20,000 states.
- **How it is trusted:** 300 generated patterns, each matched against a dozen generated paths, must give the same answer as `RegExp` — the engine it replaces is the oracle, as the line diff's is a longest-common-subsequence (D-P8-10). A pattern that took minutes now enumerates a 200-character path at once, asserted with a bound.
- **The cost:** a lookahead in a jest config is refused where it used to be accepted. That is loud, and it is one of the two ways this can be reversed.
- **Reverse:** `assertLinearPattern` in `discovery.ts` and `pattern.ts` behind it.

### D-P8-13: Known limits, stated

- **A path handed to `parseAssertions` or `detectSkipMarkers` is checked for a link at its last component only.** Enumeration no longer descends through a link — every component of a directory a config names is checked, below the repository root (D-P8-06) — so a path that came from `enumerateSuites` has none. A caller that builds its own path through a linked directory is still outside what this package checks.
- **Nothing here is safe against a tree that changes while it is read.** Every check is a check and then an act on the path checked, and Node has no root-relative open (`openat`) to close the gap. The reads are bounded and the links are refused; a tree being rewritten underneath them is a different problem, and the verification run's own snapshot is where it belongs.
- **An assertion that never runs reads as an assertion.** Identity is the operator, the arguments, and the tolerance, so moving `expect(value).toBe(5)` into a function nothing calls, or under a local binding named `expect` that does nothing, changes no assertion and reports no delta (external review, codex-5). Reachability is not decidable from syntax, and the control that catches a test whose assertions do not execute is mutation testing: a mutant survives it. `MutationAdapter` is `null` in every set this unit builds and is named in `unavailableControls()`, so no set clears L3 while this is open. M3 owns it.
- **Filters in the pinned command are not seen.** `vitest run src/` or `jest --testPathPattern x` narrow what runs, and the adapters enumerate from config alone. The command's grammar is P6's (`I5.check-command-has-a-grammar`).
- **jest's absolute-path patterns depend on where the tree is.** A custom `testRegex` that matches a directory name above the repository matches on one host and not another; jest behaves the same way.
- **In-source tests, multi-project configs, and type-level tests are refused, not enumerated.**

### D-P8-14: A coverage report is written by the code it reports on, and that is P6's to close

- **Raised by the external review** (codex-2, and gemini-2 from the other side). The istanbul report is produced by a check run in which the repository's own tests execute, so the artifact the coverage number comes from is one the agent being judged can write.
- **What P8 closed:** the report can no longer decide which lines count (D-P8-09). It can still claim that a line ran.
- **What cannot be closed by parsing:** a hit count is a claim about an execution nobody else witnessed. Reading the report more carefully does not make it evidence.
- **Owner: P6**, the unit that runs the verification and produces the report, as `I3.coverage-report-is-not-writable-by-the-suite` in the registry, with the I3 pending baseline raised from 0 to 1 in the same change. Closing it means coverage collected where the suite cannot rewrite it, or counted from instrumentation the repository does not supply, with an assertion that a forged report does not raise the number.

### D-P8-15: The sandbox buffers a command's output without a bound, and that is P10's to close

- **Raised by the external review** (codex-9) against `dockerCli`, which P2 wrote and to which P8 added only `stdin`.
- **What is wrong:** every chunk of stdout and stderr is held in the runtime's process until the command ends. The container's memory limit does not bound the host's buffers, and the optional timeout bounds duration rather than volume, so a command that prints fast enough exhausts the host before it expires. `QUOTE_LIMIT` shortens a mismatch message after collection and protects nothing.
- **Not fixed here.** It is another unit's file and another unit's contract, and a review does not widen a unit.
- **Owner: P10**, the next unit to change the provider, as `I9.sandbox-output-is-bounded`, with the I9 pending baseline raised from 1 to 2. The bound must kill the command and refuse rather than truncate: a truncated stream compared against an expectation is a verdict about something other than what ran.

## P8 amendments to the contracts

### A-P8-01: `CheckResult` gains a required `expectation`

`expectation: ExpectationOutcome | null`, where `ExpectationOutcome` is `{ readonly held: true; readonly mismatches?: never } | { readonly held: false; readonly mismatches: readonly [ExpectationMismatch, ...ExpectationMismatch[]] }`. Reasoned in **D-P8-02**. Required rather than optional for the reason `suiteCount` is: a result that could omit it would let a gate read a product's exit code as a verdict. The two arms make a held expectation with a mismatch, and a failed one without, unrepresentable.

The `mismatches?: never` and the `readonly` tuple are what make that true of every assignment rather than of fresh literals alone: excess properties are checked only on a literal written where it is assigned, so a value assembled first and annotated afterwards carried both a verdict and evidence against it, and a tuple typed as non-empty could still be emptied with `pop` (external review, codex-15). Both violations are now compile errors in `fixtures/types/i2/check-result-declares-expectation.ts`. `compareCli` was already producing consistent outcomes; what was wrong was the claim that nothing else could.

`FailedCheck.cause` gains `'expectation'`, and the verify station's gate (`requiredShortfall`, now `packages/api/src/gate.ts` and exported) judges a result that carries an expectation by it and not by its exit code, since a scenario may expect a non-zero exit. Every check the S1 line runs records `null` and is judged as before. The reviewer's evidence facts carry `expectationHeld` beside each exit code. Asserted by `I2.check-result-declares-expectation` and `I2.unmet-expectation-fails-the-gate`.

### A-P8-02: `ExecOptions` gains `stdin`

A CLI scenario that feeds input had nowhere to put it, and the alternative, a shell wrapper in the container, puts part of the scenario where the product can reach it. `LocalDockerProvider` passes `--interactive` and writes the bytes to the `docker` process; `StubSandboxProvider` writes to its child. A command that exits without reading its input still reports its own exit code; any other failure to deliver the bytes refuses the command. Asserted in both providers' own suites.

## Tooling: external review automation

Step 5 of the unit loop stopped being something a human does. `/run-review <id>`
invokes a committed runner once per family, and the replies arrive on disk. This
is not a decomposition unit — it changes the loop rather than the runtime — so
its decisions carry a `TOOLING` id rather than a unit's. The design is
`docs/superpowers/specs/2026-09-20-review-automation-design.md`.

### D-TOOLING-01: external review becomes self-attested with artifact corroboration, which is not a witness

- **Problem:** the manual loop had one property this one gives up. The maintainer was present while the review ran, and nothing in the chain from prompt to reply was authored by the system that built the unit. Automating step 5 removes the witness: the same project that wrote the code now invokes the reviewer, receives the reply, and files it. Everything downstream inherits whatever that is worth — the triage, the pull request body, and any claim that rests on the words "externally reviewed".
- **Chosen:** replace the witness with self-attestation plus corroboration, and say so in those words rather than leaving the reader to assume the old arrangement. Each family is sent the committed prompt with the bundle inlined after it, and neither is asked to read a file. Codex runs as a headless `codex exec` under a read-only sandbox, in an empty scratch working directory and a scratch config home holding only a copy of `auth.json`, with an environment of `CODEX_HOME` alone. Gemini is a direct `generateContent` API call offering no tools, which loads no local configuration and so has no clean room to build. The runner writes a manifest beside every reply recording `invocation` — for the CLI transport the command, the argv and the environment with every value but an allowlisted few redacted; for the API transport the method, the URL, which carries no key, `modelRequested`, and the header names, never their values; `artifacts`, the committed prompt-and-bundle pair the run was built from together with the number of pairs that matched the unit; `payloadSha256` and `payloadBytes`, for the exact text sent; `ingestion`, the vendor-reported input token count against its floor; `cleanRoom`, the recursive listing of both scratch directories captured before the run, `null` for the API transport; `postRunFileCount` and `recordedApprovalPolicy`, both Codex's and both `null` for Gemini; `timedOut` and `exitCode`; start and end timestamps with the wall-clock duration; `cliVersion`, the installed Codex version, or `api:generativelanguage/v1beta` for Gemini; `modelReported`, the model the vendor reported rather than one asserted for it; `tokenUsage`; `bundleSha256`; `integrity`, the echo comparison that says whether the reply carried the bundle's markers; `replySha256`, the SHA-256 of the reply file's exact bytes; and `outcome`. Beside it goes a session record: for Codex its rollout log with message bodies stripped and only metadata records kept, for Gemini one line of response metadata — the model version, the response id, and a validated subset of the response's `usageMetadata`, being its numeric fields plus `serviceTier` and nothing else, rather than whatever object the vendor returned. The run's outcome is derived from what happened and never declared — the same discipline the runtime uses for status, where the runtime works the status out and the model is never asked for it — and a run whose outcome is not `counted` is not a review, which `triage-review` refuses rather than triages.
- **Two integrity checks, each evidence of one thing:** the echo asks the reviewer to repeat four markers from the bundle, the last a random nonce on its final line, so a reply carrying the nonce is evidence the tail was delivered. The second check does not depend on the reply: the input token count the vendor reports must reach the payload's size in bytes divided by 5. Honest runs measured 3.18 and 3.20 bytes per token, and both measured failures — a reviewer that searched the bundle instead of reading it, and one that could not open its file — fell far beneath the floor. The count is produced by Google's API service, or by the locally installed Codex process in its own rollout log, and never by the model whose text is under review, so the *model* cannot write it. That is the claim, and "cannot be faked" is not: who can is D-TOOLING-02. What it proves is a lower bound — that a payload of about this size was taken in — not that every byte arrived. It catches the navigation the nonce misses, since a search can jump straight to the last line. The nonce is evidence of delivery, not that the bundle was read; the count is evidence of ingestion, not attention. For Codex, whether `token_usage_record` holds one request's input or a running total across the turn has not been measured, and until it is the Codex count is claimed as no more than that.
- **Neither check says the reply answered the prompt rather than the bundle:** the material under review reaches the model as text, and a reviewer that follows an instruction planted in it echoes the four markers and clears the ingestion floor exactly as an honest one does. The payload's delimiters carry the bundle's own end nonce, generated fresh per bundle, so bundle content cannot forge the line that closes the block and the reviewer can always tell where the material ends. That is the half that could be closed; the rest is D-TOOLING-03, where the invariant that payloads are data and never instructions is recorded as not holding here.
- **Gemini's model is pinned, with no fallback:** a direct API call has to name its model, so `gemini-3.1-pro-preview` is fixed in the runner and recorded as `modelRequested`, beside the `modelVersion` Google reports. There is deliberately no fallback list: if the model is retired, the call fails loudly rather than quietly reaching a weaker model nobody chose as the adversary. The key is a paid one, on a billing-enabled project, because the free tier's terms let Google use submitted content and let human reviewers read it. The pinned model has no free tier, so a free key fails — after the request, bundle included, has been sent.
- **Pushed before, committed untouched after:** the runner refuses unless the commit that last touched the prompt and bundle is an ancestor of the branch's upstream. A commit that never left the machine could be rewritten together with everything else local, which would empty the pre-commitment the prompt exists to make. After the run, `run-review` commits the outputs exactly as written before `triage-review` prepends anything to a reply, and `triage-review` refuses a reply whose SHA-256 does not equal the manifest's `replySha256`.
- **One write outside the repository:** when Codex refreshes its credential during a run, the refreshed `auth.json` exists only in the scratch copy about to be deleted, so the runner writes it back to the maintainer's `~/.codex/auth.json` — only when the refreshed file holds the same account, only when the real file still holds exactly the bytes that were copied from it, and atomically, by renaming a temporary file over it. It is the only write this tooling makes outside the repository, and it is made even when the run is interrupted after sending.
- **Codex runs only on Windows:** the Codex design relies on the reviewer being unable to read the maintainer's files, and that was measured only on Windows, where the read-only sandbox blocked every file read, twice. Codex's documentation suggests its read-only sandbox permits reads anywhere on macOS and Linux. That is unmeasured, so the runner refuses the Codex family on any other platform, before anything is sent, until it is measured there.
- **Why this is worth having:** every field above is something a fabrication would have to get right, and get right consistently. Timestamps, token counts, a CLI version, a model name and an integrity echo have to agree with each other, across two vendors, on every unit, without divergence — and all of it is committed, so a later reader can hold one unit's manifests against the next's and against the session records beside them. The bundle's hash is recorded independently in the prompt file, so the input a reviewer was given can be rebuilt and checked rather than taken on trust.
- **Rotation is retired, and that belongs to this decision:** family rotation existed because reviews were rationed by human patience, and they no longer are. Both families run on every unit, which buys two independent passes and makes disagreement between them a signal of its own. There is also no repeat to record when both run every time, so the bookkeeping that rotation needed goes with it.
- **What this does not prove, stated here so it is not discovered later:** corroboration is not a witness. A determined author-system could write a plausible manifest beside a plausible review. What the artifacts make hard is doing it consistently, which is a meaningful raise in the *cost* of fabrication and not the removal of the possibility. **It is not the same as a human having watched the review happen, and no pull request body, README line, or capability claim may imply that it is.** The honest phrasing is that the review ran unattended and the artifacts corroborate it; "independently reviewed" and "externally verified" both overstate what is held.
- **The other consequence, also stated once:** this turns the bundle's egress to OpenAI and Google from a deliberate manual act into a routine automated one. The same data leaves the repository as before — the full source of every changed file — at higher frequency and with less deliberation per occurrence. Keeping `/run-review` a separate explicit command is the mitigation, and it is the whole of the mitigation: `ship-unit` chains into `review-request` and stops there, printing `/run-review <id>` rather than invoking it, because the artifacts can be deleted and the egress cannot be undone. Anything that later chains into `run-review` removes the only deliberation left in the step, and would need to answer this entry first.
- **Reverse:** retire `/run-review`, return step 5 to a chat the maintainer runs by hand, and take family rotation back out of retirement. The replies have a witness again, and cost human attention per unit — which is what rationed them to one family at a time to begin with.

### D-TOOLING-02: an adversarial vendor defeats every check in this design, and that is where the boundary is

- **Problem:** codex-1 gave the construction exactly. A Gemini response carrying `finishReason: STOP`, the four bundle markers in its text and an inflated `promptTokenCount` yields complete ingestion, a verified echo and `counted`; the Codex path is the same with an inflated `input_tokens` and `approval_policy: "never"` in the rollout log. Nothing in the runner can tell a genuine response from a same-shaped forgery, beyond TLS to a pinned endpoint.
- **Chosen:** draw the boundary where it actually is, and say so wherever a claim rests on it. The reviewing **model** is untrusted. The vendor's API service and the locally installed CLI are trusted: `usageMetadata.promptTokenCount` is produced by Google's service and the rollout log by the local Codex process, neither by the model whose text is under review. What follows is narrow and true — the model cannot write its own telemetry. What does not follow is that the telemetry cannot be faked: a service or a CLI that fabricates it defeats the ingestion floor, the recorded approval policy, the CLI version and the session record at once, and no check here holds against that. The documents now name who cannot fake the count instead of claiming it cannot be faked, and this entry is the rest of the sentence.
- **Rejected:** counting the payload's tokens locally as a cross-check. Any local tokenizer is an approximation of a proprietary one, so it could not contradict a vendor's number with authority, and an ordinary disagreement would refuse an honest run — the failure mode this design least wants. It would also add a dependency to check one number while the reply itself still arrives over the same channel from the same party.
- **What raises the cost instead:** every manifest field is something a fabrication has to get right, consistently, across two vendors and every unit, with all of it committed for a later reader to hold against the next unit's. That is D-TOOLING-01's claim and it is a cost, not a proof.
- **Reverse:** nothing to reverse; this records a limit rather than building a mechanism. What would change it is a vendor-signed receipt over the request and the response. Neither vendor offers one today.

### D-TOOLING-03: instruction-following inside the bundle cannot be prevented, and the payloads-are-data rule does not hold for the bundle

- **Problem:** raised independently by both families (codex-3, gemini-4) and confirmed in full. The bundle is inlined into the payload verbatim, with no escaping; the Gemini request places prompt and bundle in one `user` part, and Codex receives the same merged string on stdin. A reply that echoes the four markers because the bundle told it to satisfies `verifyEcho` identically to an honest one, and the ingestion floor is unaffected. The project's rule that payloads are data and never instructions does not hold here, because the material under review has to reach the model as text.
- **Chosen:** fix the half that can be fixed and record the half that cannot. The payload's delimiters now carry the bundle's own end nonce, generated fresh per bundle, so no text that already exists in the bundle can spell the line that closes the block: bundle content can no longer forge the boundary, and the reviewer can always tell where the material ends. That is the whole of what it buys. It does not stop a model obeying an instruction it finds inside the bundle, nothing available does, and no document here may describe it as if it did.
- **Rejected:** structural separation — a `systemInstruction` field, a separate message part, or a role boundary. Verification found that it narrows the surface and shifts the model's prior, but that it is trained behaviour rather than an enforced boundary: no shipped API guarantees a model will not follow instructions in text labelled as data. Adopting it and calling the problem solved would replace a known gap with a hidden one, which is worse than the gap.
- **What holds instead:** triage verifies every finding against the cited code before acting on it, by a subagent with fresh context that is given the finding as untrusted material. A planted instruction that produced a false finding has to survive that, and a finding that survives it is worth acting on whatever prompted it.
- **Reverse:** if an API ever offers an enforced boundary — not a role hint but a guarantee — take it, and rewrite this entry rather than quietly leaving it.

### D-TOOLING-04: the leak scan detects an accidental plaintext leak, not a credential-aware adversary

- **Problem:** codex-2 pointed out that `findLeakedSecrets` is a contiguous-substring test, so a credential split across an array of single characters — or base64-encoded, or spelled out — passes it untouched.
- **Chosen:** keep the scan as what it is and describe it as that: a tripwire for this tool's own bugs, run over the exact bytes about to be written, before any of them is written. It compares a value in full, by its last 20 characters, and (at 40 characters or more) by a 20-character slice from its middle. No substring scanner defeats a party that knows a credential and can emit arbitrary text, so none is claimed to.
- **Why the gap is not reachable today:** the scenario needs the party producing the reply to know the value. The Gemini key is read from the environment and sent only in the `x-goog-api-key` header — never in the request body, the prompt or the model's context — and the Codex child's environment is `CODEX_HOME` alone, so a reviewer running `printenv` finds nothing of ours. A credential-aware reviewer would be a different design, and this entry is the note it would need.
- **Rejected:** widening the scan toward default-deny, the shape `redactEnv` uses. The two questions have opposite costs: a miss in redaction *writes* a secret, while a false positive here *destroys* genuine evidence after the bundle has already been sent. Measured on Windows before the scan was narrowed, a reply quoting any path under `C:\Users` tripped APPDATA, TEMP and seven more variables and withheld a valid review. Matching a credential's leading characters was rejected on the same ground (gemini-3): `sk-proj-`, `sk-ant-a` and `eyJhbGci` are identical across every key of their type, so a reply quoting such a placeholder would withhold every file of a run whose bundle had already been sent.
- **Reverse:** if a reviewer ever legitimately holds a credential, this scan stops being a tripwire and the design needs a different control; say so here rather than tightening the substring test.

### D-TOOLING-05: a failed post-run credential read still publishes the run's evidence

- **Problem:** codex-5. When the post-run `auth.json` cannot be read or parsed, the runner returns no refreshed secrets, continues, and scans the evidence only for the credentials copied in before the run. The fail-open path is real and directly tested.
- **Chosen:** leave it open, and record the reachability analysis so a later change that closes the gap the other way finds this note waiting. The premise the finding rests on — that a refreshed token could be in the evidence — does not hold for any of the three files. The manifest is built by the runner from its own recorded facts; the session record is the rollout log filtered to metadata records; the reply is the model's text. No writer of any of them carries the contents of the credential file, and the subprocess's read-only sandbox blocked every file read when it was measured, on Windows, the only platform the Codex family may run on (D-TOOLING-01).
- **Rejected:** the remedy the finding proposes, withholding the evidence when the post-run credential cannot be read. That contradicts a rule this design already holds: a run that caused egress leaves evidence that it did. Trading a visible record of a real egress against an unreachable leak is the wrong way round.
- **Reverse:** if an evidence writer ever comes to carry credential-file content, or Codex is measured on a platform whose sandbox permits reads, this becomes reachable and the trade has to be made again — refuse, and say in the refusal that the bundle was sent.

### D-TOOLING-06: several artifact pairs for one unit resolve to the newest, and the choice is now stated rather than silent

- **Problem:** gemini-1. `findUnitArtifacts` selects by newest date with no upper bound and nothing refuses when several pairs exist for one unit, so a future-dated pair would win the sort. Reproduced by execution against a synthetic listing containing a `9999-12-31` pair.
- **Chosen:** keep newest-wins and make the selection visible. `findUnitArtifacts` returns how many pairs matched alongside the one it chose, the runner prints both at the top of every run, dry or real, and the manifest records them in `artifacts`. A silent selection becomes a stated one that a later reader can check against the repository.
- **Rejected:** refusing when several pairs match. Units are legitimately re-bundled — P5 was — and old artifacts are tracked records that must not be deleted to unblock a run, so the refusal would have to be waived by deleting evidence. A test documents newest-wins as intended behaviour; changing it would be an amendment, not a review fix.
- **Why the exploit needs more access than it saves:** the runner refuses unless both files are tracked, unmodified, and the commit that last touched them is an ancestor of the branch's pushed upstream. That requires push access to the upstream — the same access needed to change the source under review directly. This is missing defence in depth, not an escalation path.
- **Reverse:** refuse when several pairs match, and drop the count from `UnitArtifacts` and the manifest. That returns the design to one where a legitimate re-bundle cannot be reviewed until a tracked record is deleted, which is why it was not chosen.


## P6: Verification + evidence

### D-P6-01: The unit spec was completed before the code, after a contradiction in the ledger was resolved

- **Ambiguous:** `DECOMPOSITION.md`'s P6 entry had scope, a delivery line, and a conformance line. It had no out-of-scope list, no acceptance criteria, no ledger, and no statement of where the verifier lives. It also contradicted the registry: `I5.adapter-refusal-enforced-at-admission` said P6 deletes `SKELETON_LINE`, which P6 cannot do while P7's tamper-analysis line remains, and the admission assertion could not fail for the right reason while any line remains.
- **Options weighed:** (A) run P7 first, so P6 deletes `SKELETON_LINE` as written, at the cost of taking P7 from the contributor it is reserved for and delaying the unit that owns twelve pending entries; (B) P6 first, and whichever of P6 and P7 lands second inherits deletion and provenance, which lands admission wiring on P7 if P7 is second and stops it being a first issue; (C) neither deletes it — I1 does.
- **Chosen:** C, with the maintainer. `SKELETON_LINE` is the line's own stub declaration (`packages/api/src/safety.ts`, S1 finding 3), I1's deliverable is replacing every S1 stub, and I1 already accepts on `unavailableControls()` refusing L3. The comment in `safety.ts` and `I5.unsafe-declaration-survives-composition` were order-independent already; only the admission entry's reason assumed P6 went last, and that line is corrected in the ledger commit.
- **What C costs:** `I5.unsafe-declaration-survives-composition` moves to I1; `I5.adapter-refusal-enforced-at-admission` splits — P6 pays the admission wiring asserted directly, and a new pending `I5.adapter-refusal-refuses-l3-end-to-end` is owned by I1; `UnitId` gains `I1`. `safety.ts` refuses an empty declaration, so whichever of P6 and P7 removes the last line puts the composition gap in its place.
- **Reverse:** move the two entries back to P6 and make P6 depend on P7.

### D-P6-02: Base and diff are trees the runtime owns, and `git` is never spawned

- **Ambiguous:** "a fresh sandbox at base+diff" named nothing the code could point at. Every build task and every check mounted `run.repo`, the author's own working copy (`packages/api/src/line.ts`, `workspaceOnly`).
- **Chosen:** the runtime snapshots the working tree at admission into a directory it owns, gives each build task a fresh copy of base plus the diffs already accepted, diffs the task's copy in process with the adapters' `diffTrees`, and materializes base plus diff for verification. `.git` is copied into each workspace and excluded from every diff.
- **Why:** the diff becomes the only channel from a task to anything after it, so writable globs, claim comparison, and per-task isolation all read one runtime-collected fact. `git` is not used because its repository config is agent-writable (D-P8-04).
- **Reverse:** mount `run.repo` again; every entry this decision pays reopens.

### D-P6-03: A claim/evidence mismatch is recorded and does not halt the run

- **Ambiguous:** the conformance line says a mismatch "is recorded as a violation", and every entry of `RunState.violations` halts the run (`packages/core/src/station/machine.ts`, the violation refusal).
- **Chosen:** the violation is written to the Vault with `recordViolation` and not entered in `RunState.violations`. Status is unchanged by it, and review sees it beside the evidence.
- **Why:** the claim is the model's text. A halt the claim can trigger lets the model's story decide the outcome, the inverse of I2. Only the file list is compared; the narrative is never parsed.
- **What review sees:** the number of differences, beside each check's result, and not the differences themselves. A claimed path is a string the author wrote, and the review seat is given no author material (I6), so the count is the runtime's fact and the paths stay in the bundle.
- **Reverse:** commit the ref to `RunState.violations`.

### D-P6-04: The model credential moves to a new unit, P12

- **Ambiguous:** `I4.model-credential-not-readable-by-the-task` was owned by P6, and its own reason says it spans the sandbox, the P10 proxy, and the driver and is not a driver change.
- **Chosen:** a new unit, P12, depending on P5 and P10, owns it. The shape is the one P10 and P11 were split out for: a change to the sandbox's network posture does not ride in a verification pull request.
- **Reverse:** re-own the entry to P6 and delete P12.

### D-P6-05: Unforgeable coverage moves to M3

- **Ambiguous:** `I3.coverage-report-is-not-writable-by-the-suite` asks P6 for coverage the suite cannot forge.
- **Chosen:** re-owned to M3, beside mutation testing. The suite and the coverage writer share a process, so no location for the report decides whether its hit counts are true; mutation testing is the control that does not trust a hit count. P6 claims nothing about coverage beyond what P8 recorded.
- **Reverse:** re-own to P6 with a named mechanism that survives in-process forgery.

### D-P6-06: With the task off `run.repo`, the locks are held to the task's diff and to the verified tree

- **Surfaced by D-P6-02:** the Vault verifies locks against its artifact root, which is `run.repo`. Once a task writes a runtime-owned copy, an agent that rewrites a locked test changes its copy and never `run.repo`, so `verifyLocks` passes and I3 would have regressed with every existing assertion still green — they model the tamper by writing `run.repo` directly.
- **Chosen:** a locked path in the task's own diff is a `lock-tamper` violation with `phase: 'diff'`, found before any check runs; and every admitted artifact is hashed in the verified tree before the checks and after them (`phase: 'tree'`, `'after-checks'`). The Vault's own check still runs at every point it ran before. Asserted by `I3.locked-path-in-diff-is-tamper`, whose rewrite lands in the copy and not in `run.repo`, and which says so.
- **Reverse:** drop the two checks; `I3.locked-path-in-diff-is-tamper` then fails.

### D-P6-07: A driver result outside the contract stops the run rather than spending a retry

- **Ambiguous:** the spec says a result carrying another key is "refused before it is recorded" without saying what the refusal is. `StationRefusal` has no arm for it, and adding one is a contract change to a protected file for a case one call site produces.
- **Chosen:** `taskResultProblems` checks the exact key set of the result, its claim, its model, and its usage, and the line throws naming every problem, before `recordTaskResult`. The run stops loudly, which is how `readResult` already treats a recorded result that does not hold what the line reads.
- **Why not a retry:** `spendRetry` records no reason, so a driver that always adds `status` would park the task with the cause lost, which reads as flakiness rather than a contract breach.
- **Reverse:** add a `StationRefusal` arm and return it here.
- **At review too:** the check first ran only where build's result arrives. The line receives a result at review as well, and it now applies the same check there, before `recordTaskResult`, and stops the same way (external review, codex-6). `I2.task-result-key-set-enforced` runs both seats. The other half of codex-6, that an author's model family is the one its result reports, is the limit already recorded under P4: whether a driver's identity is true is P5's to prove, and I1 replaces the stub driver the line still runs.

### D-P6-08: The review seat's view is its grants, which is narrower than the spec line said

- **Ambiguous:** the P6 entry said the seat is provisioned over "base plus the diff under review, minus every admitted artifact its contract does not grant". The review contract (`packages/core/src/station/contracts.ts`) grants `locked-spec`, `acceptance-tests`, `diff`, and `evidence-bundle`, and not `base-repo-readonly`, so base files the diff did not touch are not a grant.
- **Chosen:** the view holds the locked spec, the acceptance tests, and every path the accepted cumulative diff carries, copied from the verified tree, and nothing else. The task graph, the manifest, `.git`, and every unchanged base file are absent. The spec line is corrected to match in this pull request.
- **Reverse:** grant `base-repo-readonly` to the review contract, and build the view from base as well.

### D-P6-09: A tree is built beside its path and moved into place

- **Found by `I4.task-capabilities-do-not-outlive-the-task`:** a task that changed nothing has the cumulative diff of the task before it, and so the same content-addressed tree, which is also where its bytes are read from. Building in place deleted the source first.
- **Chosen:** `materialize` builds into `<tree>.building` and renames it over the target only when it is whole. A unit test rebuilds a tree from itself.
- **Reverse:** none wanted; the in-place build is wrong whenever source and target coincide.

### D-P6-10: The workspace store runs containers as the runtime's own user

- **Ambiguous:** `SandboxSpec.user` needs a value from the line, and the line does not choose an image before I1.
- **Chosen:** the `WorkspaceStore` names the user, because it makes the copies and knows who can write them. On a host with uids it is the runtime's own, and naming another is refused: making a tree writable by a different uid takes root or a world-write bit. On a host without uids it must be given.
- **Consequence for I1:** the Claude Code image runs its CLI as `node` (1000) with its home owned by that user. A line on a host whose runtime is another uid provisions that image as the runtime's uid, and the CLI's home is then not its own. Wiring the real driver into the line is I1's, and this is the first thing it meets there.
- **Reverse:** carry the user on the driver's capabilities, and have the store make its copies writable by it.

### D-P6-11: Known limits, stated

- **Independent tasks are not merged.** Diffs are cumulative and tasks run one at a time, so a task started before another passed does not see that task's change, and its own change is laid over it when it passes. Two tasks editing one file keep the later. A merge is `integrate`'s, which is I1's.
- **Every task and every verification copies the whole tree**, dependencies included, as the entry's own known limit says. A tree digest at admission and on resume hashes it all.
- **The stub sandbox enforces none of this.** It runs on the host in the copy's directory, mounts nothing, and so cannot keep a check from writing its read-only tree or a task from reaching the store; it says so in its declaration. The per-task process boundary is asserted on real containers only.
- **The resume check compares the base's digest with the admission record**, which catches a store that lost or swapped the base. It does not protect a base the runtime's own user rewrites between runs; nothing mounts the base, so nothing a task runs can.

The entries below come from the external review, triaged in `docs/reviews/2026-09-22-P6-verification-evidence-triage.md`. Codex raised eight findings, and all of them held. Gemini raised none.

### D-P6-12: A path beneath a link is not in the tree

- **Found:** `composeDiff` looked a diff path up in base by joining it to base's root, and `lstat` resolves every component of a path except its last. A repository link `p` pointing outside the repository made `p/x` read as a base entry. In two tasks, one replacing the link with a directory and one restoring it, the runtime's host process deleted the outside file while materializing the second task's tree, before any check ran (external review, codex-1; reproduced in a Linux container).
- **Chosen:** every tree operation in `workspace.ts` treats a path with a linked parent as absent when it looks the path up, and refuses it when it acts on the path. That covers the base lookup `composeDiff` and `hashAt` share, each removal, write, and source read in `apply`, and both sides of `copyOnly`. Each check is made at the moment its operation runs, because an earlier entry in the same diff can put a link where a later entry's parent is. `walkTree` never follows a link, so no diff the runtime collects has an entry beneath one. The refusal is the backstop, not a path an honest diff takes.
- **Asserted by:** `packages/api/test/verification.test.ts`. The composition and the view run on every host, using a junction on Windows. The materialization refusal runs where links can be created, which is Linux CI.

### D-P6-13: Each check runs in a sandbox of its own, bounded by its own timeout

- **Found:** every check ran in the one sandbox `verify` provisioned. The workspace mount was read-only, but the rest of the container was not, so an earlier check could change the container a later check ran in (codex-2). And `CheckSpec.timeoutMs` was never read: a check was bounded only by what was left of the sandbox's wall clock (codex-7). S1 recorded the second gap and left it to P6 and P2 (D-S1-11), and P6 had not closed it.
- **Chosen:** one fresh sandbox per check, over the same read-only tree with `deny-all` egress, whose `wallClockMs` is the check's `timeoutMs`. Admission now refuses a `timeoutMs` that is not a positive integer. A check that outruns its timeout is ended by the provider and produces no result, so it is recorded in `unstarted` with the provider's reason, which is what A-P6-02 defines that field for. No contract changes.
- **The cost:** a container start per check rather than per verification.
- **Closes:** D-S1-11's open question.

### D-P6-14: A suite check that cannot be counted fails, whether or not a count is pinned

- **Found:** the gate failed a null `suiteCount` only when `expectedSuiteCount` was pinned, so a `unit` or `acceptance` check over a tree with no test adapter, or one whose enumeration threw, passed on its exit code alone (codex-4). The unit spec's accept list says: "A tree whose suites cannot be enumerated fails the check rather than reporting `null` as a pass."
- **Chosen:** `requiredShortfall` fails a suite-kind check whose count is null, with cause `suite-count`. A check of any other kind records null by kind and is unaffected.
- **Fixtures:** the hello fixture's `node -e process.exit(0)` check, and the registry's `PASSING` and `FAILING`, were declared `unit` while running no suite. They are now `compile`, which is what they are, and `line.test.ts` asserts both sides for a `unit` check: parked over a tree with no suites, passed with a count of one over a tree with one.

### D-P6-15: The review seat is given the runtime's diff listing

- **Found:** the seat's tree holds the files the diff left, and a removal leaves none. A run that deleted an unlocked file and a run that changed nothing gave the reviewer the same tree and the same facts (codex-5).
- **Chosen:** under its `diff` grant, the seat is offered the cumulative diff as `{ path, change }` pairs read from the runtime's diff, never from the claim. The listing carries no author material.
- **Known limit:** the seat still sees a modified file only as it now is, with no patch or before-state. D-P6-08 settled that the review contract grants no base tree, and showing base contents for changed paths is a question about that contract. It belongs to the review panel (M3).

### D-P6-16: What a pinned command dispatches to is a file the task may be granted, and that is P7's to close

- **Found:** `["npm", "test"]` runs exactly as pinned, but what it runs is named in `package.json`, which is not an admitted artifact and which a task may be granted. A diff that changes the test script changes the checker, and every check still reports that it held (codex-2).
- **Why not here:** recognising a diff that changes test configuration or runner scripts is a reading of the diff, which P6's out-of-scope list gives to P7 ("tamper-style reading of the diff").
- **Registered:** `I3.check-dispatch-not-writable-by-the-task`, pending, owned by P7. The I3 baseline rises from 1 to 2. A repository that held a substituted runner at admission is the admitting human's repository, and it is outside what verification judges.

### D-P6-17: Writable globs bound what propagates, not what is written

- **Found:** a build workspace is mounted read-write whole, and the globs are enforced on the task's own diff. A task can write an ungranted path, use it, and restore it before it ends. A write under `.git` is excluded from every diff (codex-3).
- **Held:** neither kind of write propagates. None reaches verification, a later task, or the review seat, which is the property D-P6-02 and the accept list specify. What does not hold is the stronger reading, that an ungranted write is *unavailable* during the task. The I4 claim for workspace writes is therefore stated as: **an ungranted write never propagates beyond the task.**
- **Known limit, unowned:** enforcing write authority during execution takes per-path mounts, which is sandbox work that no M1 unit owns. It is recorded here rather than assigned to a unit that has not taken it on.

## P6 amendments to the contracts

### A-P6-01: `CheckSpec.command` is an argument vector

`command: readonly [string, ...string[]]`, run exactly as pinned with no shell; a check that needs one names it. A manifest whose command is a string, an empty vector, a blank program, or holds a non-string is refused at admission, naming the field, with `not-argv` or `empty`. The skeleton's whitespace split is gone. Asserted by `I5.check-command-has-a-grammar`, which also runs an argument containing a space and requires it to arrive whole, with the split form as its control.

### A-P6-02: `EvidenceBundle.unstarted`

`unstarted: readonly UnstartedCheck[]`, one `{ checkId, reason }` per check that produced no result. `CheckResult.exitCode` stays a real process's exit code. A required check here has failed the gate by `FailedCheck.cause: 'no-result'`, as before. Asserted by `I2.unstarted-check-is-in-the-evidence`.

### A-P6-03: Evidence names the trees it is about

`EvidenceBundle` gains `baseTreeSha256`, `diff: readonly DiffEntry[]` (the cumulative diff against base, each entry `{ path, change, sha256 }` with a null hash for a removal), and `diffSha256`. `AdmissionRecord` gains `baseTreeSha256` and `unavailableControls`. `baseCommit` alone did not say which tree the checks ran over, and a resume had no record of what admission found the adapter set lacked. The diff's entries are stored in the bundle; the bytes live in the runtime-owned tree the digest names.

### A-P6-04: `SandboxSpec.user`

A required `user: { uid, gid }`. `LocalDockerProvider` passes `--user uid:gid`; on a Linux host it refuses a rw workspace that user cannot write, with the new refusal layer `user`, and refuses a uid or gid that is not a whole number of zero or more. Docker Desktop maps every container user onto the host user, so there is nothing to refuse there, and the write lands. `StubSandboxProvider` ignores the user and declares it. Asserted by `I5.workspace-is-writable-by-the-task` and in `packages/sandbox`'s own suite, which require a refusal on Linux and a landed write elsewhere, and never a sandbox whose task cannot write.

Creating an entry in a directory takes both write and search permission, and the check first tested write alone, so a workspace at mode `0600` passed for its own owner, who could then create nothing in it (external review, codex-8). The rule is now `canCreateIn` in `packages/sandbox/src/local/ownership.ts`, which requires both bits from the one class the user falls in. It is unit-tested on every host, and the I5 assertion adds the `0600` case on Linux.

## P12: Credential at the egress layer

Proposed with the unit spec and approved by the maintainer before any code, each as recommended. Each entry names the option not taken, so a reversal is a choice between two stated shapes rather than a redesign.

### D-P12-01: The relay is its own container, not a second listener in the egress proxy

- **Ambiguous:** the entry says the credential moves "into" the P10 proxy, and the proxy is already the provider-owned process on the sandbox's only route out.
- **Options:** (A) a second provider-owned container, the relay, on the same internal network; (B) a second listener inside the existing proxy container.
- **Chosen: A**, with the maintainer. The proxy is `--read-only` with the comment "the proxy holds no secret", and P10's assertions rest on it being a blind tunnel that reads nothing. Putting the credential in the process that also tunnels every allowlisted connection joins the one component that must stay ignorant of traffic to the one component that must read it. A separate container keeps P10's proxy and its assertions exactly as reviewed, lets a `deny-all` sandbox have a relay with no proxy at all (D-P12-02), and costs one more container per credentialed sandbox.
- **Reverse:** move the relay's request handler into `PROXY_SOURCE` behind a second port, and give the proxy the credential environment.

### D-P12-02: A relay is independent of the egress mode

- **Ambiguous:** a build task that needs the model and no other host has no shape today: `deny-all` is `--network none`, and an `allowlist` with an empty list is refused.
- **Options:** (A) `SandboxSpec.relay` is orthogonal to `egress`; under `deny-all` a relay puts the sandbox on an internal network holding the relay alone, and `deny-all` without one is unchanged; (B) a relay is accepted only beside an `allowlist`, so a task that needs the model alone must be granted some host it does not need.
- **Chosen: A**, with the maintainer. B forces a grant nobody asked for to get a route nobody else can use, which is I4 read backwards. A keeps P10's `deny-all` assertion byte-for-byte for every sandbox without a relay, and the relay is not egress in P10's sense: the sandbox reaches one provider-owned endpoint, which reaches one fixed origin.
- **Reverse:** refuse `relay` unless `egress.mode === 'allowlist'`.

### D-P12-03: The sandbox holds a fixed placeholder, not a per-sandbox token

- **Ambiguous:** the entry allows "a placeholder, a short-lived token, or nothing". The CLI needs some value in its key variable, and the driver refuses a session whose key came from anywhere else.
- **Options:** (A) a fixed placeholder the relay ignores, the relay authenticating its client by network position — only its own sandbox's internal network reaches it; (B) a random token per sandbox, set in the container and checked by the relay.
- **Chosen: A**, with the maintainer. A token the CLI can send is a token every process in the sandbox can read, so it authenticates nothing the network position does not already: the relay is reachable only from a network one sandbox is on, verification sandboxes get no relay, and the P11 probe that will share the sandbox's network is the runtime's own. B adds a secret-shaped value, a comparison, and a way for the relay to fail, for no threat that A leaves open.
- **Reverse:** generate a token at provisioning, set it through the spec as a second variable, and refuse any request that does not carry it.

### D-P12-04: The relay forwards a granted set of path prefixes on one origin

- **Ambiguous:** the entry says the provider "authenticates the upstream request" and does not say which requests.
- **Options:** (A) the spec names one `https` origin and a non-empty list of path prefixes, and the relay refuses everything else; (B) one origin, any path.
- **Chosen: A**, with the maintainer. An API key reaches more than the messages endpoint — batches and files store data on the account and outlive the sandbox. Default deny applies to what the credential can do, not only to where it can go. The Claude Code driver's grant is set by what its CLI is observed to call with non-essential traffic off, and the relay's refusals name the path, so an under-grant is a loud, specific failure in the claim suite rather than a silent one.
- **Reverse:** drop `paths` from `RelaySpec` and forward every path to the upstream.

### D-P12-05: The driver exports its relay request; the `Driver` contract is not amended

- **Ambiguous:** something has to tell whoever provisions a sandbox which relay the driver's CLI needs. In this unit that is the driver's own test harness; in the line it will be `packages/api`, which is I1's to wire.
- **Options:** (A) `packages/drivers/claude-code` exports the relay request as a constant, and a contract method waits for a consumer that holds a driver by its contract; (B) `Driver` gains a method returning it now.
- **Chosen: A**, with the maintainer. No code in this unit would call B through the contract, so it would be an amendment with no first use — the thing WORKFLOW.md says amendments come from. It also puts a sandbox type into `core`'s driver contract, a dependency direction nothing has needed yet. I1 decides the method's shape when it wires the driver, with a second driver (M2) in view.
- **Reverse:** add the method to `packages/core/src/driver/contract.ts`, implement it on `StubDriver` and the Claude Code driver, and have the harness call it.
