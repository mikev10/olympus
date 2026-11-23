# Triage of the R25 external reviews, 2026-11-22

Two reviews of the same bundle, `2026-11-22-R25-property-checks-review-bundle.txt` (SHA-256 `0f835f16…1922`, base `reviewed/R38` at 3fde9eb, head 34d5616). Both counted on the first run, with no rerun:
- codex: gpt-6-astra, 124,893 input tokens against a floor of 81,703.
- gemini: gemini-3.1-pro-preview, 126,033 input tokens.

Each finding was checked against the cited construct by a subagent with fresh context, and then by running the construction where it could be run.

**Counts.**
- codex raised 5 findings:
  - 3 hold, and 2 of them are fixed;
  - 2 hold in part, 1 of them fixed;
  - 1 that holds is a known limit with an issue;
  - 1 that holds is rejected as a defect.
- gemini raised 4 findings:
  - 2 hold: 1 is fixed, and 1 is a known limit with an issue;
  - 1 holds in part, with no change;
  - 1 restates gemini-1 as a tradeoff.
- Two finding pairs were raised by both families:
  - codex-1 and gemini-1.
  - codex-3 and gemini-3, on the same function from opposite directions.
- No finding did not hold.

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 / gemini-1 | Code under test shares the reporter's process, so it can forge reports | both | holds | known limit, #216 |
| gemini-4 | The stdout channel is fragile; prefer IPC or a file descriptor | gemini | the tradeoff form of gemini-1 | folded into #216 |
| codex-2 | `fc['assert']`, `const check = fc.assert`, and destructuring are neither registered nor refused | codex | holds in part | fixed, 12e1bd3 |
| codex-3 | Base `fails` accepts one failed run and ignores unsound reports beside it | codex | holds; the consequence is a late refusal, not a pass | fixed, 2cfa4ba |
| gemini-3 | A property over a module the base lacks can never declare `fails` | gemini | holds | fixed with codex-3 |
| codex-5 | `propertyOutcome(pin, [], 0, evidence([]))` holds, and the test named for it does not test it | codex | holds | fixed with codex-3 |
| gemini-2 | A change can swap fast-check through the lockfile | gemini | holds in part | no change: the swap escalates at `integrate` |
| codex-4 | A tautology labelled with `deniesRule` satisfies the policy | codex | holds as a description | rejected as a defect |

## codex-1 / gemini-1 (and gemini-4): forged reports from inside the process

**Checked:**
- The preload is an `--import` loaded into the process that imports the change (`packages/adapters/src/property.ts`, `environment` and `preloadSource`).
- The marker is written into the preload file, which is mounted read-only into the same sandbox (`packages/api/src/property.ts`, `prepareProperty`).
- `readReports` accepts any line carrying the tag.

The verifier noted that product code does not even need `configureGlobal`: printing tagged lines at registered sites, and exiting 0, is enough.

**Found:** it holds. This is the limit D-R25-02 recorded before the review: "the code under test runs in the same process as the reporter, so it can forge a report line". An acceptance check shares the class, because its verdict is the runner's exit code from the same process. It takes deliberate forgery, which is outside the trust model the prompt stated ("only that the easiest path gets taken"), but the reviewers are right that no in-process marker closes it.

**Done:** filed as #216, "Verify: suite and property checks read evidence from the process the change runs in". The issue covers both check kinds and proposes observing from outside the process. It needs a channel the vitest runner may not offer, and a product interface that no unit specifies, so it is not a review fix. No unit owns it yet, and D-P7-05 already assigns forge-proof suite evidence to M3.

## codex-2: unrecognised forms of `assert`

**Checked:**
- `registrations` matched only `<ns>.assert(...)` and a directly imported `assert` identifier.
- When an unrecognised form does run, its report sits at an unregistered line, and `propertyOutcome` refuses it ("a run at X, which registers no property"). That was confirmed by reading the code and by the existing unit test for unregistered reports.
- When it does not run, nothing requires it.

**Found:** it holds in part. The bypass works only as the reviewer built it: a real assertion behind an unrecognised form, in a conditional the change controls, beside a registered tautology. Even then, the locked file is written at `test-design`, not by the change.

