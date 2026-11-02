BASE: reviewed/R26  
HEAD: e695015  
packages/vault/test/stub.test.ts  
0004c038048ac3748f3cfa09beef2d03

I have no prior project context and performed no lookups. This is a static review of the supplied text; I did not run tests or independently verify the file’s SHA-256.

1. **packages/api/src/line.ts:1564 — factually wrong — medium — A model’s identity claim can become the recorded reviewer identity.**

   Construct a build whose runtime-recorded family is Claude and a reviewer whose trusted driver resolves to GPT. Have the reviewer return a structurally valid result claiming the author’s Claude model.

   The planned seat is `different-family`; the claimed seat is `same-model`. Selecting the weaker seat commits the **claimed Claude identity**, including the runtime-supplied reviewer role and driver. The usage record instead identifies the actual resolved GPT model.

   This does not inflate independence: it conservatively lowers it. But it violates the stated distinction between a claim and the record, and produces contradictory provenance. `authorsOf` similarly promotes result identities into its author list at **line.ts:1591**.

   **Resolve:** Keep the runtime-resolved identity authoritative. Store reported identities separately as claims or discrepancies. If claims affect the independence assessment, record that assessment separately without replacing the actual seat identity. **Confidence: high.**

2. **packages/api/src/line.ts:1492 — factually wrong — medium — The security reviewer does not receive the security findings described by its role.**

   `evidenceFacts` projects checks into IDs, exit codes, suite counts, and expectation status. It omits their findings and the evidence bundle’s base-run reference/results. The additional `tamperFindings` field concerns tampering; it does not preserve each security check’s findings.

   A concrete consequence is that two evidence bundles with identical projected fields but different security findings produce identical security-reviewer context. The reviewer cannot distinguish them through this channel. The shipped role nevertheless says it receives what security checks found “over the base and over the change” at **packages/compiler/roles/security-reviewer.md:9**.

   This is not a claim that a failing verification gate advances. It is a loss of evidence at the security-review boundary, including findings in any bundle that legitimately reaches review.

   **Resolve:** Define and pass an explicit security-evidence projection containing the relevant findings and base/change results. Test with two bundles differing only in those fields and require distinguishable reviewer inputs. **Confidence: high.**

3. **packages/conformance/src/registry/separation.ts:172 — unclear — medium — The security-context test does not establish that acceptance tests are inaccessible through the filesystem.**

   The test checks that acceptance text is absent from the prompt, but its filesystem probe covers `graph.json`, `verify.json`, `.git/author-notes`, `spec.md`, and `src/change.ts`. It never probes `acceptance.md` or an actual acceptance-test file.

   Both seats use the same `reviewView(ctx, task)` call at **packages/api/src/line.ts:1554**. That function’s implementation is not included. If it leaves acceptance artifacts in the tree, the security reviewer can read them despite the prompt filter, and this conformance assertion still passes.

   **Resolve:** Inspect `reviewView` and add filesystem probes for the actual acceptance artifacts, including supported alternate paths. Require those reads to fail for the security seat. **Confidence: high that the test has this gap; insufficient source to establish the runtime leak.**

4. **packages/conformance/src/registry/separation.ts:309 — factually wrong — low — An unreadable Vault file passes the token-leak assertion.**

   The scan uses `readFile(...).catch(() => '')`. A read failure becomes an empty string, so a file containing the token can escape inspection while the assertion succeeds. This is a concrete fail-open in the test, not evidence of a production credential leak.

   **Resolve:** Let read errors fail the assertion and identify the unreadable path. **Confidence: high.**

Several mechanisms are sound within the stated trust boundary:

- **Graph derivation:** `parseGraph` rejects caller-supplied `.security` IDs and derives a companion task for every accepted review task, preserving dependencies (**validate.ts:525, 585–589**). I found no demonstrated graph-only omission bypass.
- **Family checking:** `seatReviewer` checks all supplied author families and refuses sharing at L3 (**machine.ts:268–276**). The weaker-grade selection prevents a false claim of another family from upgrading the planned grade.
- **Usage provenance:** The runtime supplies `driver.provenanceId()` before and after calls. Both Vault implementations reject missing, null, and empty driver values; legacy reads explicitly produce null (**local/vault.ts:348; stub/vault.ts:160; cost.ts:138**).
- **Configuration:** Named Codex seats are validated, and overlapping endpoint/Codex assignments throw. The shown paths do not silently select one conflicting assignment.

I found no wholly tautological assertion among the new R9 tests. Their coverage is narrower than some titles claim, particularly the filesystem-context test. Casts, brands, `readonly`, and `as unknown as` are not runtime enforcement, but exploiting them through declaration merging, module augmentation, or in-process mutation would exceed the attacker authority you specified. I found no concrete bypass requiring only those language features under this threat model.

The framing needs one distinction: **excluding an author-narrative channel cannot guarantee excluding author-written persuasion**. The author controls source files the reviewer must inspect; it can put its narrative into `src/change.ts`, which the conformance test explicitly expects both seats to read. Likewise, a different role name makes the exact seat identity different without making the underlying model independent; the family grade correctly captures that limitation.

I would therefore ask whether the runtime records actual execution provenance, includes every relevant author, and enforces access to specified artifacts and channels. Those are enforceable properties. “The reviewer never sees author material” is not enforceable while it reviews author-controlled code.