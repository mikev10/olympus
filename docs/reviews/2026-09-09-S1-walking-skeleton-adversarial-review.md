# External review of S1, 2026-09-09

The verbatim findings of an external adversarial review of the walking
skeleton (`packages/api`, the three stubs, and the S1 conformance
additions). The triage, with what was and was not acted on and why, is the
companion file `2026-09-09-S1-walking-skeleton-adversarial-triage.md`.

## Source

- **Reviewer:** ChatGPT, in a temporary chat, no repository access; worked
  from the review bundle alone.
- **Date:** 2026-09-09.
- **Bundle:** base `e50fe26` (`reviewed/F3`), head `87ee5e8` (the tip of
  `unit/s1` at the time). The bundle held the full contents of every tracked
  file changed in that range, `docs/plan/` excluded.
- **Prior context and lookups:** the prompt asked the reviewer to state at
  the top whether it held prior context and whether it performed lookups. The
  saved text begins at the findings and carries no such statement, so nothing
  is recorded here either way.
- **Citations:** the `fileciteturn...` markers inside the body are the
  reviewer's own citation artifacts, referring to positions in the bundle.
  They are left as received. Line numbers in the findings were treated as
  hints during triage, not citations.

## Review, verbatim

## Findings

### 1. `packages/api/src/line.ts:100-128` — factually wrong — **high**

**Concrete bypass:** duplicate `CheckSpec.id` values let one passing execution stand in for another required execution that failed or never started.

For example, give `verify` two required checks with the same id:

```ts
[
  { id: 'x', required: true, command: 'node -e process.exit(0)', ... },
  { id: 'x', required: true, command: 'node -e process.exit(3)', ... },
]
```

Both execute and two `CheckResult`s are collected. But when deriving failures, each spec is associated with `checks.find(c => c.checkId === check.id)`. Both specs therefore see the **first** `x` result, exit 0. `failures` is empty and the gate passes. The same construction masks a second `x` that never starts: the first successful result wins before `unstarted.get('x')` matters. fileciteturn3file0L81-L108

This is a direct route to a passing gate with a required check failing or never started. `requiredShortfall` itself is correct once it receives the right result; the correlation is wrong. fileciteturn3file0L153-L164

**Resolve:** reject duplicate check IDs before provisioning anything, and correlate results with the actual check instance/ordinal rather than recovering them later with `find`.

**Confidence:** high.

---

### 2. `packages/api/src/line.ts:89-144` — factually wrong — **high**

**Concrete bypass:** change a locked artifact _during verification_ and exit zero.

`verifyLocks` runs before the verification sandbox is provisioned. After that, every check runs in the workspace and there is no second lock verification before evidence is written, the task is committed `passed`, and the transition to `review` is returned. fileciteturn3file0L70-L125

A required check can therefore be:

```text
node -e require('node:fs').writeFileSync('spec.md','changed')
```

The command grammar accepts this as three whitespace-separated arguments. Under `StubSandboxProvider`, it executes in the workspace and exits 0. The workspace specification is RW, and the stub actually spawns the command there. fileciteturn3file0L190-L197 fileciteturn4file0L63-L109

Sequence:

1. `spec.md` is locked.
2. Entry to `verify` rehashes it successfully.
3. Required check rewrites `spec.md` and exits 0.
4. No rehash occurs.
5. Gate verdict is `pass`.

That is exactly “reach a passing gate after a locked artifact was changed.”

**Resolve:** verify the lock manifest again after verification execution and immediately before evidence/commit/transition. Better still, make protected locked paths unwritable during verification so final rehash is defense in depth rather than the primary barrier.

**Confidence:** high.

---

### 3. `packages/api/src/run.ts:33-40,115-116`; `packages/api/src/line.ts:100-128` — a tradeoff I would have made differently — **high**

**Concrete bypass:** the verification manifest has no authoritative nonempty source. `checks: []` is a passing gate.

