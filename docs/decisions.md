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
