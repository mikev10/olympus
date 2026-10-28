# External review of R12, gemini, 2026-10-28

The Gemini family's review of R12, telemetry export and the two record amendments it rests on. The triage of both reviews is `2026-10-28-R12-telemetry-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration. 57,070 input tokens ingested against a floor of 39,100; echo verified.
- **Cross-family agreement:** codex raised findings 1 (no-read-back scan bypassed), 2 (model-controlled ids exported), and 3 (resource attributes unchecked) too. Findings 4–8 were raised by gemini alone.
- **Date:** 2026-10-28
- **Bundle:** `2026-10-28-R12-telemetry-review-bundle.txt`, SHA-256 `d05f562cd52968761cd0fb26d7ad068de2f86abd0c959d17955c475b79cb250e`, base `6909a7c` (`reviewed/R7`), head `8daf393` (the unit branch after the acceptance run, before review). It held 24 sections: every new file in full and every modified file as a function-context diff. `docs/decisions.md`, `docs/plan/`, and `docs/reviews/` were excluded. Prompt: `2026-10-28-R12-telemetry-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context and made no external lookups. This is a self-report, not independently verifiable.
- **Coverage, and any gap:** the findings are not keyed to the prompt's numbered items. Item 6 is answered as a per-mechanism assessment, and item 7 as a framing assessment that called the framing correct. Item 5 (configuration satisfied without effect) has no finding of its own.
- **Citations:** line numbers refer to positions in the bundle, not the repository. They are treated as hints and were located by construct in the triage.

---

I have no prior context about this project, and I performed no external lookups during this review.

BASE: 6909a7c
HEAD: 8daf393
===== packages/vault/test/stub.test.ts =====
f7d5616cbc4c4e36e66d292fc3040517

### Findings

**packages/conformance/src/registry/telemetry.ts:246** — factually wrong — High — The no-read-back scan is completely bypassed. The regex `/from\s+['"][./]+(?:[^'"]*\/)?telemetry\.js['"]/` only catches relative path imports to `telemetry.js`. Any module in the runtime can read telemetry back simply by importing it from the package index (e.g., `import { telemetryOf } from '@olympus-ai/api';`), which the scan will fail to notice.
*Resolution:* Replace the regex with an AST-based check that finds all references to the telemetry module, including those exported through the package index, or at least expand the regex to cover `@olympus-ai/api` imports.

**packages/api/src/telemetry.ts:208** — factually wrong — High — Untrusted text controlled by the model is exported in telemetry. The model dictates the task IDs in its plan and can define the file names/checks in the workspace. These unvalidated, model-controlled strings are exported verbatim as `factory.task.id` (line 208) and `factory.check.id` (line 219). This provides a direct path for the model to exfiltrate secrets or credentials through the dashboard or CLI output.
*Resolution:* Validate `taskId` and `checkId` strictly at the intake/parsing boundary to ensure they match a safe regex (e.g., alphanumeric and hyphens only), or hash them before placing them in the export.

**packages/conformance/src/registry/telemetry.ts:233** — tautological check — Medium — The `TELEMETRY_EXPORTS_NO_TEXT` check is tautological because it fails to scan the attributes attached to the OTLP `Resource`. It iterates over spans and metric data points but completely misses `e.traces.resourceSpans[0].resource.attributes` and `e.metrics.resourceMetrics[0].resource.attributes`. The exporter could freely attach non-allowlisted attributes or leaked text to the `Resource` scope, and this test would still pass.
*Resolution:* Add loops to explicitly verify `resource.attributes` against the allowlist in both the traces and metrics assertions.

**packages/api/src/telemetry.ts:168** — factually wrong — Medium — The code double-counts untimed calls for legacy records, asserting facts the records do not support. In `callsOf`, it iterates through `usage` twice. For a single legacy call, both its pending record and its terminal record are present in the array, and both have `timing === 'not-recorded'`. The first loop increments `untimed` for the terminal record, and the second loop increments `untimed` for the pending record. The export will falsely claim 2 untimed calls for every 1 legacy call made.
*Resolution:* Consolidate the `untimed` counting logic so it is only evaluated once per unique legacy call (e.g., only counting it in the terminal record loop or tracking it by call ID).

**packages/api/src/telemetry.ts:153** — factually wrong — Medium — A halted run is exported, violating the invariant that spans whose records may still change are not exported. The `readRunRecords` treats `records.ending` as `'halted'`, which passes the `unfinished` check. However, a halted run (e.g., one that crashed mid-step) can still be resumed or cancelled by an operator. If it is cancelled later, the state changes to `cancelled`, altering the terminal state and timeline.
*Resolution:* Update the guard logic to treat a `halted` state as `unfinished` (refusing the export with a 409) since it requires terminal operator action (like a cancel) before it is permanently settled.

**packages/api/src/telemetry.ts:240** — factually wrong — Low — A time that was never recorded is presented as if it were. If a legacy run (admitted before R12 and lacking `stations`) is resumed after R12, the runtime appends only the new station entry. If `records.startedAt` is undefined, `stations[0]?.enteredAt` will fallback to the *resume* time, incorrectly presenting the resume time as the run's initial start time and wiping out the earlier timeline.
*Resolution:* If it is a legacy run and `records.startedAt` is undefined, refuse to export the run or handle it explicitly as having an unknown start time, rather than falling back to the first post-resume station entry.

**packages/api/src/telemetry.ts:213** — fails open — Low — If a legacy or malformed check (such as an `UnstartedCheck` that aborted before a start time could be stamped) lacks `check.startedAt`, `Date.parse(undefined)` yields `NaN`. Attempting to instantiate `new Date(NaN).toISOString()` throws a `RangeError`. This crashes the API route with an unhandled 500 error instead of failing closed gracefully with a clean refusal or marking it as unrecorded.
*Resolution:* Check that `check.startedAt` is defined and valid before parsing; if it is not, either omit the check span or return an explicit refusal.

**packages/api/src/telemetry.ts:192** — language escape hatch — Low — The cast `decode(await vault.read(ref)) as EvidenceBundle` blindly trusts the Vault's contents to match the TS interface. If a legacy EvidenceBundle lacks fields like `startedAt`, the cast hides this from the compiler. The failure surfaces later as a runtime crash (as seen above) rather than a controlled data boundary refusal. Similar escape hatches exist in `cost.ts` (`as UsageRecord`).
*Resolution:* Validate the parsed schema at runtime (e.g., via a parsing library or manual type guards) before asserting it matches the interface.

### Mechanism Assessment

1. **Pairing pending records with terminal ones:** **Sound.** The matching logic (using task, station, attempt, and start time) is robust and correctly handles edge cases where the runtime crashes (leaving orphaned pending records mapped to status 2/lost) without emitting zero-value metrics.
2. **Placing spans in time:** **Mostly Sound.** The derivation of timeline events deterministically from records is well-structured, but it falters on legacy data edges where fallback logic inadvertently invents start times.
3. **The attribute allowlist and the no-read-back scan:** **Unsound.** The allowlist test misses OTLP resource scopes entirely, and the no-read-back scan is easily bypassed by importing from the package index rather than the specific file. 
4. **The two new fields, written and read back:** **Sound.** The strict validation upon write to the Vault ensures data integrity, and defaulting to `'not-recorded'` on read safely bridges legacy records without inventing data.

### Framing Assessment

The adversarial framing is correct and highly effective for this type of telemetry code. By assuming the adversary controls the workspace and model outputs, it properly surfaces that seemingly benign fields (like `taskId` and `checkId`) are actually untrusted text and severe exfiltration vectors. The one minor mismatch in the framing is asking about the CLI leaking credentials in HTTP errors—Node's `fetch` API does not typically leak request headers in connection exceptions. The real risk of the CLI output was the raw printout of the export (containing the model's injected text) when no collector is configured.