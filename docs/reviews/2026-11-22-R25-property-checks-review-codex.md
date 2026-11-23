# External review of R25, codex, 2026-11-22

This is the Codex family's review of R25, property checks: the new `property` check kind, the fast-check adapter slot and its preload, admission, the base run and `verify`, the policy field `propertyPerAuthorizationRule`, and corpus v2. It is triaged in `2026-11-22-R25-property-checks-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The manifest's `cleanRoom` holds the pre-run listing of both.
- **Cross-family agreement:** gemini raised codex-1, as gemini-1 and again in gemini-4. codex-3 and gemini-3 concern the same function, `propertyBaseCause`, from opposite directions: codex-3 says it is too lenient, and gemini-3 says it is too strict for a new module. Only codex raised codex-2, codex-4, and codex-5.
- **Date:** 2026-11-22
- **Bundle:** `2026-11-22-R25-property-checks-review-bundle.txt`, SHA-256 `0f835f16bc14dffef8402f0ce7ed39e561e38552c19e882f01707f560d451922`. Base `3fde9eb` (`reviewed/R38`), head `34d5616`, the unit branch's tip before the review. It held every new file in full and every modified file as a function-context diff. Excluded: `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml`. Prompt: `2026-11-22-R25-property-checks-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had none and performed no external lookups. That is a self-report, and it cannot be verified independently.
- **Coverage, and any gap:**
  - Items 1, 3, and 5 are answered by codex-1 to codex-4.
  - Item 2 is answered by codex-5.
  - Item 4 is answered: no type-level bypass was found.
  - Item 6 lists three mechanisms the reviewer found sound.
  - Item 7 is answered: the framing is right, with a note that sampling cannot establish universal correctness.
  - No item came back empty.
- **Citations:** line numbers are positions in the bundle's new-side diffs, not in the repository. Each finding was located by its construct.

BASE: 3fde9eb  
HEAD: 34d5616  
packages/vault/test/local.test.ts  
e89de9cc65a9dd6fde538eafa334778f

I have no prior project context and performed no external lookups. This is a source-only review of the supplied bundle; the constructions below were not executed.

1. **packages/adapters/src/property.ts:159 — factually wrong — high — Code under test can replace the reporter and fabricate passing evidence.**

   The preload configures fast-check inside the process that imports the change. Its read-only mount prevents editing its bytes; it does not protect its configuration, reporter, or stdout.

   A changed product module imported by a locked test can:

   - Read `/property-preload/preload.mjs` and extract its `const config` JSON, including the random report tag, seed, count, and filenames.
   - Call `fc.configureGlobal({ seed: config.seed, numRuns: 1, reporter() {} })`. The replacement reporter suppresses assertion failures.
   - Print fabricated tagged reports for the locked file’s known registration lines, each with the pinned seed, pinned count, `failed: false`, and `counterexample: null`.

   The locked assertions can then run one failing case each while Vitest finishes successfully. `readReports` accepts the fabricated lines at **packages/adapters/src/property.ts:95**, and `propertyOutcome` accepts their claims at **packages/api/src/property.ts:119**. No locked file, dependency, trusted provider, or runtime process needs modification.

   **Resolution:** Keep property execution, configuration, and observation in a trusted process that does not load change-controlled code. Invoke the product across an isolated interface. A hidden marker or different report file alone cannot secure a reporter sharing the product’s execution privileges.

2. **packages/adapters/src/property.ts:55 — factually wrong — high — Unrecognized assertion syntax silently reduces the registration set.**

   The parser recognizes direct `fc.assert(...)` and directly imported identifiers. It does not recognize `fc['assert'](...)`, aliases such as `const check = fc.assert`, or destructuring. It neither registers these calls nor refuses the unsupported forms.

   A locked file can contain:

   ```ts
   fc.assert(fc.property(fc.integer(), () => true));
   if (checksEnabled()) {
     fc['assert'](fc.property(fc.integer(), n => multiply(n, 1) === n));
   }
   ```

   Only the tautology becomes a required registration. A change makes the imported `checksEnabled()` return false while leaving `multiply` wrong. The genuine check disappears, and the remaining report satisfies verification.

   This can also cross an `onBase: 'fails'` base run: the computed assertion fails on the base, producing an unregistered report that `propertyBaseCause` nevertheless accepts, as described next. At verify, suppressing that assertion leaves only the recognized passing report.

   **Resolution:** Define and enforce an admissible property-file grammar. Reject unsupported assertion access, aliasing, and binding ambiguity instead of silently omitting them. Add a regression combining a recognized assertion with a skipped computed or aliased assertion.

