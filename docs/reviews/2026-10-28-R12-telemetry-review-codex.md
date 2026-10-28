# External review of R12, codex, 2026-10-28

The Codex family's review of R12, telemetry export and the two record amendments it rests on. The triage of both reviews is `2026-10-28-R12-telemetry-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`. 64,701 input tokens ingested against a floor of 39,100; echo verified.
- **Cross-family agreement:** gemini raised findings 1 (model-controlled ids exported), 3 (no-read-back scan bypassed), and part of 4 (resource attributes unchecked) too. Findings 2 and 5–8 were raised by codex alone.
- **Date:** 2026-10-28
- **Bundle:** `2026-10-28-R12-telemetry-review-bundle.txt`, SHA-256 `d05f562cd52968761cd0fb26d7ad068de2f86abd0c959d17955c475b79cb250e`, base `6909a7c` (`reviewed/R7`), head `8daf393` (the unit branch after the acceptance run, before review). It held 24 sections: every new file in full and every modified file as a function-context diff. `docs/decisions.md`, `docs/plan/`, and `docs/reviews/` were excluded. Prompt: `2026-10-28-R12-telemetry-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context and made no external lookups, and that local command execution was blocked. This is a self-report, not independently verifiable.
- **Coverage, and any gap:** items 1, 2, 3, 4, 5, and 7 are answered through the findings and the closing paragraph. Item 6 (sound mechanisms) is answered with a list. The reviewer said it could not establish the finished-run guarantee because `readRunRecords` was not in the bundle.
- **Citations:** line numbers refer to positions in the bundle, not the repository. They are treated as hints and were located by construct in the triage.

---

BASE: 6909a7c  
HEAD: 8daf393  
packages/vault/test/stub.test.ts  
f7d5616cbc4c4e36e66d292fc3040517

Prior context: none. External lookups: none. I reviewed the supplied inline bundle. Local command execution was blocked, so I did not run tests or verify the file’s SHA-256.

1. **`packages/api/src/telemetry.ts:375` and `:384` — factually wrong — high — Model-controlled task IDs provide an export channel.**

   A model can put text into a drafted plan’s task ID—for example, `task-secret-<encoded-content>`. The exporter copies that ID into `factory.task.id` and the task span’s name. Call and check attributes also carry it. An allowlisted attribute **key** does not make its value runtime-controlled.

   This does not require forged Vault records, malicious drivers, or a TypeScript cast. Even restricting identifiers to ordinary alphanumeric characters permits encoded text.

   **Resolve:** Export an opaque runtime-assigned identifier or a deterministic digest instead of the model’s task ID, including in span names. Test a drafted plan containing a distinctive marker in its IDs and assert that the marker appears nowhere in the serialized export.

2. **`packages/cli/src/cli.ts:300` and `:302` — factually wrong — medium — Collector URL errors print credentials.**

   Pass `--endpoint ftp://user:collector-secret@example.com`. URL parsing succeeds, but the protocol check constructs an error containing the complete raw argument. `runCli` prints that error. A malformed URL containing a credential takes the same path through the parsing error.

   The success-path test with `x-collector-key=secret-value` does not exercise either failure.

   **Resolve:** Use fixed messages for invalid collector URLs, without interpolating `raw`. Reject URL credentials with a similarly sanitized message. Add failure-path tests with secrets in URL user information and query parameters. Also sanitize collector transport exceptions before the outer catch prints them.

3. **`packages/conformance/src/registry/telemetry.ts:212` — factually wrong — medium — The no-read-back scan misses ordinary imports of the exporter.**

   A runtime module can write:

   ```ts
   import { telemetryOf } from './index.js';
   ```

   The API index explicitly re-exports the exporter. This import does not match the scan’s `telemetry.js` expression. Neither does:

   ```ts
   const { telemetryOf } = await import('./telemetry.js');
   ```

   A gate could then use the returned attributes to make a decision while this assertion passes. Package imports and intervening re-export modules offer further routes. No cast or type-system escape is necessary.

   **Resolve:** Check resolved dependencies and symbol references, including barrel exports and dynamic imports, or enforce a package boundary that makes the exporter unavailable to decision code. Include negative fixtures for these constructions and require the scan to reject them.

   This is a bypass of the architectural assertion, not evidence that current runtime code already reads telemetry back.

4. **`packages/conformance/src/registry/telemetry.ts:181`–`:195` — factually wrong — medium — The attribute check does not enforce a fixed, comprehensive export policy.**

   The assertion imports its allowed keys from the implementation it checks. Adding a new sensitive key to `TELEMETRY_ATTRIBUTES` and emitting it satisfies the assertion without changing the independent acceptance criterion.

   It also never visits resource attributes. For example, adding an attribute containing `runId` under a new key in `resource()` would bypass the key check entirely. That value need not match either text sentinel. Span names and other string-bearing fields likewise receive no general policy validation.

   **Resolve:** Keep an independently specified export schema that covers the complete serialized object: resource attributes, span names, events, metrics, keys, and permitted value provenance. Mutation-test additions in each location.

   The existing key comparison is not literally unconditional, but its policy can be broadened by the same implementation change it is supposed to constrain.

