# R19 — Drafting at `spec` and `test-design`

**Unit:** R19 (M2, maintainer)
**Depends on:** P4, P5, P9, P13, P14, R14, R15, R17, R20
**Blocks:** R7 and R16 read what this unit records.

The `DECOMPOSITION.md` entry is binding and is not repeated here. This spec
is what the entry rests on, checked against the code on `v2` at cd1b536, and
the choices the entry leaves open, each recorded in `docs/decisions.md`
(D-R19-01 onwards). The maintainer delegated every decision in this unit to
the session's recommendation (2026-10-23).

---

## What the code holds, verified against it

| Input | Where it is | What it means here |
|---|---|---|
| Artifacts admitted as paths, every one required | `api/src/run.ts`, `RequestedArtifacts`, `admitArtifacts` | an array is the only shape; nothing can say "drafted" |
| `spec` and `test-design` are runtime stations | `core/src/station/contracts.ts`, `AGENT_STATIONS = ['build', 'review']` | they lock what was admitted (`api/src/line.ts`, `work`) and seat nothing |
| The Vault resolves locked paths against one artifact root | `vault/src/local/vault.ts`, `LocalVault.lock`; the host passes the repository (`api/src/host/compose.ts`) | approved draft bytes must be written there before they are locked, and a re-lock is refused, so a lock the drive took before a stop must be readable to be resumed |
| One base record per run | `vault/src/types.ts`, `recordBaseRun`, `readBaseRun(runId)` | R15's record is write-once per run, keyed by nothing else |
| Independence is two-valued | `core/src/station/types.ts`, `ReviewSeat.independence: 'independent' \| 'reduced'` | no grade between them |
| Approvals match by key alone | `core/src/station/machine.ts`, `transition`; `run.ts`, `approveStation` | a grant cannot name what it approved |
| A park names a task | `StationRefusal` `parked` arms | a draft has no graph task |
| The run's base digest is fixed at admission | `run.ts`, `resumeRun` compares the store's base to `AdmissionRecord.baseTreeSha256` | an approved draft written into the base would fail a resume |
| Roles are pinned at admission | `run.ts`, `admitRoles`; shipped roles `compiler/roles/builder.md`, `reviewer.md` | the drafting roles are files beside them, and admission refuses a seat without one |
| Worst-case cost counts graph tasks only | `api/src/cost.ts`, `worstCaseCost` | drafter and critic calls are not in the approved figure |
| `VaultRefKind` already has `rubric` | `core/src/run/types.ts` | no store or record writes one |

---

## Deliverables

