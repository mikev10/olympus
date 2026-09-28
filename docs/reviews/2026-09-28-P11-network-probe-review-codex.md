# External review of P11, codex, 2026-09-28

An adversarial pre-merge review of P11 (the sandbox network probe and the HTTP
behavioral adapter): the probe container `LocalDockerProvider.probe` starts in
the sandbox's network namespace, the probe script and its observation format,
the HTTP scenario reader and response comparison in the adapter, detection of
HTTP-capable stacks, and the conformance entries asserting the probe's
isolation. The only review of this unit; see Cross-family agreement below.
Triaged in `2026-09-28-P11-network-probe-triage.md`, which cites this review's
findings as `codex-1` to `codex-6`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone. The pre-run listing of both is the manifest's
  `cleanRoom`: `configHome` `["auth.json"]`, `workDir` `[]`. Exit 0, not timed
  out, 126.1 s. Ingestion `complete`: 59,821 input tokens against a floor of
  37,394. Integrity `verified`: the reply echoes every required bundle marker.
  Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `052ae88fab312b52a0777ea8e5890c64ee3f9e8d8e320689b90ac4b2829d78b5`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** not available — only codex counted; gemini was
  not run. The Gemini call was blocked by the authoring session's permission
  classifier, and the maintainer then chose to proceed on one review for cost.
  One review, no cross-family pass: every finding here was raised by codex
  alone and had no chance of corroboration.
- **Date:** 2026-09-28 (run started 2026-09-28T19:31Z).
- **Bundle:** `2026-09-28-P11-network-probe-review-bundle.txt`, SHA-256
  `b28abf127b554285e88f670e53e3a3c41cc53cc0348d9c58cf185bf3f20f1d84`, base
  `9930590` (`reviewed/P13`), head `19a1002` (the P11 done-when amendment, on
  top of the implementation commit `775bcca`). It held the full contents of
  every changed source, test, and registry file and the changeset; the two
  changed docs (`docs/decisions.md`, `docs/plan/DECOMPOSITION.md`) were listed
  in the diffstat and excluded. Prompt:
  `2026-09-28-P11-network-probe-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated "Prior context: none.
  External lookups: none", and that local shell access was blocked, so it
  neither executed tests nor verified the file hash. A self-report, not
  independently verifiable.
- **Coverage, and any gap:** findings are not numbered by prompt item. Item 1
  is answered by codex-1, codex-2, codex-3 and codex-6; item 2 by codex-5;
  item 3 by codex-2 and the marker check in codex-5; item 4 in the paragraph
  on casts, declaration merging and `canProbe` (no escape found beyond
  runtime sparse arrays and numbers); item 6 in the paragraphs on the observer
  design and loopback reach; item 7 in the closing paragraph, which accepts the
  framing and names its limit. Item 5 (configuration satisfied without doing
  what it appears to) is not addressed under that name; codex-4 and codex-5
  come closest.
- **Citations:** line numbers refer to positions in the reviewed source files
  as the bundle carried them, not to the repository at any later commit. They
  are hints; the triage located each construct by name.

---

BASE: reviewed/P13  
HEAD: 19a1002  
packages/sandbox/test/probe.test.ts  
f59857eaf5b377eedc6be711bdadd69a

Prior context: none. External lookups: none. This is a static review of the supplied prompt bundle. Local shell access was blocked; I did not execute tests or independently verify the file hash.

1. **packages/adapters/src/http.ts:149 — factually wrong — high — JSON canonicalization equates an overflowing number with `null`.**

   For a scenario expecting `{ status: 200, json: null }`, answer with status 200 and body `1e400`. `JSON.parse` produces `Infinity`; `canonical` then calls `JSON.stringify(Infinity)`, producing `"null"`. The comparison reports `held: true`. The same construction works inside objects and arrays.

   This is reachable entirely through product-controlled response bytes, without replacing any trusted component.

   **Resolution:** Reject non-finite parsed numbers before canonicalization, and validate expected values as JSON values. Add regression cases for positive and negative overflow, including nested values. If exact large-number comparisons matter, define and enforce their numeric semantics too.

2. **packages/sandbox/src/local/probe.ts:105; packages/adapters/src/http.ts:168 — factually wrong — high — an incomplete response can satisfy a status-only expectation.**

   For an expectation containing only status 200, send:

   ```text
   HTTP/1.1 200 OK\r\n
   Content-Length: 1000000000\r\n
   \r\n
   ```

   Then send slightly more than 1 MiB and stop. The probe settles an `oversized` observation immediately and destroys its request. Because the scenario has no body assertion, `compareResponse` accepts the status and returns without a mismatch.

   The product never completes the advertised response. The probe itself prevents discovering that failure, and subsequent errors cannot replace the already settled observation.

   **Resolution:** Treat oversized observations as failed checks, or discard excess body bytes while continuing to require valid response completion within a hard deadline. Test a response that crosses the cap and then stalls or disconnects.

3. **packages/adapters/src/http.ts:136; packages/adapters/src/http.ts:194 — factually wrong — medium — sparse expected arrays silently remove comparisons.**

   A JavaScript scenario with one valid request and `expected: { exchanges: new Array(1) }` passes the length check. `map(readResponse)` skips the hole, and `compareHttp`’s `forEach` skips it again. Any ready probe result therefore produces `held: true`, even if its observation is `no-response`.

   This is a malformed-scenario failure, not a sandbox-controlled scenario attack. Ordinary JSON cannot represent holes, but the public reader accepts JavaScript values and does not enforce a JSON-only boundary.

   **Resolution:** Validate every array index explicitly and reject holes. Apply the same rule to request arrays and validate `json` expectations recursively.

4. **packages/adapters/src/http.ts:215; packages/adapters/src/http.ts:227 — factually wrong — medium — “one scenario per handle” is enforced only per adapter instance.**

   Run scenario A through one adapter and leave its server listening. Construct another `HttpBehavioralAdapter` with the same trusted provider and run scenario B on the same handle. Its empty `#served` set permits the run.

   Scenario B can start a command such as `sleep`, which starts successfully without serving HTTP. A’s server then answers B’s requests and can make B pass.

   The sandbox cannot itself construct the second host adapter; this requires runtime reuse of a handle across adapter instances. Nevertheless, the advertised handle-wide restriction does not hold.

   **Resolution:** Track consumption at the provider/handle ownership boundary, shared by all adapters, or enforce an equivalent global scenario lease. Test two distinct adapter instances against one handle.

