# Triage of R5a's external reviews, 2026-11-26

Codex counted on its first run. Gemini's first two runs were `FAILED`: Google answered HTTP 402 for depleted prepaid credit before any reply, and no review existed from either. The maintainer topped the project up and the third run counted. All three runs' files are committed, the failed ones as `.attempt-1` and `.attempt-2`.

Codex (gpt-6-astra) raised 1 finding. It holds, and is fixed. Gemini (gemini-3.1-pro-preview) raised 2. Neither holds: one rests on a premise the code does not have, and one describes a deliberate mechanism that predates this unit as a defect. No finding was raised by both families.

| Family | Raised | Hold | Hold in part | Do not hold |
|---|---|---|---|---|
| codex | 1 | 1 | 0 | 0 |
| gemini | 2 | 0 | 0 | 2 |

Codex left item 5 of the prompt unanswered. Gemini left items 2, 3, 4, 6 and 7 unanswered. Neither silence is an endorsement.

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | the locked graph file is in every builder's tree, so a builder can read every task's objective whatever its `task-graph` grant filters, and the objective assertion never reads a tree | codex | holds | fixed: the file is left out of builders' trees, and the assertion reads them |
| gemini-1 | `boundGraph` picks the costliest role by `budget.maxCostUsd`, but tiers and escalation make another role cost more, so the approved figure is too low and the lock then throws | gemini | does not hold | rejected |
| gemini-2 | `review` offers `plan` and `author-narrative`, which the review contract drops; add them to the contract or stop offering them | gemini | does not hold as a defect; predates this unit | rejected |

## codex-1: the graph file is a way around the objective filter

**Claim.** `taskGraphGrant` gives a builder its own task's objective and its dependencies'. `lockApproved` writes the whole graph file into the base, builders' trees are built from the base, and so builder `b` can open `.drafts/<run id>/graph.json` and read `a`'s objective with no dependency on `a`. `I3.objective-reaches-the-builder-never-the-reviewer` reads request text and never a tree, so it passes with the exposure present.

**Checked.** A fresh-context reading of `lockApproved`, `build`, `omitWithheld` and `reviewView` confirmed each step: the file is written into the base, `build` materializes from the base and accepted diffs, and `omitWithheld` removes only paths a sensitive class matches. It also confirmed the limit of the finding: `reviewView` copies an allow-list of the spec, the tests and the diff's files, so no review seat's tree holds the graph. Then the assertion was extended to read each builder's tree as its call began, with a control that the tree holds the locked spec. Against the code as reviewed it failed: `the tree of a's builder holds the locked graph file, every task's objective in it`.

**Found.** The finding holds. The unit recorded this as a known limit (D-R5a-05), on the ground that a supplied graph file is in a builder's tree as well. That ground does not carry: a supplied graph is written by the person who wrote the spec, and a drafted one is model-written text approved per task. The consequence is narrower than the reviewer's severity suggests, because a planner can already address any builder through that builder's own objective, and no review seat is reached. What it does break is the deliverable as written, and a filter that a file read defeats is a control that does not do what it claims.

**Options.** (1) Leave the file out of every builder's tree. (2) Keep the graph out of the base altogether. (3) Drop the filter and hand every builder every objective. Option 2 contradicts the spec's lock, which writes the approved bytes into the base, and would leave `verify`'s trees without a locked artifact they hold today. Option 3 gives up the deliverable. Option 1 was chosen: it uses the mechanism a withheld path already uses, so the base and every tree `verify` builds still hold the file, and a builder that writes the path adds a locked artifact to its own diff, which `verify` already records as a tamper.

**Changed.** `build` (`packages/api/src/line.ts`) leaves a drafted graph's locked file out of the start and work copies. The assertion now requires that no builder's tree holds the file or any objective text. A supplied graph's file is unchanged: it stays in a builder's tree, as before this unit, and D-R5a-05 says so.

## gemini-1: the costliest role

**Claim.** `worstCaseCost` factors in tier pricing and escalation, so a role with a lower `maxCostUsd` and a higher escalation ceiling can cost more than the role `boundGraph` picks. The figure approved at admission is then too low, a draft using that role passes, and `graphWithinBound` throws at the lock instead of sending the draft back.

**Checked.** A fresh-context reading of `worstCaseCost` and `maxStarts`: a task's share is its call count times its role's `budget.maxCostUsd`, and nothing else. The call count is `(maxIterations + conflicts) * (retry.max + 1)`, from the station's contract and the policy's `maxConflictRetries`, so it is the same for every build task in a run. Tier, `tierByStation` and the escalation grant enter neither. Then the case was built and run: a role with half the ceiling, `tierByStation` set, and an escalation grant up to `deep`, against a role with the full ceiling and none. A graph of two tasks under the escalating role cost less than the bound's figure.

**Found.** The premise does not hold, so the construction does not exist. The second half is an accurate description of an unreachable branch: `graphWithinBound` throws. That is the spec's "the line asserts it before the lock", an assertion that the argument above still holds on the numbers, and it stops the run if a later change breaks it.

**Outcome.** Not changed. Its alternative, sending such a draft back from `readGraphDraft`, would turn a broken runtime guarantee into a planner's retry.

## gemini-2: grants the review seat is offered and does not get

**Claim.** `review` puts `plan` and `author-narrative` in the offered context, the review contract allows neither, and `grantedContext` drops both. Add them to the contract or remove them from the offer.

**Checked.** A fresh-context reading confirmed the description, and found why: the comment at that spot says everything the line has is offered and `grantedContext` keeps a seat to its contract; `REVIEW_FORBIDDEN_GRANTS` names exactly these two; and `I6.reviewer-receives-no-author-material` asserts that neither reaches the reviewer "although the line offers both". `git show origin/v2:packages/api/src/line.ts` holds both lines: this unit changed `ctx.graph.tasks` to `graphOf(ctx).tasks` and nothing else there.

**Found.** Not a defect, and not this unit's. Adding the grants would hand a reviewer the author's account, which a review seat must never hold. Removing the offer would leave the existing assertion passing whether or not the contract withheld anything.

**Outcome.** Not changed.
