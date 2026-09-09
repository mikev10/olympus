# Triage of the external review of S1, 2026-09-09

The triage record for the external adversarial review of the walking
skeleton. The findings are in the companion file
`2026-09-09-S1-walking-skeleton-adversarial-review.md`, verbatim. This file
records what each finding claimed, whether it held against the tree, what was
done, and why. Findings are not instructions; each was verified against the
cited lines and, where executable, reproduced before anything was changed.

## Source

- **Reviewer:** ChatGPT, temporary chat, no repository access; worked from the
  review bundle (base `e50fe26`, head `87ee5e8`).
- **Tree at triage:** `87ee5e8`, the tip of `unit/s1`. The cited line numbers
  had not drifted; every citation matched.
- **Verification method:** findings 1, 2, 3 (all three parts), and 7 were
  reproduced by a throwaway test in `packages/api` that ran each construction
  as the reviewer wrote it; every "passes despite" assertion passed. The test
  was deleted after the run and its cases became the regression tests below.
  Findings 4, 5, 6, 8, 9, 10, and the configuration note were confirmed by
  reading the cited code. Nothing was taken on the reviewer's word.
- **Findings returned:** 10 numbered, plus one configuration note, plus a
  framing finding. All held. None was factually wrong.

## Summary

| # | Finding | Held | Triage | Where |
|---|---|---|---|---|
| 1 | Duplicate check ids alias every spec to the first result | yes, reproduced | fixed | D-S1-12 |
| 2 | A locked artifact changed by a check during verify still passes | yes, reproduced | fixed; one part recorded for P6 with P2 | D-S1-13 |
| 3a | An empty manifest is a passing gate | yes, reproduced | fixed | D-S1-14 |
| 3b | The caller can shrink the check array after startRun begins | yes, reproduced | fixed | D-S1-14 |
| 3c | `required: undefined` through a cast reads as optional | yes, reproduced | fixed, narrowly | D-S1-14 |
| 4 | Nothing binds check-implementing files to the lock set | yes, by design | known limit, P6 with P4 | this file |
| 5 | A wrapper hides a stub's declaration | yes, already D-S1-07 | known limit, P4; record sharpened | D-S1-07 |
| 6 | Re-locking replaces the manifest; a later lock drops earlier entries | yes, per spec §2 | pending registry entry under I3, owed to P1; baseline raised | D-S1-18 |
| 7 | Locked paths resolve differently and can escape the root | yes, reproduced | fixed | D-S1-15 |
| 8 | The compile-ok fixture proves the type shape, not runtime existence | yes | wording fixed; the rest rejected as by design | this file |
| 9 | The I9 scan is a blacklist; a read of fd 0 passes | yes | known limit, already owed to P9 | D-F3-22 |
| 10 | Shrinking a tsconfig `include` hides `src` from the I9 scan | yes | fixed | D-S1-16 |
| cfg | `types` and `main` divergence is unguarded by I8 | yes | fixed | D-S1-17 |
| framing | The useful question is whether a hidden stub is refused once the line cap goes | accepted | recorded for P4 | D-S1-07 |

Pending entries went from 26 to 27 and the I3 baseline from 2 to 3, both by
the maintainer's direction for finding 6. No other baseline number changed.

## Findings

### 1. Duplicate check ids — fixed

- **Claim:** two `CheckSpec`s with the same id both correlate to the first
  `CheckResult` through `checks.find`, so a second required check that exits
  non-zero, or never starts, is masked by a first that exits zero.
- **Verified:** reproduced. Two required checks with id `x`, the first exiting
  0 and the second 3, produced two results and a `pass`.
- **Done:** `startRun` refuses a manifest with a duplicate id before anything
  is locked, provisioned, or committed, as an `invalid-request` outcome. The
  verify station correlates results with specs by position rather than by id,
  so the correlation cannot alias even if the guard were removed. Regression
  tests: `finding 1` in `packages/api/test/skeleton-hardening.test.ts`.

### 2. A locked artifact changed during verify — fixed, one part recorded

- **Claim:** the locks are verified on entry to `verify` and never again; a
  check that rewrites `spec.md` and exits 0 reaches a passing gate with the
  artifact changed.
- **Verified:** reproduced with the reviewer's exact command. The gate passed
  and `verifyLocks` afterwards reported the mismatch.
- **Done:** the locks are re-verified after the checks and before evidence is
  written or state is committed. A mismatch records an `IntegrityViolation`
  whose detail carries `phase: 'after-checks'` and the check results, commits
  the task as failed at `verify`, writes no evidence, and returns the
  `lock-tamper` refusal. Regression test: `finding 2`.
