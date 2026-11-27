BASE: reviewed/R58  
HEAD: 43703db  
packages/sandbox/test/browse.test.ts  
4562ea68573c3a315170ffa6daf7a308

I had no prior project context and performed no external lookups. This review uses the complete inline bundle. Local command execution was denied, so I did not run tests or independently verify the file hash.

1. **packages/sandbox/src/local/browse-source.ts:119 — factually wrong — high — Invisible content can satisfy an explicitly visible observation.**  
   Serve the expected text in an element with `clip-path: inset(100%)`. It retains a positive bounding rectangle and passes the checks used here, although its text is completely clipped. `innerText` still supplies the expected string, so even `{text: "Hello, Ada", visible: true}` can hold. An opaque covering element presents the same problem. Separately, the text finder at line 110 can match `display:none` content because reading `innerText` on an unrendered element returns its text content; expectations omitting `visible` can therefore pass on hidden text.

   **Resolve:** Define and enforce the visibility promised by semantic text targeting and observations, including clipping and occlusion where `visible: true` promises perceptibility. Add adversarial fixtures for hidden, clipped, and covered expected content. These require no screenshot comparison.

2. **packages/sandbox/src/local/browse-source.ts:129 — factually wrong — high — `fill` can successfully operate a disabled control that a person cannot operate.**  
   Supply a labelled, disabled `<select>` containing the requested option. `one()` checks visibility but not enabledness. `CHOOSE` then assigns its value and dispatches `input` and `change` directly. A handler can display the expected result, and the scenario holds despite the requested interaction being unavailable to a user.

   The click path at line 295 likewise sends coordinates without establishing that the target receives the click or is enabled. A disabled button can be reported as successfully clicked; a covering element can receive the click instead.

   **Resolve:** Check enabledness, editability, and target hit testing before acting. For selects, reject disabled controls and disabled options before changing their state. Assert that these impossible interactions produce `failedStep` and subsequent `not-reached` observations.

3. **packages/sandbox/src/local/browse-source.ts:214 — factually wrong — high — Requests blocked before reaching the proxy disappear from the verdict.**  
   Serve a page with `Content-Security-Policy: img-src 'none'`, an image pointing to an unlisted external host, and otherwise correct expected content. Chrome blocks the image before contacting the refusing proxy. The only handling of `Network.loadingFailed` removes an in-flight identifier; it records neither the requested host nor the failure. The proxy has no request to count, and the external image is not a top-level navigation. Consequently, `blocked` can remain empty and the scenario can hold although the page requested an unavailable, unlisted resource.

   **Resolve:** Track browser-level blocked requests as well as proxy refusals, preserving request URLs and failure reasons. Add a CSP-blocked external-resource fixture that must fail without `mayBlock` and report the host in either case. Confidence is high in the reporting gap; executing that fixture against the pinned image would confirm its precise event sequence.

4. **packages/conformance/src/registry/browser.ts:1 — factually wrong — medium — The assertions do not establish the claimed resistance to page-controlled script-world tampering.**  
   The supplied fixtures use ordinary pages. Replacing isolated-world evaluation and node resolution with main-world equivalents would leave those fixtures behaving normally, so the seven assertions can still pass after this protection is deleted. Likewise, the visibility and impossible-interaction constructions above are absent: successful interaction and missing/ambiguous targets do not test those properties.

   **Resolve:** Add a page that overrides main-world DOM getters and methods to fabricate observations, with a control demonstrating that the overrides actually execute. Require the browser to report the genuine DOM state. Verify that removing world isolation makes that assertion fail, and add the adverse visibility/action fixtures above.

The following mechanisms appear sound within the stated trust model:

- **`browse.ts:235`, `browse-source.ts:175`:** Separate filesystem/process isolation and pipe-based browser control remove the straightforward routes for replacing the runner or driving Chrome through a shared debugging port.
- **`browse.ts:142`:** Double JSON encoding keeps scenario strings inside a literal rather than executable runner source.
- **`browse.ts:182`:** Report parsing rejects missing observations and inconsistent failed-step histories. **`adapters/src/browser.ts:242`** performs the verdict comparison on the host and treats absent observations and reported failures as failures.
- Runtime scenario validation rejects unsupported target forms and sparse arrays. TypeScript casts, declaration merging, or a dishonest type predicate in product code do not alter these host-side checks under the supplied trust boundary.

I found no strictly tautological new assertion and no demonstrated path where a production exception becomes a passing verdict. Some negative assertions accept any exception, which weakens diagnostic specificity, but that alone does not establish a product-controlled bypass.

The adversarial framing is appropriate. Its key distinction is between **authentic browser evidence**, which these boundaries substantially protect, and **evidence that the expected content was perceptible and the requested interaction occurred**, which the observation and action checks currently overclaim.