The caller supplies `FixtureTask.checks`; `startRun` retains the caller's task object rather than snapshotting it. `verify` iterates whatever array exists at that time. With zero checks, the loop produces zero results, the failure calculation iterates zero specs, and `failures.length === 0` yields `pass`. fileciteturn3file1L251-L269 fileciteturn3file0L77-L108

There is also a TypeScript-specific version: `readonly` is erased. A caller can retain a mutable array, pass it as `readonly CheckSpec[]`, start the asynchronous run, then shrink it before verification. `startRun` stores `fixture: req.task` by reference. fileciteturn3file1L328-L335

And a JavaScript/`unknown`/cast caller can omit `required`. At runtime `requiredShortfall` starts with:

```ts
if (!check.required) return undefined;
```

so `required: undefined` turns an otherwise failing execution into an optional one. fileciteturn3file0L153-L164

The registry does explicitly leave the general missing-check/shrunken-suite property pending for P6, so this is not a hidden false claim by that pending entry. It is nevertheless a real passing-gate construction under the invariant framing. fileciteturn3file3L865-L879

**Resolve:** validate `RunRequest` at runtime, snapshot/canonicalize the check manifest before any await or station work, and make the required check set derive from runtime-owned locked configuration rather than caller-mutability. Refuse an absent/invalid manifest.

**Confidence:** high.

---

### 4. `packages/api/src/run.ts:33-40`; `packages/api/src/line.ts:47-50,100-104` — factually wrong — **high**

**Concrete bypass:** nothing binds the files implementing verification to `lockedPaths`.

Use:

```ts
lockedPaths: ['spec.md'],
checks: [{
  id: 'acceptance',
  command: 'node acceptance.mjs',
  required: true,
  ...
}]
```

If `acceptance.mjs` is agent-writable, the build can replace it with a test that exits zero. The lock verification proves only `spec.md` is intact; verification then runs the rewritten `acceptance.mjs`. `FixtureTask` exposes the lock list and check list as independent caller fields, and `spec` simply locks the former. fileciteturn3file1L251-L260 fileciteturn3file0L27-L31

For the supplied hello fixture the check is inline, so this exact bypass is not exercised there. It appears as soon as a check is implemented by an ordinary workspace test file.

**Resolve:** the runtime needs an authoritative acceptance-artifact manifest whose files are included in the lock set before build. Do not attempt to infer this reliably by parsing arbitrary command strings; the adapter/check enumeration layer should produce the protected artifact set explicitly.

**Confidence:** medium-high. The supplied contract sources are not present, so I cannot rule out an unseen contract-level constraint, but there is no runtime enforcement here.

---

### 5. `packages/api/src/safety.ts:55-79`; `packages/api/test/safety.test.ts:25-32` — unclear — **medium**

**Concrete issue:** unsafe discovery is not compositional. A wrapper hides a stub perfectly.

The implementation tests only whether the **outer object** has an `unsafe` property. The package's own test demonstrates this with `DelegatingVault`, `DelegatingSandbox`, and `DelegatingDriver`: all three contain the corresponding stub, and `unsafeComponents` returns only `SkeletonLine`. fileciteturn3file1L387-L417 fileciteturn6file0L25-L33

The wrapper implementations really do retain and delegate to the inner components while exposing no declaration. fileciteturn3file2L571-L657

There is an important qualification: **this is not currently a way to obtain an L2/L3 run.** `unsafeComponents` unconditionally appends `SKELETON_LINE.unsafe`, and `startRun` refuses whenever the resulting array is nonempty. So wrapping all three stubs still hits the line-level cap. fileciteturn3file1L409-L417 fileciteturn3file1L298-L303

The hole becomes live the moment `SKELETON_LINE` is legitimately removed while wrappers are possible. At that point a stub can remain silently underneath an apparently safe component.

**Resolve:** this cannot be made robust by optional structural discovery alone. Safety/provenance needs to be compositional—either trusted component metadata that wrappers must propagate, a graph construction layer that owns provenance, or an equivalent certification mechanism. Within S1, the unconditional line cap is what actually makes above-L1 sound.

**Confidence:** high on the hiding behavior and current cap; the correct later trust model is architectural and therefore unclear from this source.

