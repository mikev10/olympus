---
name: review-request
description: Prepare an external adversarial review of a shipped unit. Writes exactly two files to docs/reviews/, the prompt and the bundle the reviewers are given, commits and pushes them, and stops without sending anything. Use after a unit ships and before the next one starts. Takes a unit id, e.g. review-request F3.
---

# Prepare an external review

The reviewers are **two other model families**, each given the prompt and the
bundle and nothing else — not Claude Code, not the session that built the unit.
That independence is the point: a reviewer sharing the author's context inherits
the author's blind spots.

Your job is to produce two files, hand them over in plain steps, and stop. You
do not perform the review.

## What the maintainer gets

Exactly two files per review, side by side in `docs/reviews/`, and nothing else
to open:

| File | What it is | What `/run-review` does with it |
|---|---|---|
| `<date>-<UNIT>-<slug>-review-prompt.txt` | The instructions, and nothing but the instructions | Sends all of it, verbatim, to each reviewer, with the bundle inlined after it |
| `<date>-<UNIT>-<slug>-review-bundle.txt` | The code: every changed file, in full | Inlines it into the text it sends, after the prompt, between delimiters that name this file |

`<date>` is today, `<UNIT>` keeps its case, `<slug>` names the unit:
`2026-09-14-P4-station-machine-review-prompt.txt`.

The prompt refers to the bundle by that exact filename and never by any other
name, so the reference resolves however the bundle arrives and the prompt needs
no rewording per reviewer: the runner's opening delimiter names it, and a chat
reviewer sees it as the attachment's name. No family reads the bundle from a
working directory.

Both of the runner's delimiters carry the bundle's own end nonce —
`<<<BEGIN REVIEW BUNDLE <nonce>>>> <filename>` and
`<<<END REVIEW BUNDLE <nonce>>>>` — so no text inside the bundle can spell the
line that closes it, and the reviewer can always tell where the material ends.
That is the whole of what it buys: it is not a defence against a reviewer
following an instruction it finds inside the bundle.

Every word in the prompt file is meant for the reviewer: no headings, notes, or
provenance for the maintainer go in it, because the whole file is sent
verbatim.

