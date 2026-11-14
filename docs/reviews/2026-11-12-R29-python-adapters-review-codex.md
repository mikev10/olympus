BASE: reviewed/R34  
HEAD: 97c8267  
packages/vault/test/local.test.ts  
3576a2efd1b62365418ffab6757b92ee

I had no prior project context and performed no external lookups. This review uses the complete inline bundle. Local file access was blocked, so I did not run reproductions or verify the supplied SHA-256. Findings below are source-based; confidence is high unless stated otherwise.

1. **packages/adapters/src/python/framework.ts:34 — factually wrong — high — The repository can replace the module executed as pytest.**

   The command is `.venv/bin/python -m pytest`, without import-path isolation. A repository-root `pytest.py` can therefore take precedence over the installed package:

   ```python
   import os
   os._exit(0)
   ```

   Adding this file leaves the real tests, assertions, and their static suite count unchanged. `missingRunner()` still finds the genuine installed pytest and approves execution. No dependency-tree write or protected configuration change is needed. A sourceless root `pytest.pyc` is another route outside the `__pycache__` exclusion.

   **Resolve:** Bootstrap the judge from a runtime-controlled import environment, authenticate the modules actually loaded, and prevent repository paths from supplying runner modules. Test both source and sourceless module shadowing. Merely checking that installed pytest exists does not establish which module executes.

2. **packages/adapters/src/python/discovery.ts:32 and :55 — factually wrong — high — Accepted conftest hooks can suppress every test’s execution.**

   `COLLECTION_HOOK` does not reject `pytest_runtest_protocol`. A base repository can contain:

   ```python
   def pytest_runtest_protocol(item, nextitem):
       from judge_switch import bypass
       if bypass:
           return True
       return None
   ```

   Initially, `judge_switch.py` defines `bypass = False`; the real tests execute and can fail. The change sets it to `True`. The hook then handles every item without running its test protocol. Collection still finds the same items, and pytest can exit successfully. The change touches neither conftest nor the test files.

   The filter also overlooks imported hooks and definitions nested inside top-level conditionals. This is not merely unsupported plugin functionality: the adapter accepts these configurations instead of refusing them.

   **Resolve:** Refuse execution-affecting hooks and unresolved hook bindings, and protect their transitive inputs. For the stated adversarial guarantee, repository code must not control the judge’s execution protocol in the same interpreter.

3. **packages/adapters/src/python/tests.ts:428 — factually wrong — high — Unresolved parametrization silently hides deleted cases and implicit skips.**

   Start with:

   ```python
   @pytest.mark.parametrize("x", list(range(2)))
   def test_value(x):
       assert subject(x)
   ```

   Change `range(2)` to `range(0)`. Both tables are unresolved by `parametrizeIds()`, so both become the same bare case name, `test_value`. Assertions remain identical, and no explicit skip marker was added.

   Pytest treats the empty parameter set as a skipped parameterized test under its default configuration. Thus cases disappear and the remaining synthetic case skips, while the adapter reports neither deletion nor added skip. Pytest can exit zero.

   **Resolve:** Refuse unresolved parameter tables rather than collapsing them to one case. Explicitly handle empty sets and the configuration governing their behavior.

4. **packages/adapters/src/python/tests.ts:417 — factually wrong — high — Test-object assignments can hide tests without changing the static case list.**

   Given a failing `test_bad` and another passing test, append:

   ```python
   test_bad.__test__ = False
   ```

   Pytest no longer collects `test_bad`. The adapter still enumerates its function definition, still extracts its assertion, and finds no skip marker. Consequently, the remaining test can pass while the hidden test goes unreported.

   Likewise, assigning `test_bad = lambda: None` replaces the callable that executes while leaving the original definition and assertion visible to this reader.

   **Resolve:** Model or reject assignments that alter collected bindings and their collection attributes. Apply the same rule to module-level `__test__`, unresolved decorators, and other constructs that replace test objects.

5. **packages/adapters/src/python/tests.ts:70 and :130; packages/adapters/src/python/parse.ts:58 — factually wrong — medium — Assertion normalization discards behavior that can weaken a check.**

   Concrete examples:

   - Change `pytest.approx(expected, nan_ok=False)` to `nan_ok=True`. `approxAssertion()` records tolerance but drops `nan_ok`; a NaN comparison can become passing without a delta.
   - Remove `check=lambda exc: exc.code == 403` from `pytest.raises(ValueError, check=...)`. The reader records positional arguments and `match`, but discards `check`. The exception predicate disappears unreported.
   - Change an expected string from `"a  b"` to `"a b"`. `flatText()` collapses whitespace inside literals, making these different values identical to the comparator.

   **Resolve:** Preserve literal values and every behavior-affecting argument. Treat an unsupported argument as unresolved or conservatively changed, rather than dropping it.

6. **packages/readiness/src/scan.ts:449 and :482 — factually wrong — medium — Readiness uses a less isolated install and trusts repository-controlled test counts.**

   `pythonInstall()` executes the installer over the materialized repository, unlike the API installer’s manifest-only workspace. A committed `venv.py` can intercept the first `python -m venv` step. The shown readiness path also does not perform the API’s dependency-tree replacement before installation.

   Separately, `pythonSuite()` accepts a zero exit and JUnit attributes as evidence that tests passed. A shadow `pytest.py` can read the `--junitxml` argument, write:

   ```xml
   <testsuite tests="1" failures="0" errors="0" skipped="0"/>
   ```

   and exit zero without running a test. This directly violates the stated rule against trusting runner output for test counts.

   **Resolve:** Reuse the isolated installation path for readiness, clean dependency artifacts, and obtain execution evidence through a trusted judge. At minimum, do not present these report attributes as independently established execution counts.

7. **packages/conformance/src/registry/stacks.ts:250 — factually wrong — medium — The installer conformance checks pass vacuously when package reading drops everything.**

   The malformed uv and requirements cases reject only when `!read.ok` or some returned package is verifiable. An implementation returning `{ ok: true, packages: [] }` passes both checks: `.some(...)` is false on an empty array. The checks therefore fail to detect precisely the silent omission their titles promise to prevent.

   They are not wholly tautological, but these branches are vacuous for an empty successful parse. Checking that flags appear in an argument vector also does not establish actual hash enforcement.

   **Resolve:** Assert the expected package identities and cardinality, and require each intended refusal. Add real Python-install probes using incorrect hashes, with correct-hash controls.

Several narrower mechanisms are sound in the supplied code:

- **Host parsing:** `python/parse.ts:20` parses through Lezer and rejects error nodes; the shown configuration readers parse data without executing repository Python.
- **Install failure handling:** `packages/api/src/install.ts:266` stops on the first unsuccessful step and converts execution exceptions into installation failure.
- **Named dependency-tree writes:** `packages/api/src/line.ts:1530` excludes these writes from the carried diff; `install.ts:205` removes existing dependency trees before installing. This protects those paths, although it does not secure Python’s other import locations.
- **Coverage denominator:** `python/coverage.ts:126` adds statically executable changed lines independently of report exclusions. That prevents an exclusion from removing an obligation, but does not authenticate claimed execution.

I found no concrete TypeScript cast, declaration-merging, generic-erasure, or type-predicate bypass available to the repository adversary under your trust assumptions. Forging a runtime-selected adapter or installer would require control explicitly excluded by the prompt.

The adversarial framing is appropriate. The central unresolved boundary is that immutable files and static enumeration do not make an interpreter executing repository code a trustworthy judge. The question I would add is: **what trusted observer establishes that each required test actually executed and satisfied its assertions, even when repository code can alter imports, hooks, bindings, or process termination?** The current implementation does not establish that property.