---
name: review-request
description: Prepare an external adversarial review of a shipped unit. Writes exactly two files to docs/reviews/, a prompt to paste and a bundle to attach, commits them, copies the prompt to the clipboard, and prints numbered hand-over steps. Use after a unit ships and before the next one starts. Takes a unit id, e.g. review-request F3.
---

# Prepare an external review

The reviewer is a **different model family** in a clean room — not Claude Code,
not the session that built the unit. That independence is the point: a reviewer
sharing the author's context inherits the author's blind spots.

Your job is to produce two files, hand them over in plain steps, and stop. You
do not perform the review.

## What the maintainer gets

Exactly two files per review, side by side in `docs/reviews/`, and nothing else
to open:

| File | What it is | What the maintainer does with it |
|---|---|---|
| `<date>-<UNIT>-<slug>-review-prompt.txt` | The instructions, and nothing but the instructions | Pastes all of it into the chat |
| `<date>-<UNIT>-<slug>-review-bundle.txt` | The code: every changed file, in full | Attaches it to the same message |

`<date>` is today, `<UNIT>` keeps its case, `<slug>` names the unit:
`2026-09-14-P4-station-machine-review-prompt.txt`.

The prompt refers to the bundle by that exact filename and never by any other
name, so nothing has to be renamed on upload. Every word in the prompt file is
meant for the reviewer: no headings, notes, or provenance for the maintainer go
in it, because the maintainer copies the whole file.

