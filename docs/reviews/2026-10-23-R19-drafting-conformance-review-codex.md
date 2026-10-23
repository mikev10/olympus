BASE: cd1b536
HEAD: e772ef9
packages/conformance/src/registry/verification.ts
3bdd87b264a9720cd6f37ec8062743b0

I had no prior project context and performed no external lookups. I read the bundle supplied in the prompt. A local file-listing attempt was denied; I did not independently verify the SHA-256 or run the tests.

These are findings about **what the assertions can establish**, not claims that the unseen runtime contains these defects. Confidence is high unless stated otherwise. Below, `drafting.ts` means `packages/conformance/src/registry/drafting.ts`. Citations to its registration lines identify the assertions whose coverage is missing.

1. **drafting.ts:857 — factually wrong — high — The black-box assertion can pass with repository access.**

   `TEST_DRAFTER_IS_BLACK_BOX` enumerates the sibling `start` directory, derived by replacing `work` in the mounted source. It does not inspect what the drafter can read from the actual mounted `work` directory when its call begins.

   **Construction:** prepare the expected three files in `start`, then copy repository files into `work` before provisioning. Keep egress denied and `others` empty. The assertion passes. Alternatively, append repository contents to `stablePrefix` without either forbidden marker; the prefix checks still pass. The critic’s additional mounts and actual tree are not checked either.

   **Resolve:** inspect the actual workspace at seat entry, compare full relative paths and bytes against the permitted inputs, check links and additional mounts, and verify all delivered context against an explicit allowlist. Add the missing admission case granting **test-critic** egress; presently only test-drafter egress is exercised.

2. **drafting.ts:857 — factually wrong — high — No drafted acceptance-test scenario exercises approval through locking and subsequent verification.**

   The scenarios reach `test-design:1`, inspect conditions, or reject the draft. Calls to `approveAndResume` approve specs, not drafted tests.

   **Construction:** correctly draft, base-run, critique, and present tests, but make the test-design approval path discard their script or manifest, omit their locks, or continue using the originally supplied verification manifest. These drafting assertions never enter that path. The supplied-artifact tests need not detect a defect confined to drafted artifacts.

   **Resolve:** approve a test draft, drive through build and verify, and observe the exact approved scripts and checks executing. Verify the manifest and scripts are locked; tamper with each before subsequent transitions and require refusal.

3. **drafting.ts:857 — factually wrong — high — The tests do not establish that the critic judges the recorded snapshot.**

   `LOCKED_DRAFT_IS_THE_BYTES_READ` changes the drafter workspace only after the initial drive has stopped—after the critic has already run. The critic stubs return fixed findings without checking their input. The test-critic context assertion requires markers, not the correct draft bytes.

   **Construction:** record draft A, but construct critic context from the live drafter workspace or a stale draft B. Continue approving and locking recorded A. The assertions still pass because no critic distinguishes A from B. Likewise, dropping the draft’s contents while retaining `[draft]` satisfies the context check.

   **Resolve:** have the critic stub validate the exact recorded content and identity it receives. Change the drafter workspace between recording and critic delivery. Require the critic record and approval to bind to the same draft and attempt.

4. **drafting.ts:857, drafting.ts:859 — factually wrong — high — Normal resumes do not cover interruption safety.**

   The drafting assertions resume after completed approval or rejection calls. None interrupts the draft lifecycle between persistence steps.

   **Construction:** approval writes a grant before recording its draft/attempt binding; recovery treats that incomplete grant as sufficient. Or recovery treats “draft recorded, critic absent” as “critic clean.” An uninterrupted implementation can satisfy every shown drafting assertion while either recovery path locks uncleared bytes.

   `LAST_ATTEMPT_GOES_TO_A_PERSON` also checks that a park decision eventually exists, not its claimed ordering before the state commit.

   **Resolve:** inject stops around draft, base-result, critic, approval, installation, lock, rejection, and state commits. Resume from a fresh runtime instance and assert that incomplete evidence never authorizes advancement. Instrument decision/state ordering explicitly.

5. **drafting.ts:858, drafting.ts:860 — unclear — high — The L2/L3 helper tests leave their integration unproved.**

   Testing pure functions is a reasonable response to the composition restriction. It does not establish that the line supplies their actual inputs or obeys their results.

   **Construction:** leave `effectiveApproval`, `seatTestDrafter`, and `builderModels` correct, but have the L2 exit supply `failed: []`, omit the draft argument, or ignore the returned requirement. Separately, have drafting admission compare only the builder’s initial family instead of the escalation-inclusive list. The helper tests pass; the shown line scenarios do not exercise those combinations.

   **Resolve:** exercise the actual exit/seating orchestration with recorded inputs and observable consequences, without requiring a paid end-to-end model call. Until then, describe these as helper guarantees and an explicit integration coverage gap.

6. **drafting.ts:857, drafting.ts:859 — factually wrong — high — Draft-specific fail-closed cases are substantially narrower than the stated property.**

   The draft checks use one behavioral script. The malformed cases cover a truncated security JSON document, an empty spec, and one non-JSON critic response.

   **Construction:** treat a missing drafted script’s Node error as an expected base failure; default an empty or schema-invalid critic response to clean; or run only the first declared draft check. Preserve the specific tested malformed cases. These assertions do not distinguish that runtime from a correct one. Existing supplied-check tests do not establish that the drafted-check path shares their enforcement.

   **Resolve:** add drafted cases with multiple distinguishable checks, absent scripts, unstarted commands, timeouts, skipped checks, missing results, and malformed critic shapes such as `{}` or `{"findings":null}`. Require complete result coverage and explicit failed conditions. For skipped execution, observe that the check actually ran, not just an exit status.

