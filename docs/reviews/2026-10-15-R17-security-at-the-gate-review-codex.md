BASE: reviewed/R15
HEAD: a1d5b8e
packages/vault/test/stub.test.ts
0cf0cedeb7466b22a4f7e3fa24cfea57

I had no prior project context. I reviewed the bundle supplied in the prompt and performed no external lookups. A local file-listing command was blocked; I ran no tests and did not independently verify the file’s SHA-256. Citations below use new-side source lines.

1. **packages/api/src/scan.ts:48 — factually wrong — high — Removing scanner configuration also removes attacker-controlled content from inspection.**

   `removeNamed` recursively deletes any entry with a listed basename, including directories. The submitted tree retains those entries; only the scanned copy loses them.

   Put a new credential in `.gitleaks.toml`, or in `.gitleaksignore/credential.txt`. Both disappear before the secret scan. Likewise, put flagged TypeScript in `.semgrepignore/payload.ts`: the static-analysis scan never receives it. These constructions need no inline suppression marker.

   **Resolution:** Preserve these bytes for inspection while preventing their interpretation as configuration. Alternatively, refuse changes using reserved scanner names, including directories, and explicitly handle existing reserved files. Add real-scanner tests for credentials inside configuration files and source inside directories with these names.

   **Confidence: high.** The deletion occurs in runtime code, independently of scanner behavior.

2. **packages/api/src/security.ts:129 — factually wrong — high — An optional denial check satisfies the mandatory denial requirement.**

   The `denied` set includes every acceptance or behavioral check carrying `deniesRule`, without checking `required`.

   A request can name `owner-only`, then supply:

   ```json
   {
     "id": "deny-owner",
     "kind": "behavioral",
     "deniesRule": "owner-only",
     "command": ["node", "-e", "process.exit(1)"],
     "required": false,
     "timeoutMs": 10000
   }
   ```

   Include an independent required reproduction check and the required scanners. This denial check satisfies `test-design`, need not run on the base because it omits `onBase`, and cannot fail the verify gate even when it fails every time. The supplied optional-check test confirms that optional failures permit a task to pass.

   **Resolution:** Count only required checks toward denial coverage. Require an explicit base declaration for those checks and retain their binding to the named authorization rule.

   **Confidence: high.**

3. **packages/api/src/security.ts:129 — factually wrong — high — `deniesRule` proves a label exists, not that a denied caller was exercised.**

   Even making the check required does not fix the semantic gap. A behavioral check with `deniesRule: "owner-only"`, `onBase: "passes"`, and `command: ["node", "-e", "process.exit(0)"]` satisfies the requirement without contacting the product.

   The positive control in `packages/conformance/src/registry/security.ts`, inside `RULE_NEEDS_A_DENIAL_CHECK`, uses exactly this construction. Its “denial” passes regardless of the authorization implementation. A separate reproduction check can satisfy the manifest’s requirement for something failing on the base.

   **Resolution:** Represent denial scenarios as runtime-executed interactions specifying caller identity, attempted operation, and expected refusal. Bind the rule to that scenario and check its observation outside the product. Until then, describe this mechanism as declaration coverage rather than evidence of denial.

   **Confidence: high.** This is a tautological security check explicitly accepted by the supplied test.

4. **packages/api/src/security.ts:176 — factually wrong — high — Secret values can reach the Vault through finding metadata.**

   Hashing `Secret` does not make the remaining finding fields secret-free. Paths are agent-controlled and are rendered verbatim.

   Create a file named `<credential>.ts` whose contents also contain that credential. When the scanner reports the content finding, its path contains the same credential. `renderFindings` stores that path in `stdout`, and the result also retains it in `findings`. The evidence bundle additionally retains diff paths at `packages/api/src/line.ts:1197`.

   The check can correctly fail while violating the separate requirement that discovered secrets never enter the Vault. The existing seeded-secret test uses an innocuous filename, so it misses this channel. Raw scanner `stderr` is another unsanitized channel retained by `scanTree`, though its actual leakage behavior needs scanner-specific testing.

   **Resolution:** Apply a consistent redaction or opaque-identifier strategy to paths, diagnostics, and other evidence fields before persistence. Test secret-bearing filenames as well as secret-bearing content.

   **Confidence: high for the filename construction; unverified for scanner diagnostics.**

