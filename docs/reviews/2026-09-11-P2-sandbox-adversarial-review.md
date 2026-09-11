# External review of P2, 2026-09-11

The verbatim findings of an external adversarial review of the sandbox
(`packages/sandbox/src/local/`, its package tests, and the P2 conformance
additions). The triage, with what was and was not acted on and why, is the
companion file `2026-09-11-P2-sandbox-adversarial-triage.md`.

## Source

- **Reviewer:** Gemini. Family: Google Gemini. Temporary chat, no memory or
  history, no repository access; worked from the uploaded review bundle alone.
- **Family rotation:** ChatGPT reviewed F3 and S1; Gemini reviewed P1. **This
  review did not rotate** — it is the second consecutive Google Gemini review.
  Recorded rather than glossed: two runs of one family return correlated
  findings, which reads as consensus while being one opinion sampled twice, so
  agreement between the P1 and P2 reviews is weaker evidence than agreement
  across families would be. A third family is owed to the next unit.
- **Date:** 2026-09-11.
- **Bundle:** base `a5c3028` (`reviewed/P1`), head `ddc317c` (the tip of
  `unit/p2`). The bundle held the full contents of every tracked file changed
  in that range, with `docs/plan/`, `docs/decisions.md`, and `docs/reviews/`
  excluded. It additionally carried two unchanged files as labelled reference
  context — `packages/sandbox/src/types.ts`, the contract the unit implements,
  and `packages/sandbox/src/stub/provider.ts` — because the mount code cannot
  be judged against a contract the reviewer cannot see.
- **Prior context and lookups:** the reviewer stated at the top that it had set
  aside all prior context and performed no external lookups. Recorded as
  disclosed. It is a self-report and is not independently verifiable.
- **Coverage, and any gap:** the prompt asked seven numbered things. Items 1
  (bypasses), 2 (tautological checks), 5 (configuration satisfied without doing
  what it appears to do), 6 (mechanisms assessed sound) and 7 (whether the
  framing was right) were answered. **Item 3 (fail-open conditions) and item 4
  (language-level escape hatches: casts, `unknown`, `any`, declaration merging,
  module augmentation, generic erasure, type predicates) came back empty** — no
  finding is labelled as either, and neither is addressed as a category. Item 3
  is partly covered in substance by finding 3, which is a fail-open condition
  even though it is not filed as one; item 4 is not covered at all, which
  matters because the unit deliberately introduced a widened input type
  (`UnvalidatedMountEntry`) and the tests reach the run-time guards through
  `as unknown as` casts. Silence on those is not endorsement of them.
- **Citations:** line numbers refer to positions in the review bundle, not to
  the repository. They are hints, and each was re-located by reading the named
  construct rather than by trusting the number.

---

I have set aside all prior context and performed no external lookups. The review below is based solely on the provided contents of `olympus-p2-review.txt`.

The adversarial framing you provided is exactly the right approach for this code. When building a container sandbox that physically enforces security invariants (especially one standing between an untrusted agent and an immutable audit store), assuming the easiest bypass path and hunting for fail-open conditions or TOCTOU (Time-of-Check to Time-of-Use) flaws is the most rigorous way to validate the implementation.

Here is the concrete review of the mechanisms and assertions, ordered by severity.

### 1. Docker Mount Argument Injection (Bypass)

* **Location:** `packages/sandbox/src/local/mounts.ts:47` and `107`
* **Type:** factually wrong
* **Severity:** High
* **The concrete bypass:** The `refuseUnrepresentable` check prevents commas in the *unresolved* `entry.source` to stop `--mount` flag injection. However, an attacker can provide a symlink (e.g., `/tmp/link`) that contains no commas but resolves to a directory with commas and valid Docker mount flags (e.g., `/tmp/dir,source=/vault`). The `realpath` resolution returns this malicious path, which is directly interpolated into `mountArgument()`. Docker will parse the comma as an option delimiter, allowing the attacker to completely overwrite the mount target and directly mount the Vault.


* **What would resolve it:** Call `refuseUnrepresentable(label + ' resolved source', source)` immediately after `resolveSource()` returns, ensuring the fully resolved path is validated before it reaches Docker execution.

### 2. Unenforced Wall-Clock Lifetime Budget

