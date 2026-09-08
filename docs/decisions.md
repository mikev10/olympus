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
- **`CapabilityScope.tools` has no relation to `DriverCapabilities`** (owner: P3, policy engine). `tools: string[]` is a free list, so a policy can grant a tool no driver exposes and nothing notices. Validation against what the selected driver declares belongs to P3.
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
