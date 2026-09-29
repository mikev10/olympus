BASE: reviewed/P9  
HEAD: 6b1c8c3  
packages/vault/test/stub.test.ts  
f845963a3fc511bfcf8d0f92c6ba15ac

I have no prior project context and performed no external lookups. I reviewed the inline bundle. A local file-listing attempt was blocked; I did not execute tests or independently verify the bundle’s SHA-256. Citations refer to source-file lines within the bundle.

1. **packages/api/src/tamper.ts:88 — factually wrong — high — Changes to test dependencies can silently remove the protection of unchanged tests.**

   The selection excludes files that remain tests and have unchanged bytes. It does not inspect changes to their dependencies.

   For example, an existing test calls `checkResult(actual)` imported from `src/test-support.ts`. Change that helper from validating and throwing to returning immediately. Leave the test untouched. The test passes, but no assertions, cases, or markers from it enter the comparison. Provided the helper is not a protected/configuration path, the report is empty.

   This also permits TypeScript-specific weakening: leave `assertType<Expected>(value)` unchanged while changing an imported `Expected` alias to `any`, or replace a validating helper with a predicate that unconditionally returns `true`. Changing a declaration or module augmentation can alter the meaning of an unchanged type assertion without entering this analysis.

   **Resolution:** Protect or escalate changes to the tests’ dependency closure, including helpers, fixtures, and type declarations. A syntax comparison of selected test files cannot establish preservation of their meaning. **Confidence: high.**

2. **packages/api/src/tamper.ts:113 — factually wrong — high — Runtime context skips can be aliased past detection.**

   Starting with a Vitest test whose callback receives `ctx`, insert:

   ```ts
   const omit = ctx.skip;
   omit();
   ```

   Keep the original assertions below it. `contextSkips` recognizes direct `ctx.skip()` calls and a `skip` binding destructured in the callback parameter. It does not follow this local assignment. `assertNoEscape` tracks declarers such as `test`, not the context’s skip function.

   Consequently, the test becomes skipped while its case title and assertion syntax remain present, and the marker extractor returns no added skip. Other tests can keep the runner successful.

   **Resolution:** Track context and skip-function aliases, and refuse unresolved escapes or computed accesses involving the test context. Add this construction to an end-to-end fixture using an actual runner. **Confidence: high for the marker-extraction bypass; the unchanged assertion comparison is inferred from its demonstrated contract because `assertions.ts` is absent.**

3. **packages/api/src/tamper.ts:121 — factually wrong — high — Parameterized cases can shrink without losing an enumerated case.**

   Change:

   ```ts
   test.each([1, 2, 3])('handles %i', n => {
     expect(validate(n)).toBe(true);
   });
   ```

   to the same declaration with `[1]`.

   `extractCases` emits the title template once, independent of the table. The callback’s assertion remains identical. No skip marker is introduced, and the number of test files stays constant. Inputs `2` and `3` disappear from execution without a case-deletion finding.

   The comment saying assertion comparison sees a shrinking table is not supported by the interface: `Assertion` carries the assertion’s operator, arguments, and tolerance, not the enclosing parameter table.

   **Resolution:** Compare parameterization inputs and multiplicity; flag changes whose execution set cannot be established statically. Include imported table data in the protected dependency closure. **Confidence: high; verify the complete assertion extractor to exclude an undocumented special treatment of parameter tables.**

4. **packages/api/src/tamper.ts:114 — factually wrong — high — Global marker pairing loses the scope of `.only`.**

   Construct two changed test files, each containing a suite named `selected`:

   - Before: file A has `describe.only('selected', ...)`; file B has `describe('selected', ...)` plus a separate test that judges the implementation.
   - After: remove `.only` from A and add it to B’s `selected` suite.

   Keep every case and assertion unchanged. Make the newly enabled tests in A pass.

   The marker pool contains `describe.only: selected` on both sides, so the new focus in B consumes the old marker from A. The case titles and assertions also pair. Yet B’s separate judging test now stops running.

   **Resolution:** Match markers together with their affected cases and execution scope. Moving a focus marker is harmless only when the set it excludes remains equivalent. **Confidence: high.**

5. **packages/api/src/tamper.ts:144 — factually wrong — high — Pinning command arguments does not protect a writable command implementation.**

   Suppose the admitted command is:

   ```text
   node scripts/check.mjs
   ```

   and that script runs the test runner. Replace its contents with `process.exit(0)`, leaving the manifest, package configuration, and test files unchanged.

   The line executes the same pinned argument vector, but the command now does nothing. Tamper analysis has no command input or dependency graph: it examines discovered tests, recognized configuration changes, snapshots, and policy-protected paths. An ordinary writable script outside those categories receives no dispatch protection.

   **Resolution:** Bind pinned checks to protected executable inputs and their dependencies, or execute a runtime-owned runner whose dispatch cannot be changed by repository files. **Confidence: high for the architectural gap; the exact filename construction requires checking the omitted configuration classifier’s filename rules.**

6. **packages/api/src/tamper.ts:146 — factually wrong — high — An absent test adapter is explicitly converted into clean test findings.**

   When `set.test === null`, analysis returns three empty finding arrays. The included test deliberately demonstrates deleting a test in an unsupported tree without reporting its deletion.

   Admission does not close this universally: `admissionRefusal` permits unavailable controls below L3. Thus a missing analysis capability and a successfully analyzed clean change have the same representation in the evidence report at those levels.

   This directly conflicts with the stated requirement that absent capability or unsupported input refuse, rather than silently degrade. It does not require the task to control the runtime-selected adapter.

   **Resolution:** Refuse verification when required tamper analysis is unavailable, or introduce an explicit incomplete-analysis result that cannot be accepted as clean. **Confidence: high.**

7. **packages/conformance/src/registry/tamper.ts:23 — unclear — medium — The integration fixtures use checks that pass regardless of repository behavior.**

   `PASSING` runs `node -e process.exit(0)`. `runVitest` installs that check even for the assertion-weakening, skip, and dispatch fixtures. No Vitest command runs.

   These fixtures contain meaningful assertions about report production; they are not wholly tautological. Their **pinned check**, however, is tautological. In particular, the dispatch fixture’s command never dispatches through the package script being changed. It proves that a package edit is reported, not that the mechanism protects execution of a pinned test command.

   **Resolution:** Keep these fixtures for report plumbing, and add real-runner controls where the original test fails against a broken implementation and the proposed bypass makes it pass or skip. **Confidence: high.**

The mechanisms I assess as sound within the supplied source are narrower than the overall guarantee:

- Analysis uses runtime-owned trees and runtime-collected differences; the driver’s claim does not supply the tamper report.
- Building the adapter from the pre-task tree prevents that task’s package edit from directly selecting its own analyzer.
- Parse errors and analysis exceptions propagate rather than becoming empty findings. The shown HTTP path records a halt.
- Plain case moves and assertion moves are handled with multiplicity, avoiding straightforward move-as-deletion false positives.
- Recorded findings flow through evidence to the review context and integrate transition. The transition raises approval requirements and preserves a blocked gate.

I found no demonstrated attack in which a repository-side cast, `unknown`, declaration merging, or module augmentation directly changes the runtime’s trusted objects. Those techniques matter here through the semantics of writable tests and their dependencies, as in finding 1.

The adversarial framing is appropriate. The implementation supports a narrower claim: it detects selected syntactic changes. It does not establish that unchanged-looking assertions still execute or still judge the same behavior. A sound acceptance question would be: **“Has any input capable of changing the execution or meaning of a judging check changed without being refused or explicitly escalated?”** That requires protecting execution dependencies as well as comparing assertion syntax.