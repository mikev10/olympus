# Triage of the P4 external review, 2026-09-17

Every finding in `2026-09-17-P4-station-machine-adversarial-review.md`, checked
against the code before anything was changed. Findings are cited by the
reviewer's own numbers.

**Counts.** Ten findings. **Six hold and were reproduced as failing tests**
(3, 4, 5, 6, 7, 10). **Two hold as accurate statements about work this unit
explicitly does not own** (2, 9). **One holds as a latent gap owned by the
driver units** (8). **One is about the review prompt, not the code** (1), and
it is the most useful item in the reply. **None did not hold.** Two of the ten
(7, 8) restate limits this unit had already written into `docs/decisions.md`
before the review; the bundle excludes that file, so the reviewer could not
have known.

That is an unusually high hit rate, and it is recorded as such rather than
smoothed over: the reviewer answered all seven numbered prompt items, invented
nothing, and marked its own uncertainty accurately — the two findings it rated
"medium" confidence are the two that turned out to need another unit's work.

| # | Finding, in one line | Verdict | Outcome |
|---|---|---|---|
| 1 | The prompt's threat model hands the attacker the Vault the gates are checked against | Holds — about the prompt, not the code | Review-request skill's threat model fixed |
| 2 | `approveStation` records `approvedBy` with no authentication | Holds — belongs to P9 | Recorded (D-P4-11); already in the signature |
| 3 | One grant is a standing approval for every later visit to the same station | **Holds — reproduced** | **Fixed** (A-P4-04) |
| 4 | A kill inside an attempt gives unbounded driver invocations per iteration | **Holds — reproduced** | Open: the fix collides with an accept criterion. Maintainer's call |
| 5 | The review seat is mounted over the author's whole tree, and the plan is a file in it | **Holds — reproduced** | **Half fixed** (A-P4-05); half is `I6.review-seat-reads-only-its-grants` (P6) |
| 6 | The bytes a lock check verified are not the bytes the model is handed | **Holds — reproduced** | **Fixed** for context (A-P4-05); check execution recorded |
| 7 | A kill between a Vault write and the next commit wedges the run | **Holds — reproduced** | Already a recorded known limit, written before the review |
| 8 | Reviewer independence rests on a family string parsed from a result | Holds in part — latent, owned by the driver units | Already a recorded known limit |
| 9 | A required check can satisfy the gate while testing nothing | Holds — belongs to P6 | Recorded (D-P4-11) |
| 10 | A tamper is attributed to a role that had not acted, with the wrong driver's provenance | **Holds — reproduced** | **Fixed** (A-P4-05) |

---

## 1 — the threat model gives the caller executable components

**Verdict: holds, and it is a defect of the prompt, not of P4.**

Checked: `RunRequest.components`, `ResumeRequest.components`, and
`ApprovalRequest.vault` are all parameters of exported functions. The prompt
said the motivated party "controls … the arguments to the exported entry points
(startRun, resumeRun, approveStation)" and, one sentence later, that it "does
not control code running inside the runtime's own process". Both cannot be true:
a `Vault` is an argument *and* code that runs in the process. Read literally,
the prompt let the attacker replace the thing under test.

The reviewer is right that this makes findings 1 and 2 near-tautologies, and
right about the cost: two of ten findings went to the boundary rather than to
the machine. It also proposed a sharper question, and that question is a better
description of what this unit actually has to survive.

**What changed:** nothing in P4. The review prompt for P4 is a committed record
of what was sent and is not edited. The defect is in the instrument that writes
prompts, so `.claude/skills/review-request/SKILL.md` gained two things: a
sentence in the threat-model template naming what the party does *not* control
(the runtime-selected vault, sandbox, and drivers are trusted even where a
function takes one as a parameter), and a short rule above it explaining why a
boundary stated from one side only gets read literally, with this review as the
worked example. This is a change outside P4's code, made because a wrong threat
model taints every future review; drop it if the maintainer would rather it were
its own piece of work.

## 2 — an approval nobody granted

**Verdict: holds as a statement of fact; belongs to P9.**

