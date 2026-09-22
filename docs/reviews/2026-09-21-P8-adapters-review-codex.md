# External review of P8, codex, 2026-09-21

An adversarial pre-merge review of P8 (Adapters, TypeScript): the vitest and
jest adapters, coverage and config-change detection, the CLI behavioral
adapter judged on the host, and the two contract amendments (A-P8-01, A-P8-02),
with the CI and harness changes that landed between reviews. One of two
reviews run from the same prompt and bundle; the other is
`2026-09-21-P8-adapters-review-gemini.md`. Both are triaged in
`2026-09-21-P8-adapters-triage.md`, which cites this review's findings as
`codex-1` to `codex-15`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone. The pre-run listing of both is the manifest's
  `cleanRoom`: config home `[auth.json]`, working directory `[]`. Exit 0, not
  timed out, 164.8 s. Ingestion `complete`: 129,505 input tokens against a
  floor of 81,757. Integrity `verified`: the reply echoes every required bundle
  marker. Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `98993e73d4b4846985ca2b2420a9a8ec51349884b27f667277db1b933444cac7`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** gemini raised the same mechanism as codex-2
  (gemini-2: the report decides the coverage denominator) and as codex-8
  (gemini-3: `test['skip']` and other forms hide a marker). Related but not
  the same mechanism: codex-7 and gemini-4 (a config's runtime effect differs
  from its static reading, by different constructions), and codex-1 and
  gemini-1 (the host reads outside the repository, through an ancestor link
  and through a `..` glob respectively). Every other finding here codex raised
  alone.