**Fixed:** admission refuses any use of fast-check the parse cannot locate, naming the file and line:
- a computed access to the namespace;
- the namespace used as a value, whether passed, destructured, or aliased;
- `ns.assert` or a named `assert` that is not called where it is named.

Type positions, `fc.Arbitrary<T>` and `typeof fc`, stay allowed. The new test failed before the fix (the codex-2 test in `packages/adapters/test/property.test.ts`). The alternative, registering every form, was rejected: an alias can be reassigned, and a parse that follows bindings would still miss what a helper module does. Refusing is the fail-closed choice.

## codex-3 and gemini-3: the base rule for `fails`

**Checked:**
- `propertyBaseCause` accepted `fails` on any failed run with the pinned seed and a non-empty file. It ignored unregistered reports, unreported registrations, other reports' seeds, and short counts.
- `verify` runs the full comparison over the same registrations, so each of those problems was refused there. codex-3's consequence is therefore a late refusal, not a pass.
- gemini-3's case is real: a file importing a module the base lacks throws before any `fc.assert`, reports nothing, and was refused as `no-result`. An acceptance check in the same position counts as `fails` by its exit code (`packages/api/src/base.ts`). So a property over new code could never declare `fails`, and `passes` cannot hold over a module that does not exist.

**Fixed:**
- **gemini-3:** the preload now prints a tagged `{"ready":true}` once it has configured the framework. `readReports` returns null, unreadable, without one, so a pin that was never set reads as unreadable evidence, never as an empty run.
- **The rule for `fails`** is now:
  - unreadable evidence is `no-result`;
  - no report at all, with a non-zero exit, is met: the file never reached a property, as an acceptance check's import failure does;
  - otherwise, any mismatch other than the exit code and the failed runs themselves is `suite-count`;
  - otherwise, the rule is met if some run failed, and is `contrary` if none did.

Unit tests for each case failed against the old rule. A conformance case was added to `I5.property-check-runs-every-pinned-case`: a property over `greet.mjs`, which the base lacks, declared `fails`, carries the run to `integrate` once the build writes the module. It failed against the old rule, refused at `test-design` as `no-result`, and passes with the fix.

**Rejected:**
- *Treating any non-zero exit as `fails`*, as gemini-3 proposes. A preload that never configured fast-check would then read as a reproduction. The ready line is what separates "the file did not load" from "the pin was never set".
- *Keeping the strict rule.* It makes property checks unusable on new modules, for no gain: `verify` requires every registration in any case.

## codex-5: an empty registration set

**Checked:** with no sites and no runs, every loop in `propertyOutcome` is empty, and it returned `{ held: true }`. The test named "no registration at all never holds on an empty report" passed a non-empty, unregistered report instead. Admission and `prepareProperty` keep an empty set off the normal path.

**Fixed:** `propertyOutcome` names `registrations` as a mismatch when there are none, whatever was reported, and the test now covers the empty case. It failed before the fix.

## gemini-2: swapping fast-check through the lockfile

**Checked:** the runtime installs the tree's lockfile, the change's included (R34). But `package.json` and `package-lock.json` are config files (`packages/adapters/src/config-files.ts`). `analyzeTamper` records any change to them as a protected path touched (`packages/api/src/tamper.ts`), and that escalates the `integrate` exit to a person. The install also requires every package to resolve from a granted registry with an integrity hash, so a `file:` path is refused.

**Found:** it holds in part. A spoofed registry package is possible, but the change is never silent: it stops for a person, exactly as swapping vitest under an acceptance check would. No change was made in this unit.

## codex-4: a tautology labelled with `deniesRule`

**Checked:** `denialRefusal` reads only whether a required property check names the rule. The existing denial requirement, from R17, is satisfied the same way, by a check naming the rule. Whether the check exercises the rule is the `test-design` critic's to judge, not admission's.

**Found:** the description holds, and it is not a defect of this unit. The policy requires a declared association, beside the denial check and never instead of it, and its comment says so. Adequacy cannot be decided by counting calls, as the reviewer agrees. The conformance fixture uses a tautology deliberately: it asserts the association rule, not a property's quality.

**Rejected,** with no change.

## After the fixes

Rerun as the acceptance criteria:
- typecheck and lint;
- the adapters, api, and conformance property tests;
- the free CI path;
- the deterministic tier, compared byte for byte against the committed result.

Results are in the merge-gate report.