5. **packages/adapters/src/security.ts:89 — factually wrong — medium — Whitespace normalization creates baseline collisions between different matched programs.**

   `staticFingerprint` collapses whitespace throughout the matched source, including inside string literals.

   With a pinned rule matching `eval($X)`, put this on the base:

   ```ts
   eval("a  b");
   ```

   Replace it in the same file with:

   ```ts
   eval("a b");
   ```

   Both fingerprints receive the same normalized matched text. Their rule, path, and occurrence count also agree, so the new flagged expression is accounted for by the base. The string values—and potentially their behavior—differ. Similar collisions exist inside template literals.

   **Resolution:** Normalize only syntactically insignificant whitespace using language-aware tokens, preserving literal contents, or hash the exact matched text while accepting formatting-related churn.

   **Confidence: high for the collision.** Its practical impact depends on the pinned rule and matched expression.

6. **packages/api/src/tamper.ts:266 — factually wrong — medium — Marker counts do not establish whether the diff added a suppression marker.**

   The implementation compares the number of marker-bearing lines per file, rather than examining added lines.

   For example:

   ```diff
   -// Documentation example: nosemgrep
   +// Documentation example removed.
    ...
   -const value = harmless();
   +const value = harmless(); // nosemgrep
   ```

   Each version contains one marker-bearing line, so `suppressionMarkersAdded` remains empty even though the diff adds a marker at a new location. Adding another occurrence to a line already containing the marker is also invisible.

   The scanners’ suppression-disabling flags provide a separate defense against hiding findings; this issue bypasses the explicit marker gate and its violation record.

   **Resolution:** Inspect added diff lines, or compare marker occurrences with sufficient location/context information to implement an explicitly chosen movement policy.

   **Confidence: high.**

7. **packages/api/src/line.ts:1110 — factually wrong — medium — A later provisioning failure discards earlier security findings from the iteration’s evidence.**

   Security results accumulate only in memory until the entire check loop finishes. If an earlier scanner reports a new secret and a later scanner cannot be provisioned, the function immediately returns `spendRetry`. It never writes the collected results or reaches the `gate-failed` decision.

   Thus, a verify attempt can discover a credential yet leave no enforcement record saying that it did. This is an evidence-loss path, not a demonstrated route to a passing task. Triggering provisioning failure deterministically is not established under the stated attacker permissions.

   **Resolution:** Persist partial check outcomes and the provisioning failure before retrying. Preserve already-observed failures even if later checks cannot start. Apply equivalent treatment to exceptions during later processing.

   **Confidence: high about the control flow; conditional on the later failure occurring.**

Several mechanisms are sound within the stated trust boundary:

- **Runtime-derived verdicts:** `packages/api/src/line.ts:1161` selects the security verdict from runtime results and the stored base findings. The model’s claim does not supply that verdict.
- **Malformed-report handling:** `packages/api/src/security.ts:162` rejects missing results, unexpected exits, and `null` findings. The supplied parsers distinguish malformed reports from valid empty findings; Semgrep reports containing errors are rejected.
- **Counted baseline comparison:** `packages/adapters/src/security.ts:189` consumes baseline occurrences individually, preventing an additional identical reported finding from disappearing through set membership alone. This remains subject to fingerprint quality.
- **Sandbox configuration:** `packages/api/src/scan.ts:80` requests read-only workspace/rules mounts and deny-all egress. Image equality is checked against runtime-selected scanners in `securityProblems`. Given the trusted provider assumption, these are meaningful controls.
- **Security-part locking:** `packages/api/src/line.ts:298` refuses an absent part before locking, and includes the admitted part among locked spec artifacts.

I found no demonstrated TypeScript-specific escape across the stated boundary. Casts, declaration merging, generic erasure, and dishonest type predicates in submitted code do not change the separately running runtime. The bundle’s compile-error fixtures demonstrate compiler constraints, not security against arbitrary casts; the runtime validation and isolation are what matter.

The adversarial framing is appropriate, but two claims need separating. A locked, client-selected configuration establishes **which rules were approved**, not a runtime-enforced minimum security policy. Likewise, a `deniesRule` label establishes **declared coverage**, not exercised authorization. The key additional questions are: “Were all relevant submitted bytes actually inspected?” and “What independent observation proves each required denial occurred?” Those distinctions expose the concrete failures above without treating deliberately absent rule classes as defects.