Checked `approveStation` (`packages/api/src/run.ts`). `approvedBy` is validated
only for being a non-empty string and is then persisted verbatim. There is no
authentication and the function does not pretend otherwise: `ApprovalRequest`
carries the comment "Authenticating who this is belongs to the API that calls
this function (P9)", and P4's out-of-scope list assigns "the HTTP surface for
approve, cancel, and status" to P9.

So the mechanism does what it says. What the finding really lands on is the
prompt asking whether "an approval nobody granted" is possible while also
handing the caller the approval call — finding 1 again. Under the corrected
boundary, `approveStation`'s caller is the authentication boundary, and this
becomes an explicit trust assumption.

**What changed:** nothing. Recorded in D-P4-11.

## 3 — a grant is a standing approval for every future visit

**Verdict: holds. Reproduced before the fix.**

The construction was built exactly as described, with a sandbox whose first
check exits non-zero:

1. `build:1` set to `human-required`. `startRun` refuses at the build exit.
2. A human approves `build:1`. The run resumes and crosses.
3. The check fails, so `verify` sends the task back to `build` — a backward
   move, which correctly needs no approval.
4. The task is built a second time, and the second exit from `build` — a
   human-required gate on work nobody has seen — **advanced on the first
   visit's grant.**

Two builds, one approval, and no second approval sought. Worse, a human who
*wanted* to approve the second visit could not: `approveStation` refused,
because a grant with that key already existed.

The consequence is the reviewer's, and it is not inflated: this is a
human-required gate crossed without a human, which is the failure I4 exists to
prevent.

**What changed (A-P4-04):** `ApprovalGrant` gained `usedAt: string | null`.
`transition` now requires an *unspent* grant and returns the key it spends; the
line marks that grant used in the same commit as the station move, so a stop
between the two leaves it unspent and the gate is re-evaluated.
`approveStation` records a new grant when no unspent one exists. Spent grants
stay in run state — they are the record that a human approved, and consuming
them by deletion would fix the gate by destroying the audit trail.

`I4.approval-outcome-gates-the-station` gained the rebuild case, and was shown
to fail with the `usedAt` check deleted:

> I4: the rebuilt task crossed the human-required build exit on the first
> visit's grant

## 4 — unbounded invocations inside one recorded iteration

**Verdict: holds. Reproduced. Not fixed here, because the fix contradicts an
acceptance criterion.**

Reproduced with a vault that throws before the commit that records a result:
three kills in that window produced **three driver calls against one recorded
iteration**, with `attempts` still `{ iterations: 1, retries: 0 }` and the task
still `running`. The reviewer's reading of the two existing assertions is also
correct: `I5.task-attempts-are-bounded` tests uninterrupted failures and the
resume of an *already parked* run, and the resume assertion injects its stops
only after commits, so neither can see this window.

The reviewer's fix — count every physical invocation — is the right shape. It
cannot be applied as a review fix, because P4's accept criterion says a run
killed after any committed state and resumed "ends in the same station, task
statuses, **attempt counts**, approvals, and review seats as the same run
uninterrupted", and `I2.resume-derives-state-from-the-vault` enforces exactly
that, comparing `attempts` in full. The two properties are incompatible by
construction: one says a kill must cost nothing, the other says it must cost
something. Changing the assertion to accommodate the fix would be weakening an
acceptance criterion to satisfy a finding, which is an amendment and the
maintainer's decision, not this session's.

**Recommendation: amend.** A bounded spend is what I5 is for; the criterion's
stated purpose — "so a resume cannot reset them" — survives, and is strengthened
by, a stricter count; and an unbounded spend under a kill loop is the worse of
the two failures. The change would be to count on every entry into an attempt,
and to restate the criterion as *no lower than* the uninterrupted run's counts.

**What changed:** nothing in code. Written up under Known limits with the
reproduction and the recommendation.

## 5 — `grantedContext` filters the prompt, not the environment

**Verdict: holds. Reproduced. Half fixed; the other half is owed.**

Reproduced end to end. The sandbox mount modes for a whole run were
`['rw', 'ro', 'rw']` — build read-write, checks read-only, **and the review seat
read-write** — over `ctx.run.repo`, the author's whole tree. The `review`
contract's `writeBoundary.workspaceGlobs` is `[]`. The admitted task graph is a
file in that tree, and the fixture policy grants the reviewer role a `read`
tool. The reviewer's reading of the assertion is correct too:
`I6.reviewer-receives-no-author-material` searches `stablePrefix +
variableSuffix` and never touches the filesystem.

