# Triage of R16's external reviews, 2026-11-09

Two reviews, both `counted`, each on the first run: Codex (gpt-6-astra, 107,360 input tokens against a floor of 73,553) and Gemini (gemini-3.1-pro-preview, 105,550 against the same floor). Neither family was rerun. Each reply's SHA-256 matched its manifest's `replySha256` before its header was added.

- **Codex:** 3 findings. 2 hold: one fixed (codex-2), one recorded as a known limit with an owner (codex-1). 1 is a framing qualification, accepted as stated, with no code change (codex-3). 0 did not hold.
- **Gemini:** 0 findings. It answered items 6 and 7 only, assessing every mechanism sound; items 1–5 came back empty.
- **Raised by both families:** none.

Each finding was checked by a fresh-context reader against the cited code, and codex-2 also by a test run before and after the fix.

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-2 | `POST /runs` refuses a three-part intent with no `template`, so a run from a bug-fix candidate cannot inherit the candidate's template over HTTP | codex | holds | fixed, 582fcc3 |
| codex-1 | The runtime checks a reproducing check's declaration and its failure on the base, never that the failure is the defect's | codex | holds | known limit, owned by M3 mutation testing (D-A-BG-05) |
| codex-3 | "Any byte of a report" is too broad: a person may copy a report's text into the three parts, which is authorized | codex | holds as a framing point | accepted; no change |

## codex-2: HTTP intent parsing ignores an inherited template

- **Checked:** `createBody` in `packages/api/src/http/server.ts` read an object intent only beside `template: 'bug-fix'`; otherwise any non-string intent was a 400. `templateOf` in `packages/api/src/run.ts` resolves a candidate's template at admission, after the body is parsed. A string intent in an inherited bug-fix run is refused there as `not-an-intent`. The fresh-context reader confirmed all three.
- **Run:** a new case in `I4.run-template-granted-by-policy` posts a bug-fix candidate with the three parts and no `template`. Against the old code it answered `400 {"error":"bad-request","message":"intent is the text a drafted spec is drafted from"}`.
- **Fixed:** the route reads either intent shape whatever the body names, and admission, which resolves the template, refuses a shape that does not fit (D-R16-10). After the fix the same request reaches admission's cost check (`422 cost-unapproved`). All ten R16 assertions pass.
- **Options weighed:** making `template` required beside `candidate` was rejected. It restates what the candidate already fixes, and a mismatch is already refused as `not-the-candidates`.

## codex-1: reproduction is a judgment, not a runtime property

- **Checked:** `reproductionProblems` and `checkProblems` (`packages/api/src/validate.ts`) check the declaration, and R15's base run checks the failure. `defect.json` is held to the runtime's bytes. Nothing links the check's failure to the defect's content. Confirmed.
- **Consequence:** a check that fails on the base for an unrelated reason passes the runtime. It then rests on the `test-design` critic, whose rubric point 7 asks exactly this, and on the person approving the draft. The reviewer agrees this is no bypass of either.
- **Outcome:** this is the known limit D-A-BG-05 recorded when the amendment was confirmed ("no code can tell that a check follows prose steps"), owned by mutation testing in M3. The suggested negative conformance case, an unrelated failing check, would only assert that the runtime accepts it. That proves nothing a control does, so it is not added. No fix.

## codex-3: the framing

- **Checked:** `defectIntentText` (`packages/api/src/spec-parts.ts`) puts the person's three parts in the spec drafter's prompt, and a person may have copied text from the report into them. That path is by design (D-A-BF-02): the person's channel is the boundary. The property the suite asserts is the narrower one the reviewer proposes. No tracker field, no body, and no marker reaches any request automatically (`I7.bug-fix-run-sends-no-report-text`). The reviewer found no such path.
- **Outcome:** accepted as a sharper statement of the question; no change.

## Gemini

It reported no findings, and its reply has no sections for items 1–5. That is recorded in its header as silence, not as clearance. Its item 7 judged the framing correct, which disagrees with codex-3. The disagreement is about how the question was worded, not about the code.
