# External review of P8, gemini, 2026-09-21

An adversarial pre-merge review of P8 (Adapters, TypeScript): the vitest and
jest adapters, coverage and config-change detection, the CLI behavioral
adapter judged on the host, and the two contract amendments (A-P8-01, A-P8-02),
with the CI and harness changes that landed between reviews. One of two
reviews run from the same prompt and bundle; the other is
`2026-09-21-P8-adapters-review-codex.md`. Both are triaged in
`2026-09-21-P8-adapters-triage.md`, which cites this review's findings as
`gemini-1` to `gemini-6`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`
  (`generativelanguage/v1beta`), offering no tools. `cleanRoom` is `null`
  because an API call loads no local configuration. Exit 0, not timed out,
  253.3 s. Ingestion `complete`: 129,275 prompt tokens against a floor of
  81,757. Integrity `verified`: the reply echoes every required bundle marker.
  Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `d1dde50f3a82bba5699f4881b12406f9015bc95441adf3a556ea4cd4702260d4`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** codex raised the same mechanism as gemini-2
  (codex-2: the report decides the coverage denominator) and as gemini-3
  (codex-8: `test['skip']` and other forms hide a marker). Related but not the
  same mechanism: gemini-4 and codex-7 (a config's runtime effect differs from
  its static reading, by different constructions), and gemini-1 and codex-1
  (the host reads outside the repository, through a `..` glob and through an
  ancestor link respectively). gemini-5 and gemini-6 were raised by gemini
  alone.
- **Date:** 2026-09-21 (run started 2026-09-22T02:15:10Z UTC).
- **Bundle:** `2026-09-21-P8-adapters-review-bundle.txt`, SHA-256
  `193da6d987db4d6f2ecb888114ef99a825013064419bdcf1a1b981328f218468` (the
  manifest's `bundleSha256`), base `6d32e07` (`reviewed/P5`), head `bf8cb44`
  (P8: Adapters (TypeScript)). It held the full contents of 53 of the 56 files
  changed in that range: all source, tests, changesets, the CI workflow, and
  the lockfile. It excluded `docs/decisions.md`, `docs/plan/DECOMPOSITION.md`,
  and `docs/plan/F1-spine.md`, as the prompt states ("no design documents").
  Prompt: `2026-09-21-P8-adapters-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated that it performed no
  external lookups. It said nothing about prior context, although the prompt
  asked for both. This is a self-report and cannot be independently verified.
  The API call offered no tools.
- **Coverage, and any gap:** the reply is not organised by the prompt's seven
  items. Its six findings are typed "concrete bypass" (1–4, which address
  items 1 and 5), "escape hatch" (5, item 4), and "fail open" (6, item 3).
  **Items 2, 6, and 7 came back empty:** it did not say whether any check is
  tautological, it named no mechanism as sound, and it did not address whether
  the framing was right. The second area of the question also came back empty:
  nothing on the gate reading `expectation`, the CLI judge, the adapter-set L3
  refusal, the CI workflow change, or the harness permission change. That
  silence is not a finding that those areas are sound. It did not use the
  requested labels (factually wrong / unclear / tradeoff).
- **Citations:** line numbers are positions within the bundle's file sections
  and are treated as hints. Each finding was located by the construct it
  describes. Several of gemini's numbers point to a neighbouring construct:
  discovery.ts:153 for `vitestSuites` (at 187), markers.ts:65 for
  `isDeclarer` (at 80), and static.ts:56 for `scopeOf`'s import handling
  (at 72).

---

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