- **Admission says what is drafted.** `RequestedArtifacts.spec` and
  `.acceptanceTests` are each a list of paths or the literal `'draft'`.
  `RunRequest` gains `intent` (a person's text, or null) and `rubrics` (the
  host's rubric directory, or null). A drafted spec needs an intent; an intent
  with a supplied spec, or neither, is refused. Drafted tests need the spec's
  run-requirements part, admitted or drafted. The admission record holds each
  artifact as `{ source: 'supplied', … }` or `{ source: 'drafted' }`, the intent
  and each rubric by reference, and an acceptance manifest that is supplied,
  drafted, or `none`.
- **Seats.** A drafted station seats its drafter and its critic, each a task
  of run state with a fixed id (`spec.drafter`, `spec.critic`,
  `test-design.drafter`, `test-design.critic`) under a fixed role
  (`spec-drafter`, `spec-critic`, `test-drafter`, `test-critic`), so attempts,
  retries, starts, usage, and parks are counted exactly as a build task's are.
  `ComponentGraph.drafting` names the driver of each seat; a drafting run
  without it is refused.
- **Drafting.** The spec drafter runs over a fresh copy of the base and writes
  `.drafts/<run id>/` `spec.md`, `security.json`, `run-requirements.json`, and
  `questions.json`. The test drafter runs over a tree holding the locked spec
  and nothing else, with no egress beyond the model relay, and writes test
  files under the spec's `testDirectory` and `.drafts/<run id>/acceptance.json`.
  The runtime reads those paths alone, hashes the bytes it read, and records the
  draft. Nothing else the seat wrote leaves its workspace.
- **Runtime problems.** A drafted spec whose parts do not parse, or a drafted
  manifest that admission would have refused, or a test path the base already
  holds, is sent back with the problems' paths and codes, as the runtime's own
  findings.
- **The critic.** Seated over the recorded bytes, read-only, with the drafter's
  grants plus the draft and the rubric. Its result is the final message:
  `{"findings": [string, …]}`. Anything else counts as one finding. Graded
  against the drafter; `same-model` seats no critic.
- **The base run per draft hash.** `test-design` runs R15's base run over the
  base plus the draft's files, and records it under the draft's hash. A
  mismatch sends the draft back carrying one fact: that the draft did not hold
  over the repository, never which check or its exit code (A-R19-11). The
  record keeps each check's id, declaration, and exit code or a fixed cause,
  for a person.
- **The gate.** The runtime evaluates the station's conditions, records them
  in run state with the attempt, and `effectiveApproval` applies the drafted
  floor. A grant names the draft's hash and attempt, and is matched on both.
- **Approval, rejection, park.** `approveStation` takes the draft's hash.
  `rejectDraft` records a person's rejection with notes at `spec` or a reason
  from a fixed set at `test-design`. A third attempt sent back goes to a
  person; a person's rejection of the third parks the run with
  `drafts-rejected`, naming the station.
- **The lock.** On a passed gate the runtime writes the approved bytes into
  the artifact root and the base snapshot, records the draft lock with the new
  base digest, and locks the paths against the approved hashes. A resume reads
  the latest digest from that record.
- **Grades.** `different-family`, `different-model`, `same-model`, derived
  from resolved models for every compared pair, the review seat's included.
  R2 keys its false-done rate, autonomy ratio, and drafts sent back by grade.
- **Cost.** `worstCaseCost` counts every seat a drafted station may seat.
- **Roles and rubrics.** Four role files beside `builder` and `reviewer`;
  default rubrics `spec.md` and `test-design.md` in `@olympus-ai/api`.
- **The principal's channel.** `POST /runs` takes `intent` and `'draft'`;
  `POST /runs/:id/approve` takes the draft hash; `POST /runs/:id/reject` is new;
  a run's standing shows the draft, its failed conditions, and the critic's
  findings. The CLI gains `--intent`, `--draft-spec`, `--draft-tests`, and
  `reject`.

## Contract amendments, landed in this unit's pull request

- **A-R19-01** `RequestedArtifacts.spec` and `.acceptanceTests` take `'draft'`;
  `.acceptanceManifest` and `.specParts.runRequirements` / `.questions` are new
  and optional. `RunRequest` gains `intent: Intent | null` and
  `rubrics: string | null`. `AdmissionRecord.artifacts.spec` and
  `.acceptanceTests` become `AdmittedSet`; it gains `acceptanceManifest`,
  `specParts.runRequirements` and `.questions`, `intent`, and `rubrics`.
- **A-R19-02** `AgentStation` gains `spec` and `test-design`. Their contracts
  require `parallelism`, grant `intent` and `base-repo-readonly` at `spec` and
  the locked spec alone at `test-design`, write `.drafts/**` and `**`, and allow
  three iterations. `CRITIC_CONTRACTS` holds the critic seats; the
  `test-design` critic is granted the locked spec, the draft, and the rubric.
  `ContextGrant` gains `intent`, `draft`, `rubric`. `RetryPart` types the
  variable suffix of a retry.
- **A-R19-03** `effectiveApproval` takes the drafted floor; `TransitionInput`
  carries the draft's hash, attempt, and failed conditions.
- **A-R19-04** `ApprovalGrant.draft`, `ApprovalRequest.draft`;
  `DecisionCause` gains `approval-rejected`, `draft-sent-back`,
  `draft-floor-applied`; `approval-granted` carries the draft;
  `approval-refused` gains `draft-mismatch` and `draft-invalid`.
- **A-R19-05** `ParkCause` gains `drafts-rejected`; its `parked` arm names the
  station and no task.
- **A-R19-06** `RunState.drafts` records each station's attempts.
- **A-R19-07** `Vault` gains `recordIntent`, `recordRubric`, `recordDraft`,
  `recordCriticResult`, `recordDraftLock`, and `readLocks`; `VaultRefKind`
  gains their kinds. I1's closed operation set is updated.
- **A-R19-08** `BaseRunRecord.draft`; `recordBaseRun` is write-once per run and
  draft hash; `readBaseRun(runId, draft)`.
- **A-R19-09** `ReviewSeat.independence` is an `IndependenceGrade`.
- **A-R19-10** `SpecPart` gains `run-requirements` and `questions`.

## Out of scope

The entry's list, verbatim in `DECOMPOSITION.md`: drafting at `plan`; the
role format, compiler, and renderer; `auto` on a drafted artifact at L3;
reviving a parked run; a drafter for the rest of the verification manifest;
R16's bug-fix intent. Also: a second driver (R6, Codex). With one driver the
conformance suite proves the grades with stub families, and a real run sends
every draft to a person.

## Acceptance criteria

```
pnpm typecheck
pnpm lint
pnpm test
pnpm conformance
```

Every conformance sentence in the entry is one assertion in
`packages/conformance/src/registry/drafting.ts`, each run over the real line,
the real filesystem Vault, and stub drivers whose families the assertion sets.
