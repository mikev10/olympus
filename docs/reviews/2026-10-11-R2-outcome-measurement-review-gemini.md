# External review of R2, gemini, 2026-10-11

An adversarial pre-merge review of R2 (outcome measurement): `outcomes.ts` and
the bounds in `bounds.ts`, the run endings and record-only standing in
`run.ts`, GitHub's merge time in `integrate.ts`, the run listing in both
vaults, the HTTP and CLI surfaces, and the conformance entries that state those
properties, together with the R1 amendment's negative fixtures that share the
diff range. One of two reviews run from the same prompt and bundle; the other
is `2026-10-11-R2-outcome-measurement-review-codex.md`. Both are triaged in
`2026-10-11-R2-outcome-measurement-triage.md`, which cites this review's
findings as `gemini-1` to `gemini-4`, numbered in the order they appear under
the reply's item-1 heading (the reply itself does not number them).

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no
  tools; `cleanRoom` is `null` because an API call loads no local
  configuration. Exit 0, not timed out, 251.2 s. Ingestion `complete`: 75,780
  prompt tokens against a floor of 52,054. Integrity `verified`: the reply
  echoes every required bundle marker. Outcome `counted`. Reply SHA-256 as the
  runner wrote it:
  `86ed4ec785467588f3f1230aff313643a69d1994915b69095fafa996178ea614`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** gemini-1 (a run that halts after the integration
  record is written but before run state records the spent approval reads as
  merged and autonomous) was raised by codex too, as codex-2. gemini-2 to
  gemini-4 were raised by gemini alone.