7. **drafting.ts:836 — factually wrong — high — A refused approval can still have authorization side effects.**

   `draftingDecision` checks the returned refusal and the presence of a refusal decision. It does not resume afterward or inspect whether a grant was also persisted. In `APPROVAL_BINDS_THE_DRAFT`, the wrong-hash calls are followed by a legitimate approval before resuming.

   **Construction:** persist an approval grant, then return `draft-mismatch` or `draft-invalid` and record that refusal. The shown tests accept the return value and record. For the invalid-draft scenario, they never attempt the advancement that would expose the hidden grant.

   **Resolve:** isolate each refused approval, verify no authorization or lock changed, then resume and require that the invalid or unapproved draft remains unable to advance.

8. **drafting.ts:860 — factually wrong — medium — Drafting identity tests cannot distinguish resolved identity from reported identity.**

   The seat helper returns the same `model` from `resolveModel()` and `runTask()`. Consequently, a drafting implementation grading the result’s reported model instead of the resolved model passes these cases.

   **Construction:** retain correct reviewer behavior, but calculate critic or test-drafter independence from the returned result identity. All drafting fixtures remain indistinguishable. The reviewer-specific contradictory-identity scenario in `tier.ts` does not exercise these new seats.

   **Resolve:** introduce differing resolved and returned identities for each drafting seat, using a trusted test driver to model the discrepancy. Assert that only the resolved identities determine grades. This is a test construction, not an assumption that the adversary can replace runtime-selected drivers.

9. **drafting.ts:814 — factually wrong — medium — Four cost rows do not prove that every possible call is budgeted.**

   The assertion requires four drafting rows and a total greater than the no-drafting estimate. It does not independently check attempts, per-seat limits, or arithmetic.

   **Construction:** budget exactly one call per seat despite permitting three attempts. Or create four nominal drafting rows with a negligible positive total. The assertion passes, and the rig’s ordinary approval amount comes from the same estimator.

   **Resolve:** derive an independent expected upper bound from explicit fixture budgets and permitted call counts. Check each seat’s contribution and refusal just below the complete bound.

10. **drafting.ts:840 — factually wrong — medium — Decision-table coverage establishes occurrence, not faithful accounting.**

    `draftingDecision` finds one matching cause and checks its decider, station, and run. It does not check the decision’s draft/attempt binding, relevant payload, multiplicity, or incompatible decisions.

    **Construction:** record a correctly labeled refusal against the wrong attempt, or emit both approval-granted and approval-refused for the same action. The existential search still finds what it needs.

    **Resolve:** compare the decisions produced by each operation against an expected set, including applicable identifiers and payloads. Couple those checks to resulting authorization and state.

11. **packages/conformance/src/registry/i1.ts:45 — factually wrong — medium — The “closed operation set” inspects only own string names on one prototype.**

    **Construction:** add a public instance field `put = (...) => ...`, a symbol-keyed method, or an inherited helper. None appears in `Object.getOwnPropertyNames(LocalVault.prototype)`. A getter under an allowed name also satisfies the name check without being the promised operation.

    **Resolve:** inspect a real instance and its prototype chain using `Reflect.ownKeys` and property descriptors, with an explicit boundary for ordinary object methods. Check operation descriptors as well as names.

    This is a conformance gap in the claimed interface closure, not a demonstrated agent-access route: the threat model trusts the Vault and excludes arbitrary runtime-process code.

The mechanisms I assess as sound **within their exercised scope** are:

- `APPROVAL_BINDS_THE_DRAFT` distinguishes reuse of a completed attempt’s approval from approval of a second attempt with identical bytes.
- `LOCKED_DRAFT_IS_THE_BYTES_READ` meaningfully detects rereading the edited spec workspace during later approval/installation.
- `CRITIC_FINDING_SENDS_BACK` exercises both a finding and an unreadable narrative, and checks retry records and context placement.
- `SPEC_LESS_RUN_NEEDS_AN_INTENT` checks specific admission failures and uses `isNoRunState`; unrelated storage exceptions are rethrown.
- The pure approval and family tests contain positive and negative controls. They are useful unit tests, despite the integration gap above.

I found **no unconditional tautology in the new drafting assertions**. Shared expectations weaken some oracles, especially costing, but those tests can fail. I also found no broad catch in the new drafting assertions that turns arbitrary thrown errors into success. The missing/error-result concerns above are untested runtime branches, not demonstrated exception swallowing by the new harness.

For TypeScript escapes, `fixtures/types/i7/intent-is-not-a-payload.ts:9` establishes assignment restrictions, not authenticated origin. Widening a value through an `unknown` parameter, an `any` return, an unchecked generic conversion, or a dishonest type predicate can defeat that restriction without a direct cast from the branded type. The existing `i7.ts` pending entry expressly acknowledges some such gaps. Declaration merging or module augmentation should not be assumed to permit every incompatible field rewrite; no concrete additional exploit of those mechanisms is established here.

Those language escapes require code in a trusted path to perform the conversion. Under the stated adversary, they are **not independently executable runtime attacks**. A structural `{text, from: 'principal'}` value alone nevertheless cannot prove channel provenance; that requires testing the actual human/trigger ingress, which is not shown.

The adversarial framing is appropriate if the question is: **“Which plausible runtime regressions or omitted checks survive these assertions?”** It becomes misleading if it assumes the party can replace trusted components or if “independent critic” means an incorruptible judgment. The stated adversary controls even a different-family critic’s narrative. Family separation proves a relationship between resolved identities, not the truth of its findings. These tests should prove runtime-controlled evidence, binding, isolation, and approval rules; they cannot prove that a clean model judgment is substantively correct.