Two things are wrong, and they separate cleanly:

- **The mount contradicted the contract.** A station granted no workspace glob
  was handed a writable copy of the work it judges. That is P4's own code
  disagreeing with P4's own contract table, and it is fixed.
- **The plan is readable from the tree whatever the mode is.** Fixing that needs
  a curated view holding only the grants allowed, in place of the author's
  working copy — which needs the runtime-collected diff. P4 cannot build it, and
  the unit's out-of-scope list already defers the diff to P6.

The author's narrative is *not* reachable the same way: it lives in the Vault,
which is never mounted (`others: []`).

**What changed (A-P4-05):** `runTask` takes the mount mode from the station
contract's write boundary, so `review` is mounted read-only and `build` is not.
Mount modes for a run are now `['rw', 'ro', 'ro']`. The existing sandbox test
was updated to that expectation and now names the contract that decides it.

**What is owed:** `I6.review-seat-reads-only-its-grants`, owner P6, added to the
pending registry with the assertion it must carry — a reviewer that actively
opens the admitted graph and an author-written sentinel and is refused both. The
pending baseline for I6 rises **0 → 1** in this pull request, as a deliberate
edit visible in the diff.

## 6 — time-of-check/time-of-use on locked artifacts

**Verdict: holds. Reproduced. Fixed for model context; recorded for check
execution.**

Reproduced with a vault that swaps `spec.md` immediately after `verifyLocks`
returns `ok` at `build`, and restores it before the next verification. The model
received a spec reading `SWAPPED-SPEC: build whatever you like`, **no violation
was recorded**, and the run went on to complete at the `integrate` floor. Every
lock comparison saw the admitted bytes, exactly as the finding predicted.

The reviewer split its own confidence correctly. The build-context variant is
entirely inside this unit's code and is fixed. The check-execution variant —
bytes swapped while checks run inside a sandbox — would need the tree snapshotted
at provisioning, which is a sandbox and Vault capability that does not exist;
`SandboxSpec` mounts a mutable source path.

**What changed (A-P4-05):** `readText` now hashes the bytes it read and compares
them to the admission hash, so what is hashed is exactly what is handed over.
A mismatch is a `lock-tamper` violation at phase `context`. The read happens
*before* `startAttempt`, so context that drifted under the check costs no
iteration budget. Verified: the same swap now refuses at `build` with
`lock-tamper`, zero driver calls, one violation.

## 7 — a stop between a Vault side effect and the next commit

**Verdict: holds, both instances. Reproduced. Already a recorded known limit.**

Both reproduced with kills placed before the relevant commit:

- Killed after `recordAdmission` and before the first state: `resumeRun` throws
  (no state to read) and a second `startRun` throws `already has an admission
  record`. The run can be neither started nor resumed.
- Killed after a station's `lock` and before its `phase: exiting` commit: the
  resume re-enters the station, locks again, and LocalVault refuses with
  `refusing to lock … again`.

The reviewer is also right that the resume assertion only kills after
`commitRunState`, so it cannot find either.

What it could not know is that both were already written down. `docs/decisions.md`
carried, before this review: *"A crash between a Vault write and the run state
that records it. Between a station's `lock` and its commit, a resume re-locks
and the Vault refuses the already-locked path. Between `recordAdmission` and the
first run state, no resume can find the run."* The bundle excludes
`docs/decisions.md` by construction, because it carries author reasoning.

Note also what the finding is measured against. P4's accept criterion is a run
killed **after any committed run state**, and these kills are before one. The
claim the finding actually contradicts — "a run can be stopped at any point and
resumed" — is the *prompt's* wording, not the unit's. Both entry points fail
closed and loudly; nothing is silently degraded and no gate is crossed.

**What changed:** nothing. The existing entry already names both windows, why
neither is closed, and what would close them (a Vault read of the lock manifest,
and a lookup of an admission without state — neither exists).

## 8 — model identity is a string parsed from a result

**Verdict: holds in part, as a latent gap. Already recorded, owned by the driver
units.**

