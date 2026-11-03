# R13 — Nightly review, as R13a and R13b

**Units:** R13a (M2), R13b (M2)
**R13a depends on:** P14, R2, R17, R22
**R13b depends on:** R13a, R9
**Blocks:** R11 waits on R13b

The `DECOMPOSITION.md` entry for R13 states what the nightly review is for, and
it still binds both units. This spec splits that entry into two units, names
what each delivers, what each leaves out, and what proves each done, and
records the choices the entry leaves open (D-A-NR-01 to D-A-NR-06). It was
checked against the code on `v2` at eb15d11 and confirmed by the maintainer on
2026-11-03.

The split follows the models. R13a's two jobs call no model. R13b's two jobs
each seat a reviewer. Each unit's review bundle then covers one kind of risk:
drift and fail-closed scanning in R13a, and seat independence and untrusted
text in R13b (D-A-NR-01).

---

## What the code holds, verified against it

| Input | Where it is | What it means here |
|---|---|---|
| A schedule fires an `intake-candidate` and nothing else | `api/src/schedule.ts:68`, `intake.fire`; `core/src/trigger/schemas.ts:25`, `TemplateId = 'intake-candidate'` | no job template exists; R13a adds the first, as R22 said a later unit would |
| The `scheduled` field schema carries one field, `schedule` | `core/src/trigger/schemas.ts:72` | a job reads which schedule fired and nothing else from the event |
| The Vault is content-addressed: an object's file name is the SHA-256 of its bytes | `vault/src/local/vault.ts:1-10`, `:113` | re-hashing a record needs no schema; a mismatch is drift |
| Runs are enumerable, and their records are read per run | `vault/src/types.ts:724` `listRuns`; `readDecisions`, `readUsage`, `readIntegration`, `readLocks` | the re-hash walks every run; trigger decisions are read by `readTriggerDecisions` (`:734`) and carry their own `sha256` (`:638`) |
| R2's rates are derived on read and never stored | `api/src/outcomes.ts:322` `outcomes`, `:332` `deriveOutcomes`; no Vault write in the file | there is no published rate to compare against today (D-A-NR-03) |
| A violation names a run, a role, and a driver | `integrity/src/types.ts:217` | drift found at night has no role or driver to name, so it is not an `IntegrityViolation` (D-A-NR-02) |
| A decision record names a run | `vault/src/types.ts:323`, `EnforcementDecision.runId` | a nightly job has no run either; its record sits beside the runs, as R22's refused deliveries do (D-R22-03) |
| R17's scanners pin their images by digest | `adapters/src/security.ts:17-20`, `SecurityScanner.image` is `name@sha256:<digest>` | the nightly sweep runs the same pinned images; policy names which, and cannot name an unpinned one |
| No dependency audit exists | R17's entry leaves it to R13 (`DECOMPOSITION.md`, R17, "Not in this unit"); readiness installs with `--no-audit` (`readiness/src/scan.ts:390`) | R13a builds it |
| Egress can be limited to named hosts | `core/src/policy/types.ts:20`, `network.egress: 'none' \| string[]`; `sandbox/src/local/egress.ts:121` `checkEgress` | the audit's sandbox is granted the advisory host alone |
| A reviewer seat records reduced independence where families cannot differ | `core/src/station/machine.ts:257` `seatReviewer`; grade `'reduced'` (`api/src/outcomes.ts:270`) | R13b seats through the same function |
| R11 does not exist | `DECOMPOSITION.md`, R11, no spec and not started | R13b has no R11 proposal to write (D-A-NR-05) |

---

## R13a — Nightly checks without a model

**Deliver:**

- **Job templates.** `TemplateId` gains `nightly-integrity` and
  `nightly-security`. A schedule names one. The scheduler runs the job in place
  of recording a candidate. A job reads the schedule's id from the event and
  nothing else, seats no model, and never enters the line's build
  (`R22-triggers.md`, "What a trigger does"). Policy validation refuses a job
  template on any kind but `scheduled`.
- **The nightly record.** Each firing writes one `NightlyRecord` beside the
  runs and not under any run. It is write-once and content-addressed, and it
  carries the schedule, the template, the date it covers, the runtime's start
  and end times, the outcome, and the findings. The outcome is `completed` or
  `refused` with a cause, and `collectedBy` is `'runtime'`. A job that could not
  finish is `refused` and is never recorded as finding nothing (I5).
- **Re-hash.** `nightly-integrity` re-hashes every object in the Vault. That
  covers every run's evidence, locks, decisions, usage, and integration
  records, and every trigger decision with its refused-delivery counts. A record
  whose bytes no longer hash to its name, a ref that names a missing object, or
  a lock that no longer verifies is a `record-drift` finding. The finding names
  the run where there is one, the record kind, the expected hash, and the
  observed hash.
- **Rates checked against the last snapshot.** The same job derives R2's rates
  for the window the last snapshot covered, from the re-hashed records, and
  compares them with that snapshot. Any difference is a `rate-drift` finding
  naming the rate and both values. The job then writes tonight's snapshot into
  its record. The first night has no prior snapshot and records that as such,
  never as a match (D-A-NR-03).
- **Security sweep.** `nightly-security` runs R17's secret scan and static
  analysis over the head of the target's default branch. It runs them under
  `deny-all` with the pinned images `verify` uses, and the tree is the only
  mount.
- **Dependency audit.** The same job audits the lockfile in a separate sandbox.
  That sandbox's egress is granted only to the advisory host the policy names,
  and the audit image is pinned by digest. If the host is unreachable, the
  lockfile is missing, or the stack is unsupported, the job records a refusal
  with that cause, never "no findings" (I5).