Later, `run-review` adds `-review-codex.md` and `-review-gemini.md` (the two
replies), each with a `.run.json` manifest and a `.session.jsonl` beside it —
for Codex its rollout log stripped to metadata records, for Gemini one line of
response metadata — and `triage-review` adds `-triage.md`. Units reviewed before the
per-family names carry a single `-review.md` instead. Units reviewed before this
rule also carry a `-review-request.md`; that file is retired, and its contents
now live in the bundle's own header, the prompt's first paragraph, and the
review header written at triage.

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
  git diff -z --name-only --diff-filter=ACMR <base>..HEAD | while IFS= read -r -d '' f; do
    [ -f "$f" ] || continue
    case "$f" in docs/decisions.md|docs/reviews/*|docs/plan/*) continue ;; esac
    printf '\n===== %s =====\n' "$f"; cat "$f"
  done
  printf '\n=== BUNDLE END === %s\n' "$(openssl rand -hex 16)"
} > docs/reviews/<date>-<UNIT>-<slug>-review-bundle.txt
```

**`-z` and `read -d ''` are load-bearing: do not simplify them back.** Without
`-z`, `git diff --name-only` wraps any path outside plain ASCII in double quotes
with C-style escapes — `"caf\303\251.ts"` for a file named `café.ts` — because
`core.quotePath` is on by default, here and everywhere. The loop's `[ -f "$f" ]`
test then fails against that literal string and the file is skipped: its contents
never reach the bundle, nothing is printed, and the generator exits 0. Measured
in a throwaway repository on 2026-09-21, with `core.quotePath` at its default:
`café.ts` was dropped from the bundle and every check below still passed. A
reviewer cannot report a bypass in code it was never shown, and nothing in the
reply would say a file was missing. `-z` emits raw paths separated by NUL, which
is the one form no filename can contain, so every name git can produce survives.
The same `-z` form is used in the section count below, so the two agree.

**The last line is a fresh random nonce, and it is the only proof the tail
arrived.** `openssl rand -hex 16` yields the 32 hex characters the runner
matches on; where `openssl` is absent, `head -c16 /dev/urandom | xxd -p | tr -d
'\n'` does the same. Generate it per bundle and never reuse one: a value that
appeared in an earlier bundle is a value a reviewer can echo without having read
this one. Regenerate a bundle with `>`, never `>>`, so the previous run's nonce
does not survive in the middle of the file.

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

**Confirm the bundle holds one section per changed file.** Nothing downstream
compares the bundle against the diff it was built from, so a file that is simply
absent raises nothing anywhere:

```bash
sections=$(grep -cE '^===== .* =====$' docs/reviews/<date>-<UNIT>-<slug>-review-bundle.txt)
expected=$(git diff -z --name-only --diff-filter=ACMR <base>..HEAD | while IFS= read -r -d '' f; do
  case "$f" in docs/decisions.md|docs/reviews/*|docs/plan/*) continue ;; esac
  echo x
done | wc -l)
[ "$sections" -eq "$expected" ] || echo "FAIL: $sections sections for $expected changed files"
```

The `case` list is the same one the generator excludes by, so the two counts are
built from the same rule; change one and change the other.

**A mismatch means the bundle must not be sent, whichever way it went.** Fewer
sections than files means a file the diff lists is missing from the bundle — the
quoting above is one cause and this check is not specific to it, so treat any
future cause the same way: find out which file and why before sending anything.
More sections than files means a changed file's own contents carry a line shaped
like `===== something =====` at column 0, which is worth knowing for a second
reason: the runner derives the bundle's final-section marker with that same
pattern, so it would name a line inside a file rather than the last section, and
an honest reviewer would echo a value the runner never asked for.

Confirm two more things about the nonce, so a bundle that breaks either is fixed
here rather than refused at the next run:

```
tail -1 docs/reviews/<date>-<UNIT>-<slug>-review-bundle.txt | grep -qE '^=== BUNDLE END === [0-9a-f]{32}$' || echo 'FAIL: nonce is not the last line'
grep -c '^=== BUNDLE END === ' docs/reviews/<date>-<UNIT>-<slug>-review-bundle.txt   # must print exactly 1
```

**One nonce, on the last line.** Both properties are load-bearing, and both are
now checked twice. The runner refuses a bundle that breaks either: `bundleMarkers`
requires the nonce on the last non-empty line and refuses a bundle carrying more
than one nonce-shaped line, before anything is sent. The two commands above are
the generator-side check, which finds the same problem here, before the bundle is
committed, rather than at the next run. Neither replaces the other: what used to
be true is that these commands were the only check, and a check an operator has
to remember to run is not a check.

If anything follows the nonce, the echo proves delivery only as far as the
nonce, and the prompt's instruction to read the very last line is false. If the
marker appears twice, a reviewer that read the whole bundle can echo the earlier
one and be recorded as having failed a check it passed — a refusal that throws
away a good review.

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

**Name both sides of the trust boundary, not just the untrusted one.** Say what
the party controls *and* what it does not. A boundary stated from one side only
gets read literally: P4's prompt said the party controls the arguments to the
exported entry points, and the Vault the gates are checked against is an
argument, so the prompt handed the attacker the thing under test. Its reviewer
spent two of ten findings on that contradiction rather than on the code. The
components a runtime is wired with — vault, sandbox, drivers — are trusted even
where a function takes one as a parameter, and the prompt has to say so.

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
The code under review is in the file
`<date>-<UNIT>-<slug>-review-bundle.txt` (SHA-256 <hash>) — the full contents of
every changed file, with the commit range at its top. It is provided with this
prompt: attached to this message, present in your working directory, or included
in the prompt text itself. If you cannot read it, stop and say so; do not review
from the description below alone. Before reviewing, state on four separate
lines: the BASE: value from the bundle's first lines, the HEAD: value, the file
path in the bundle's final `===== <path> =====` header, and the 32-character
value on the bundle's very last line, which begins `=== BUNDLE END ===`. If you
cannot read all four, say so and stop — a partially received bundle produces
findings about code you were not shown. Copy the last of these exactly; it is
the only one of the four that proves you reached the end of the file.

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

That party controls <the untrusted inputs: what the model returns / the files
in the workspace / the data on a request / when the process stops>. It does not
control the components the runtime is wired with — the Vault, the sandbox
provider, and the drivers are runtime-selected and trusted, even where a
function takes one as an argument — and it does not control code running inside
the runtime's own process.

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

**The runner makes two integrity checks, and a run counts only if both pass.**
Both are decided mechanically, without anyone reading the reply, and each is
evidence of something different.

**The echo, where only the fourth value is worth much.** The runner reads all
four values from the committed bundle — its BASE and HEAD lines, its final
`===== <path> =====` header, and its last line — so a reviewer that echoes a
wrong one is caught. But measure where the first three live: in P5's bundle,
BASE is line 1, HEAD is line 2, and the final section's path appears at line 66,
inside the `=== CHANGED ===` stat listing that names every changed file. All
three sit in the first 70 lines of 9730, and the Gemini CLI, measured before
the runner inlined the bundle, took in about the first 2000 lines and searched
the rest with a tool. A reviewer handed a fifth of the bundle could echo all
three truthfully: they are evidence the reviewer opened the right file, not that
it received the file. The trailing nonce is the only marker a truncated reader
cannot produce, which is why it exists and why it has to be the last line. A
bundle with no nonce has no tail check in it at all, and the runner refuses to
send one: a run against it could never count.

**The token count, which does not depend on the reply.** The vendor reports how
many input tokens it took in — Google in the response's
`usageMetadata.promptTokenCount`, Codex in its rollout log's
`token_usage_record` — and the run counts only if that reaches the payload's
size in bytes divided by 5. Honest runs over a real 403,661-byte bundle measured
3.18 and 3.20 bytes per token and cleared that floor easily; the two measured
failures, a reviewer that searched the bundle instead of reading it and one that
could not open its file, took in 32,893 and 24,181 tokens against a floor of
80,732. The count comes from the vendor, not the model, so a reviewer cannot
write it, and it catches what the nonce misses: a reviewer that searched its way
to the last line echoes the nonce correctly and still took in a fraction of the
bundle. For Codex, whether `token_usage_record` holds one request's input or a
running total across the turn has not been measured yet, so a Codex count at or
above the floor is evidence of ingestion only as far as that measurement goes.
Claim no more for it than that.

The paragraph asking for the four values names three ways the bundle can
arrive — attached, in the working directory, or in the prompt text — and
commits to none of them, so it holds on every path the prompt is used on. The
runner inlines the bundle into the prompt text for both families; no family
reads it from a working directory. A chat reviewer, on the manual path, gets it
as an attachment. An editor who only ever sees one path will read the
paragraph as clumsy and simplify it to "the attached file", and a reviewer
given the bundle another way will then report it missing on every run — a
refusal indistinguishable from diligence.

**What neither check covers.** The nonce is evidence the tail was delivered, and
the token count is evidence the whole payload was taken in. Neither is evidence
the middle was read. A model can take in a whole bundle and reason about a tenth
of it, and nothing in the file or the count detects that: both are evidence
about transport and ingestion, not about attention. Cross-family agreement and
the prompt's own numbered items carry that load, and neither of them closes it
either.

**Committed before the review runs, and that is the point.** The prompt is
written by the system that built the unit, so publishing it before the answer
exists lets a reader judge whether the reviewer was steered, and check that the
findings were not selected to match the framing.

## 5. Commit both files

On the unit branch, both files in one commit, and push. The runner refuses to
send a prompt and bundle unless the commit that last touched them is on the
branch's upstream: a commit that never left this machine could be rewritten
along with everything else on it, so only a pushed one fixes them before a
reviewer sees them.

```
git add docs/reviews/<date>-<UNIT>-<slug>-review-bundle.txt docs/reviews/<date>-<UNIT>-<slug>-review-prompt.txt
git commit -m "<UNIT>: the review prompt and bundle, as sent"
git push
```

## 6. Hand over, then stop

End the turn with this block, filled in, and nothing after it except the
"what is next" line WORKFLOW.md requires.

```
REVIEW ARTIFACTS READY: <UNIT> <title>

Two files in docs/reviews/, both committed and pushed:
  PROMPT  <date>-<UNIT>-<slug>-review-prompt.txt   the instructions
  BUNDLE  <date>-<UNIT>-<slug>-review-bundle.txt   the code, <N> lines

Nothing has been sent. To run both reviewers:
  /run-review <UNIT>

The other files in docs/reviews/ are records. You do not need to open them.
```

**Nothing has been sent, and this skill does not send.** `/run-review` puts the
bundle in front of two third-party services, and that cannot be undone: deleting
a file afterwards recovers nothing. It stays the maintainer's own command, one
per unit, and this skill never chains into it.

Do not review the unit yourself. Do not act on a review you did not receive.

## When the review comes back

Not this skill's job, and not this session's. The reviews run under
`/run-review <unit>`, which leaves both replies on disk as the runner wrote them
and commits them untouched. `triage-review <unit>` reads them from there, checks
each against its manifest's hash, heads each with a provenance header derived
from its manifest, verifies every finding against the cited code
before acting on one, writes the triage, applies what is accepted, and stops
before merge.