---

### 6. `packages/vault/src/stub/vault.ts:61-75` — a tradeoff I would have made differently — **medium**

**Concrete bypass if the caller/component layer can reach the Vault:** locking the same `runId` again silently rebases the trusted hash.

`lock()` simply does:

```ts
this.locks.set(runId, manifest);
```

The vault test explicitly pins replacement semantics: it locks `spec.md`, replaces the manifest with one containing `tests.md`, modifies the previously locked `spec.md`, and then requires `verifyLocks()` to report `{ok: true}`. fileciteturn4file1L216-L240 fileciteturn4file1L375-L381

Thus, if code retaining the supplied vault reference changes an artifact and invokes `lock()` again, verification blesses the new state. More generally, a later station that locks only new artifacts drops all earlier entries.

This is not an agent-only bypass if I1's mount boundary is real; an isolated agent should never possess the Vault API. But `RunRequest.components.vault` is an ordinary in-process object supplied by the caller, so wrappers/orchestrator code does have the ability.

**Resolve:** make lock history monotonic or immutable: refuse re-locking a run, append/version manifests while retaining prior entries, or require a new manifest to cryptographically/structurally include the previous protected set.

**Confidence:** high on behavior; medium on whether the intended threat boundary includes an API caller/component wrapper invoking `lock` out of station order.

---

### 7. `packages/vault/src/stub/vault.ts:123-129`; `packages/api/src/line.ts:65` — factually wrong — **medium**

**Concrete construction:** `lockedPaths` is documented as workspace-relative but is never validated as such, and Vault and line resolve it differently.

The Vault hashes:

```ts
readFile(resolve(this.root, path));
```

while build consumes:

```ts
readFile(join(ctx.fixture.workspace, path));
```

The Vault also permits `..` traversal and absolute paths; there is no descendant check. fileciteturn4file1L278-L285

For an absolute POSIX path such as `/tmp/x`, `resolve(root, '/tmp/x')` addresses `/tmp/x`, while `join(workspace, '/tmp/x')` addresses a path beneath `workspace`. The object described as “locked” can therefore differ from the text handed to the driver. `../x` escapes the stated root altogether. The API type only documents “Workspace-relative”; TypeScript does not encode that property. fileciteturn3file1L251-L259

**Resolve:** one canonical path-resolution function shared by lock and consumers; reject absolute paths, `..` escape, and—if symlinks are in scope—verify realpath containment beneath the workspace/root.

**Confidence:** high.

---

### 8. `packages/conformance/fixtures/types/i5/stubs-declare-unsafe.ts:14-17` — factually wrong — **medium**

**Concrete conformance escape:** `I5.stubs-declare-unsafe` proves only TypeScript assignability, not that a runtime declaration exists.

For example a stub implementation can contain:

```ts
declare readonly unsafe: {
  readonly component: 'StubVault';
  readonly cannotEnforce: readonly string[];
};
```

A `declare` class field contributes to the instance type but emits no runtime property. The compile-ok fixture still accepts `new StubVault('/')` as `DeclaresUnsafe`. The same type-only effect can be produced by suitable declaration merging/module augmentation. The fixture itself is only four assignments. fileciteturn3file2L705-L722

Likewise, if casts were allowed into the fixture, `as unknown as DeclaresUnsafe` defeats the assertion trivially.

This is **not by itself a whole-CI bypass**: the direct runtime I5 assertion and package safety tests inspect actual direct stubs and would catch the simple `declare`-only version. The finding is specifically that the named compile assertion is not executable evidence of a runtime property.

**Resolve:** retain the compile fixture for API-shape coverage but describe it as such; runtime existence/value needs a runtime assertion. If compile fixtures are intended as proof, prohibit assertion casts and ambient augmentations affecting the tested symbols.

**Confidence:** high for `declare`/casts; medium for module augmentation because the unseen fixture compiler determines which ambient files it loads.

---

### 9. `packages/conformance/src/registry/i9.ts:7-36` — factually wrong — **medium**