- **Findings become candidates.** Each security or audit finding becomes an
  `intake` candidate. Its typed fields are the scanner, the rule, the path, and
  the line, under a new field schema, `nightly-finding`. A human admits it like
  any other candidate. The job never opens a change, drafts a fix, or narrows a
  grant (D-A-SC-03).
- **Drift is visible.** `GET /nightly` returns the nightly records. A drift
  finding is also written to P14's record under a new cause, `record-drift`,
  with `decidedBy: 'nightly'` and the run it names. Drift with no run, such as a
  trigger decision, is in the nightly record alone.

**Gate paths:** `packages/core/src/trigger/schemas.ts` (not matched by
`protected-paths.txt`, but a contract file), `packages/vault/src/types.ts`,
`packages/integrity/src/types.ts` if the finding type lands there,
`packages/adapters/src/types.ts` for the audit scanner, and
`packages/conformance/`. The pull request takes `gate-change`, and the squash
merge carries `Gate-Change: acknowledged`.

**Not in this unit:** any model seat, including the findings reviewer and the
whole-tree reviewer, which are R13b's. Also out: a fix, a change, or a pull
request opened from a finding; any narrowing of a run or a grant; an audit for
a stack R1 does not support, which is refused instead; a scanner R17 does not
ship; repairing a drifted record, which is the operator's; a cron grammar; and
a UI over the nightly record.

**Conformance:** `pnpm typecheck`, `pnpm lint`, and `pnpm conformance` pass,
and the report names an assertion for each new row. Each fails when its check
is deleted:

- `I5.nightly-rehash-finds-a-drifted-record`: a byte flipped in one object is a
  `record-drift` finding.
- `I5.nightly-rate-drift-is-found`: a record changed under a snapshot is a
  `rate-drift` finding.
- `I5.nightly-first-snapshot-is-not-a-match`: the first night records that no
  snapshot existed, never a match.
- `I5.nightly-audit-unreachable-is-refused`: an unreachable advisory host is a
  refusal, never zero findings.
- `I4.nightly-audit-egress-is-the-advisory-host-alone`
- `I4.nightly-scan-runs-deny-all`
- `I7.nightly-finding-is-typed-fields`: a candidate carries the schema's fields
  only.
- `I2.nightly-job-opens-no-change`

---

## R13b — Nightly reviewers

**Deliver:**

- **Findings reviewer.** A third job template, `nightly-findings-review`. It
  reads one day of the runtime's records as typed fields, never raw text:
  refusals, parks, violations, failed checks, R22's trigger decisions and
  refused-delivery counts, R13a's findings, and post-merge outcomes where R8
  has recorded them. It seats a read-only reviewer. The reviewer's family
  differs from every author family whose work the day holds. Where that cannot
  hold, the job records reduced independence through `seatReviewer` (I6).
- **Whole-tree reviewer.** A fourth job template, `nightly-tree-review`. It
  seats R9's security reviewer role over the head of the default branch, read
  only, under `deny-all`, with the tree as its only mount. Its family differs
  from every author of merged work since the job's last completed run. Where
  that cannot hold, it records reduced independence.
- **Located findings only.** The runtime refuses a whole-tree finding that does
  not name a file and a line in the tree, and records the refusal rather than
  the finding. A findings-review finding must name a record from the day it
  reviewed.
- **Findings become candidates, and nothing more.** Each finding becomes an
  `intake` candidate. Its typed fields are the location and category, or the
  record it names. The reviewer's text is kept as its claim and never enters a
  later prompt (I7). A human admits it. Neither job changes a run, a grant, or
  a status, and neither narrows anything on its own (D-A-LC-10, D-A-EX-01).
- **The review is recorded.** Each seat's identity, its grade, and its
  findings are in the nightly record. R11 later reads them from there
  (D-A-NR-05).

**Gate paths:** `packages/core/src/trigger/schemas.ts`,
`packages/vault/src/types.ts`, and `packages/conformance/`. The pull request
takes `gate-change`.

**Not in this unit:** R11's proposals and any learning-loop record. Also out:
a review verdict that gates the line, which is M3's; a third model family;
reviewing work merged outside Olympus beyond naming it unattributed; and any
change, fix, or narrowing made from a finding.

**Conformance:** `pnpm typecheck`, `pnpm lint`, and `pnpm conformance` pass,
and the report names an assertion for each new row. Each fails when its check
is deleted:

- `I6.nightly-reviewer-family-differs-from-every-author`
- `I6.nightly-reduced-independence-is-recorded`
- `I7.nightly-reviewer-gets-typed-fields-only`
- `I7.nightly-claim-never-enters-a-prompt`
- `I5.nightly-unlocated-finding-is-refused`
- `I4.nightly-tree-reviewer-is-read-only-deny-all`
- `I2.nightly-review-changes-no-run`

---

## Contract amendments, owed by each unit's pull request

- **A-R13a-01:** `TemplateId` gains `nightly-integrity` and `nightly-security`.
  A job template is valid only on `scheduled`.
- **A-R13a-02:** the Vault gains `recordNightly` and `readNightly`, and the
  `NightlyRecord` type, kept beside the runs.
- **A-R13a-03:** `FIELD_SCHEMAS` gains `nightly-finding`, which takes scanner,
  rule, path, and line.
- **A-R13a-04:** `DecisionCause` gains `record-drift`, decided by `nightly`.
- **A-R13b-01:** `TemplateId` gains `nightly-findings-review` and
  `nightly-tree-review`. `nightly-finding` gains category and record fields.
