# External review of P7, gemini, 2026-09-29

An adversarial pre-merge review of P7 (tamper detection): `analyzeTamper` over a
task's base and verified trees, the adapters' case enumeration, skip-marker and
assertion extraction, the protected-path and dispatch checks, the report's path
into the Vault, the evidence bundle, the review seat, and the `integrate`
escalation, and the conformance entries that claim each of these. Triaged in
`2026-09-29-P7-tamper-detection-triage.md`, which cites this review's findings
as `gemini-1` to `gemini-6`, numbered in the order the reply gives them.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no
  tools. `cleanRoom` is `null` because an API call loads no local
  configuration. Exit 0, not timed out, 241.4 s. Ingestion `complete`: 95,749
  prompt tokens against a floor of 67,777. Integrity `verified`: the reply
  echoes every required bundle marker. Outcome `counted`. Reply SHA-256 as the
  runner wrote it:
  `0964f9567bc5d641fbae788497e9495b2254de399854a6a680fedb72d2e81d94`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** codex also raised gemini-3 (codex-2: context-skip
  aliasing), gemini-4 (codex-1 for test utilities, codex-5 for dispatched
  scripts), and gemini-6 (codex-6: a missing test adapter returns empty
  findings). Gemini alone raised gemini-1 (shadowed test declarers), gemini-2
  (tagged-template `each`), and gemini-5 (assertions in unreachable code).
- **Date:** 2026-09-29
- **Bundle:** `2026-09-29-P7-tamper-detection-review-bundle.txt`, SHA-256
  `60bf727f9a108bc7733d7fbd2969528bf1367adc39183390678be8724bc236f5`, base
  `3528016` (`reviewed/P9`), head `6b1c8c3` (the P7 commit, "P7: Tamper
  detection"). The full contents of 26 of the 28 files changed in that range;
  `docs/decisions.md` and `docs/plan/DECOMPOSITION.md` were excluded, as the
  prompt withholds design documents. Unchanged files were not in it. Prompt:
  `2026-09-29-P7-tamper-detection-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context
  about the project and made no external lookups. A self-report, not
  independently verifiable.
- **Coverage, and any gap:** the reply is a list of six findings with no
  per-item structure. Items 1, 3, and 5 are answered by them (1, 3, 4, 5 for
  item 1; 2 and 6 for item 3; the dispatched-script half of 4 for item 5).
  Items 2 (tautological checks), 4 (language escape hatches), 6 (mechanisms
  assessed as sound), and 7 (whether the framing is right) came back empty.
  That silence is recorded, not read as endorsement.
- **Citations:** line numbers refer to positions within the bundle's copy of
  each file, not the repository, and are treated as hints to the construct.

BASE: reviewed/P9
HEAD: 6b1c8c3
packages/vault/test/stub.test.ts
f845963a3fc511bfcf8d0f92c6ba15ac

I had no prior context about this project and performed no external lookups.

### Findings

packages/adapters/src/markers.ts:67 — factually wrong — High — AST Block Scope Shadowing
`declarersIn` builds a single flat map of test declarers and completely ignores lexical scoping. An agent can shadow `test` or `describe` locally within a block using a dummy function (e.g., `{ const test = (name, fn) => {}; test('judging', () => { expect(x).toBe(5); }) }`). The AST parser treats this as a valid test and extracts the assertions (preventing deletion or removal findings), but at runtime it executes the no-op dummy function. The test is silently bypassed with an empty tamper report.
**Resolution**: Track lexical scope during AST traversal, or refuse any local variable declarations that shadow known test declarers.

packages/adapters/src/markers.ts:92 — factually wrong — High — Tagged Template Literals Ignored
`chainOf` returns `undefined` for `TaggedTemplateExpression` nodes. In Jest and Vitest, tests defined with tagged templates (e.g., `test.each\`...\`('name', () => {})`) are entirely skipped by `extractCases` and `extractSkipMarkers`. An input the analysis cannot read silently produces no findings. An agent can delete, weaken, or skip these tests without triggering any tamper report because the analysis treats them as non-existent.
**Resolution**: Handle `ts.isTaggedTemplateExpression` in `chainOf` by returning the chain of its tag expression, or explicitly refuse tagged templates to fail closed.

packages/adapters/src/markers.ts:125 — factually wrong — High — Context Skip Aliasing and Computed Properties
`contextSkips` attempts to find `ctx.skip()` but rigidly checks for the exact parameter name (`bound`) and silently ignores computed property access. An agent can alias the context (`const c = ctx; c.skip();`) or use computed properties (`ctx['sk' + 'ip']()`) to skip tests at runtime. Because `unwrap` does not follow variable assignments and `literalKey` returning `undefined` does not trigger a refusal in this function, the test is silently skipped without generating a skip marker finding.
**Resolution**: In `contextSkips`, refuse if `literalKey` returns `undefined` on a context object property access. Refuse local aliases of the context parameter, or track data flow for the context object.

packages/api/src/tamper.ts:67 — a tradeoff I would have made differently — High — Test Utilities and Dispatched Scripts Excluded
`analyzeTamper` extracts cases and assertions exclusively from test files identified by `enumerateSuites` (e.g., `*.test.ts`) and tracks framework config files. If an agent modifies a shared test utility (e.g., `setup.ts`, custom matchers) to silently skip tests or pass assertions, or alters a repository shell script that a pinned command invokes (e.g., `['sh', 'scripts/run.sh']`), these changes fall outside the tracked files. Test execution is altered without triggering protected-path or test tampering findings.
**Resolution**: Extend tamper analysis to track any file in the dependency graph of the test suites, or require that all auxiliary test scripts and utility files be explicitly listed in the policy's protected paths.

packages/adapters/src/framework.ts:28 — a tradeoff I would have made differently — High — Dead Code Assertion Extraction
`extractAssertions` identifies assertions via static AST traversal but ignores code reachability. An agent can wrap `expect` calls in an `if (false) {}` block or inside an uncalled nested function. The AST parser still extracts the assertions (meaning no removals or weakenings are reported), but they are never executed at runtime, completely bypassing the test criteria.
**Resolution**: While full static analysis of reachability is complex, refusing assertions found inside obvious dead branches (e.g., `if (false)`) or uncalled function declarations within a test body would mitigate trivial bypasses. (I recognize M3 mutation testing may be the intended ultimate backstop for this).

packages/api/src/tamper.ts:128 — factually wrong — Medium — Failure to Fail Closed on Missing Test Adapter
The invariants require that an unsupported stack is a refusal and never a silent degrade. However, if `set.test === null` (meaning no test framework adapter is present in the repository), `analyzeTamper` silently returns empty test finding arrays instead of throwing an `AdapterRefusal`. While admission refuses L3, this allows L1 and L2 runs to proceed with zero test tampering protection without halting or warning.
**Resolution**: Throw an `AdapterRefusal` if `set.test === null`, explicitly failing closed when asked to analyze tests in a tree where they cannot be parsed.