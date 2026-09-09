---
name: review-request
description: Prepare an external adversarial review of a shipped unit. Generates the diff bundle and a tailored review prompt to paste into a different AI. Use after a unit ships and before the next one starts. Takes a unit id, e.g. review-request F3.
---

# Prepare an external review

The reviewer is a **different model family** in a clean room — not Claude Code,
not the session that built the unit. That independence is the point: a reviewer
sharing the author's context inherits the author's blind spots.

Your job is to produce two artifacts and stop. You do not perform the review.

## 1. Determine the range

Base is the last reviewed tag; head is the unit's tip.

```
git tag --list 'reviewed/*' --sort=-creatordate | head -1
git log --oneline <base>..HEAD
```

If no tag exists, ask which commit to diff from. Do not guess.

## 2. Generate the bundle

Full contents of changed files, not diff hunks — a reviewer hunting for bypasses
needs surrounding context, and a hunk hides it.

```bash
{
  echo "BASE: <base>"; echo "HEAD: $(git rev-parse --short HEAD)"; echo
  echo "=== COMMITS ==="; git log --oneline <base>..HEAD; echo
  echo "=== CHANGED ==="; git diff --stat <base>..HEAD; echo
  git diff --name-only --diff-filter=ACMR <base>..HEAD | while read -r f; do
    [ -f "$f" ] || continue
    case "$f" in docs/decisions.md|docs/reviews/*|docs/plan/*) continue ;; esac
    printf '\n===== %s =====\n' "$f"; cat "$f"
  done
} > ~/Desktop/olympus-<unit>-review.txt
```

**Excluded by construction, and why.** `docs/decisions.md` carries author
reasoning and prior review outcomes — a reviewer reading it inherits
conclusions already reached and stops questioning them. `docs/reviews/` holds
what earlier reviewers found. `docs/plan/` is the spec the code is judged
against; the reviewer gets the invariants restated in the prompt instead.

Never include anything from `.plan/`. Confirm with `grep -c '\.plan/'` and
`grep -c 'docs/decisions.md'` before handing the bundle over.

## 3. Derive the unit-specific half of the prompt

From `docs/plan/DECOMPOSITION.md` and the unit's spec, extract four things:

- **What the unit built**, in two or three sentences, no jargon the reviewer
  cannot resolve from the bundle
- **The mechanisms that matter** — the two to four things a bypass would target
- **Which invariants it touches**, stated in full (the reviewer has no `docs/plan/`)
- **Out of scope**, verbatim, so absent work is not reported as a defect

**The adversarial question is derived from what the unit does.** Conformance
infrastructure: *how would I make this pass without the invariant holding?*
A vault: *how would I write to it?* A sandbox: *how would I escape the mount or
reach a read-only path?* A policy engine: *how would I obtain a capability that
was not granted?* Get this wrong and the review reads like a code-style pass.

**Name mechanisms, never verdicts.** Say what a mechanism does and leave every
judgment to the reviewer. No "this should be solid", no "the weak point is
probably X", no target number of findings, no hint at what a previous review
found. Framing tells the reviewer what failure would mean; it never tells them
where to look for it.

**A limit worth knowing:** this half of the prompt is written by the same system
that built the unit, so the mechanisms it names are the ones it thought about. A
bypass nobody considered lives in a mechanism nobody lists. That is why the
reviewer receives the full bundle rather than only the named mechanisms, and why
item 7 below invites it to reject this framing outright.

## 4. Emit the prompt

Fill the template below and print it for the maintainer to copy. The clean-room,
calibration, and output sections are fixed — do not reword them. They are what
separates a useful review from a list of style opinions.

```
You are reviewing <what: e.g. the conformance testing infrastructure> of a
TypeScript project. You have the source and nothing else — no design documents,
no author reasoning, no prior version, no conversation that produced it.

If you hold any prior context about this project from earlier conversations,
stored memory, or anything you have seen before, set it aside. Do not search
for the project or its author.

CONTEXT YOU NEED

<two or three sentences on what this code does and why>

It must hold against a capable, motivated party trying to <the unit's failure
mode: make CI green without doing the work / write to the vault / escape the
sandbox / obtain an ungranted capability>. Assume no deceptive intent — only
that the easiest path gets taken.

The invariants at stake:

<each relevant invariant, stated in full>

The mechanisms that matter most:

<two to four, one line each>

EXPLICITLY OUT OF SCOPE FOR THIS UNIT

<verbatim from the unit spec. Absent work listed here is not a defect.>

THE QUESTION

<the derived adversarial question>

Report concretely:

1. Places where the mechanism can succeed while the property it protects is
   violated. Give the specific construction.
2. Checks that are tautological — that would pass regardless of the code under
   test.
3. Anything that fails open: an error, a missing file, an empty result, a
   skipped test, or a thrown exception yielding a pass.
4. Escape hatches specific to the language: casts, unknown, any, declaration
   merging, module augmentation, generic erasure, type predicates.
5. Ways the configuration can be satisfied without doing what it appears to do.
6. Which mechanisms you assess as sound, and why. If none are, say so.
7. Whether the framing above is right. If the adversarial question is the wrong
   question for this code, say so and explain what you would ask instead. That
   is a finding, not a digression.

HOW TO REVIEW

- Report what you find. Do not aim for a count, and do not manufacture findings
  to appear thorough.
- Label each as: factually wrong / unclear / a tradeoff I would have made
  differently.
- Cite file and line.
- State confidence where uncertain, and what you would check to resolve it.
- Do not defer to the code's own comments. A comment asserting a property is
  not evidence the property holds.

OUTPUT

Per finding: file:line — type — severity (high/medium/low) — the concrete bypass
or issue — what would resolve it.

Order by severity, highest first. State at the top whether you had any prior
context and whether you performed any lookups.
```

## 5. Report and stop

Print the bundle path and the prompt. Remind the maintainer:

- Paste into a **temporary chat** — no memory, no history
- Use a **different model family** than the last reviewer, and rotate across
  units; two runs of the same family return correlated findings, which reads as
  consensus and is one opinion sampled twice
- Bring the findings back for triage; findings are not instructions

Do not review the unit yourself. Do not act on a review you did not receive.

## 6. When the review comes back

Store the raw response verbatim at
`docs/reviews/<date>-<UNIT>-<slug>-review.md`, **tracked** — for S1,
`docs/reviews/2026-09-09-S1-walking-skeleton-adversarial-review.md`. The unit
id keeps its case; the slug names the unit and the kind of review. The file is
not regenerable — the same prompt tomorrow returns different findings — and the
triage record cites findings by number, so without the original those citations
point at nothing.

Its header must record: the **model and family** that produced it, the date, the
bundle's base and head commits, and whether the reviewer disclosed prior context
or lookups. Rotation degrades into guessing within a few units if the family is
not written down, and reviewer calibration over time is impossible without it.

Then triage into `docs/reviews/<date>-<UNIT>-<slug>-triage.md`, the same name
with `-triage` in place of `-review`: which findings were accepted, which
recorded as known limits, which rejected and why, which could not be verified
against the cited line.

**Verify every finding against the cited line before acting on it.** The
reviewer had no repo access and worked from a bundle; line numbers drift, and
findings self-labeled medium confidence are often reasoning from an absent file.
A finding that does not hold is reported as such, never fixed.

The **bundle** is not stored. It is `git diff` output, reproducible from the
recorded base and head, so keeping it is keeping a cache. Delete it.
