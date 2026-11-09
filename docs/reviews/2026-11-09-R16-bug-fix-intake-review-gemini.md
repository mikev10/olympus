BASE: 6118b1e
HEAD: 770ae1c
packages/vault/src/types.ts
12fb7e9747dd63b9251a0d5adee936d1

I had no prior context about this project, and I performed no external lookups. 

### 6. Which mechanisms you assess as sound, and why
I assess the mechanisms protecting the bug-fix run invariants in this bundle as **sound**. I found no bypasses, tautological checks, or fail-open conditions. The code correctly and robustly implements the security properties and constraints as specified. 

Specifically:

**1. Untrusted Tracker Text Isolation (`I7` Mechanism)**
The code succeeds in preventing the tracker's raw payload (or an extracted payload field containing free text like `body` or `title`) from entering a prompt. 
- In `packages/conformance/src/registry/bug-fix.ts`, the schema extraction test and payload checks enforce that `issue` triggers extract only safe structured fields (like `number`, `repository`, and allowlisted labels).
- No fields from the candidate record are passed to the `intent` or to the models. 
- The HTTP entry point (`packages/api/src/http/server.ts`) strictly enforces that the intent is provided by the principal. It enforces `exactKeys` to ensure no extra tracker fields can be smuggled via HTTP into the `BugFixIntentBody`.

**2. Strict Policy Enforcement on `template` (`I4` Mechanism)**
The code robustly prevents a user from making a run a bug-fix without the policy permitting it.
- `templateOf` correctly forces runs admitted from a candidate to take the candidate's exact template.
- If a candidate's template is `intake-candidate`, attempting to name `'bug-fix'` via HTTP returns `not-the-candidates` and is refused.
- If a user omits the template, the run automatically adopts the candidate's template. If the candidate was a `bug-fix`, the run is forced to supply a `BugFixIntent` through `bugFixProblems`, eliminating any fallback to a generic text intent.
- For a person's own run, `templateOf` strictly checks `policy.triggers.runTemplates`.

**3. Bug-Fix Reproduction Invariants (`I3` / `I5` Mechanisms)**
The code flawlessly guarantees that a bug-fix must be reproduced, and limits the capabilities of the drafters to bypass this:
- `bugFixProblems` statically refuses any supplied `spec` or `acceptanceTests` for a bug-fix run.
- `reproductionProblems` strictly enforces that at least one drafted check sets `reproduces: true` and is `required: true`. It also explicitly forbids non-bug-fix runs or supplied tests from using the `reproduces: true` flag. 
- `checkProblems` structurally mandates that any check with `reproduces: true` must declare `onBase: 'fails'`, rejecting omissions.
- `specArtifacts` ensures that `defect.json` and `reproduction.json` are bound to the spec. `readSpecDraft` forces the `defect.json` hash to explicitly match the byte serialization of the runtime's own `intentRecord`, meaning the drafter cannot reword or tamper with the human-supplied defect steps.
- Because drafted tests are cryptographically hashed and locked at `test-design`, the builder model has no ability to rewrite the check script later to fake a pass. 

**4. Proper Type Defenses & Fail-Closed Logic**
- There are no dangerous `any` or `unknown` casts around intent payloads. 
- Missing fields reliably return `undefined` (or fail `typeof` checks), pushing `missing` problem codes that fail closed across the validation loops (e.g., `readSpecDraft`, `checkProblems`, `exactKeys`).
- The `Dismissal` logic correctly spends the admission's exclusive file lock (`createExclusive`), guaranteeing that a candidate cannot be both dismissed and admitted.

### 7. Whether the framing above is right
The framing of the adversarial question is correct and appropriate for this code. The threat model accurately assumes that the adversary controls the inputs and model outputs, but respects the boundary of the runtime, cryptographic locks, and human-in-the-loop critic checkpoints. Because the runtime holds the test drafter accountable to the locked baseline (requiring failure on base) and the critic enforces that the script meaningfully implements the locked human `defect.json` steps, the framing asks the exact right questions for validating this design. The design cleanly neutralizes the specified threats.