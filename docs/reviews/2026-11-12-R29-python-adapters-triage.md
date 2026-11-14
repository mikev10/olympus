# Triage of R29's external reviews

Two reviews, both `counted`:

- **Codex** (gpt-6-astra) counted on its first run.
- **Gemini** (gemini-3.1-pro-preview) counted on its rerun. Its first run is `FAILED` (HTTP 402, prepaid credits depleted) and is kept as `.attempt-1`.

**Counts**

- Codex: 7 findings. 7 hold: 6 in full and 1 in part (codex-6). 0 do not hold.
- Gemini: 4 findings, all 4 hold, 0 do not hold.
- Both families raised one mechanism, codex-3 = gemini-3, so there are 10 distinct findings.
- All 10 were verified by fresh-context subagents, which were not told who wrote the code. Each reproduction ran against the real adapters, and in Docker with pytest 8.4.2 in the pinned image where it could run.

**Outcome**

- 9 fixed on `unit/r29`.
- 1 fixed in part, with the rest recorded as a known limit and filed as issue #160 (codex-6).
- The root class behind codex-1, codex-6 and gemini-1 is recorded under the existing pending entry `I3.runner-process-loads-only-base-code` (M3, #42): the runner's process runs code the change can write.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | A root `pytest.py` or `pytest.pyc` replaces the runner under `python -m pytest` | codex | holds | fixed, `9184026` (+ `6d9bf39`) |
| codex-2 | The conftest check misses run-protocol and session hooks, imported hooks, and hooks nested under a condition | codex | holds | fixed, `e1a850f` |
| codex-3 / gemini-3 | A non-literal parametrize table collapses to its bare name, so emptying it hides deleted cases | both | holds | fixed, `edd0576` |
| codex-4 | `test_x.__test__ = False` or rebinding `test_x` hides a test the reader still lists | codex | holds | fixed, `2ca9c83` |
| codex-5 | `nan_ok` and `check=` are dropped, and whitespace inside literals is collapsed | codex | holds | fixed, `4774431` |
| codex-6 | Readiness installs over the whole tree and trusts reports the suite's own process writes | codex | holds in part | `-I` fixed in `9184026`; the rest is a known limit, #160 |
| codex-7 | The installer assertion passes for a reader that returns no packages | codex | holds | fixed, `33eb5ba` |
| gemini-1 | A skip in product code that tests import goes unreported | gemini | holds | fixed, `23b5b1b`; the limit entry was extended in `18201a6` |
| gemini-2 | Skips in fixtures, in helpers, and under a module-level `if` are missed | gemini | holds | fixed, `7e0f8b8` |
| gemini-4 | An aliased skip (`pt.skip`, `s = pytest.skip`) is missed | gemini | holds | fixed, `7e0f8b8` |

How the runtime uses what these mechanisms produce decides each finding's real consequence:

- **The `verify` gate** passes on two things only: the pytest process's exit code, and the adapter's static suite count (`gate.ts`, `line.ts`, `verification.ts`). No runner report is read.
- **Tamper findings** decide nothing alone. They escalate the `integrate` exit to a human (`tamper.ts`). A finding that is missed therefore means an L3 run integrates with nobody seeing it.
- **Acceptance tests are locked and hashed**, so the test-file gaps hit unit tests. gemini-1 and codex-1 reach locked tests as well, because product code and root files are not locked.

## codex-1: the runner's module can be replaced

- **Checked:**
  - `PytestAdapter.invocation` ran `.venv/bin/python -m pytest`, which puts the working directory first on `sys.path`.
  - `missingRunner` only checks that the installed pytest exists.
  - The test was reproduced in the pinned uv image against the `python-hello` fixture with a failing test:
    - baseline: exit 1
    - root `pytest.py` calling `os._exit(0)`: exit 0
    - a sourceless `pytest.pyc`: exit 0
  - A root `pytest.py` is not a protected config file, so nothing escalates either.
- **Verdict:** holds.
- **Fix:** `.venv/bin/python -I -c PYTEST_BOOTSTRAP`.
  - `-I` keeps the working directory and every `PYTHON*` variable off the path while pytest is imported. The bootstrap then appends the tree last, behind the standard library and the install.
  - Measured in the same image: the fixture still imports its own module, and the shadow now exits 1.
  - The installers' `python` steps and readiness's probes run under `-I` too. Readiness's coverage probe starts coverage.py through the same bootstrap, because `coverage run -m` under `-I` leaves the tree off the path; that was measured, as the probe's `ModuleNotFoundError`.
- **Rejected:**
  - `-P` with `-m pytest`, because a test importing a root module then fails.
  - Inserting the tree first, because it is the defect.
- **Assertion:** `I3.python-install-runs-no-package-code` now requires `-I` on every `python` step, and an adapter test checks the bootstrap's order. Both fail against the old argv.

## codex-2: conftest hooks beyond collection

- **Checked:** `COLLECTION_HOOK` listed collection hooks only, and `checkConftest` read only top-level definitions and assignments. Run under the repository's vitest, all three of these were accepted:
  - `def pytest_runtest_protocol`
  - `from x import pytest_collection_modifyitems`
  - `if True: def pytest_collection_modifyitems`

  In the image, a conftest whose `pytest_runtest_protocol` returns `True` exits 0 with no test run, including when it imports that hook from a non-config module whose flag the change flips.
- **Verdict:** holds.
- **Fix:** an allowlist in place of the denylist. A conftest may hold fixtures, helpers, and a markers-only `pytest_configure`. The following are refused, naming the name:
  - any other `pytest_*` name, whether defined, nested, imported (including under an alias), or referenced
  - a wildcard import
  - `globals()`, `setattr()` and the other dynamic binders
  - `pluginmanager`
  - `__dict__`

  `import pytest_mock` and `from pytest_mock import MockerFixture` still read: they bind a module or a class, never a hook.
- **Rejected:** a longer denylist of outcome-changing hooks, because the denylist is what was wrong.

## codex-3 / gemini-3: unresolved parametrize tables

Both families raised this independently.

- **Checked:** `parametrizeIds` returned `undefined` for a non-literal or empty table, and `functionCases` then recorded the bare name.
  - Reproduced: changing `list(range(2))` to `list(range(0))`, or `dynamic_cases()` to `[]`, gave no deleted case and no skip, while pytest went from 2 passed to 1 skipped.
  - A literal `[1, 2]` to `[]` was already caught.
  - The bare-name choice was D-R29-07's, which named this fix as its reverse.
- **Verdict:** holds.
- **Fix:**
  - A table that is not a list or tuple display, or that spreads, is refused, as the TypeScript set refuses a non-literal `.each`.
  - A row whose id depends on what the parse cannot see (a non-primitive value, a callable `ids=`, a non-literal `id=`) is named `?<source>`, so a dropped row is still a deleted case.
  - An empty table is a skip marker.
- **Same mechanism, closed in the same commit:**
  - A fixture's `params` rows are recorded as cases of the fixture's.
  - A `parametrize` mark anywhere but a test's own decorator (an alias, `pytestmark`) is refused.
  - A test module's `pytest_generate_tests` is refused.
- **Rejected:** keying the bare case on the table's source text. It catches `range(2)` → `range(0)` but not a change inside a called function's body.

## codex-4: rebinding a test

- **Checked:** `readTestFile` read only `def` and `class` statements, and honoured `__test__ = False` only in a class body. Reproduced:
  - `test_bad.__test__ = False` made pytest collect 1 test instead of 2.
  - `test_bad = lambda: None` ran a no-op.

  In both cases the reader still listed `test_bad` and its assertion.
- **Verdict:** holds.
- **Fix:** `rebindings` walks the module and class levels, including the bodies of top-level `if`, `for`, `while`, `try`, `with` and `match` statements. Each of the following is a marker of the test it touches:
  - an assignment, an augmented assignment, a `del`, a loop target, or an import over a test name, or an attribute set on one
  - a second definition of the same name
  - `__test__` set on the module or a class

  A dynamic binder at that level is refused. Any falsy literal `__test__` passes a class over, as pytest reads it for truth.

## codex-5: assertion arguments dropped or normalised

- **Checked:**
  - `approxAssertion` read only `rel` and `abs`, so `nan_ok` was dropped. In pytest 8.4.2, `nan == approx(nan, nan_ok=False)` fails and `nan_ok=True` passes.
  - `callAssertion` kept only `match`, so `check=` was dropped. pytest 8.4.2 accepts `check=` and fails on a mismatch.
  - `flatText` collapsed whitespace inside string literals, so `"a  b"` and `"a b"` compared equal. The TypeScript `text()` keeps literals verbatim.
- **Verdict:** holds, all three.
- **Fix:**
  - `flatText` keeps `String` and `FormatString` spans as written.
  - Every keyword the reading does not model is part of the assertion, as `name=value` sorted; `msg` is excluded because it does not change what passes.
  - `nan_ok`, by keyword or position, rides in the approx operator. The shared tolerance comparison reads only the subject and the value, which was measured when the first placement failed its test.
  - Only an appended `match` or `check` counts as stronger, so an appended `nan_ok=True` is reported.

## codex-6: readiness's install and suite probes

- **Checked:** confirmed in the code.
  - `pythonInstall` runs over the whole materialised base.
  - A committed `venv.py` intercepted `python -m venv` in the image.
  - No dependency tree is removed first.
  - The green probe trusts exit 0 plus a JUnit file written in-process.
- **The consequence is narrower than the finding implies.** Readiness scans the base, which its author controls, and derives a ceiling of at most L2. It does not touch `verify`, and the npm path has the same properties.
- **Verdict:** holds in part, on the consequence.
- **Fixed:** `-I` on every readiness `python` call (`9184026`). That closes the `venv.py` route and the runner shadow there.
- **Known limit:** the manifest-only install, removal of committed dependency trees, and report forgery are recorded in D-R29-15 and filed as #160 for readiness.

## codex-7: a vacuous installer assertion

- **Checked:** lines 265–268 refuse only on `!read.ok || some(verifiable)`, so `{ ok: true, packages: [] }` passed. There was no positive case.
  - Two corrections to the reviewer's wording: the inputs are well-formed lockfiles, not malformed ones, and the option-line check was not vacuous.
  - The adapter unit tests do pin the exact packages, but those tests are not the executable assertion behind the claim.
- **Verdict:** holds.
- **Fix:** the assertion compares the exact keys and reasons beside a hashed wheel and a pinned, hashed requirement read as verifiable.
- **Failing against the old behaviour:** a reader returning an empty list yields `[]`, which no longer equals the expected list.

## gemini-1: a skip in product code

- **Checked:** `tamper.ts` read skip markers only from the files `enumerateSuites` lists.
  - Reproduced: adding `pytest.skip("x", allow_module_level=True)` to `src/mod.py` took the importing test from 1 passed to 1 skipped, with no finding.
  - It reaches locked acceptance tests, because product code is not locked.
- **Verdict:** holds.
- **Fix:** `TestFrameworkAdapter.skipSources(dir)`, on the gate path this unit declared, as D-R29-13's two methods were. It names the files tamper reads markers from:
  - vitest and jest: their suites, since their skips are bound to the test context
  - pytest: every source module

  A non-test module's markers are its skip references. Its own `sys.exit` is not counted, because under pytest it fails the test that reaches it.
- **Limit:** an indirect spelling such as `getattr(os, "_e" + "xit")` in product code still escapes. That is the pending runner-process entry, whose reason now names pytest's route (`18201a6`).

## gemini-2: skips outside a test body

- **Checked:** `functionCases` returned early for fixtures and non-test names, and module-level reading inspected only `ExpressionStatement`. An autouse fixture skip, a helper skip, and `if True: pytest.skip(...)` each skipped tests in pytest with no finding.
- **Verdict:** holds.
- **Fix:** `skipReferences` reads the whole file. Every reference to the skip family counts wherever it is, owned by the definitions it sits in:
  - pytest's `skip`, `skipif`, `xfail` and `importorskip`
  - unittest's `skip`, `skipIf`, `skipUnless`, `expectedFailure`, `skipTest` and `SkipTest`
  - `pytest.exit` and `os._exit`

  A module-level marker is now owned by `(module)`, not by the file's absolute path, so a marker already in the base pairs with the head's.

## gemini-4: aliased skips

- **Checked:** `SKIP_CALLS` matched literal dotted names only. `import pytest as pt; pt.skip()` and `s = pytest.skip; s()` each skipped tests in pytest with no finding.
- **Verdict:** holds.
- **Fix:** the same reading follows the binding forms below. A string naming a skip counts too.
  - import aliases: `from pytest import skip as s`, `import pytest as pt`
  - assigned names, followed to a fixed point

  `getattr` on pytest, `_pytest` or unittest with an attribute the parse cannot read is refused, as the TypeScript set refuses a computed key on the test context.

## The reviewers' framing

- **Item 7:** both families held the framing right.
- **Codex's sharper question:** *what trusted observer establishes that each required test actually executed?* That is the open pending entry `I3.runner-process-loads-only-base-code`. No in-process judge can answer it against code the change writes. This unit narrows the easy paths into it, and leaves closing it to its owner, M3.
