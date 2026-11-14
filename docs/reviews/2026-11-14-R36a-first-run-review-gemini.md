# External review of R36a, gemini, 2026-11-14

The admission path, base snapshot, and failure reporting of R36a (the shipped example runs on the real driver), reviewed from the bundle alone. Triage: `2026-11-14-R36a-first-run-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration.
- **Cross-family agreement:** none. All three findings (gemini-1 to gemini-3) were raised by this family alone; none of Codex's four describes the same mechanism.
- **Date:** 2026-11-14
- **Bundle:** `2026-11-14-R36a-first-run-review-bundle.txt`, SHA-256 `d2c0aa21ad7b0d17436859593bd8a03c7bf1174fc185bce8f5dc02dc214206bd`, base `eab6a44` (`reviewed/R34`), head `6a634ff` (unit/r36a after D-R36a-13, before the review files). Every file added since the base in full and every modified file as a function-context diff, 44 sections; `docs/decisions.md`, `docs/reviews/`, `docs/plan/` and `pnpm-lock.yaml` excluded. Prompt: `2026-11-14-R36a-first-run-review-prompt.txt`.
- **Prior context and lookups:** it reported no prior context and no external lookups. Self-reported, not independently verifiable.
- **Coverage, and any gap:** items 1 (gemini-1, gemini-2), 3 (gemini-3), 6 (soundness listed) and 7 (framing endorsed) answered; items 2 (tautological checks), 4 (language escape hatches) and 5 (configuration satisfied without effect) came back empty.
- **Citations:** line numbers are positions in the bundle, not the repository; the triage located each construct by name.

---

BASE: eab6a44
HEAD: 6a634ff
packages/vault/src/types.ts
2c390740f8a13747cb82e4d78a5b5b8d

I have no prior context about this project, and I performed no external lookups. 

### 1. `admittedEntries` traversal bypass allows injecting unadmitted/sensitive artifacts into the model's context
**File:** `packages/api/src/run.ts:886`
**Type:** factually wrong / concrete bypass
**Severity:** High

**The concrete bypass:** 
The new `admittedEntries` function recursively searches the user-provided `req.artifacts` object to locate artifacts and pass them to security and base-tree overlay checks. However, its traversal logic contains a critical flaw:
```typescript
      if (typeof record.path === 'string' && typeof record.sha256 === 'string') found.set(record.path, record.sha256);
      else Object.values(record).forEach(walk);
```
Because of the `else` clause, if an object is identified as an artifact (by having string properties `"path"` and `"sha256"`), the function **does not recurse** into any of its other properties.

An attacker can exploit this by placing the actual artifacts inside an object that itself has dummy `"path"` and `"sha256"` properties. For example, by adding `"path": "dummy"` and `"sha256": "dummy"` to the very root `req.artifacts` object, `admittedEntries` will process the root object as the sole artifact and halt traversal. 

Consequently, all actual artifacts (like `acceptanceTests`) are completely missed by both `sensitiveArtifacts` and `overlayArtifacts`. The attacker can commit a highly sensitive file (e.g., an API key or configuration file) in the base commit and reference it in the hidden `acceptanceTests`. Since it was bypassed, `sensitiveArtifacts` never rejects it, and `overlayArtifacts` ignores it. Later, the runtime will extract the `acceptanceTests` directly from the object and pass the sensitive file’s contents into the model's context, violating default deny and breaking the trust boundary constraints.

**What would resolve it:** 
Remove the `else` keyword. The function should always recurse into the object's values to ensure no nested artifacts can be hidden from validation checks, even if the parent object matches the artifact criteria:
```typescript
      if (typeof record.path === 'string' && typeof record.sha256 === 'string') found.set(record.path, record.sha256);
      Object.values(record).forEach(walk);
```

### 2. Log injection via unsanitized `TaskId` in `attemptLine`
**File:** `packages/api/src/http/server.ts:48`
**Type:** factually wrong / concrete bypass
**Severity:** Medium

**The concrete bypass:** 
The `attemptLine` function logs failed attempts to the host's log. To ensure logs stay strictly on one line as specified, it sanitizes `failure.untrustedDetail` by replacing control characters with spaces. However, it interpolates the `task` parameter (a `TaskId`) directly into the log line without sanitization.

As explicitly stated in the invariants context, "a task id is the requester's text, admitted with no character class". An attacker can supply a task graph containing a `TaskId` with newline characters (e.g., `"my-task\n2026-11-14T00:00:00Z [INFO] run 1234 task evil: attempt succeeded"`). When this task fails, the newlines are written to the log unaltered, allowing the attacker to spoof trusted status logs or hide failure logs, directly violating the invariant that "event payloads are data, never instructions" and "One line a failed attempt is logged as".

**What would resolve it:** 
Sanitize the `task` variable (and ideally all interpolated variables like `runId`, `failure.source`, and `failure.layer`) for control characters using the same regex replacement currently applied to `failure.untrustedDetail`.

### 3. `snapshotBase` throws generic `Error` for an existing base, yielding a 500 status rather than a graceful refusal
**File:** `packages/api/src/workspace.ts:228`
**Type:** a tradeoff I would have made differently / fails open (to an unhandled exception)
**Severity:** Low

**The issue:** 
In `snapshotBase`, if the requested base already exists, the function throws a generic JavaScript `Error` (`throw new Error(...)`). Back in `run.ts`, the catch block is designed to gracefully catch and report `BaseRefusal` errors as 400-level `invalid-request` rejections, but it deliberately re-throws anything else (`if (!(error instanceof BaseRefusal)) throw error;`).

If a prior admission attempt failed after `snapshotBase` but before committing state (for instance, due to a server crash or network hiccup), the base is left behind. A subsequent request with the same `runId` will throw this generic `Error`, which causes the HTTP handler to crash and return a 500 Internal Server Error rather than the expected domain refusal.

**What would resolve it:** 
Change `throw new Error(...)` to `throw new BaseRefusal(...)` when detecting an existing base, ensuring it is properly caught and returned cleanly through the domain's refusal machinery.

---

### Soundness Assessment and Framing
- **`snapshotBase` / `materialize`**: Sound. By reading the tree directly from the provided base commit in git's object store (rather than checking out the working folder), it effectively prevents untracked working folder bytes and CRLF inconsistencies from entering the model's context.
- **Admission Order**: Sound. Refusing tool grants and evaluating the base snapshot explicitly before calculating the worst-case estimate guarantees that an unsupportable or unsafe run cannot have spend approved. 
- **`toolGrantRefusal`**: Sound. It rigorously matches the driver's actively declared tools against the requested capability scope derived from `worstCase.tasks`.
- **`attemptFailure`**: Sound (other than the log injection). It strictly bounds the output to 400 characters, isolates the component layer parsing safely (so the attacker cannot manipulate the object properties), and stores it distinctly as untrusted data rather than prompt instructions.

**Framing:** The adversarial framing provided is excellent and perfectly scopes the security goals of the runtime. The emphasis on data vs. instructions, strict boundaries, and capable motivated attackers directly illuminated the traversal short-circuit and the log injection flaws.