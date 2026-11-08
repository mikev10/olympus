BASE: reviewed/R8b  
HEAD: 0edf3ae  
packages/vault/test/stub.test.ts  
1c218aa6beb0d73c297ee20f246ed2cc

I had no prior project context and performed no external lookups. This is a static review of the supplied bundle; I did not run tests or independently verify its SHA-256.

1. **packages/api/src/line.ts:1329 — factually wrong — high — Sensitive artifacts bypass tree omission through model context.**  
   Classify the admitted specification’s path as sensitive, without granting its class to the builder. `omitWithheld` removes the file, but `build` already read its contents and puts `spec.text` into `locked-spec`. The task receives the withheld bytes through its context. Acceptance tests have the same route. Review also offers these texts, and the test drafter receives locked-spec text independently of its filtered tree.

   **Resolution:** Apply sensitive-path authorization before constructing artifact-derived context, consistently across seats. Refuse a seat when its required context cannot be supplied under its grants. Add assertions using distinctive sensitive contents and inspect the entire request, not just mounted files. **Confidence: high.**

2. **packages/api/src/line.ts:252, 1327 — factually wrong — high — Parallel provisioning can launch a model with stale, wider capabilities after narrowing commits.**  
   Run two independent build tasks in one batch. Task A has no brought input and enters `runTask`, which captures its full scope before awaiting `sandbox.provision`. While provisioning is pending, task B receives declared input and completes `narrowRun`. A then finishes provisioning and calls its driver with the previously captured full tools and sandbox egress, despite the committed narrowing.

   This construction requires ordinary asynchronous scheduling, not a malicious provider or runtime hook. It concerns a model call that has not yet started when narrowing commits; simply exempting already-running model calls does not address it.

   **Resolution:** Coordinate narrowing with task launch. For example, resolve batch input and commit any required narrowing before provisioning the batch, and prevent a provisioning operation from subsequently launching with an obsolete scope. Add a deterministic test that delays A’s provisioning until B’s narrowing commits. **Confidence: high.**

3. **packages/api/src/drafting.ts:704–705 — factually wrong — medium — Critic tree filtering is undone immediately afterward.**  
   The critic’s base tree is filtered, then every `record.files` entry is written into it without applying the critic’s sensitive grants. Classify a valid drafted output path as sensitive and leave its class ungranted to the critic: the final critic tree nevertheless contains that path. `renderDraft(record)` also supplies draft content before this filtering.

   The shown drafter collection checks writable grants but adds no corresponding sensitive-path refusal. Whether this also permits an unseen replacement in the eventual locked tree depends on draft-reading and locking helpers not included here; I would inspect those before claiming that stronger bypass.

   **Resolution:** Check drafted paths against sensitive-path restrictions before recording, presenting, or locking them, and enforce the critic’s grants on both its final tree and rendered context. **Confidence: high for critic-tree bypass; unresolved for eventual replacement.**

4. **packages/core/src/policy/validation.ts:873 — factually wrong — medium — A sensitive classification can validate while matching no tree-relative paths.**  
   Validation requires nonempty strings, but does not require tree-relative patterns. A class containing `"/secrets/key.txt"` validates, and a sensitive grant can name it. Omission and write refusal compare that pattern against tree-relative `"secrets/key.txt"`, so neither protects the intended file.

   This is a configuration failure, not an attacker editing policy: a person can satisfy validation while receiving no protection for the named path.

   **Resolution:** Define and validate a canonical tree-relative glob syntax, rejecting absolute paths and unsupported separators. Test accepted patterns against the same path representation used by omission and write detection. **Confidence: high.**

The supplied conformance tests also leave material gaps:

- `NO_CALL_RESTORES_CAPABILITY` supplies a “second input” hook on resume after the build exit, but the shown hook is called only by `build`. Reaching review does not prove that second input was delivered. Assert an actual second delivery and receipt under the original narrowing.
- `history()` converts every state-file read error into an omitted version; `mounted()` converts every read error into “absent.” Those helpers can conceal failures in the evidence they claim to inspect. Accept only specifically expected absence and propagate other errors.
- The withholding assertion exercises recording failure and a missing narrowed role, but not a failed state commit. Add that failure between successful recording and input release.

These are test-coverage and failure-masking issues; I found no basis to call the entire suite tautological.

Several mechanisms are sound within the stated trusted-runtime boundary. Admission computes narrowing before creating the first state and refuses missing narrowed scopes and excessive requested levels. Policy validation compares narrowed tools and hosts against their original grants and rejects higher ceilings. Sequential `narrowRun` awaits recording and commitment before releasing its frozen input object. The private `WeakSet` supplies runtime identity checking that a TypeScript cast alone cannot forge. `apply` preserves an existing narrowing over subsequent changes.

I found no demonstrated attacker-accessible escape through casts, declaration merging, or module augmentation. Those require runtime-process influence excluded by the threat model. The Vault’s narrowing decoder is incomplete—it does not validate `level`—but the bundle does not establish an attacker-controlled route to that stored value.

The adversarial framing is appropriate. The crucial additional questions are **whether every route carrying sensitive bytes is authorized**, including prompt context, and **where task launch becomes atomic with respect to narrowing**. Filtering trees and preserving a state flag do not alone establish either property.