- **Recorded, not fixed:** the reviewer's stronger remedy, making locked paths
  unwritable during verification, is not reachable from the skeleton. The
  contract types the workspace mount as `mode: 'rw'` with no other value, so
  the verification sandbox mounts the workspace writable in every provider,
  Docker included. Whether verification should run against a read-only
  workspace, and what the contract needs for that, is owed to P6, with P2 as
  the provider that would enforce it. Recorded in D-S1-13.

### 3. The verification manifest — fixed, narrowly

- **Claim:** `checks: []` passes; the caller's array is held by reference and
  can be shrunk after `startRun` begins; a `required` that is not a boolean
  reads as optional.
- **Verified:** all three reproduced.
- **Done:** `startRun` snapshots the task before its first `await`, and
  refuses, as `invalid-request`, a manifest with no check, with no required
  check, or with a check whose id is empty or duplicated, whose command is
  empty, whose `required` is not a boolean, or whose `expectedSuiteCount` is
  present and not a non-negative integer. Locked paths are validated in the
  same pass (finding 7). Regression tests: `finding 3`.
- **Kept with P6:** the authoritative manifest, pinned at `test-design` and
  read from the Vault rather than from the caller, is what closes this class.
  `I5.missing-check-or-shrunken-suite-refuses` already owes it to P6; the
  reviewer noted the same.

### 4. Check-implementing files are not bound to the lock set — known limit

- **Claim:** `lockedPaths` and `checks` are independent caller fields; a check
  that runs a workspace file the agent can write is judged by an artifact the
  agent controls.
- **Verified:** by reading. True by construction of `FixtureTask`, which the
  spec defines as "one task, described completely by the caller; the plan
  station that would emit it does not exist."
- **Triage:** known limit, owed to P6 with P4. In the full line, acceptance
  tests are locked at `test-design` (I3; `LockEntry.lockedBy` names that
  station) and the verification manifest is Vault-resident (P6). The skeleton
  has neither station and cannot infer the protected set from a command
  string, which the reviewer also advised against. No S1 change.

### 5. A wrapper hides a stub's declaration — known limit, record sharpened

- **Claim:** `unsafeComponents` reads the outer object only; the package's own
  delegating wrappers demonstrate that a wrapped stub disappears. Not a route
  above L1 today, because `SKELETON_LINE` is appended unconditionally.
- **Verified:** by reading; already recorded as the known limit in D-S1-07.
- **Triage:** no fix. The reviewer's framing finding is the useful statement:
  the question is not whether a hidden stub gets above L1 now, it cannot, but
  whether the mechanism will still refuse one once the line cap is removed.
  For this code the answer is no. D-S1-07 now states the requirement P4
  inherits: before `SKELETON_LINE` is deleted, component provenance must be
  compositional, so that a wrapper cannot drop a declaration. P4 decides
  whether that becomes a pending entry.

### 6. Re-locking replaces the manifest — pending entry under I3, owed to P1

- **Claim:** `lock` sets the run's manifest, replacing any earlier one; a
  later lock that names only new artifacts drops every earlier entry, and a
  caller holding the vault can re-lock after a change.
- **Verified:** by reading `vault.ts` line 73 and the test that pins
  replacement. S1 is correct as built: spec §2 says "replaces any earlier
  manifest for the run".
- **Triage:** not rejected. Replace semantics make I3 unsatisfiable in the
  full line: `spec` locks the spec, `test-design` locks the acceptance tests,
  and the second lock would drop the first's entries while I3 requires both
  locked and re-verified at every transition. By the maintainer's direction
  this is a pending registry entry, `I3.lock-preserves-earlier-entries`, owed
  to P1, and the I3 baseline is raised from 2 to 3 in the same change. The
  `Vault.lock` contract is silent on append versus replace; P1 decides and
  asserts it. D-S1-18.

### 7. Locked path resolution — fixed

- **Claim:** the vault resolves a locked path with `resolve(root, path)` and
  the build station reads it with `join(workspace, path)`; an absolute path
  addresses two different files, and `..` escapes the root in both.
- **Verified:** reproduced. An absolute path outside the workspace was locked
  by the vault, and `build` then threw `ENOENT` for `workspace/<absolute>`.
  The run did not refuse; it threw an unstructured error after the lock,
  with the run state left at `running`.
- **Done:** `startRun` refuses, as `invalid-request`, a locked path that is
  absolute, empty, duplicated, or contains a `..` segment. Both readers now
  call `resolve`. Regression tests: `finding 7`.