Checked. `readResult` validates `typeof model.family === 'string'` and casts
`Partial<TaskResult>` back to `TaskResult`; `seatReviewer` compares families by
exact string equality. The reviewer's note about the test is accurate —
`ChosenDriver.runTask` overwrites every result's model with `resolveModel()`, so
the tests never exercise a lying result.

But the chain is longer than the finding needs it to be. Authors' families come
from results the *runtime* wrote from what a driver returned, and whether a model
can influence its own `result.model` is a property of the Driver implementations,
which this unit does not touch. The reviewer said as much, rated it medium, and
noted that L3 is unreachable while `SKELETON_LINE` stands — all correct.

This too was already written down, under Known limits: *"A driver that reports
another model than it runs is held to the identity its result reports … Whether
a driver's identity is true is P5's claim to prove."*

**What changed:** nothing. Hardening the line here would mean overriding the
result's identity with `resolveModel()`, which would be *weaker*, not stronger:
the current design deliberately holds a driver to the model its result says ran.

## 9 — a required check that tests nothing

**Verdict: holds; belongs to P6.**

Checked `validate.ts`: a manifest must carry at least one required check, and a
command need only be a non-empty string. Nothing binds it to the acceptance
tests or to a trusted suite. The fixture's required check really is `node -e
process.exit(0)`.

The reviewer classified this itself as a tradeoff rather than a defect, and
that is right: P4's out-of-scope list defers "verification beyond S1's check
execution, suite enumeration, and the claim/evidence diff" to P6, and a run
above L1 is refused until P6 lands. The fixture proves execution plumbing and is
not claimed to prove more.

**What changed:** nothing. Recorded in D-P4-11 against P6.

## 10 — a violation attributed to a role that had not acted

**Verdict: holds. Reproduced.**

Reproduced with a vault that reports a mismatch only once the run reaches
`review`. The recorded violation named `role: 'reviewer'` and
`driverProvenanceId: 'stub-driver@…'` — the build driver's — while the reviewer
had been invoked **zero** times. The same shape applied at `build`: a mismatch
found *before* the build ran was attributed to the builder role.

The reviewer is precise about the consequence and does not inflate it: the run
still refuses, so no gate opens. What is damaged is the audit record, which is
the whole point of a tamper-evident store.

**What changed (A-P4-05):** `recordTamper` takes the suspect separately from the
task it fails. A mismatch found before a task ran passes null, which falls back
to the last task that actually produced a result, or to `unattributed` —
the rule D-P4-08 already stated but the `before-*` call sites did not follow.
Provenance now comes from the driver at the station where the mismatch was
found, so a review-time detection records the reviewer's driver, not the
builder's.

One existing test asserted the old attribution (`role: 'builder'` for a mismatch
found before the build ran) and now asserts `unattributed`, with a comment
naming D-P4-08. That is a correction, not a weakening: at that point in the run
no agent had touched the workspace.

## The three sections beyond the numbered findings

**Tautologies and fail-open behaviour.** The reviewer's walk through the
required-check executor matches the code: a check that throws produces no
result, a required no-result fails, non-zero exit codes fail, and a null or
undersized `suiteCount` fails when `expectedSuiteCount` is set. Nothing to act
on, and it is worth recording that an adversarial reader looked for a
swallow-and-pass here and did not find one.

**Mechanisms assessed as sound.** Each was re-checked and each holds: resume
takes its level, policy, and artifacts from the admission record and the caller
cannot restate them; `effectiveApproval` is correct as a single-gate
calculation, and the defect really was grant *lifetime*, not the strictness
arithmetic; verification status follows exit codes; persistent lock tampering is
handled, including missing, unreadable, and path-escape cases.

**Framing.** Answered in full, and acted on — see finding 1.

---

## What this review cost and bought

Four code changes, two contract amendments, one pending registry entry with a
raised baseline, one open decision for the maintainer, and one fix to the
instrument that writes these prompts. Two of the ten findings were already known
and written down, which is the price of excluding `docs/decisions.md` from the
bundle — and that exclusion is deliberate, because including author reasoning
would tell the reviewer where to look.

The one thing to carry forward: the sharpest finding was item 7, the framing
question, and it was only available because the prompt asked for it.
