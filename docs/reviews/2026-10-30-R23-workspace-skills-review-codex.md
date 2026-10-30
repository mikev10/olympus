BASE: 178d62a
HEAD: 7188bcb
packages/drivers/openai-compatible/test/invariants.test.ts
35213329fbf84920be86003807a938f5

I had no prior project context and performed no external lookups. This review uses the complete inline bundle. A local directory-listing attempt was blocked; no tests were run.

1. **packages/drivers/claude-code/test/invariants.test.ts:261 — factually wrong — high — Loading instructions need not produce their tokens.**

   A CLI regression loads `CLAUDE.md`, the rules file, or the workspace agent definition while still excluding workspace skills. The model replies `READY`, omitting the planted tokens. Both driver sessions pass: these three instruction sources have no independent observation comparable to the skill list. The control also passes because removing the flag exposes `probe-alpha`, and its model reply includes the requested token.

   This construction requires no forged CLI output or runner access—only the model-output control explicitly allowed by the question. A successful positive control does not make the negative reply evidence reliable.

   **Resolve:** observe the actual instructions sent upstream through trusted instrumentation, or independently establish which instruction sources the CLI loaded. Keep reply canaries as supplementary evidence. **Confidence: high.**

2. **packages/conformance/src/registry/workspace-instructions.ts:44–46 — factually wrong — medium — A table row need not represent an executable workspace-instruction check.**

   There are two concrete constructions:

   - Map a new driver's row to an existing I3 pending ID. `owed` checks only the ID; it checks neither package ownership nor uniqueness. Multiple drivers can borrow the same pending obligation.
   - Register an unrelated passing test as an external I3 assertion owned by the new package and reference its ID in the table. The predicate checks ID, kind, and package, but not what the test exercises. Exact ID/title reconciliation still succeeds.

   The first bypasses owning an assertion altogether; the second satisfies the configuration without checking the property. An independently enforced pending baseline might reject an unapproved new pending entry, but borrowing an existing entry requires none.

   **Resolve:** require an executable assertion for admission under the stated fail-closed requirement; otherwise explicitly report pending drivers as unverified. Bind any pending obligation to its driver and require unique mappings. Shared conformance scenarios and mutation checks are needed to establish behavior beyond metadata. **Confidence: high for the predicate; overall pending-gate behavior is not supplied.**

3. **packages/drivers/claude-code/src/stream.ts:108; packages/drivers/claude-code/test/invariants.test.ts:264–267 — factually wrong — medium — Missing skill telemetry becomes successful negative evidence.**

   The added parser test explicitly establishes that an init message without `skills` becomes `skills: []`. Consequently, `toBeDefined()` proves only that parsing supplied an array.

   A CLI upgrade could load skill descriptions during no-tool sessions but omit their skill-list field. That session passes with a `READY` reply. The Skill-enabled production session can continue excluding the plants, while the flag-removed Skill control still lists `probe-alpha` and passes. The control therefore does not establish observability for the no-tool session.

   **Resolve:** preserve missing or malformed telemetry as an unknown state. Require an independent observation for modes in which the CLI does not provide a trustworthy complete list. **Confidence: high about the missing-field behavior; the upgrade is a concrete regression construction, not a claim about the pinned CLI.**

4. **packages/drivers/openai-compatible/test/invariants.test.ts:221–229 — factually wrong — medium — Reusing one task ID can mask workspace-dependent instruction loading.**

   Both sessions use the same driver instance and task ID. Consider a future implementation that loads workspace instructions when first preparing a task, then caches its initial messages by task ID. The bare run primes the cache; the planted run reuses those clean messages. Both exchanges remain identical, including the scripted tool turn, while a fresh task first executed over a planted workspace loads its instructions.

   **Resolve:** run the comparison with independent driver instances and equivalent initial state. Add a planted-first case to expose ordering dependence. **Confidence: high that this construction passes the shown comparison; the bundle does not establish that such caching currently exists.**

The following mechanisms are sound within their narrower scope:

- The OpenAI comparison requires two baseline requests and exact equality of the resulting request-body strings, preventing an empty-versus-empty pass and avoiding dependence on model narration.
- The Claude control requires both CLI-reported discovery and the token-bearing reply. Removing the driver's flag also fails the explicit empty-argument check for an ordinary CLI invocation.
- The control executes through `watched.exec`, so its usage enters the same accounting path as driver calls.
- Missing recorded environment, failed expectations, and thrown exceptions do not visibly become passes.

I found no demonstrated TypeScript-specific escape within the stated trust boundary. The casts, `readonly` declarations, and regex type predicate are not security boundaries, but exploiting runner-process mutation would exceed the allowed attacker capabilities. The phantom-driver check is not tautological; it exercises missing-row rejection, although it does not test actual package discovery. `workspacePackages()` is absent, so discovery completeness remains unverified.

The adversarial framing is appropriate for the runtime isolation boundary. These finite probes, however, establish regression evidence rather than universal non-loading. The key additional question is whether each observation independently measures instruction ingress and whether representative loading regressions—including fresh-session and missing-telemetry cases—necessarily turn the assertion red.