- **Date:** 2026-09-21 (run started 2026-09-22T02:15:10Z UTC).
- **Bundle:** `2026-09-21-P8-adapters-review-bundle.txt`, SHA-256
  `193da6d987db4d6f2ecb888114ef99a825013064419bdcf1a1b981328f218468` (the
  manifest's `bundleSha256`), base `6d32e07` (`reviewed/P5`), head `bf8cb44`
  (P8: Adapters (TypeScript)). It held the full contents of 53 of the 56 files
  changed in that range: all source, tests, changesets, the CI workflow, and
  the lockfile. It excluded `docs/decisions.md`, `docs/plan/DECOMPOSITION.md`,
  and `docs/plan/F1-spine.md`, as the prompt states ("no design documents").
  Prompt: `2026-09-21-P8-adapters-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated that it had no prior
  project context, that it performed no external lookups, and that local tool
  execution was blocked, so it ran no tests and did not verify the bundle's
  hash itself. This is a self-report and cannot be independently verified,
  although the read-only sandbox and the empty working directory are recorded
  in the manifest.
- **Coverage, and any gap:** all seven numbered items were answered. Items 1,
  3, 4, and 5 are covered by findings 1–15. Item 2, tautological checks: it
  found no wholly tautological test, but found several whose titles claim more
  than they prove (the linked-directory fixture, the outcome type, the
  host-execution scan). Item 6, sound mechanisms: the host-side CLI judge, the
  gate's `requiredShortfall`, the adapter-set L3 refusal, the in-process line
  diff, static config parsing as a no-execution measure, leaf-link and UTF-8
  refusal, size checks, the CI credential change, and the harness permission
  change. Item 7, framing: the framing is right, but the guarantee needs a
  declared supported subset, and the acceptance question should be "does every
  construct the adapter cannot establish as safe become an explicit refusal?"
  Every finding carries the label "factually wrong". None is labelled unclear
  or a tradeoff.
- **Citations:** line numbers are positions within the bundle's file sections,
  as the reviewer says, and are treated as hints. Each finding was located by
  the construct it describes. Codex's numbers fell on or within a few lines of
  the construct.

---

BASE: reviewed/P5  
HEAD: bf8cb44  
pnpm-lock.yaml  
c24420c6aa333611f66d379c697d5f37

I had no prior project context. I performed no external lookups. This is a source review of the inline bundle; local tool execution was blocked, so I did not run tests or independently verify the SHA-256. Line references are within the supplied file sections.

1. **`packages/adapters/src/files.ts:44` — factually wrong — high — Ancestor symlinks bypass the no-follow protection.**

   `lstat(path)` and `O_NOFOLLOW` inspect/protect the final component, not its ancestors. Construct `head/linked -> /outside`, then configure Jest roots as `['<rootDir>/linked/tests']`. The lexical containment check accepts this. `walkTree` checks `/head/linked/tests`, sees the real outside directory, and enumerates it. Reading `/head/linked/tests/a.test.ts` also succeeds.

   No concurrent replacement is necessary. The linked-directory test in `assertions.test.ts` passes the link itself to `parseAssertions`, so it does not exercise this construction.

   **Resolve:** enforce containment and no-link traversal for every component from the trusted root. For mutable trees, use descriptor-relative traversal or an immutable snapshot; checking components and subsequently reopening by pathname still races.

2. **`packages/adapters/src/coverage.ts:142` — factually wrong — high — The untrusted report controls both coverage hits and the denominator.**

   For a changed executable `src/a.ts`, this report is accepted:

   ```json
   {
     "/workspace/src/a.ts": {
       "statementMap": {},
       "s": {}
     }
   }
   ```

   Because the file has an entry, the adapter uses its empty statement map instead of deriving executable lines. `total` becomes zero and coverage returns `1`. Alternatively, the report can supply positive counts for statements that never executed.

   This violates the stated boundary even without deceptive behavior: stale, filtered, or incorrectly mapped reports can produce the same result.

   **Resolve:** independently establish executable locations and validate report correspondence to the exact source. Missing locations must not remove obligations. Positive hit counts additionally require evidence collection that repository code cannot forge; schema validation alone cannot provide that provenance.

3. **`packages/adapters/src/coverage.ts:78` — factually wrong — high — The missing-file fallback misses executable expression bodies.**

   With report `{}`, compare:

   ```ts
   // base
   export const f = () =>
     1;

   // head
   export const f = () =>
     2;
   ```

   Only line 2 changes. `executableLines` records the variable statement on line 1, but the arrow’s expression body is not a statement. No changed executable line is counted, so the uncovered change receives coverage `1`.

   **Resolve:** use an executable-location model that includes expression bodies and initializers, with conservative refusal or uncovered accounting for unsupported constructs.

4. **`packages/adapters/src/assertions.ts:153` — factually wrong — high — “At least as strong” accepts assertions that contradict the original requirement.**

   These changes are silently accepted:

   ```ts
   expect(x).not.toBe(5);  // before
   expect(x).toBe(5);      // after
   ```

   ```ts
   expect(x).toBeTruthy(); // before
   expect(x).toBe(0);      // after
   ```

   Removing negation returns true immediately. Likewise, every matcher in `EXISTENCE` is treated as implied by any equality matcher, regardless of expected value. Neither implication holds.

   The tolerance branch also ignores negation: narrowing the tolerance of `not.toBeCloseTo` permits more values, yet is dropped as harmless.

   **Resolve:** report these changes unless a matcher-specific implication is actually established. Correct the test that explicitly blesses removing negation.

5. **`packages/adapters/src/assertions.ts:83` — factually wrong — high — Assertion identity omits whether the assertion executes and what its identifiers mean.**

   Moving an assertion into an uncalled function produces the same parsed assertion:

   ```ts
   // before
   test('x', () => { expect(value).toBe(5); });

   // after
   test('x', () => {
     const unused = () => { expect(value).toBe(5); };
   });
   ```

   There is no skip marker, and comparison reports no delta. Similarly, adding a local no-op `expect` binding leaves the recorded assertion unchanged.

   **Resolve:** retain and compare binding and execution context. Where reachability or assertion provenance cannot be established, return an explicit unresolved result rather than certifying equivalence. Moving identical text is not sufficient evidence that an assertion survived.

6. **`packages/adapters/src/assertions.ts:86` — factually wrong — high — Subject-call type arguments disappear, and standalone `assertType` disappears entirely.**

   These parse identically because only matcher-call type arguments are recorded:

   ```ts
   expectTypeOf<Actual>().toEqualTypeOf<Expected>();
   expectTypeOf<any>().toEqualTypeOf<Expected>();
   ```

   Also, `assertType<Expected>(value)` is recognized as a subject call but discarded because it has no subsequent matcher. Removing it therefore produces no removed assertion.

   **Resolve:** preserve subject-call type arguments and explicitly record standalone type assertions. Add fixtures for deletion, generic changes, `any`, and changes to referenced type declarations.

7. **`packages/adapters/src/static.ts:284` — factually wrong — high — Exported config mutation is accepted as a resolved literal.**

   This config exports one object and subsequently changes discovery:

   ```js
   module.exports = { testMatch: ['**/*.test.ts'] };
   module.exports.testMatch = ['**/*.check.ts'];
   ```

   `exportedConfig` selects the first assignment and ignores the mutation. No followed `const` exists to trigger reference counting. The adapter enumerates the original pattern while the exported object contains the replacement.

   Imported defaults have a related alias escape:

   ```ts
   import { configDefaults } from 'vitest/config';
   const holder = { list: configDefaults.exclude };
   holder.list.push('**/*');
   export default { test: { exclude: [...configDefaults.exclude] } };
   ```

   Both references to `configDefaults` qualify as “plain reads”; the mutation through `holder` is missed.

   **Resolve:** reject unsupported effects on exports and escaped mutable values. A local reference count does not establish immutability of the exported configuration.

8. **`packages/adapters/src/markers.ts:28` — factually wrong — high — Ordinary aliases and computed access silently hide skip/focus markers.**

   Examples returning no marker include:

   ```ts
   import { test as check } from 'vitest';
   check.only('focused', () => {});
   ```

   ```ts
   test['skip']('skipped', () => {});
   ```

   ```ts
   test('skipped', ({ skip: omit }) => { omit(); });
   ```

   The first two escape identifier/property-chain recognition. The third recognizes that a `skip` property was destructured but searches for calls named `skip`, ignoring the actual local binding `omit`.

   **Resolve:** resolve imported and destructured bindings, support literal element access and transparent wrappers, and refuse unresolved declarer forms rather than returning an authoritative empty list.

9. **`packages/sandbox/src/local/docker.ts:99` — factually wrong — high — Container output can exhaust host memory.**

   Every stdout/stderr chunk is retained until process termination, then concatenated and decoded. A command that continuously emits output can consume memory in the runtime process; the container’s memory limit does not bound these host buffers. `QUOTE_LIMIT` applies only after collection and therefore provides no protection.

   **Resolve:** enforce byte limits during collection, terminate/refuse on overflow, and bound retained evidence. Do not truncate and then compare truncated output as though it were complete.

10. **`packages/adapters/src/discovery.ts:420` — factually wrong — medium — Missing configured roots silently shrink enumeration.**

    Given Jest roots `['<rootDir>/tests', '<rootDir>/integration']`, deleting `integration` causes `exists(dir)` to return false and the loop to continue. The result looks like successful enumeration of the remaining tree.

    This is an adapter-local failure to reject an invalid configured input, distinct from the deferred comparison of base/head suite counts.

    **Resolve:** require each configured root to exist and be a safely accessible directory. Missing roots must produce a refusal.

11. **`packages/adapters/src/assertions.ts:21` — factually wrong — medium — Whitespace normalization changes literal meaning.**

    The global replacement operates inside strings, templates, and regular expressions:

    ```ts
    expect(output).toBe('a  b');
    expect(output).toBe('a b');
    ```

    Both acquire identical argument text, so comparison declares them unchanged despite different expectations.

    **Resolve:** normalize syntax trivia using tokens or AST structure while preserving literal contents and significant line terminators.

12. **`packages/adapters/src/discovery.ts:241` — factually wrong — medium — `assertLinearPattern` does not establish linear matching.**

    A pattern such as:

    ```text
    a*a*a*a*a*a*a*a*b$
    ```

    contains no quantified groups or backreferences and passes the checker. Matching a long run of `a` without a final `b` entails extensive backtracking across adjacent repetitions. Repository-selected names and patterns are evaluated synchronously on the host.

    **Resolve:** use a bounded, non-backtracking matcher or a genuinely restricted grammar. The present check is a heuristic against selected patterns, not a linear-time guarantee.

13. **`packages/adapters/src/files.ts:137` — factually wrong — medium — Config-path directories and special files can disappear from change reporting.**

    Directories are traversed but never recorded. Adding an empty directory named `jest.config.ts` therefore produces no config change. For special files, `sameEntry` returns true whenever both sides are `other`; replacing a FIFO with a socket at a config path is considered unchanged.

    **Resolve:** record directory entries where relevant, and refuse unsupported types at selected config paths. Presence of two unreadable special files is not evidence of equality.

14. **`packages/conformance/src/registry/adapters.ts:105` — factually wrong — medium — The no-host-execution assertion is a bypassable syntax blacklist.**

    For example, adapter code using:

    ```ts
    const execute = globalThis['eval'];
    execute(repositoryText);
    ```

    does not match the listed module imports, `process` chains, or direct calls named `eval`/`Function`. The scan can pass after parsing is replaced with host execution through this form.

    This is not a demonstrated execution path in the current adapters. It is an incorrect claim about what the conformance assertion proves.

    **Resolve:** narrow the claimed guarantee and strengthen enforcement with restricted dependencies/capabilities and tests that execute deliberately hazardous config fixtures while observing host side effects. Include mutations of the enforcement mechanism itself.

15. **`packages/integrity/src/types.ts:40` — factually wrong — low — The outcome type does not enforce the claimed verdict/evidence exclusivity.**

    Excess-property checks apply to fresh literals, not all assignments:

    ```ts
    const value = {
      held: true as const,
      mismatches: [{ field: 'stdout', expected: 'a', observed: 'b' }],
    };
    const outcome: ExpectationOutcome = value; // structurally assignable
    ```

    The failed tuple is also mutable: `.pop()` can leave it empty. Neither requires `any` or a double cast.

    **Resolve:** use a readonly tuple, exclude `mismatches` explicitly from the successful arm, and validate external representations. The current `compareCli` constructor does produce consistent outcomes; this finding concerns the stronger type-level claim.

The host-side CLI judge is sound within the stated trust boundary: it copies the validated expectation before execution, sends only argv/stdin to the provider, and compares observations on the host. A process printing a claimed verdict cannot replace that comparison. `requiredShortfall` rejects a genuine `held: false` regardless of exit code and rejects a missing required result. I found no concrete process-controlled overwrite of that verdict in the supplied implementation.

The adapter-set refusal also holds for sets produced here: mutation remains null, HTTP/browser remain absent, and admission independently checks slots. I found no repository construction that makes those sets clear L3. Arbitrary forged adapter objects or a hostile provider would cross the trusted-runtime boundary you explicitly excluded.

The in-process line diff has a conservative fallback and meaningful independent LCS tests. Static parsing avoids directly executing config modules. Leaf-link rejection, UTF-8 rejection, and ordinary file-size checks provide real protections, although they do not resolve the ancestor-path issue.

I found no wholly tautological test that passes regardless of its subject’s implementation. Several assertions prove less than their titles claim, especially the linked-directory fixture, the outcome-type fixture, and the host-execution scan.

The CI credential requirement fails closed for fork PRs, as explicitly intended. The harness permission widening is confined to its temporary workspace; the parent temporary directory remains separate from the Vault fixture. I found no additional concrete bypass in those two changes.

The framing is appropriate, but the demanded guarantee needs a declared supported subset. Arbitrary TypeScript assertion equivalence and mutable JavaScript configuration cannot be certified by these syntactic summaries. The key acceptance question is: **does every construct the adapter cannot establish as safe become an explicit refusal?** Here, several become “unchanged,” an empty enumeration, or 100% coverage instead.