3. **packages/api/src/property.ts:142 — factually wrong — high — One failing report overrides invalid or incomplete base evidence.**

   For `onBase: 'fails'`, the implementation accepts any report satisfying:

   ```ts
   r.failed && r.seed === check.seed && r.file !== ''
   ```

   It does not require a registered location, positive executed-case count, complete registration coverage, or valid reports for the other properties. It ignores the comparison’s structural failures.

   A concrete locked suite contains one failing property and another registered property inside `it.skip`. The first report admits the base even though the second never reports. Likewise, a second property can run fewer cases or use another seed without preventing admission. Static suite selection still counts the file, so the subsequent suite-count check does not repair this.

   This is distinct from allowing early termination of a property that actually found a counterexample: unrelated registrations and invalid locations are being ignored.

   **Resolution:** Separate report-integrity validation from the expected truth outcome. Require complete, correctly located reports with the pinned seed; require full counts for successful properties and legitimate counterexample execution for failed ones. Only then evaluate whether the base demonstrated a failure.

4. **packages/api/src/security.ts:157 — a tradeoff I would have made differently — medium — Authorization-property coverage is satisfied by a label attached to a tautology.**

   The policy checks whether a required property check names the rule in `deniesRule`. Admission checks assertion presence, not whether an assertion exercises authorization.

   A required check with `onBase: 'passes'`, `deniesRule: 'owner-only'`, and this property satisfies the new requirement:

   ```ts
   fc.assert(fc.property(fc.integer(), n => n === n));
   ```

   It passes regardless of the authorization implementation. Another check can provide the manifest’s required base failure.

   The conformance fixture explicitly uses this construction: `HOLDS` contains `n === n`, and `POLICY_REQUIRES_A_PROPERTY_PER_RULE` assigns it to `owner-only`. Its denial check is also just `process.exit(0)`. That assertion tests metadata enforcement, not authorization protection.

   **Resolution:** Describe the policy accurately as requiring a *declared association*. If it is intended to establish behavioral coverage, add trusted negative controls or authorization mutants that the associated properties must reject. General semantic adequacy cannot be established by counting `assert` calls.

5. **packages/api/test/property.test.ts:28 — factually wrong — low — The empty-registration test does not exercise its stated condition.**

   The test titled “no registration at all never holds on an empty report” supplies `evidence([run(3)])`, a nonempty report. It passes because that report is unregistered.

   In fact:

   ```ts
   propertyOutcome(pin, [], 0, evidence([]))
   ```

   returns `{ held: true }`. Current admission and preparation prevent an entirely empty registration set on the normal path, so this is not independently an end-to-end bypass.

   **Resolution:** Test the actual empty/empty case and either reject it in `propertyOutcome` or explicitly document and test its nonempty-registration precondition.

The following mechanisms are sound within their stated boundaries:

- **Artifact binding and tamper checks:** named property files must be admitted locked artifacts (**packages/api/src/verification.ts:161**), and verify rejects changes to admitted paths before execution (**packages/api/src/line.ts:1644**).
- **Ordinary fail-closed comparison:** given authentic reports and a complete registration set, `propertyOutcome` rejects missing reports, wrong seeds, short successful runs, failed properties, and nonzero exits (**packages/api/src/property.ts:95**).
- **Capability and input validation:** absent adapters and unreadable property files are refused; manifest pins receive runtime numeric validation rather than relying on TypeScript types (**packages/api/src/property.ts:155**, **packages/api/src/validate.ts:327**).

I found no independent bypass through casts, `any`, `unknown`, declaration merging, module augmentation, generic erasure, or type predicates under the supplied trust model. Changing product-side types does not change the runtime’s validator. The relevant language escape is executable JavaScript sharing mutable process state with the observer.

The adversarial framing is appropriate. The central question is whether the runtime observes execution through a boundary the change cannot control; here it parses claims from a process the change inhabits. Separately, authentic execution of finitely many pinned cases cannot establish universal correctness. That sampling limitation is expected for property testing; fabricated execution evidence and silently omitted assertions are not.