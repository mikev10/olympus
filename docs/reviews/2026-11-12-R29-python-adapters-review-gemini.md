BASE: reviewed/R34
HEAD: 97c8267
packages/vault/test/local.test.ts
3576a2efd1b62365418ffab6757b92ee

I had no prior context about this project and performed no external lookups. 

The adversarial question is exactly the right framing for this runtime: because the agent controls the product code, the tests, and the dependencies, it can exploit any misalignment between what the static parser believes the test suite does and what the test runner actually executes. The static parsing mechanisms in this adapter set fail open in several ways, allowing an agent to skip or delete tests at runtime without the static tamper analysis detecting the change.

Here are the concrete bypasses found:

### 1. `packages/api/src/tamper.ts:112`
- **type**: factually wrong
- **severity**: high
- **bypass**: Tamper analysis for skip markers (`test.detectSkipMarkers`) is only invoked on recognized test files (`before` and `after` suites enumerated by `test.enumerateSuites`). An agent can add `import pytest; pytest.skip("bypassed")` to a product source file (e.g., `hello.py`). When the test suite imports this module, it executes the skip at collection or runtime, skipping the tests and exiting 0. Because product files are never scanned for skip markers, the skip is completely undetected.
- **resolution**: Skip markers must be scanned across all executable Python files in the repository, not just test suites. Alternatively, enforce a trusted pytest plugin in the check sandbox that forces a non-zero exit if any tests are skipped.

### 2. `packages/adapters/src/python/tests.ts:316` (and 290)
- **type**: factually wrong
- **severity**: high
- **bypass**: Even within recognized test files, the AST traversal for skip markers is too shallow. The `functionCases` logic explicitly returns early (line 316) if a function is decorated with `@pytest.fixture` or if it's a non-test helper function. Additionally, top-level skip checks (line 290) only inspect `ExpressionStatement` nodes. An agent can place `pytest.skip()` inside a fixture, inside a helper function called by a test, or under an `if True:` block at the module level. The static parser skips these nodes entirely, while pytest executes them and silently skips the tests.
- **resolution**: Execute `skipCallsIn` or a generic AST visitor over the entire file's AST regardless of statement type, function name, or decorators, ensuring any skip invocation within the test file is caught.

### 3. `packages/adapters/src/python/tests.ts:386` (and 431)
- **type**: factually wrong
- **severity**: high
- **bypass**: When `@pytest.mark.parametrize` receives a dynamic or non-literal iterable (e.g., `dynamic_cases()`), `parametrizeIds` returns `undefined` (line 386). The parser then falls back to recording a single case using the bare function name (line 431). An agent can modify the dynamic data source to return an empty list `[]`. Pytest will run zero iterations for this test, but the static parser will still record the bare function name. Since the recorded name matches the BASE record, no tests are flagged as deleted, enabling a silent bypass.
- **resolution**: If a parametrization cannot be resolved statically to a fixed list of IDs, it must be refused (fail closed) or escalated, rather than failing open by assuming a single test case exists.

### 4. `packages/adapters/src/python/tests.ts:257`
- **type**: factually wrong
- **severity**: high
- **bypass**: The `SKIP_CALLS` regular expression strictly matches specific literal dotted names (like `pytest.skip` or `self.skipTest`). An agent can easily evade this by aliasing the import (`import pytest as pt; pt.skip()`) or assigning the function to a variable (`s = pytest.skip; s()`). The static parser will not recognize these as skip calls, but pytest will execute them, skipping tests and exiting 0 undetected.
- **resolution**: Static detection of function calls in dynamic languages like Python is inherently incomplete due to aliasing. A reliable approach requires runtime enforcement (e.g., passing a flag or using a trusted pytest wrapper that forbids skips) rather than relying exclusively on static regex/AST matching.