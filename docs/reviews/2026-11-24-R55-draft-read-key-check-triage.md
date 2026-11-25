# Triage of the R55 reviews, 2026-11-24

Two reviews, both `counted` on the first run, neither rerun. Each reply's
SHA-256 matched its manifest's `replySha256` before its header was prepended.

**Counts.** Codex: 2 numbered findings and 2 notes worth a verdict; all 4 hold.
Gemini: 3 findings; all 3 hold, one with a smaller consequence than stated.
One mechanism was raised by both families. **No finding failed to hold.** One
thing a reviewer called sound did not: Gemini assessed the not-UTF-8 fallback
as sound, and codex-1 shows it was a defect.

Every finding was checked three ways: read against the function it describes,
given to a subagent with fresh context that was told nothing of who wrote the
code, and, where it predicts behaviour, constructed as a test that was run
against the code as reviewed. The test is the authority where they differ; they
did not differ.

| Finding | What it says | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | A file with one invalid UTF-8 byte is replaced by a notice, and the hash and approve command are still printed | codex | holds | fixed, ef3887c, 62bbbce |
| codex-2 | A control byte and the literal text of its escape print alike; a byte-order mark is dropped; CRLF and a missing final newline are invisible | codex | holds | fixed, ef3887c |
| gemini-1 | U+2028, U+2029, and U+061C are not escaped | gemini | holds; the forged-line consequence depends on the terminal | fixed, ef3887c |
| gemini-2 | `isDraftView` accepts `questions: {kind: 'read'}` without its lists | both | holds; the consequence is a wrong message and exit 2, not a pass | fixed, ef3887c |
| gemini-3 | A stored record that is JSON `null` throws in `readDraft` | gemini | holds in part: it throws, but the answer was a 500 either way | fixed, 92700d8 |
| codex-note-a | No assertion fails if the probe's time limit is deleted | codex | holds | fixed, ae75c8d |
| codex-note-b | The start-up check supports "the provider accepted this request at start-up", not "every later call will succeed" | codex | holds as a statement of the limit | recorded, D-R55-06; no code change |

## codex-1: bytes that are not UTF-8 were withheld

**Checked.** `draftLines` decoded each file with a fatal decoder and, on
failure, printed `| (not UTF-8 text; not shown)` and went on to the next file
(`packages/cli/src/draft.ts`, the loop over `view.files`, as reviewed). The
hash line and the approve suggestion were printed before the loop. A test
giving a file the bytes `73 65 63 ff 72 65 74 0a 5c 09 7f` failed on the
reviewed code: none of the file's content was printed.

**Consequence.** As the reviewer says. A drafter that puts one invalid byte in
a file hides that file's whole content from the person approving, behind a
notice a hurried reader passes over, with the approve command ready beside it.
The service hashes those bytes correctly, so the approval binds content nobody
read. This is the failure the command exists to prevent.

**Fix.** Two were weighed. Refusing the whole draft makes a draft with any
binary file unreadable and so undecidable, which parks a run for a reason a
person cannot inspect. Printing the bytes was chosen: a file that is not UTF-8
is printed byte for byte, printable ASCII as itself, a backslash doubled, every
other byte as `\x{..}`, with a note above it that carries no margin. Nothing is
withheld, so the approve suggestion stays.

## codex-2: what is printed did not stand for one sequence of bytes

**Checked.** Four constructions, each a failing test on the reviewed code:

- `allow<NUL>deny\u{0}` and `allow\u{0}deny<NUL>` (the second term six literal
  characters) printed the same line, because `visible` escaped a control
  character and left a literal backslash alone.
- A leading byte-order mark was consumed by the decoder's default and printed
  as nothing.
- `a\r\nb` and `a\nb` printed the same two lines, because lines were split on
  `\r?\n`.
- `a` and `a\n` printed the same line.

**Consequence.** The claim the command makes, that what a person reads is what
the hash covers, was not true at the byte level. The first case is the one with
teeth: a control byte could be passed off as documentation of a control byte.

