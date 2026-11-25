# External review of R55, gemini, 2026-11-24

The unit's draft-reading route and CLI command, and the start-up check of the
model key, reviewed from the bundle alone. What was done with each finding is
in `2026-11-24-R55-draft-read-key-check-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no
  tools. `cleanRoom` is `null` because an API call loads no local
  configuration.
- **Cross-family agreement:** gemini-2 (the incomplete `isDraftView` check)
  was raised by codex too, in its closing notes. gemini-1 (U+2028, U+2029,
  U+061C not escaped) and gemini-3 (a `null` record throws in `readDraft`)
  were raised by this family alone. Its "sound mechanisms" list calls the
  not-UTF-8 fallback sound; codex-1 found the same code a defect, and
  verification agreed with codex.
- **Date:** 2026-11-24
- **Bundle:** `2026-11-24-R55-draft-read-key-check-review-bundle.txt`, SHA-256
  `49335b0f6ccfb07e80cfcc4705e03468ab06c93ee0ab82e9b4a3daa8db4aeb2b`, base
  `ef868ca` (`reviewed/R56`), head `29ea48a` (the unit branch after `v2` was
  merged into it). Every new file in full and every modified file as a
  function-context diff; `docs/decisions.md`, `docs/plan/`, `docs/reviews/`,
  and the lockfile excluded. Prompt:
  `2026-11-24-R55-draft-read-key-check-review-prompt.txt`.
- **Prior context and lookups:** it stated it had no prior context and
  performed no external lookups. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 1 (gemini-1), 3 (gemini-3), 4 (gemini-2),
  6 (three mechanisms assessed sound), and 7 (the framing, judged right) were
  answered. Items 2, tautological checks, and 5, configuration satisfied
  without doing what it appears to, came back empty. The findings are not
  numbered in the reply; the triage numbers them in the order given.
- **Citations:** line numbers are positions in the bundle, treated as hints.
  Each finding was located by the function it describes.

---

I had no prior context about this project, and I performed no external lookups.

BASE: reviewed/R56
HEAD: 29ea48a
packages/conformance/src/registry/startup-key.ts
bc535feffb123d49d3d75ea45536ac32

### Findings

packages/cli/src/draft.ts:14 — factually wrong — high — The `unprintable` check catches many control characters but omits `0x2028` (Line Separator) and `0x2029` (Paragraph Separator), as well as `0x061C` (Arabic Letter Mark, a bidi override). A model can include these characters in a file's content or path. Because `draftLines` splits only on `\r?\n`, these separators remain embedded in the text string and are passed to the terminal. In terminals that treat them as line breaks, the text skips to a new line without the `| ` margin, allowing the model to forge trusted CLI output (like a fake `hash ...` line) and trick the operator into approving the wrong hash. — Add `code === 0x2028 || code === 0x2029 || code === 0x061c` to the `unprintable` condition to ensure they are escaped.

packages/cli/src/draft.ts:38 — a tradeoff I would have made differently — medium — The type predicate `isDraftView` uses an incomplete type check for the `questions` property. It verifies `questions.kind === 'read'` but casts `value` to `DraftView` without checking that `openQuestions` and `assumptions` exist and are arrays. While the API currently returns correct shapes, relying on this incomplete predicate is an escape hatch/generic erasure that would cause an unhandled `TypeError` in `draftLines` (crashing the CLI and failing open into an error) if the response deviated, instead of cleanly reporting a bad API answer. — Expand the predicate to verify the presence and array structure of `openQuestions` and `assumptions` when `kind === 'read'`.

packages/api/src/draft-view.ts:74 — factually wrong — low — The code casts the result of `JSON.parse` to `DraftRecord` and immediately accesses `record.files` to assign it to `stored`. If the JSON retrieved from the Vault represents the value `null`, `record` is `null` and `record.files` throws a `TypeError: Cannot read properties of null`. This bypasses the subsequent `typeof` and `Array.isArray` checks, resulting in an unhandled exception that yields a 500 error instead of a clean mismatch refusal. — Check `typeof record === 'object' && record !== null` before attempting to access `record.files`.

### Sound Mechanisms

- The loop in `readDraft` validating the hashed base64 bytes firmly bounds the CLI's rendered output to the exact same bytes that form the draft's approval hash. Because both the CLI and API decode the base64 identically, the operator is guaranteed to approve only the bytes they were shown.
- The `probeModelKey` function correctly traps all network, URL, and fetch-level exceptions and surfaces them as failures, fully honoring the fail-closed invariant if the provider cannot be reached.
- The `draftLines` component safely catches invalid UTF-8 sequences using `fatal: true` on `TextDecoder`, falling back cleanly rather than crashing the client or rendering dangerous garbage.
- The adversarial framing of the prompt accurately targets the risks for this unit, and no underlying assumptions need adjustment.