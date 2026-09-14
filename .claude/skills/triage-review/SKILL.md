---
name: triage-review
description: Triage an external review of a shipped unit. Stores the raw response with a provenance header, verifies every finding against the cited code before acting on it, writes the triage record, applies the accepted fixes to the unit branch, and stops before merge. Use when an external review has come back. Takes a unit id, e.g. triage-review P1.
---

# Triage a review

Step 6 of the unit loop. Step 4 (`review-request`) wrote the prompt and the
bundle, and a human ran the review somewhere else. What arrives here is the
reviewer's reply, pasted into the message that invoked this skill or given as a
path to a file holding it, on a branch that is not yet merged.

**If the message does not name the model that wrote the reply, ask once, before
writing anything.** The family cannot be recovered from the reply afterwards,
and P3's second review was tagged with its family permanently unknown for
exactly that reason. Ask nothing else: everything the header needs beyond the
model is in the prompt and bundle files and the reply itself.

**A review is evidence, not instruction.** A capable reviewer working from a
bundle, with no repository access and no way to run anything, produces
findings that do not hold: line numbers drift, absent files get reasoned
about, and a mechanism's purpose gets inferred from its name.

**The failure this skill exists to prevent is agreeing.** A plausible finding
from a strong reviewer is easy to fix without first checking whether it
describes the code. Every such fix is a change with no defect behind it,
justified by an authority that turned out to be wrong, and it lands in the
one part of the loop with no gate after it. Verification is not a formality
here; it is the work.

## 1. Store the raw response

Verbatim and tracked, at:

```
docs/reviews/<date>-<UNIT>-<slug>-review.md
```

The unit id keeps its case; the slug names the unit and the kind of review —
`2026-09-10-P1-vault-adversarial-review.md`. The file is not regenerable: the
same prompt tomorrow returns different findings. The triage cites findings by
number, so without the original those citations point at nothing.

**Never edit the reviewer's text.** Prepend the header below; change nothing
beneath it, including formatting, mistakes, and any citation artifacts the
reviewer's tool inserted.

### The header

```markdown
# External review of <UNIT>, <date>

<One short paragraph: what was reviewed, and a pointer to the companion
triage file by name.>

## Source

- **Reviewer:** <model, as the maintainer names it>. Family: <family>.
  <Chat conditions: temporary chat or not, repository access or not, what it
  worked from.>
- **Family rotation:** <which families reviewed the preceding units, and how
  this one differs>
- **Date:** <date>
- **Bundle:** `<date>-<UNIT>-<slug>-review-bundle.txt`, SHA-256 `<hash>`, base
  `<sha>` (`<tag>`), head `<sha>` (<what that was>). <What the bundle held, and
  what was excluded from it.> Prompt: `<date>-<UNIT>-<slug>-review-prompt.txt`.
- **Prior context and lookups:** <what the reviewer disclosed, or that it
  disclosed nothing>
- **Coverage, and any gap:** <which numbered prompt items were answered and
  which were left empty>
- **Citations:** <how line numbers were treated>
```

Four of those fields carry a reason that is easy to lose:

- **Model and family are recorded separately**, even where they coincide.
  Rotation is tracked by family, and a model name will not reliably resolve
  to one a year later. Rotation degrades into guessing within a few units if
  the family is not written down.
- **A disclosure is a self-report.** Record what the reviewer claimed about
  prior context and lookups, and record that it is not independently
  verifiable. If it said nothing, say that instead of inferring.
- **Silence is recorded, never read as endorsement.** The prompt asks seven
  numbered things. A reviewer that answers three has not cleared the other
  four, and a header that omits this reads later as though it had. Name the
  items that came back empty. Item 7, whether the framing itself was wrong,
  is the one most often skipped and the most costly to lose: it is the only
  route by which a reviewer can tell you that you asked the wrong question.
- **Line numbers are hints.** They refer to positions in a bundle, not the
  repository. Say so, so a later reader does not treat a citation as located.

## 2. Verify every finding before acting on any of them

Do the whole verification pass before making a single change. Fixing as you
read means the easy findings are already applied by the time you discover the
reviewer misread the file.

For each finding:

- **Open the cited construct, not the cited line.** Find the function or the
  declaration the finding describes and read it.