**Fix.** A backslash prints as two, so an escape on the screen is never the
file's own text. The decoder keeps the byte-order mark, which then prints as
`\u{feff}`. Lines are split on `\n` only, so a carriage return prints as
`\u{d}`. A file whose last line has no newline says so in a note. The
command's notes (`(empty file)`, `(no newline at end of file)`, the not-UTF-8
note) carry no `| ` margin, which no line of a file can lack, so a file cannot
print one; before, `| (empty)` could be a file's own first line.

## gemini-1: three characters were not escaped

**Checked.** `unprintable` listed ranges by hand and had none of U+2028,
U+2029, or U+061C. A test confirmed they were printed raw.

**Consequence, separated from the defect.** The reviewer says a terminal that
treats U+2028 as a line break would let a file print a line with no margin.
That depends on the terminal and was not shown; most render it as a space or a
box. U+061C is a direction mark, which the hand-written list meant to cover and
missed. The defect is real whichever terminal is used: a hand-kept list of
dangerous characters was incomplete, and would be again.

**Fix.** Chosen over adding the three: the test is now by Unicode category.
Every control, format, line or paragraph separator, private-use, unassigned,
and surrogate character (`\p{C}`, `\p{Zl}`, `\p{Zp}`) is escaped. That covers
the three, the soft hyphen, the tag characters, and whatever the next reviewer
would have named. A tab inside a file is still kept.

## gemini-2: the predicate did not check the questions lists (both families)

**Checked.** `isDraftView` checked only `questions.kind`. With
`{kind: 'read'}` and no lists, `draftLines` threw a `TypeError`, which
`runCli`'s final catch reported as `could not reach the API: Cannot read
properties of undefined` with exit 2. A test confirmed it.

**Consequence.** Not a pass, as both reviewers say: nothing is printed and the
exit is non-zero. The message is false, though, since the API was reached.

**Fix.** The predicate checks every field `draftLines` reads, the two lists
and their elements included, so such a body is reported as "the API answered
something that is not a draft", exit 1.

## gemini-3: a `null` record threw

**Checked.** `JSON.parse('null')` succeeds inside the `try`; `record.files` on
the next statement was outside it and threw. The server's handler turned that
into a 500 `internal`. A clean mismatch is also a 500 `internal`, so the status
did not change and no byte was returned either way; only the message did. The
same was true of a `files` list holding `null` or an entry without its three
strings, which the reviewer did not name: those threw inside `draftDigest` or
at `file.base64`.

**Fix.** The record is checked to be an object, and `files` to be a list of
entries each with a string path, hash, and bytes, before anything reads them.
Each is now the same "refused, not shown" mismatch as changed bytes.

## codex-note-a: nothing asserted the time limit

**Checked.** No assertion read `init.signal`, and no test gave the probe a
provider that never answers. Deleting the signal failed nothing.

**Fix.** The limit is a third parameter of `probeModelKey`, defaulting to the
ten seconds it was, so a test need not wait that long. A unit test and the
conformance assertion `I5.host-refuses-a-rejected-key` give it a provider that
never answers and require the refusal as unchecked. The unit test timed out
before the parameter existed.

## codex-note-b: what the start-up check supports

Holds, and is the claim the unit makes: the README says the host "does not
start on a key the provider rejects or one it could not check", and nothing
says a later call cannot fail. A key revoked after start-up fails each attempt
as before. Recorded as a known limit in D-R55-06. No code change.

## What both reviewers assessed as sound

`readDraft`'s hash checks, `awaitingKey`, `probeModelKey`'s fixed origin,
refused redirect, and 2xx-only rule, and the start-up assertions. Neither
family raised a finding against the preload in `I9.packaged-host-runs`; codex
judged it a test seam that needs trusted process control. Silence on the rest
is recorded as silence: Gemini answered nothing on tautological checks or on
configuration, and codex spoke to tautology only for the start-up tests.
