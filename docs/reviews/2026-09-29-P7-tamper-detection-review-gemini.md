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