BASE: eb15d11
HEAD: b04c518
packages/vault/src/types.ts
69b0de2c8167fbb993f6ce210eb9995f

I have reviewed the code based on the provided adversarial context and invariants. The framing provided is accurate and appropriate for analyzing the security properties of this code. 

Here are my findings, ordered by severity:

### 1. packages/api/src/nightly.ts:388 — type: factually wrong — severity: high
**The concrete bypass:** Untrusted text from scanners (`rule`, `path`, and `fingerprint`) bypasses schema enforcement and is written verbatim into the Vault. In `NightlyJobs.#finding`, these fields are passed to `intake.recordFinding`, which correctly enforces the `nightly-finding` schema for the `CandidateRecord` (returning `{ none: 'schema' }` if they violate it). However, the finding is *still* placed into the `NightlyFinding` array and written to the `NightlyRecord` regardless of the schema check outcome. Furthermore, the unvalidated `fingerprint` is embedded directly into the `TriggerDecision.key` field via `packages/api/src/intake.ts:172` and written to the Vault. 
**What would resolve it:** Do not include fields in the `NightlyRecord` if they fail the `checkFields` schema validation. Validate `fingerprint` against a schema before embedding it into the `TriggerDecision.key`.

### 2. packages/api/src/nightly.ts:133 — type: factually wrong — severity: high
**The concrete bypass:** The nightly integrity check can be completely evaded by an attacker tampering with the store. The `NightlyRecord` is constructed and hashed *after* `nightly-integrity` builds the `hashes` map. As a result, the `NightlyRecord` itself is never included in its own `hashes` map for the next night to verify. An attacker who tampers with stored run objects can also modify the `hashes` map in the most recent `NightlyRecord` to match the tampered files, compute its new hash, and rename the file to the new hash. Because `readNightly` (`packages/vault/src/local/vault.ts:887`) trusts the file name as the hash and `nightly-integrity` does not verify the cryptographic chain of the `comparedWith` field, the modified record is loaded and the tampered files match the forged map, reporting "completed, nothing found".
**What would resolve it:** The integrity check must verify the cryptographical chain of `comparedWith` hashes against what was actually produced in previous nights, or include the `NightlyRecord` in a robust merkle tree/hash map that is independently verifiable. 

### 3. packages/api/src/nightly.ts:341 — type: ways the configuration can be satisfied without doing what it appears to do — severity: high
**The concrete bypass:** The dependency audit can be bypassed for a vulnerable `pnpm` project. `AUDITORS` defines `NPM_AUDITOR` before `PNPM_AUDITOR`. In `NightlyJobs.#audit`, `AUDITORS.find` is used to select the first auditor that matches a lockfile present in the repository root. An attacker can commit a dummy, dependency-free `package-lock.json` alongside their vulnerable `pnpm-lock.yaml`. The job will select `NPM_AUDITOR`, which scans the empty `package-lock.json`, finds zero vulnerabilities, and successfully reports "completed, nothing found" without ever auditing the actual pnpm dependencies.
**What would resolve it:** The job must accurately identify the primary stack (e.g., via `packageManager` in `package.json` or by failing if multiple conflicting lockfiles are present) rather than relying on a first-match array search.

### 4. packages/adapters/src/audit.ts:40 — type: fails open — severity: medium
**The concrete bypass:** The `GHSA` regex used to validate and extract GitHub Advisory IDs is not anchored (`^`/`$`). In `ruleOf`, if the `ghsa` string matches `GHSA.test(ghsa)`, the function returns the *entire* `ghsa` string rather than the extracted match. This allows an attacker to inject arbitrary text into the `rule` field by providing a string that contains a valid GHSA ID alongside malicious text (e.g., `"malicious text GHSA-1234-5678-90ab"`). 
**What would resolve it:** Return the extracted match (`GHSA.exec(ghsa)?.[0]`) instead of the raw `ghsa` string, consistent with how `url` is parsed on line 42.

### Sound Mechanisms
- **Network Error Detection:** The `unreachable` check for auditors (`packages/adapters/src/audit.ts:51`) correctly and soundly identifies network errors based on standard npm/pnpm stdout/JSON error signatures without falsely flagging unrelated errors.
- **Schema Validation Engine:** `checkFields` (`packages/core/src/trigger/schemas.ts:165`) correctly checks string byte length *before* regex matching, effectively preventing ReDoS on oversized inputs.
- **Open Intake Exceptions:** The `stillOpen` check (`packages/api/src/nightly.ts:98`) securely restricts bypassing the hash check to the specific `intake/counts/` prefix for the current hour, preventing attackers from exploiting it to hide arbitrary files.