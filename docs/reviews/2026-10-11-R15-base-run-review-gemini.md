BASE: 2dc1f11
HEAD: 3f61372
packages/vault/test/stub.test.ts
8d11971995a02b4729e7215edb0eae95

I have no prior context about this project and performed no lookups.

**1. Framing and the Adversarial Question**
packages/api/src/base.ts:36 — factually wrong — high — The adversarial question ("How would I get a change accepted at `verify` while the run never showed, from records the runtime made, that a required check failed on the base and passes after the change?") is the wrong question for this code. The runtime's records *will always show* that the check failed on the base and passed after the change, because the runtime strictly enforces exit codes. The actual vulnerability is that the runtime cannot distinguish a semantic test failure from a missing file. The right question to ask is: "How can an agent bypass the semantic intent of the acceptance gate, given that the runtime strictly verifies exit codes to produce those records?"

**2. Missing Files Yielding a Pass (Fail Open)**
packages/api/src/line.ts:377 — factually wrong — high — A missing file yields a pass for the `onBase: 'fails'` requirement. Because `runOnBase` copies only the base tree without applying the diff that contains the newly submitted acceptance tests, any test script submitted in the PR will be missing on the base. Executing it (e.g., `node new_test.js`) yields a non-zero exit code due to "file not found". `baseMismatches` interprets this non-zero exit code as a successful demonstration that the defect exists. In `verify`, the diff is applied, the script exists, and it trivially exits 0. The mechanism succeeds while the property it protects (that the change fixed a defect) is violated.
*Resolve by:* Distinguishing execution errors (like command/file not found) from test assertion failures, or by applying the test files (but not the product changes) to the base tree before running the base checks.

**3. Configuration Satisfied Without Testing the Code**
packages/api/src/line.ts:1062 — factually wrong — high — A behavioral check that runs a workspace script (e.g., `["npm", "run", "test:behavioral"]`) can be bypassed by modifying the un-locked configuration. The PR diff can modify `package.json` to change the `test:behavioral` script to `exit 0`. The check fails on the base (using the original script) and passes in `verify` (using the modified script) without the agent fixing any code.
*Resolve by:* Locking configuration files that behavioral checks rely on, or restricting behavioral checks from relying on mutable workspace configurations.

**4. Tautological Checks Evading Protected Paths**
packages/api/test/harness.ts:74 — factually wrong — medium — A check can be made tautological and evade protected-path escalation by dynamically building filenames. If a check command uses `['my', 'bypass.txt'].join('')`, `analyzeTamper`'s static analysis of the command string will not flag `mybypass.txt` as a protected path. The diff can then add `mybypass.txt` to satisfy the check in `verify` after it failed on the base, completely bypassing the code under test.
*Resolve by:* Observing actual filesystem reads/writes during the sandbox execution rather than relying on static analysis of the command arguments.

**5. Language-Specific Escape Hatch: Type Cast**
packages/api/src/validate.ts:184 — a tradeoff I would have made differently — medium — The function uses a type cast (`value.checks as CheckSpec[]`) to return the parsed manifest. This bypasses TypeScript's structural typing, allowing unvalidated, unexpected properties in the JSON to persist in the `checks` array throughout the runtime, which could be exploited if downstream logic inspects them.
*Resolve by:* Explicitly constructing and returning new `CheckSpec` objects containing only the validated properties.

**6. Language-Specific Escape Hatch: Type Predicate**
packages/api/src/base.ts:14 — a tradeoff I would have made differently — low — The type predicate `check is DeclaredCheckSpec` narrows the type based solely on `check.onBase !== undefined`. While current upstream validation prevents `OtherCheckSpec` from having `onBase` defined, this predicate would silently fail to catch bugs if validation logic changes, incorrectly casting a unit check to an acceptance/behavioral check.
*Resolve by:* Including `check.kind === 'acceptance' || check.kind === 'behavioral'` in the predicate's condition.

**7. Sound Mechanisms**
packages/vault/src/local/vault.ts:424 — The `Vault.recordBaseRun` mechanism is sound. It uses an exclusive file creation (`wx` flag equivalent) to ensure the base record is written exactly once per run, preventing an adversary from overwriting the record with favorable results.
packages/api/src/line.ts:1010 — The sandbox isolation in `verify` is sound. Each check is provisioned in a fresh sandbox and destroyed immediately after, effectively preventing cross-test contamination or state leakage.