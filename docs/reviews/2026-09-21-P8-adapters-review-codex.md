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