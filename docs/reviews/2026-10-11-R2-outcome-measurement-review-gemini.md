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