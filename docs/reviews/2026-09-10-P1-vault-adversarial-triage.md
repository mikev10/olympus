# Triage of the P1 external review, 2026-09-10

The findings are in `2026-09-10-P1-vault-adversarial-review.md`, verbatim, with
the reviewer and bundle recorded in its header. Findings are cited by number
from that file.

**Counts.** Three findings. Three hold. None was rejected as not holding. Two
were fixed on `unit/p1`; one is recorded as a known limit with an owning unit.
The reviewer's descriptions of the code were accurate in all three cases; two
of its three stated *consequences* needed correcting, and one finding turned
out to be worse than reported.

**Reviewer calibration, this unit.** 3 of 3 findings held — the best result of
the three reviews so far. Set against that: the reviewer answered three of the
prompt's seven numbered items and returned nothing on tautological checks,
failing open, configuration, or whether the framing was right. Its severities
were roughly sound, though finding 1's "high" rested on a consequence that does
not hold today.

| # | Finding | Verdict | Outcome |
|---|---|---|---|
| 1 | `hashArtifact` lets `EISDIR`/`ELOOP`/`EACCES` escape as unhandled exceptions | **Holds**; consequence overstated | **Fixed** — third sentinel, `unreadable` |
| 2 | Record hydration validates part of the shape and casts the rest | **Holds**, and is worse than described | **Fixed** — both boundaries completed |
| 3 | TOCTOU between `realpath` and `readFile` in `hashArtifact` | **Holds**; not exploitable, as the reviewer itself argues | **Known limit**, owned by P2 |

---

## Finding 1 — unreadable artifacts escaped as exceptions

**Verdict: holds. The defect is real; the consequence as stated is not, and the
real one is worse in a different way.**

**Checked by construction, not by reading.** A locked `spec.md` was replaced
with a directory of the same name and `verifyLocks` was called:

```
before: F1 directory-substitution: THREW EISDIR: illegal operation on a directory, read
after:  F1 directory-substitution: RETURNED {"ok":false,"tampered":[{"path":"spec.md",
        "expected":"1b355baa…","actual":"unreadable"}]}
```

`isAbsent` covered `ENOENT` and `ENOTDIR` only, so `EISDIR` from `readFile`,
`ELOOP` from `realpath`, and `EACCES` from either propagated out of
`verifyLocks`. Replacing a file with a directory needs no privilege at all.

**Where the reviewer is wrong:** it says the pipeline crashes because
`api/src/line.ts` calls `verifyLocks` unguarded. `line.ts` is wired to
`StubVault`, not `LocalVault` — the two meet only at I1, the integration unit.
Nothing crashes today. The finding's severity does not depend on that, though,
and the reviewer's underlying point stands independently: this is precisely the
shape D-S1-15 already recorded as unacceptable — *"an exception that happens to
stop a run is not a control. It holds only until someone adds a `catch`, and it
leaves the record inconsistent."* P1 reintroduced it in the component whose
whole job is detecting tampering.

**Worth noting for S1's owner:** `StubVault.hashFile` carries the identical
`ENOENT`/`ENOTDIR`-only guard, so the same gap exists there. It is not P1's to
fix — I1 deletes that file — but it should not be inherited if that ever
changes.

**Fixed** by a third sentinel beside `missing` and `escaped`. Every failure to
resolve or read a locked artifact now returns `unreadable` rather than
throwing, on the reasoning that an artifact the runtime cannot read is not the
artifact that was locked, so it is a mismatch like any other and the line
records it and refuses. `lock` refuses an unreadable path outright.

Not taken: the reviewer's alternative of catching in `line.ts` and converting
to a `lock-tamper` refusal. That leaves the Vault throwing and asks every caller
to remember a `catch` — the same fragility one level up.

**Also fixed alongside, and worth flagging as beyond what the finding asked
for:** resolving the artifact root moved out of `hashArtifact` into its callers.
It was being recomputed per entry, and a root that cannot be resolved is an
operational failure rather than a verdict about one path. It now throws once,
loudly, with a message saying no locked path can be verified.

## Finding 2 — incomplete record validation before an unchecked cast

**Verdict: holds, and the manifest half is worse than the reviewer describes.**

`requireRunState` checked `runId`, `station`, `version` and `tasks`, and
omitted `evidenceRefs` and `violations` entirely. `requireManifest` checked only
that `entries` was an array, never that its elements were entries.

```
before: F2a partial-run-state: RETURNED evidenceRefs=undefined violations=undefined
        F2a spread: THREW TypeError: s.evidenceRefs is not iterable
after:  F2a partial-run-state: THREW LocalVault: …\1.json does not hold a run state
```

The reviewer's consequence is confirmed at `packages/api/src/line.ts:249-250`,
which does spread both arrays — subject to the same caveat as finding 1, that
`line.ts` holds a `StubVault` today.

**Worse than described:** the reviewer predicted a junk manifest would be
"blindly trusted". It was, and then failed obscurely — `verifyLocks` threw
`The "paths[1]" argument must be of type string. Received undefined` from inside
`resolve()`. A corrupt manifest surfaced as a path-library error naming an
argument index, with nothing to connect it to the Vault or the run.

**Fixed.** `requireRunState` now requires `evidenceRefs` and `violations` to be
arrays, and rejects a `tasks` that is an array. `requireManifest` requires
`runId` and that every element carries `path`, `sha256`, `lockedAt` and
`lockedBy` as strings. Both refuse at the boundary with a message naming the
file.

## Finding 3 — TOCTOU between `realpath` and `readFile`

**Verdict: holds. Recorded, not fixed.**

The window is real by construction: `realpath` and `readFile` are two syscalls
and the path can be swapped between them.

The reviewer's own impact analysis is correct and is the reason this is not
fixed now. To pass the gate through this window an attacker needs a file whose
bytes hash to the locked artifact's SHA-256 — which means already possessing the
locked content, in which case writing it into the workspace legitimately is
simpler. There is no privilege gained.

**Recorded as a known limit owned by P2** rather than fixed here, because the
durable fix is not the one the reviewer proposes. Descriptor-based reads would
narrow the window inside `LocalVault`, but the window only exists because the
tree is writable while it is being verified. A-S1-02 already widened
`MountTable.workspace` to admit `ro` so that verification can run against a
read-only workspace, and `I1.mount-layer-enforcement` already obliges P2 to
mount the workspace with the mode the table gives it. That closes the class
rather than narrowing one instance of it. Recorded in `docs/decisions.md` under
P1's known limits with P2 named.

---

## What changed

- `packages/vault/src/local/vault.ts` — the `unreadable` sentinel; `hashArtifact`
  no longer throws; the artifact root resolves once in the callers; both record
  boundaries completed.
- `packages/vault/test/local.test.ts` — five regression tests. Four were shown
  failing against the pre-fix code and passing after; the fifth (`tasks` as an
  array) covers a case the mutation left intact and so was not demonstrated.
- `docs/decisions.md` — D-P1-11, D-P1-12, and finding 3 as a known limit.

## Gates after the fixes

`pnpm typecheck`, `pnpm lint`, `pnpm test` (251 passed), `pnpm conformance`
(59 assertions) all pass. `git ls-files -- .plan/` prints nothing. No
conformance assertion was changed, no baseline moved, and no contract file was
touched.
