# External review of R16, codex, 2026-11-09

The external review of R16, bug-fix intake, by the Codex family. Triage: `2026-11-09-R16-bug-fix-intake-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`. Ingestion 107,360 input tokens against a floor of 73,553; all four markers echoed.
- **Cross-family agreement:** none. Gemini raised no findings, so all three below were raised by Codex alone.
- **Date:** 2026-11-09
- **Bundle:** `2026-11-09-R16-bug-fix-intake-review-bundle.txt`, SHA-256 `25983451d371591ade6b3b37d51217a3fd7e13890b0a1ca2c9916ad29857a021` (the manifest's `bundleSha256`), base `6118b1e` (`reviewed/R24`), head `770ae1c` (R16's unit commit, before review fixes). Every new file in full and every modified file as a function-context diff; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` excluded. Prompt: `2026-11-09-R16-bug-fix-intake-review-prompt.txt`.
- **Prior context and lookups:** it disclosed no prior context and no external lookups, and said a local file-listing attempt was blocked. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 1 (codex-1, codex-2), 6, and 7 (codex-3) were answered; for items 2–5 it reported finding nothing, and said the base-run execution code was not in the bundle.
- **Citations:** line numbers are positions in the bundle's new side of each diff, not the repository; they are hints.

BASE: 6118b1e  
HEAD: 770ae1c  
packages/vault/src/types.ts  
12fb7e9747dd63b9251a0d5adee936d1

I had no prior project context and performed no external lookups. I reviewed the bundle embedded in your prompt. A local file-listing attempt was blocked; I ran no tests.

1. **packages/integrity/src/types.ts:82; packages/api/rubrics/test-design.md:18 — unclear — high — Reproduction is a semantic judgment, not a property established by the runtime.**

   A test drafter can declare a required behavioral check with `reproduces: true` and `onBase: 'fails'`, while its script checks an unrelated condition:

   ```js
   const fs = require('node:fs');
   process.exit(fs.existsSync('unrelated-marker.txt') ? 0 : 1);
   ```

   Put this script in the declared test directory and name it in the command. It fails on a base without that file. The builder creates the file; the same locked check passes while the reported defect remains.

   The new validation checks the declaration and the base outcome, but does not establish a relationship between that outcome and the defect. Keeping `defect.json` byte-identical does not establish that relationship either.

   **The critic and any required human approval remain real barriers.** This is not a demonstrated bypass of those barriers: rubric item 7 explicitly tells the critic to reject this construction. The issue is treating the runtime’s observed failure as proof of reproduction under an adversarial guarantee. Trusted drivers do not make model judgments infallible.

   **Resolution:** Explicitly describe defect correspondence as a critic/person judgment. Require approval of the particular reproduction and its observed failure reason if that judgment must be trusted. Add a negative conformance case with an unrelated failing check; the current reproduction test exercises declarations and a cooperative example, not semantic discrimination. Confidence: high about the deterministic gap; acceptance through the critic remains untested.

2. **packages/api/src/http/server.ts:152 — factually wrong — medium — HTTP intent parsing does not honor an inherited candidate template.**

   Submit an authenticated request containing a bug-fix candidate and:

   ```json
   {
     "intent": {
       "steps": "Run the affected operation.",
       "actual": "It fails.",
       "expected": "It succeeds."
     }
   }
   ```

   Omit `template`, as candidate inheritance permits. `createBody` recognizes the object-shaped intent only when the request explicitly says `template: 'bug-fix'`. Otherwise it rejects this object as a non-string before `templateOf` can inherit the candidate’s template.

   Using a string instead does not help: admission subsequently inherits `bug-fix` and rejects the string-shaped intent. Consequently, callers must redundantly name the template to use the HTTP route. The conformance test for inheritance calls admission directly, so it misses this discrepancy.

   **Resolution:** Parse both supported intent shapes independently of the explicit template, then let admission enforce compatibility with the resolved template. Add an HTTP test admitting a bug-fix candidate without an explicit template. Confidence: high.

The mechanisms I assess as sound within the shown code and stated trust boundary are:

- **Template authorization:** `run.ts:651` resolves candidate templates from the trusted Vault and checks personal requests against `runTemplates`. Omitting or nulling a candidate request’s template does not remove its inherited classification. The policy validator also checks actual template values and allowed trigger kinds.
- **Defect preservation:** `drafting.ts:482` collects required draft files and checks the defect’s hash against runtime-generated bytes. Missing files and altered content become problems. Both new parts enter the locked artifact set. This preserves the person’s statement, though it cannot prove a check follows it.
- **Dismissal versus admission:** Both LocalVault operations use exclusive creation of the same candidate mark. A dismissal winning after admission’s preliminary read still prevents the final admission mark. The HTTP route authenticates before dismissal and validates a closed cause set.

I found no demonstrated new exception-to-pass or missing-file-to-pass path in these mechanisms. The execution and result-handling implementations behind base checks are not included, so I cannot independently certify their handling of skipped tests, process errors, or empty execution.

I also found no strictly tautological new conformance assertion. The reproduction assertion is **weaker than the semantic claim**, rather than always true: removing the declaration enforcement would make its negative cases fail.

The TypeScript casts and predicates shown do not provide an in-scope exploit by themselves. JSON callers cannot introduce declaration merging, module augmentation, getters, or custom prototypes into the runtime merely by submitting fields. The `Intent` type’s `from: 'principal'` tag is not authentication; the authenticated HTTP route supplies the actual boundary. A cast performed by runtime code would require control explicitly excluded here.

Finally, the framing needs one qualification at **packages/api/src/spec-parts.ts:176 — unclear — medium**: “any byte of a report” cannot literally be the protected property. A person can legitimately copy a command, error message, or repository identifier into the three intent fields; `defectIntentText` then carries those bytes to the model. That is authorized human input under your assumptions.

The useful questions are whether tracker-controlled data has an **automatic path** into model context, and whether the approved check actually exercises the person-authorized defect. I found no concrete automatic tracker-to-prompt path in the supplied changes. The second question remains dependent on semantic review, beyond the runtime’s hashing and base-failure checks.