* **Location:** `packages/sandbox/src/local/provider.ts:143`
* **Type:** factually wrong
* **Severity:** High
* **The concrete bypass:** The sandbox's wall-clock limit is only evaluated synchronously when the caller invokes `exec()`. If an agent executes a background process (e.g., `nohup malicious_work &`) and the caller issues no subsequent `exec()` calls, the check `remaining <= 0` is never triggered. The container continues running indefinitely on the host, completely bypassing the lifetime budget constraint.


* **What would resolve it:** Register a `setTimeout` (or equivalent background timer) at the end of `provision()` that proactively calls `this.#end()` to forcefully destroy the container when the deadline expires, independent of API activity.

### 3. Vault Path Resolution Fails Open

* **Location:** `packages/sandbox/src/local/mounts.ts:98`
* **Type:** factually wrong
* **Severity:** High
* **The concrete bypass:** If the designated Vault path does not exist at provision time, `resolveMounts` catches the `realpath` exception and falls back to the unresolved `absolute` path for containment checks. If that unresolved path contains a symlink in a parent directory, the string-matching in `overlapsPath()` will compare a fully-resolved attacker source against an unresolved Vault string. The mismatch yields a false negative, granting the attacker read-write access to the Vault's location once it is created.


* **What would resolve it:** Instead of blindly returning `absolute` on failure, recursively walk up the directory tree to find the deepest existing parent, resolve it using `realpath`, and append the remaining unresolved segments to produce a canonicalized fallback string.

### 4. Tautological Vault Prototype Assertion

* **Location:** `packages/conformance/src/registry/i1.ts:25`
* **Type:** factually wrong
* **Severity:** Medium
* **The concrete bypass:** The check `I1.vault-implementation-exposes-only-named-operations` only inspects `Object.getOwnPropertyNames(LocalVault.prototype)`. This assertion passes even if the Vault implementation exposes unauthorized generic write methods via inheritance (the prototype chain), JavaScript Symbols, or instance properties assigned directly in the constructor.


* **What would resolve it:** Instantiate a concrete `LocalVault` object and inspect its entire prototype chain (`Object.getPrototypeOf`), including Symbol properties and instance-bound functions.

### 5. Tautological Remote Capability Claim

* **Location:** `packages/conformance/src/registry/claims.ts:121`
* **Type:** factually wrong
* **Severity:** Medium
* **The concrete bypass:** The `sandbox.remote` assertion verifies the container's environment by querying `provider.daemon().endpoint` and matching it against `provider.capabilities().remote`. A provider that incorrectly identifies its endpoint will easily pass this test because the test trusts the provider's own state rather than independently observing the container or host.


* **What would resolve it:** Independently verify network locality by executing commands inside the container or dynamically inspecting host network topology.

### 6. Incomplete Immutability on Mount Table

* **Location:** `packages/sandbox/src/local/mounts.ts:85`
* **Type:** unclear
* **Severity:** Low
* **The concrete bypass:** `mountTable()` freezes the returned table and the `others` array but fails to apply `Object.freeze()` to the `workspace` object. While practically safe because the returned table doesn't currently leak back to untrusted scopes, this shallow freeze fails to enforce immutability strictly at the data boundary.


* **What would resolve it:** Apply `Object.freeze(workspace)` prior to returning the table.

---

### Sound Mechanisms Assessed

* **Egress Allowlist Refusal:** (`packages/sandbox/src/local/provider.ts:68`) **Sound.** Refusing an `allowlist` configuration outright instead of silently degrading it to `deny-all` or `allow-all` perfectly enforces the fail-closed invariant.


* **Over-strict Path Comparison:** (`packages/sandbox/src/local/paths.ts:15`) **A tradeoff I would have made differently (but sound).** Forcing path comparisons to lowercase on case-sensitive filesystems means `/Vault` and `/vault` overlap and will trigger a refusal. This strictness is a classic fail-closed tradeoff—refusing a theoretically safe operation is always better than allowing a bypass via case-sensitivity desynchronization.



Are you planning to address the `setTimeout` background timer implementation for the wall-clock budget directly within `LocalDockerProvider`, or should that lifecycle enforcement happen at a higher orchestrator layer?
