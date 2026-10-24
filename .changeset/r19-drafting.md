---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"olympus-ai": minor
"@olympus-ai/compiler": minor
"@olympus-ai/conformance": minor
---

R19: drafting at `spec` and `test-design`. A run admitted with a person's
intent and no spec, or with no acceptance tests, drafts them on the line: a
drafter writes, the runtime records the bytes it read under one hash, the base
run runs a test draft, an independent critic reads it, and the exit's approval
carries the drafted floor; what is approved is written into the artifact root
and the base and locked against that hash (D-A-DS-01 to D-A-DS-07, D-R19-01 to
D-R19-20, A-R19-01 to A-R19-10).

- core: `spec` and `test-design` are agent stations with drafter contracts;
  `CRITIC_CONTRACTS` holds the critic seats. `ContextGrant` gains `intent`,
  `draft`, `rubric`. `ReviewSeat.independence` is an `IndependenceGrade`
  (`different-family`, `different-model`, `same-model`). `effectiveApproval`
  takes the drafted floor; `ApprovalGrant` and the transition match a grant
  by key, draft hash, and attempt. `RunState.drafts` records each station's
  attempts. `ParkCause` gains `drafts-rejected`; `StationRefusal` gains
  `same-family-drafter`. New: `seatTask`, `seatTestDrafter`, `gradeOf`,
  `retrySuffix`, `grantedCriticContext`, `DRAFT_ROLES`.
- vault: `AdmissionRecord` holds each artifact as supplied or drafted, the
  acceptance manifest, the two new spec parts, the intent, and the rubrics.
  New operations `recordIntent`, `recordRubric`, `recordDraft`,
  `recordCriticResult`, `recordDraftLock`, `readLocks`. Base records are kept
  once per run and draft hash (`readBaseRun(runId, draft)`). New decisions
  `approval-rejected`, `draft-sent-back`, `draft-floor-applied`. A record or
  state written before R19 reads as it did.
- api: `RequestedArtifacts` takes `'draft'`, an acceptance manifest, and the
  run-requirements and questions parts; `RunRequest` takes `intent` and
  `rubrics`; `ComponentGraph.drafting` names each seat's driver.
  `approveStation` takes the draft hash; `rejectDraft` is new. A run's
  standing names the draft a person decides. The worst case counts every
  drafting seat. R2's rates gain grade keys. Default rubrics ship as
  `DEFAULT_RUBRICS_DIRECTORY`. HTTP: `POST /runs` takes `intent`,
  `POST /runs/:id/approve` takes `draft`, and `POST /runs/:id/reject` is new;
  the host reads `FACTORY_RUBRICS_DIR`.
- cli: `create` takes `--draft-spec`, `--intent`, `--draft-tests`,
  `--acceptance-manifest`, `--run-requirements`, and `--questions`;
  `approve` takes `--draft`; `reject` is new.
- compiler: ships the `spec-drafter`, `spec-critic`, `test-drafter`, and
  `test-critic` roles.
- conformance: one assertion for each of R19's conformance sentences, P14's
  table rows for the new decisions, and I1's operation set at twenty-four.