- **Date:** 2026-10-11 (run started 2026-10-11T22:41Z).
- **Bundle:** `2026-10-11-R2-outcome-measurement-review-bundle.txt`, SHA-256
  `3a2cb047dfb3610f00af4b03f23f181a488776c6eec803890a098880df57cf34`, base
  `9021655` (`reviewed/R1`), head `0a7141d` ("R2: outcome measurement"). The
  range holds three commits: the R1 amendment adding a negative fixture for
  every ceiling-bearing probe (#34), the R2 spec and amendments, and R2 itself.
  It held the full contents or whole-function diffs of 32 of the 36 changed
  paths; the four documentation paths (`docs/decisions.md`,
  `docs/plan/DECOMPOSITION.md`, `docs/plan/R1-readiness.md`,
  `docs/plan/R2-outcomes.md`) were excluded, and so was every unchanged file.
  Prompt: `2026-10-11-R2-outcome-measurement-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior project
  context and performed no lookups. This is a self-report and is not
  independently verifiable.
- **Coverage, and any gap:** the reply answers three of the seven prompt items
  under their own headings: item 1 (all four findings), item 6 (sound
  mechanisms: the bounds, approval-wait collapsing, unmetered-usage exclusion)
  and item 7 (the framing is right). Items 2 (tautological checks), 3 (fail
  open), 4 (language escape hatches) and 5 (configuration) came back empty;
  gemini-4 describes a fail-open validation but is filed under item 1.
  Silence on those four items is not a finding that they are clean.
- **Citations:** line numbers refer to positions in the bundle's files (new
  side of each diff), not to the repository. They are hints; the triage
  locates each construct before citing it.

---

BASE: 9021655
HEAD: 0a7141d
packages/vault/src/types.ts
b0d7a206a149780a0c867e965fe0d68d

I did not have prior context about this project, and I performed no lookups.

### 1. Places where the mechanism can succeed while the property it protects is violated

**packages/api/src/outcomes.ts:241** — factually wrong — High
**The concrete bypass:** The `autonomyRatio` artificially inflates if the adversary halts the runtime at a specific moment. A run is classified as `autonomous` if its ending is `'merged'` and `approvalsSpent === 0`. The `'merged'` ending relies on the `IntegrationRecord` (written independently in `vault.recordIntegration` the moment GitHub merges), but `approvalsSpent` relies on the run's `RunState` (`state.approvals.some(g => g.usedAt !== null)`). If the adversary stops the process right after `recordIntegration` succeeds but *before* `commitRunState` updates the state with the spent approval, the run reads as merged with zero spent approvals. It is wrongly counted as fully autonomous.
**What would resolve it:** Instead of reading spent approvals from the `RunState` (which is vulnerable to this write-skew), count the `approval-granted` entries directly from `run.decisions`. Decisions are immutably recorded when the human grants them, securely preceding the merge action.

**packages/api/src/outcomes.ts:161** and **packages/api/src/run.ts:792** — factually wrong — High
**The concrete bypass:** Fully autonomous runs that succeed without an integrator are completely excluded from throughput metrics and improperly evaluated via live workspace checks. Both `deriveOutcomes` and `runStanding` rely strictly on the presence of a spent approval at the final `integrate` gate (`state.approvals.some(...)`) to identify a `'passed'` run. However, fully autonomous runs (e.g., requestedLevel 3) do not require approvals and thus never spend one. 
In `outcomes.ts`, the ending evaluation falls through to `'unfinished'`, silently stripping the successful run from the autonomy ratio, cycle time, and yield pools. In `run.ts`, `runStanding` falls through to `reloadExecuted`, checking live workspace locks and returning `source: 'workspace'`, directly violating the invariant that completed runs must be derived from records alone.
**What would resolve it:** Identify completed runs using an explicit terminal indicator (e.g., a `phase: 'completed'` in `RunState` or verifying the final station's task status), rather than exclusively checking for a spent gate approval that autonomous runs lack.

**packages/api/src/outcomes.ts:121** and **packages/api/src/outcomes.ts:318** — factually wrong — Medium
**The concrete bypass:** Cost estimates and the first-pass yield by model randomly misattribute data when tasks escalate. The logic assumes `calls[0]` or `calls.find((r) => r.attempt === 1)` yields the chronologically *first* driver call of an attempt to determine the task's starting model. However, `LocalVault.readUsage` retrieves these records sorted alphabetically by their SHA-256 hash, not by time. If a task escalates (making multiple calls within `attempt 1` across different tier models), the "first" model selected is simply the one with the lowest hash.
**What would resolve it:** Add a sequential index, strictly monotonic clock reading, or timestamp to `UsageRecord`, and ensure the metrics layer sorts by this temporal indicator before selecting the first call.

**packages/api/src/http/server.ts:333** — factually wrong — Low
**The concrete bypass:** The HTTP `outcomeWindow` validation fails open on formatting. The prompt explicitly demands: "`from` and `to`, each an ISO time if given; anything else is refused". The implementation uses `Number.isNaN(Date.parse(value))`. Since `Date.parse` permissively accepts a vast array of non-ISO time formats (e.g., `10/11/2026`, `Oct 11 2026`), it violates the strict format constraint. 
**What would resolve it:** Enforce a strict ISO 8601 regex match on the `value` string before checking it against `Date.parse`.

### 6. Sound Mechanisms

I assess the following mechanisms as structurally sound and well-executed:

- **The Clopper-Pearson Bounds (`bounds.ts`)**: The derivation of the exact binomial confidence intervals via binary search over the CDF is mathematically excellent. By bounding `mid` effectively away from absolute `0`, it avoids JavaScript `-Infinity` `NaN` cascade panics. Furthermore, mirroring the failure rate upper bound to derive the success rate lower bound (`1 - upperBound(sample - count, ...)`) accurately implements the requested one-sided statistics. 
- **Approval Wait Collapsing (`outcomes.ts:192`)**: The logic to map arbitrary resumes (which blindly repeat identical ungranted requests) to a single clearance cleanly models real wait times without overcounting. Extracting the oldest valid request before the grant is resilient to chaotic start/stop loops by the adversary.
- **Unmetered Usage Exclusion (`outcomes.ts:317`)**: By failing closed and entirely dropping tasks that possess even a single unmetered call (`pending` or `lost`) from the median cost calculations, it structurally prevents an adversary from artificially driving down the projected cost estimate by repeatedly cutting the power before completion.

### 7. Framing

The adversarial framing provided is **exactly the right question** for this code. Because the adversary fundamentally controls the physical execution environment (when the process stops and resumes), race conditions between distinct Vault writes (like the integration record persisting before the run state) are inevitable. Asking how a party can exploit those seams to misrepresent the published metrics directly surfaces critical flaws (like the autonomy ratio bypass).