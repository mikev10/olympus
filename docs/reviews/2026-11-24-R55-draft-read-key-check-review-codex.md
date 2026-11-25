# External review of R55, codex, 2026-11-24

The unit's draft-reading route and CLI command, and the start-up check of the
model key, reviewed from the bundle alone. What was done with each finding is
in `2026-11-24-R55-draft-read-key-check-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run under a read-only sandbox, with recorded
  approval policy `never`, in an empty scratch working directory and a scratch
  config home holding only `auth.json`, with an environment of `CODEX_HOME`
  alone. The pre-run listing of both is the manifest's `cleanRoom`.
- **Cross-family agreement:** the incomplete `isDraftView` check was raised by
  both families (here in the closing notes, by gemini as its second finding).
  codex-1 (bytes that are not UTF-8 withheld), codex-2 (an escape and its own
  text print alike; byte-order mark, line endings, final newline), and the
  note that no assertion covers the probe's time limit were raised by this
  family alone. Gemini called the not-UTF-8 fallback sound, which is the
  opposite reading of codex-1.
- **Date:** 2026-11-24
- **Bundle:** `2026-11-24-R55-draft-read-key-check-review-bundle.txt`, SHA-256
  `49335b0f6ccfb07e80cfcc4705e03468ab06c93ee0ab82e9b4a3daa8db4aeb2b`, base
  `ef868ca` (`reviewed/R56`), head `29ea48a` (the unit branch after `v2` was
  merged into it). Every new file in full and every modified file as a
  function-context diff; `docs/decisions.md`, `docs/plan/`, `docs/reviews/`,
  and the lockfile excluded. Prompt:
  `2026-11-24-R55-draft-read-key-check-review-prompt.txt`.
- **Prior context and lookups:** it stated it had no prior project context and
  performed no external lookups, and that it ran no tests. A self-report, not
  independently verifiable.
- **Coverage, and any gap:** items 1 and 3 (two numbered findings), 4 (the
  `as DraftRecord` cast and the type predicate), 5 (the injected probe and the
  preload, judged test seams), 6 (four mechanisms assessed sound), and 7 (the
  framing, with a refinement) were answered. Item 2, tautological checks, was
  answered only for the start-up tests; nothing was said of the draft tests.
- **Citations:** line numbers are positions in the bundle, treated as hints.
  Each finding was located by the function it describes.

---

BASE: reviewed/R56  
HEAD: 29ea48a  
packages/conformance/src/registry/startup-key.ts  
bc535feffb123d49d3d75ea45536ac32

I had no prior project context and performed no external lookups. This is a static review of the supplied bundle; I did not run tests.

1. **packages/cli/src/draft.ts:62 — factually wrong — high — Unreadable bytes still receive a successful, approval-ready presentation.**  
   Put one invalid UTF-8 byte, such as `0xff`, into a file containing the material the attacker wants concealed. The decoder rejects the entire file; lines 64–65 replace all its contents with “not UTF-8 text; not shown” and continue. The draft’s hash and approval command remain in the output, and `packages/cli/src/cli.ts:542` returns success.

   The runtime can correctly hash those bytes while the operator never sees them. This is a warning-and-continue path through the precise inspection failure this feature needs to prevent. The CLI test explicitly expects this placeholder rather than a refusal.

   **Resolve:** Render otherwise unreadable bytes in an unambiguous byte representation, or fail the whole presentation and withhold its approval suggestion. Add a test requiring that invalid UTF-8 cannot produce a successful, partially displayed draft. **Confidence: high.**

2. **packages/cli/src/draft.ts:25 — factually wrong — medium — Escaping does not distinguish literal escape text from actual control bytes.**  
   Consider these two file contents, where `<NUL>` means an actual zero byte and `\u{0}` means six literal ASCII characters:

   ```text
   allow<NUL>deny\u{0}
   allow\u{0}deny<NUL>
   ```

   Both have the same byte length, and both render as:

   ```text
   | allow\u{0}deny\u{0}
   ```

   Their hashes differ, but the opaque hash does not tell the reader where the actual NUL occurs. An attacker can make control-bearing bytes look like literal documentation of those controls.

   There are additional losses at **line 62**, where the default `TextDecoder` consumes an initial UTF-8 BOM, and **lines 71–72**, which normalize CRLF and omit the final newline distinction. Consequently, this presentation cannot support its claimed byte-level correspondence.

   **Resolve:** Escape literal backslashes as well as controls, preserve or explicitly annotate BOMs and line endings, and distinguish the final newline. Test adversarial pairs of distinct byte sequences that currently render identically. **Confidence: high.**

The following mechanisms look sound within the stated trust boundary:

- **`readDraft`, packages/api/src/draft-view.ts:84–92:** checks record identity, the aggregate digest against run state, and each decoded file’s digest before returning files. The `as DraftRecord` cast is not validation, and malformed shapes can throw, but the HTTP handler converts such failures into errors rather than returning a successful draft. I found no demonstrated hash-verification bypass using attacker-controlled file bytes and paths.
- **`awaitingKey`, packages/api/src/draft-view.ts:96–99:** requires the waiting station, hash, and attempt to match. The route derives both inputs from one state snapshot. The actual approval-binding implementation is outside this bundle, so I cannot independently establish its behavior.
- **`probeModelKey`, packages/api/src/host/key-probe.ts:48–63:** uses a fixed provider URL, rejects redirects, supplies a timeout, ignores response content, and accepts only 2xx. Network and cancellation failures produce refusals. I found no construction within the supplied threat model that makes it accept a rejected key.
- **Startup tests:** the accepted/rejected cases, recorded requests, default-probe test, and installed-host rejection test are meaningful rather than tautological. The paid test throws when its key is absent. However, the supplied assertions do not establish timeout enforcement: deleting the abort signal would escape their explicit checks.

The incomplete `isDraftView` predicate at **packages/cli/src/draft.ts:31–40** accepts `questions: {kind: 'read'}` without validating its arrays. That can cause a later exception, but not success; the trusted service constructs those arrays. Likewise, injected probes and the `NODE_OPTIONS` preload require trusted process or environment control. They are test seams, not attacker-accessible configuration bypasses under these assumptions.

The framing is appropriate, with one refinement: distinguish **hash integrity** from **faithful presentation**. The demonstrated failures concern presentation despite correct hashing. For startup, the supported claim is that the provider accepted this request at startup—not that every subsequent model call will succeed.