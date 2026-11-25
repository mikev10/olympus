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