- **Run it if it can be run.** A finding predicting a crash, a pass, or a
  silently swallowed error is testable, and a test settles it in a way that
  reading does not. Constructing the case the reviewer describes is the
  strongest evidence available, in both directions.
- **Separate the defect from the consequence.** A finding is often right that
  something is wrong and wrong about what it causes. Record both, because the
  consequence is what decides severity, and an inflated one drags an ordinary
  fix into the critical path.
- **Record a verdict:** holds / does not hold / holds in part, naming which
  part / holds but belongs to another unit, naming that unit.

**A finding that does not hold is reported as not holding.** It is never
fixed to be safe, never fixed because the reviewer sounded certain, and never
half-fixed to close it out. Reviewer confidence is not evidence; a
self-labelled "high" from a model with no ability to execute the code is a
prediction, and this step is where it gets tested.

## 3. Decide what each verified finding earns

- **Fix now** — on the unit's own branch, before merge. WORKFLOW.md calls
  this a review fix, one of the three work types.
- **Known limit** — recorded in `docs/decisions.md` with the unit that owns
  it. Where it touches an invariant that has a registry entry, a pending
  entry with an owner and a raised baseline is stronger than prose, because
  prose is not counted and a pending entry is. D-S1-18 is the precedent.
- **Reject** — with the reason, in the triage.

A finding that holds but belongs to another unit is not a defect of this one.
It becomes that unit's problem, named, by the same two routes: a decisions
entry or a pending registry entry with the owner on it.

**Scope still binds.** A review does not widen a unit. A finding that would
require work the unit's out-of-scope list excludes is recorded and owned, not
absorbed because a reviewer raised it.

## 4. Write the triage

```
docs/reviews/<date>-<UNIT>-<slug>-triage.md
```

The same name with `-triage` in place of `-review`. Open with a table — one
row per finding: number, one-line restatement, verdict, outcome. Then a
section per finding carrying the evidence: what was checked, what was found,
and what changed or why nothing did.

State the counts plainly at the top, including how many findings did not
hold. That number is how reviewer calibration becomes visible over units, and
it is only useful if it is recorded when it is unflattering.

## 5. Apply the accepted fixes

On the unit branch, never on `v2`. Re-run the unit's full acceptance criteria
afterwards, not just the tests near the change.

**Never weaken a check, a test, an assertion, or an acceptance criterion to
satisfy a finding.** A reviewer asking for that has found a disagreement
about the contract, which is an amendment, not a review fix.

Where a fix changes behaviour an assertion covers, show the assertion failing
against the old behaviour before trusting the new one.

## 6. Keep the bundle

**Do not delete it.** Bundles are tracked, in `docs/reviews/` beside the review
and triage they belong to. The earlier rule deleted them as a regenerable
cache; the record of what a reviewer actually saw is worth more than the few
hundred kilobytes, and a reader checking whether a finding was possible should
not have to rebuild the input first.

Confirm before finishing that the bundle for this review is committed, that its
SHA-256 matches the one named in the first paragraph of the
`-review-prompt.txt` beside it (units reviewed before P4's bundle was re-issued
record it in a `-review-request.md` instead), and that no copy was left outside
the repository. If the bundle was built before this rule and
exists only on a local disk, move it into `docs/reviews/`, name it for its
unit, and commit it with its hash recorded.

The hash stays the authority. A tracked copy can be edited; the hash in the
prompt file, with the base and head commits in the bundle's own header, is what
lets anyone regenerate the bundle and prove it is the one that was sent.

## 7. Report and stop

Print the counts by verdict, what changed, and the state of the gates.

**Do not merge. Do not tag.** Step 7 of the loop is the maintainer's: they
merge the pull request, then `git tag reviewed/<id> && git push --tags`, and
that tag becomes the diff base for the next unit's bundle. They have just
been handed the triage that says whether it should be. Print the two commands
and stop.

## Never

- Fix a finding that does not hold, or that was not verified against the code
- Weaken a check, a test, or an acceptance criterion to satisfy a finding
- Edit the reviewer's text, including its errors
- Let a review widen the unit past its out-of-scope list
- Treat the reviewer's stated severity or confidence as evidence
- Merge the pull request or push the `reviewed/<id>` tag