- **Stated plainly, for P1 and P2:** the behaviour the reviewer found was
  fail-closed by accident, not by design. An exception that happens to stop a
  run is not a control: it leaves state inconsistent, records no violation,
  and holds only until someone adds a `catch`. P1 (the vault's root) and P2
  (the mount layer, which the contract requires to resolve symlinks and path
  escapes) will meet the same shape and should not read this as precedent.
  D-S1-15. Symlink and realpath containment stay with those units.

### 8. The compile-ok fixture proves the type shape — wording fixed, rest rejected

- **Claim:** a `declare readonly unsafe` class field, declaration merging, or
  a cast satisfies `DeclaresUnsafe` without emitting a runtime property, so
  `I5.stubs-declare-unsafe` is not executable evidence of a runtime property.
- **Verified:** by reading; correct for `declare` fields.
- **Triage:** the pairing is by design and the reviewer says as much: the
  fixture is the early compile-time signal, and
  `I5.unsafe-component-refused-above-l1` constructs the real stubs and reads
  the property at run time, which a `declare`-only field fails. The assertion
  title now says the fixture pins the type shape and names the runtime
  assertion as the proof of existence. D-F3-22 already records the class of
  limit. No other change.

### 9. The I9 scan is a blacklist — known limit, already owed

- **Claim:** `readFileSync(0)` through `node:fs` makes behaviour depend on
  foreground stdin and matches nothing the scan looks for; `/dev/tty` through
  `node:fs` likewise.
- **Verified:** by reading `TERMINAL_MODULES` and `TERMINAL_CHAINS`.
- **Triage:** known limit. `I9.api-runs-headless`, pending for P9, is the
  behavioural assertion the reviewer asks for. The D-F3-22 bullet on I9 now
  names the file-descriptor construction beside the alias one. The blacklist
  was not extended; chasing spellings is the limit, not the fix.

### 10. A shrunk `include` hides `src` from the I9 scan — fixed

- **Claim:** the scan's only enumeration guard is `files.length === 0`; an
  `include` naming one safe file keeps the program non-empty while the
  runtime source leaves it.
- **Verified:** by reading `packageProgram` and `i9.ts` line 26.
- **Done:** the scan refuses a program that omits any `.ts` file under the
  package's `src`, naming each omitted file; `sourceFilesOutsideProgram` in
  `kit/scan.ts` does the comparison and has its own test. S1 widened this
  scan, so S1 owns the hole. The general inventory assertion over every
  package and every directory stays with P5 as D-F3-22 records. D-S1-16.

### Configuration note: `types` and `main` divergence — fixed

- **Claim:** `I8.fixture-paths-match-published-entries` compares the paths
  map to one entry, `types` or else `main`, so the two could diverge and the
  fixtures would typecheck against a file the runtime does not load.
- **Verified:** by reading `workspacePackages`.
- **Done:** `WorkspacePackage` exposes `main` and `types` separately, and the
  I8 assertion refuses a package whose two entries resolve to different
  files. `entryDivergence` in `kit/workspace.ts` has its own test. D-S1-17.

### Tautological checks, fail-open paths, language escapes

Agreed with the reviewer on all three sections. No registered assertion is
tautological. No ordinary exception yields a pass; the fail-open cases were
the structural ones above, now closed or owed. The `readonly`-erasure and
`declare`-field escapes are real and are handled by the snapshot (finding 3)
and the runtime assertion (finding 8).

### Framing

Accepted as a finding. For checks and locks the adversarial question was the
right one and found real passing-gate states. For the safety declaration the
sharper question is recorded in D-S1-07 for P4. The reviewer's closing point
stands and is what `SKELETON_LINE` exists to say: an L1 `pass` from the
skeleton is weaker than "every invariant holds", and the code says so.

## What changed

- `packages/api/src/run.ts`: `invalid-request` outcome; the task is validated
  and snapshotted before the first `await`.
- `packages/api/src/line.ts`: results correlated by position; locks
  re-verified after the checks; `resolve` in the build reader.
- `packages/api/test/skeleton-hardening.test.ts`: one regression test per
  fixed finding, drawn from the reproduction.
- `packages/conformance/src/registry/i3.ts` and `pending-baseline.json`: the
  I3 pending entry for finding 6; I3 baseline 2 to 3.
- `packages/conformance/src/registry/i5.ts`: the fixture assertion's title.
- `packages/conformance/src/registry/i8.ts`, `i9.ts`, `kit/scan.ts`,
  `kit/workspace.ts`, and `test/kit/workspace.test.ts`: the inventory guard
  and the entry-divergence guard.
- `docs/decisions.md`: D-S1-12 through D-S1-18; D-S1-07 and D-F3-22 amended.

## What did not change

Findings 4, 5, and 9 are recorded with owners and no code. No contract file
was edited. No pending entry other than finding 6's was added or paid.