5. **packages/conformance/src/registry/http.ts:90 — factually wrong — medium — the isolation assertion survives removal of process isolation.**

   Add `--pid container:<sandbox>` to `probeRunArgs`. The probe now shares the product’s PID namespace, violating the stated process-isolation property. All three added conformance entries can still pass: the inspection checks network mode, mounts, read-only root, and dropped capabilities, but never PID mode or process visibility.

   The assertions are not wholesale tautologies: several checked configuration changes would fail them. They simply do not prove the full isolation claim. Removing `no-new-privileges` or changing the probe user likewise escapes this inspection.

   Additionally, at **line 94**, *every* failed `docker exec … cat` becomes “marker absent.” A missing `cat` executable or execution failure satisfies that subcheck without establishing file absence.

   **Resolution:** Inspect PID mode, user, and security options; test process separation directly. Make the marker check distinguish confirmed absence from execution failure, with a positive control demonstrating that the inspection command works.

6. **packages/sandbox/src/local/probe.ts:117 — factually wrong — low — the response timeout is inactivity-based, not elapsed-time-based.**

   `req.setTimeout` does not implement the stated ten-second limit “from the moment it is sent.” A server can send body fragments frequently enough to keep the connection active and finish after ten seconds. The scenario can then pass.

   The provider’s overall sandbox budget remains a separate bound; this is not an unlimited execution bypass.

   **Resolution:** Start an independent timer when sending each request, clear it on settlement, and destroy the request when that deadline expires. Test a steadily trickling response that exceeds ten seconds.

The central observer design is sound under the supplied trust boundary: the product’s writable files do not supply the probe executable or source; network response strings are JSON-encoded rather than executed; and the comparison runs on the host. `readProbeOutput` rejects malformed JSON, unknown observation shapes, and incorrect observation counts. Missing readiness and missing observations fail comparison. Unsupported providers are explicitly excluded from HTTP detection.

I found no source-supported route for product response bytes to redirect the probe beyond loopback. Its connection address is a fixed numeric loopback address; response headers are not used as destinations, and there is no redirect-following implementation. A product-operated forwarder could use its existing network access, but that does not create additional reach through this probe.

TypeScript casts, declaration merging, and the structural `canProbe` predicate do not themselves give this adversary host execution or control over the trusted provider. The relevant language failure here is the runtime handling of sparse arrays and JavaScript numeric values, not the ability to write an `as` expression.

The adversarial framing is appropriate for evidence integrity and network confinement. Its limit is that a behavioral check establishes the observed exchanges, not which internal application process deserves credit or whether the implementation generalizes beyond those exchanges. A replacement server that actually answers every tested request correctly is indistinguishable at this boundary; broader correctness requires broader acceptance criteria.