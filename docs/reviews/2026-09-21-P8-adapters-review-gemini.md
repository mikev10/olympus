BASE: reviewed/P5
HEAD: bf8cb44
pnpm-lock.yaml
c24420c6aa333611f66d379c697d5f37

I have reviewed the code with the provided context. I performed no external lookups. 

Here are the findings regarding enforcement gaps, tautologies, and bypasses, ordered by severity.

**1. `vitestSuites` glob resolution allows arbitrary file read outside the repository**
packages/adapters/src/discovery.ts:153 — concrete bypass — high
The `vitestSuites` adapter passes the untrusted `discovery.include` array directly to `tinyglobby` without restricting the traversal to the repository. An agent can configure `vitest.config.ts` with `include: ['../../../**/*.ts']`. The `glob` function will traverse the host filesystem, escaping the repository, and return paths to arbitrary host files. The host will then open and parse these files via `TestFrameworkAdapter.parseAssertions`, leaking file existence and potentially exposing file contents through syntax error diagnostics.
**Resolution:** Apply the `inside` validation to every file path returned by `glob` before accepting it, or switch to using `walkTree` bounded to the repository root, identically to how Jest discovery isolates its search.

**2. Coverage adapter trusts forged or ignored lines in the untrusted coverage report**
packages/adapters/src/coverage.ts:147 — concrete bypass — high
When mapping covered lines, the adapter determines the executable denominator using `hits === undefined ? executableLines(after, path) : new Set(hits.keys())`. The `coverage-final.json` report is generated inside the untrusted sandbox, meaning the agent can fully manipulate it. An agent can add `/* istanbul ignore next */` before a block (e.g., `if (false) { expect(...) }`), or use a `posttest` script to forge the JSON. Istanbul will naturally omit ignored lines from `statementMap`, meaning `hits.keys()` will lack them. The adapter subsequently skips these lines (`if (!executable.has(line)) continue`), effectively ignoring the untested code and calculating 100% coverage.
**Resolution:** Always execute `executableLines(after, path)` on the host to compute the immutable denominator of changed executable lines. Use the coverage report *only* for the numerator (`hits.get(line) > 0`).

**3. Test skip markers evaded via ParenthesizedExpression or ElementAccessExpression**
packages/adapters/src/markers.ts:65 — concrete bypass — high
The `isDeclarer` function traverses property accesses and calls but strictly expects `ts.isIdentifier(root)` at the bottom of the AST chain. It fails to unwrap `ParenthesizedExpression` or `ElementAccessExpression`. An agent can wrap the test declarer in parentheses (e.g., `(test).skip('...', () => { ... })`) or use bracket notation (e.g., `test['skip'](...)`). Vitest/Jest will validly execute these and skip the test, but the adapter will silently fail to recognize the skip marker. The assertions inside remain statically visible, protecting them from deletion detection, while the test never runs.
**Resolution:** Use the `unwrap` helper (from `static.ts`) during the `isDeclarer` traversal to strip parentheses and type assertions. Additionally, add support or strict refusals for `ts.isElementAccessExpression` in the declarer chain.

**4. Static configuration parsing bypassed by runtime side-effect imports**
packages/adapters/src/static.ts:56 — concrete bypass — medium
To uphold I1, the adapter parses framework configurations statically and successfully enforces that imported objects like `configDefaults` are not mutated *locally* in the AST. However, an agent can inject a side-effect import (e.g., `import './mutator.js'`) into the config. The adapter statically ignores the import, but when Vitest loads the config inside the sandbox, Node executes `./mutator.js`. This script can alter the runtime environment (e.g., mutating `configDefaults`, `Array.prototype`, or intercepting global hooks) to skip real tests and run dummy ones, fulfilling `expectedSuiteCount` while completely diverging from the adapter's static assumptions.
**Resolution:** Refuse any import declarations in configuration files that do not originate from a strict allowlist of known framework modules, and outright refuse side-effect imports (imports without a named or default import clause). 

**5. Type weakening (`any`) is invisible to the AST-based assertion comparator**
packages/adapters/src/assertions.ts:87 — escape hatch — low
The assertion comparator pairs and compares the literal AST text of arguments. If an agent changes the type of a tested variable from a strict type to `any` on a preceding line, or introduces an `as any` cast upstream in the data flow, the `expect(result).toBe(...)` AST remains textually identical. The test loses its type-safety, but the adapter detects no weakened assertion.
**Resolution:** This is a known tradeoff of AST-only parsing. Completely closing this escape hatch requires utilizing the TypeScript Compiler API (`TypeChecker`) to evaluate the resolved types of assertion subjects.

**6. Out-of-memory crash via file growth during stream read**
packages/adapters/src/files.ts:56 — fail open — low
In `readRegularFile`, the adapter validates `stats.size > capBytes`, but then uses `handle.readFile()` which pulls the entire file into a buffer. If an agent intentionally causes a file to grow massively between the `stat` check and the read, `readFile` will attempt to buffer the new size in memory before the `bytes.length > capBytes` check can catch it, potentially crashing the runtime host process.
**Resolution:** Use `createReadStream` with a chunk counter (similarly to how it was implemented in `hashRegularFile`) and abort the stream immediately if the cap is exceeded.