**Concrete conformance escape:** `I9.api-never-touches-a-terminal` is a blacklist of module names and textual property chains, not a proof that API code is headless.

For example this can live in API source:

```ts
import { readFileSync } from "node:fs";

const input = readFileSync(0, "utf8");
```

That makes runtime behavior depend on foreground stdin. `node:fs` is not in `TERMINAL_MODULES`, and there is no `process.stdin`, `.isTTY`, or `console.*` chain for the regex to match. Similarly, opening `/dev/tty` through `node:fs` is invisible to this assertion. fileciteturn3file4L941-L971

Aliases also weaken a textual chain check (`const { stdout } = process; ...`), although I cannot quantify that path without the omitted `propertyChains` implementation.

**Resolve:** treat this scan as a lint heuristic, not the I9 proof. A headless behavioral assertion—API started with no TTY and closed stdin—is the right executable property. The registry already marks that stronger assertion pending for P9. fileciteturn3file4L998-L1005

**Confidence:** high for the `node:fs` file-descriptor construction.

---

### 10. `packages/conformance/src/registry/i9.ts:22-36`; `packages/api/tsconfig.json:1-3` — factually wrong — **medium**

**Concrete configuration escape:** I9 only requires `packageProgram(pkg).files` to be nonempty; it does not prove that the program still contains all API runtime source.

The current API tsconfig correctly includes `src` and `test`. fileciteturn3file2L699-L703 But if that configuration is shrunk to an existing safe file such as:

```json
"include": ["test/wrappers.ts"]
```

the TypeScript program can remain nonempty while `src/run.ts`, `src/line.ts`, and `src/safety.ts` disappear from the I9 scan. The assertion's only enumeration guard is `files.length === 0`. fileciteturn3file4L951-L971

A terminal dependency can then be added to omitted runtime source without this assertion seeing it. Protecting `tsconfig.json` behind a review label is useful process control, but it is not executable evidence of the invariant.

**Resolve:** compare the program against the complete on-disk `src` set and refuse any source file omitted from the compiler program, or scan `src` independently of tsconfig enumeration.

**Confidence:** medium-high. I would inspect the omitted `packageProgram` implementation to confirm exactly how it filters the TypeScript program.

---

## Tautological checks

I did **not** find a named assertion here that is literally tautological—i.e. one that succeeds regardless of the code under test.

`I5.stubs-declare-unsafe` can fail at compile time; it is just weaker than runtime existence. `I5.unsafe-component-refused-above-l1` genuinely calls `startRun`, checks two levels, exact component ordering, nonempty declarations, and a positive L1 case. fileciteturn3file3L801-L858 `I9.api-never-touches-a-terminal` genuinely scans and throws for the patterns it knows about. Its problem is incompleteness, not tautology.

The `if (!outcome.ok) return` patterns in package tests are also not tautologies because the immediately preceding `expect(outcome.ok).toBe(true)` throws on the wrong value.

## Fail-open behavior

The actual fail-open cases I found are structural absences: zero/shrunk checks, duplicate IDs, unlocked verification artifacts, and the post-verification lock window.

I did **not** find an ordinary exception path that turns into a passing gate. A required `sandbox.exec` exception becomes “no result” and fails; a missing lock manifest throws rather than reporting intact; malformed unsafe declarations throw before the run begins; provision/destroy/driver/evidence/commit errors propagate instead of creating a pass. The tests explicitly cover the unique-ID unstarted case and missing lock behavior. fileciteturn3file2L487-L499 fileciteturn4file2L407-L419

I cannot verify whether a _skipped local conformance test_ can nevertheless be counted as executed because the assertion runner is absent from the upload. The visible registry explicitly recognizes that a comment or skipped test is insufficient evidence for **external** assertions and keeps external reconciliation pending rather than accepting them. fileciteturn4file3L595-L604

## TypeScript/language escape hatches

The relevant ones are real:

