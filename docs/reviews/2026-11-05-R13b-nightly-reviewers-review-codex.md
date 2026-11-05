BASE: adf5c9e  
HEAD: e3fcd98  
packages/vault/src/types.ts  
7391d7dbcd7415199ed27b6185e3cca4

No prior project context. No external lookups. I reviewed the inline bundle; local shell access was blocked, so I did not execute tests or independently verify the file’s SHA-256.

1. **packages/api/src/nightly-review.ts:497 — factually wrong — high — The author window does not cover the tree being reviewed.**  
   Construction: Claude authors code, which is merged and reviewed successfully on Monday. On Tuesday, GPT authors another merge. Wednesday’s whole-tree reviewer is Claude. `mergedSince` includes only Tuesday’s run; `authorsOf` therefore supplies only GPT, although Claude’s Monday code remains in the reviewed tree. The seat can be recorded as `different-family`, including at L3. With no intervening merges, the same tree instead becomes `no-author`.

   **Resolve:** derive authors for the reviewed tree, retaining attribution for older work that remains present. Alternatively, restrict the reviewed subject to the changes covered by the author window. Add a successive-firing test with retained code from an older author. **Confidence: high.**

2. **packages/api/src/nightly-review.ts:152 — factually wrong — medium — An unreadable violation does not refuse the review.**  
   A decision references a violation whose file is missing, unreadable, or invalid JSON. The catch substitutes `null`; line 130 projects this as `violation: "unreadable"`. The job continues, and `{"findings":[]}` can produce a completed review despite the missing source record. This is a failure-condition bypass; it does not require an attacker-controlled Vault.

   **Resolve:** propagate the read failure into the existing `store-unreadable` refusal, retaining any partial subject separately. Test missing and malformed referenced violations. **Confidence: high.**

3. **packages/api/src/nightly-review.ts:536 — unclear — medium — A valid empty answer proves no review coverage.**  
   For a nonempty tree, return `{"findings":[]}` without inspecting any files. Parsing succeeds, the location loop executes zero times, and line 565 returns no refusals. The same distinction applies to findings review: delivery of the records proves availability, not examination. Thus the runtime can establish “the call returned the required format,” but cannot establish “the subject was reviewed and nothing was found.”

   An additional concrete route to investigate is a repository containing `AGENTS.md` or `CLAUDE.md` instructing the harness to return that empty answer. The whole tree is mounted, but the supplied bundle does not show whether the selected drivers automatically load repository instructions. Read-only mounting would not prevent that promotion of repository text into instructions.

   **Resolve:** define completion as protocol completion and keep coverage unknown unless independently observed. Inspect the actual drivers’ instruction discovery and prompt assembly; disable automatic repository instruction loading for these seats and test poisoned instruction files. Even file-access evidence cannot prove substantive review. **Confidence: high for empty-answer acceptance; conditional for automatic instruction loading.**

4. **packages/conformance/src/registry/nightly-review.ts:365 — factually wrong — low — The “changes no run” assertion compares names, not contents.**  
   The snapshot records only `object.path`. An implementation that overwrites an existing run object or state file without changing its name passes the comparison at line 376. The assertion therefore does not establish its stated “same objects” property.

   **Resolve:** compare paths and byte digests, including mutable state files. Add a control that overwrites an existing file and demonstrates that the assertion detects it. This is an incomplete assertion, not an unconditional tautology. **Confidence: high.**

The following mechanisms look sound within the supplied boundaries:

- **Tree location:** `nightly-review.ts:556` requires exact membership in the materialized file list and checks the actual file’s line count. Together with the positive decimal schema, this rejects invented paths and out-of-file lines. Filesystem containment still depends on the unshown `materialize` implementation.
- **Record location:** `findingsReview` checks the validated record identifier against the actual day-item set before creating a candidate. Naming a syntactically valid foreign hash is insufficient.
- **Claim separation:** `dayItems` never projects `review.claim`; `note` is removed before candidate validation. The shown host, check-ID, message, and violation-detail paths do not directly reach the prompt.
- **Reviewer identity:** the post-call grade cannot raise the planned grade, and the stored reviewer identity remains runtime-resolved. The demonstrated independence defect is incomplete author selection, not trusting the reviewer’s reported identity.
- **Ordinary exceptions:** the outer catch in `nightly.ts:150` records a refusal. A thrown file-read error in location checking does not become a successful empty review.
- **Sandbox request:** the seat requests one read-only mount, no additional mounts, and deny-all egress with the model relay. Under the stated trusted-provider assumption, I found no shown route for the sandbox to write the Vault.

I found no demonstrated unconditional tautology or skipped-test-to-pass path in the new assertions. Their scripted driver and recording provider establish request construction, not actual model activity or sandbox enforcement.

The TypeScript assertions on parsed store records are not runtime validation. However, casts, mutable `ReadonlySet` values, declaration merging, and module augmentation are not independently exploitable by the stated adversary, who cannot execute code inside the runtime. The reviewer’s JSON does encounter runtime shape and field checks; I found no demonstrated cast-based bypass of candidate location.

The adversarial framing is useful for attribution, instruction provenance, and location checks. It needs one qualification: an adversary controlling the entire answer can always return a valid empty list. The enforceable question is whether the runtime accurately records the subject supplied, attribution checked, observable coverage, and claims received—not whether the model truly examined the subject or found every defect.