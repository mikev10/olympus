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