- `readonly` is erased: the caller-supplied `checks` array is mutable at runtime.
- `declare` fields can satisfy `DeclaresUnsafe` without emitting `unsafe`.
- `as unknown as DeclaresUnsafe` defeats a compile-ok fixture if assertions are permitted there; `any` does so even more directly.
- declaration merging/module augmentation can potentially add `unsafe` only to a class's type surface.
- a generic wrapper can preserve a type parameter with a cast while returning a runtime wrapper that stripped `unsafe`; generic type information is erased and `unsafeComponents` only sees the outer object.
- I found no special bypass in this code's `isStringArray` predicate itself; its runtime check is real. A dishonest user-defined predicate is not involved in the safety decision.

## Configuration

The current tsconfig-path/Vitest-alias wiring is mechanically reasonable: `conformanceAliases()` is directly generated from `conformancePathsMap()`, and Vitest uses that result. fileciteturn5file0L13-L28 fileciteturn5file1L64-L82

The significant configuration hole I can establish is the I9 source-enumeration shrink above.

One item remains **unclear** from the supplied snapshot: `I8.fixture-paths-match-published-entries` compares the paths map to one `pkg.entry`, but `workspacePackages()` is omitted, so I cannot establish how it treats divergent `types`, `main`, or future `exports`. I would specifically check whether runtime and type entries are required to resolve to the same file rather than merely choosing one of them.

## Mechanisms I assess as sound

**Current above-L1 refusal:** sound for S1 as it stands. `SKELETON_LINE.unsafe` is appended unconditionally, so no legitimate L2 or L3 request can get into `commitRunState`, locking, provisioning, or the line. Wrapping the three stubs does not defeat that current cap. fileciteturn3file1L371-L417

**Malformed unsafe declaration handling:** sound as fail-closed behavior. Once an `unsafe` property exists, malformed shape/name/empty declaration causes an exception rather than being interpreted as safe. fileciteturn3file1L387-L406

**Lock hashing at the checkpoints that actually run:** the StubVault hashes bytes with SHA-256, treats deletion as a mismatch, and `refuseIfTampered` records a violation, commits failure, and refuses. Those checkpoints are sound; the end-to-end lock property is not, because of the windows and manifest semantics above. fileciteturn4file1L232-L240 fileciteturn3file0L133-L150

**A unique, present, genuinely required check:** if its execution yields nonzero, it fails; if it produces no result, it fails; and if an expected suite count is declared while suite count is unknown, it fails. That local logic is sound under the assumptions of unique IDs, an immutable manifest, and a truthful sandbox result. fileciteturn3file0L153-L164

**Claim does not determine verdict:** sound in this line. `verdict` is calculated from check shortfalls before `result.claim` is read for the evidence bundle; the claim has no dataflow into `failures` or `verdict`. The package test also supplies the claim “all tests pass” while a check exits 3 and requires a failing gate. fileciteturn3file0L104-L125 fileciteturn3file2L457-L474 I did not find a construction where the driver's narrative itself decides the gate.

**The exact direct-stub conformance runtime assertion:** sound for precisely the graph it constructs. It is not evidence about hidden/wrapped stubs.

## Framing

The adversarial framing is mostly right, but one part should be sharpened.

For the **current S1 code**, “get above L1 by hiding a stub” is not the useful attack question: `SkeletonLine` makes above-L1 impossible regardless of the three component declarations. There is no wrapper-only construction that gets an L2/L3 run through this version.

The useful question is instead:

**Will the component-safety mechanism still refuse a hidden stub when the unconditional SkeletonLine cap is eventually removed?**

For the code shown, the answer is **no**: the package's own wrapper test demonstrates that nested stubs disappear from `unsafeComponents`.

For checks and locks, the adversarial question is exactly the right one. It exposes real passing-gate states that the happy-path assertions do not: duplicate identities, no authoritative check manifest, unlocked acceptance artifacts, and mutation after the last hash verification.

Finally, several broad I5 requirements in the question are deliberately still pending in this unit—especially missing/shrunken verification. That means those gaps should not be described as the S1 registry falsely claiming full I5. They _do_ mean an L1 `GateResult.verdict === 'pass'` from this walking skeleton is substantially weaker than “all stated invariants hold.” The code should be reviewed with that distinction explicit.
