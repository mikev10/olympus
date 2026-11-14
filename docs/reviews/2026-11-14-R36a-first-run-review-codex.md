BASE: eab6a44
HEAD: 6a634ff
packages/vault/src/types.ts
2c390740f8a13747cb82e4d78a5b5b8d

I had no prior project context and performed no external lookups. I reviewed the inline bundle. A local file-discovery command was blocked; I did not independently verify the file’s SHA-256 or run tests.

1. **packages/api/src/run.ts:1122 — factually wrong — medium — Cost approval is still offered before the unavailable-controls refusal.**  
   In `admission`, `unavailableControls` is computed before the cost branch, but `admissionRefusal(unrecorded)` runs afterward. Supply an otherwise valid request at a level requiring an unavailable control, with `approvedCostUsd: null`: the function returns `cost-unapproved`. Approving that figure then exposes `controls-unavailable`. The conformance table itself constructs a controls-unavailable request, but supplies its cost approval beforehand.

   Move the controls refusal before the cost branch and test the same unsupported request with no approved figure. This violates the promised admission ordering; it does **not** demonstrate unauthorized spending. Confidence: high.

2. **packages/api/src/line.ts:1543 — factually wrong — medium — Some sandbox failures bypass the new failure-reporting channel.**  
   In `verify`, let a behavioral check’s `sandbox.exec` throw—for example, following a container timeout. The catch adds an `unstarted` entry but never calls `spendRetry` or records `attempt-failed`. Consequently, no `attempt-failed` event is emitted, and a later iterations-exhausted stop receives no `lastFailure`, because `lastFailureOf` only handles retries-exhausted parks.

   The gate still fails closed; the defect is the promised reporting coverage. Record these failures through a shared reporting function independent of retry accounting, or explicitly narrow the reporting contract to retried attempts. Confidence: high.

3. **packages/conformance/src/registry/first-run.ts:173 — factually wrong — medium — The no-leaked-file assertion treats unreadable subtrees as empty.**  
   `everyPath` catches every `readdir` failure and substitutes `[]`. If the run directory can be listed but `base` or a task subtree cannot, the parent listing still supplies the `base` entry required by the positive control. The assertion can then pass without inspecting files inside that directory, including a leaked `.env`.

   Let traversal errors fail the assertion. Also require evidence that a task actually ran: accepting a generic refusal and finding a base directory does not establish the claim about trees handed to models. Confidence: high.

4. **packages/conformance/src/kit/git.ts:47 — factually wrong — low — Fixture commits are not necessarily the requested paths or the fixture’s raw bytes.**  
   Two concrete constructions contradict the helper’s guarantees:

   - Commit `extra.txt`, then call `commitFixture(dir, { paths: ['wanted.txt'] })`. The existing index still contains `extra.txt`; `write-tree` includes it.
   - Supply `.gitattributes` containing `*.txt text eol=lf` and a CRLF text file. `git add` can normalize its bytes despite `core.autocrlf=false`. Configured clean filters can also transform content.

   Use an isolated, initially empty index for path selection. If byte identity is required, construct blobs without clean filters and attributes, or verify every resulting blob against the intended bytes. Confidence: high.

The following mechanisms look sound **within the code shown**:

- Overlay admission rechecks the bytes against the admitted hash, compares existing base content, and writes only after all entries pass. That closes ordinary working-copy drift between admission reads.
- Tool admission compares resolved seat grants with the selected driver’s inventory before offering cost approval. The negative test exercises actual admission rather than merely comparing constants.
- Failure detail is separated as `untrustedDetail`; the shown nightly projection excludes it. SSE uses JSON serialization, preventing embedded newlines from becoming additional SSE events. Standing is derived before failure detail is attached.
- Snapshot errors and nonempty `skipped` results refuse admission. These paths do not silently accept a partial snapshot.

I cannot establish the full snapshot security property from this bundle. `resolveCommit` and `materializeCommit` are imported but absent. In particular, whether repository-controlled Git replacement refs can substitute objects, and whether chained symlinks remain confined, depends on those implementations. These are unresolved boundaries, **not demonstrated bypasses**.

I found no proven tautological assertion among the new checks. The traversal assertion above has a concrete false-pass path. Likewise, the shown casts, proxies, and JSON assertions do not establish an attacker-accessible TypeScript escape: manufacturing runtime objects or replacing trusted drivers would exceed the stated threat model.

The adversarial framing is appropriate, with two qualifications. Uncommitted admitted run files are an intentional exception to commit-byte identity. Also, “untrusted text never enters a prompt” is too broad literally: supplied specs and model-authored drafts intentionally do. The enforceable question is whether each channel is authorized as context, and whether failure/event text crosses into instructions or runtime-derived status. No such failure-text crossing is demonstrated by the supplied code.