5. **`packages/vault/src/local/vault.ts:245` and `packages/vault/test/local.test.ts:478` — factually wrong — medium — New station history can be silently erased and then interpreted as legacy absence.**

   The test demonstrates that a *new* `commitRunState` accepts a record without `stations`. Reading it substitutes `[]`. After reading a populated state, a caller can omit `stations` using a cast and commit the remainder, thereby discarding the history while subsequent reads report only “not recorded.”

   A cast is not even necessary to replace the history with `stations: []`: that is valid `RunState`. The shown read validator accepts it.

   **Resolve:** Separate legacy read normalization from new-write validation. Require station history on new writes and enforce preservation of the previously committed prefix. Test omission, truncation, replacement, and mutation of existing entries.

   This is a record-contract defect; I am not assuming that the model can directly invoke Vault methods.

6. **`packages/vault/src/local/vault.ts:283` and `:305` — factually wrong — medium — Timing validation accepts ambiguous and reversed intervals.**

   `isTime` accepts any string that `Date.parse` understands. For example, a zone-free timestamp such as `2026-10-28T10:00:00` passes, but its interpretation depends on the reader’s timezone. The same record can therefore produce different exported timestamps on different hosts.

   The validator also accepts a terminal `endedAt` earlier than `startedAt`. The exporter then emits a reversed span and a negative duration histogram observation at `packages/api/src/telemetry.ts:461`.

   Both constructions fit the declared string-based types; casts are unnecessary.

   **Resolve:** Require an unambiguous timestamp representation and validate interval ordering. Apply the same timestamp rule to station entries. Reject inconsistent records rather than repairing them silently.

   Normal line writes use `toISOString()`, so the ambiguous-format construction concerns the public record boundary. Clock rollback can produce reversed intervals even with the normal writer.

7. **`packages/vault/src/stub/vault.ts:153` and `:250` — factually wrong — medium — Stub validation admits malformed timing and silently normalizes invalid station history.**

   The timing guard checks only `typeof r.timing !== 'object'`. Consequently, `null`, `{}`, and arrays pass when supplied through `unknown` or `any` casts. Those records are stored without the promised timing fields.

   Separately, `stations: null` can be committed through a cast, after which `read.stations ?? []` silently converts it into absent history. LocalVault rejects that same value. These gaps are not among the stub’s declared persistence and isolation limitations.

   **Resolve:** Share timing and station validators between Vault implementations. Normalize only genuinely absent legacy fields, and reject present-but-invalid values. Add parity tests for `null`, incomplete objects, arrays, and missing endpoints.

8. **`packages/conformance/src/registry/telemetry.ts:141` — factually wrong — low — The untimed-count assertion passes when the count is missing.**

   The assertion tests:

   ```ts
   Number(attr(run, 'factory.calls.untimed')) < 1
   ```

   If the exporter stops emitting that attribute, `attr` returns `undefined`, conversion yields `NaN`, and the comparison is false. With `factory.stations.recorded` still false, the assertion passes despite deleting the capability it claims to verify.

   **Resolve:** Require the attribute explicitly and compare its parsed integer value against the independently calculated expected count. Test deletion of the attribute.

The following mechanisms look sound within the supplied code and trust boundary:

- Token and cost fields come from usage readings, not `TaskResult.usage`. Lost and unmetered readings do not acquire zero-valued token or cost observations.
- Model identity comes from the trusted driver’s pre-call resolution. The line supplies timestamps itself.
- Pending records are written before invocation; terminal records retain that start. Pairing uses task, station, attempt, and start time rather than array adjacency.
- Tool-call counts are explicitly named `factory.claim.tool_calls`; they are not presented as an independently observed runtime count.
- The service constructs and serves the export; collector POSTs occur in the CLI.
- The new telemetry assertions generally propagate exceptions. I found no blanket exception-to-pass handler in them. The specific missing-value pass is finding 8.
- CLI-versus-library equality is a useful transport assertion, though it cannot establish that the library’s export is correct.

I cannot fully establish the finished-run guarantee from this bundle: `telemetryOf` delegates classification to `readRunRecords`, whose implementation is not included. The shown code refuses `unfinished`, and tests cover waiting at integration, but that does not establish every crash or terminal-state classification. I would inspect that classifier and its record-consistency assumptions before asserting a bypass or declaring the guarantee sound.

The adversarial framing is appropriate for exported values, CLI diagnostics, and crash boundaries. Architectural scan bypasses and malformed in-process Vault calls are a separate category: they test whether future code changes can violate the contract unnoticed. They should not be described as capabilities already available to the model. None of the demonstrated bypasses requires declaration merging, module augmentation, or generic erasure; ordinary imports, valid string values, and—in the malformed-record cases—casts suffice.