Later, `triage-review` adds `-review.md` (the reply) and `-triage.md` beside
them. Units reviewed before this rule also carry a `-review-request.md`; that
file is retired, and its contents now live in the bundle's own header, the
prompt's first paragraph, and the review header written at triage.

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
} > docs/reviews/<date>-<UNIT>-<slug>-review-bundle.txt
```

The header at its top (base, head, commits, changed files) is the bundle's
provenance. Record the bundle's SHA-256 for the prompt:

```
sha256sum docs/reviews/<date>-<UNIT>-<slug>-review-bundle.txt
```

**Excluded by construction, and why.** `docs/decisions.md` carries author
reasoning and prior review outcomes — a reviewer reading it inherits
conclusions already reached and stops questioning them. `docs/reviews/` holds
what earlier reviewers found. `docs/plan/` is the spec the code is judged
against; the reviewer gets the invariants restated in the prompt instead.

**The hash is the authority, the tracked copy is the convenience.** A copy can
be edited and a hash cannot; with the base and head in the bundle's header,
anyone can regenerate the bundle and prove it is the one that was sent. Because
`docs/reviews/*` is excluded above, a tracked bundle never appears inside a
later one.

Never include anything from `.plan/`. Confirm before going on that both of these
print `0`:

```
grep -c '^===== \.plan/'                    docs/reviews/<date>-<UNIT>-<slug>-review-bundle.txt
grep -c '^===== docs/decisions\.md =====$'  docs/reviews/<date>-<UNIT>-<slug>-review-bundle.txt
```

They match the bundle's section headers, not prose. A count over the bare
path would report a false hit whenever README.md, CONTRIBUTING.md, or a
changeset that mentions the decisions log is in the diff.

## 3. Derive the unit-specific half of the prompt

From `docs/plan/DECOMPOSITION.md` and the unit's spec, extract four things:

- **What the unit built**, in two or three sentences, no jargon the reviewer
  cannot resolve from the bundle
- **The mechanisms that matter** — the two to four things a bypass would target
- **Which invariants it touches**, stated in full (the reviewer has no `docs/plan/`)
- **Out of scope**, verbatim, so absent work is not reported as a defect. Unit
  ids and decision ids in it mean nothing to the reviewer; add one sentence
  saying so, as P4's prompt did

**The adversarial question is derived from what the unit does.** Conformance
infrastructure: *how would I make this pass without the invariant holding?*
A vault: *how would I write to it?* A sandbox: *how would I escape the mount or
reach a read-only path?* A policy engine: *how would I obtain a capability that
was not granted?* Get this wrong and the review reads like a code-style pass.

**Name mechanisms, never verdicts.** Say what a mechanism does and leave every
judgment to the reviewer. No "this should be solid", no "the weak point is
probably X", no target number of findings, no hint at what a previous review
found, and no known limit from `docs/decisions.md`. Framing tells the reviewer
what failure would mean; it never tells them where to look for it.

**A limit worth knowing:** this half of the prompt is written by the same system
that built the unit, so the mechanisms it names are the ones it thought about. A
bypass nobody considered lives in a mechanism nobody lists. That is why the
reviewer receives the full bundle rather than only the named mechanisms, and why
item 7 below invites it to reject this framing outright.

## 4. Write the prompt file

Fill the template below and write it, and only it, to
`docs/reviews/<date>-<UNIT>-<slug>-review-prompt.txt`. Plain text, no fence
around it. The clean-room, calibration, and output sections are fixed — do not
reword them. They are what separates a useful review from a list of style
opinions.

```
The code under review is in the attached file
`<date>-<UNIT>-<slug>-review-bundle.txt` (SHA-256 <hash>) — the full contents of
every changed file, with the commit range at its top. If that file is not
present in this conversation, stop and say so; do not review from the
description below alone.

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

**Committed before the review runs, and that is the point.** The prompt is
written by the system that built the unit, so publishing it before the answer
exists lets a reader judge whether the reviewer was steered, and check that the
findings were not selected to match the framing.

## 5. Commit both files

On the unit branch, both files in one commit, and push, so they are reachable
from any device:

```
git add docs/reviews/<date>-<UNIT>-<slug>-review-bundle.txt docs/reviews/<date>-<UNIT>-<slug>-review-prompt.txt
git commit -m "<UNIT>: the review prompt and bundle, as sent"
git push
```

## 6. Put the prompt on the clipboard

Best effort, and say whether it worked. Use a reader that keeps UTF-8, because
the prompt contains dashes that a console code page would mangle:

- Windows: `powershell -NoProfile -Command "Get-Content -Raw -Encoding UTF8 '<absolute path to prompt>' | Set-Clipboard"`
- macOS: `pbcopy < <path>`
- Linux: `wl-copy < <path>` or `xclip -selection clipboard < <path>`

If none works, the hand-over tells the maintainer to open the file instead.

## 7. Recommend the reviewer

Read the `Reviewer:` and `Family rotation:` lines in the most recent
`docs/reviews/*-review.md` headers to learn which families reviewed the last
units. Recommend a family that did not review the previous unit, preferring the
one used least recently, and respect any family the maintainer has said not to
use. If a repeat cannot be avoided, say so in the recommendation.

## 8. Hand over, then stop

End the turn with this block, filled in, and nothing after it except the
"what is next" line WORKFLOW.md requires. Absolute paths, so the maintainer can
paste them into a file picker.

```
REVIEW READY: <UNIT> <title>

Two files in docs/reviews/, both committed:
  PROMPT  <date>-<UNIT>-<slug>-review-prompt.txt   the instructions   <on your clipboard | not on the clipboard>
  BUNDLE  <date>-<UNIT>-<slug>-review-bundle.txt   the code           <N> lines

Do this:
  1. Open <family> in a new temporary chat (no memory, no history, no project).
     Why <family>: <one line on rotation>.
  2. Attach the bundle file:
       <absolute path to bundle>
  3. Paste the prompt into the message box.<If not on the clipboard: " Open this file, select all, copy:" and the absolute path>
  4. Send the file and the prompt together, in one message.
     Write down the exact model name the chat shows.
  5. When the reply has finished, copy all of it. In a new Claude Code session
     on branch unit/<id>, run:
       /triage-review <UNIT>
     and paste the reply, with the model name, into that message.

The other files in docs/reviews/ are records. You do not need to open them.
```

Do not review the unit yourself. Do not act on a review you did not receive.

## When the review comes back

Not this skill's job, and not this session's. The review runs in another tool,
on the maintainer's clock. `triage-review <unit>` stores the reply with its
provenance header, verifies every finding against the cited code before acting
on one, writes the triage, applies what is accepted, and stops before merge.
