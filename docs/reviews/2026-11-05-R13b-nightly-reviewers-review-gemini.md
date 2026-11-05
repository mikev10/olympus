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