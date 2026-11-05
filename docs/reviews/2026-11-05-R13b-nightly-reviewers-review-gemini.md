# External review of R13b, gemini, 2026-11-05

The adversarial review of R13b's two nightly reviewer jobs, by the Gemini family, from the committed bundle. The triage of this review and its Codex companion is `2026-11-05-R13b-nightly-reviewers-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration. This is the second run; the first, `2026-11-05-R13b-nightly-reviewers-review-gemini.attempt-1.run.json`, was `FAILED` on an HTTP 402 from the API and returned no reply.
- **Cross-family agreement:** gemini-2 (the tree review's author window) was raised by Codex too, as codex-1. gemini-1 and gemini-3 were raised by Gemini alone.
- **Date:** 2026-11-05
- **Bundle:** `2026-11-05-R13b-nightly-reviewers-review-bundle.txt`, SHA-256 `cc142a44911b154a4db4e62101bd6bd28d9697026988c68f45cd8c1ca7fbbaeb` (the manifest's `bundleSha256`), base `adf5c9e` (`reviewed/R13a`), head `e3fcd98` (the unit branch's last code commit before the review). It held every changed package file under `packages/` and the changeset, new files whole and modified files as unified diffs; `docs/decisions.md` and `docs/plan/R13-nightly.md` were excluded, so the reviewer saw no design record. Prompt: `2026-11-05-R13b-nightly-reviewers-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context and performed no external lookups. This is a self-report and is not independently verifiable.
- **Coverage, and any gap:** items 1 and 3 were answered by findings 1–3, and item 7 by one sentence saying the framing fits. Items 2 (tautological checks), 4 (language escape hatches), 5 (configuration satisfied without effect), and 6 (sound mechanisms) came back empty; that is silence, not clearance.
- **Citations:** Line numbers are positions in the bundle's new-side hunks, not the repository; each was treated as a hint and the cited construct was located by name in the triage.

---

BASE: adf5c9e
HEAD: e3fcd98
packages/vault/src/types.ts
7391d7dbcd7415199ed27b6185e3cca4

I have reviewed the code with no prior context and performed no external lookups. The adversarial framing fits perfectly, as it highlights how the reliance on unvalidated free-text records and historical omissions breaks the runtime's security properties.

Here are the concrete bypasses and issues found:

1. packages/api/src/nightly-review.ts:80 — concrete bypass — high — text a model wrote into a reviewer's prompt as instructions
**The bypass:** In `dayItems`, when mapping a `violation-recorded` or any enforcement decision, the `d.taskId` is placed directly into the fields object (`const base = { cause: d.decision.cause, decidedBy: d.decision.decidedBy, taskId: d.taskId, station: d.station };`). The prompt confirms that drafting models can write the check IDs that become task IDs. Because `taskId` is ingested without `charClass` validation and passed directly into `fields`, it is included when `findingsReview` does `JSON.stringify(items)` to build the reviewer's prompt. An adversarial drafting model can write arbitrary system instructions into a check ID, causing a decision on that task to cleanly inject those instructions straight into the reviewer model's prompt, bypassing the envelope.
**What would resolve it:** Exclude `taskId` from `decisionFields` or validate it against a strict character class like `identifier` before projecting it into the reviewer's context.

2. packages/api/src/nightly-review.ts:319 — concrete bypass — high — get a reviewer of an author's own model family recorded as independent
**The bypass:** In `treeReview`, the `mergedSince` function is responsible for gathering authors to check reviewer independence against, but it explicitly filters for runs merged *since the job's last completed run started*. However, `nightly-tree-review` mounts and reviews the *entire* repository tree, which contains historical code authored by models across all past merges. Because authors of older merges are excluded from `authors`, a reviewer model assessing its own model family's historical code will pass the `seatReviewer` check and be inaccurately recorded as having `different-family` (or `no-author`) independence.
**What would resolve it:** For a whole-tree review, collect authors from *all* historical merged runs that contributed to the tree, rather than limiting the window to only runs merged since the last job execution.

3. packages/api/src/nightly-review.ts:301 — concrete bypass — medium — make either job fail open, recording "completed, nothing found" when it did not review
**The bypass:** In `findingsReview`, if the runtime recorded no items for the previous day (`items.length === 0`), the job skips seating a reviewer entirely and returns `{ refusals: [], review: empty(subject) }`. Because the `refusals` list is empty, `nightly.ts` records the job's outcome as `{ kind: 'completed' }` with `findings: []` (signifying "nothing found"). This creates a fail-open scenario where the service incorrectly reports a successful, completed review yielding zero findings, rather than acknowledging that a review was not and could not be performed.
**What would resolve it:** Return a distinct refusal (e.g., `cause: 'no-records'`) when `items.length === 0` rather than an empty refusals list, ensuring the recorded outcome reflects that the check was aborted.