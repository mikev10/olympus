# Review request for P4, 2026-09-14

The prompt and bundle provenance for the external adversarial review of the
station machine (`packages/core/src/station/`, the line and entry points in
`packages/api`, the Vault and contract amendments A-P4-01 to A-P4-03, and the
P4 conformance additions).

**The review has not been run yet.** This file records what the reviewer was
asked and what it was given, before it answers. The response, when it comes
back, is stored verbatim in a companion `...-adversarial-review.md`, and what
was and was not acted on in a `...-adversarial-triage.md`.

Committing the request ahead of the response is the point: the prompt is
written by the same system that built the unit, so the mechanisms it names are
the ones that system thought about, and a bypass nobody considered lives in a
mechanism nobody listed. Publishing the framing lets a reader judge whether the
reviewer was steered, and lets anyone check afterwards that the findings were
not selected to match it. The prompt's own item 7 invites the reviewer to
reject the framing outright.

## Bundle

- **Base:** `cea985c` (`reviewed/P3`), head `296e28d` (the tip of `unit/p4`,
  pull request #5).
- **Range:**
  - `54ad4d1` Revert "P3: track the review bundle, by named exception"
  - `50102db` docs: review bundles are tracked, and live in docs/reviews/
  - `ae1a16e` ci: the protected-paths guard covers direct pushes to v2, not only PRs
  - `4dd914c` docs: P4 gains the five parts it lacked, and names the amendments it needs
  - `fa04acf` A-P4-01: StationRefusal gains the approval and seat arms; parked closes
  - `5f071c5` A-P4-02, A-P4-03: record review seats and admissions; make run state resumable
  - `296e28d` P4: Station machine
- **The first three commits are the maintainer's, landed on `v2` after
  `reviewed/P3` was tagged.** The skill diffs from the tag, so their files
  (`.claude/skills/*`, `.github/protected-paths.txt`,
  `.github/workflows/protected-paths.yml`, `.gitignore`) are in the bundle beside
  P4's. They are unreviewed gate changes, and this review covers them too.
- **File:** `2026-09-14-P4-station-machine-review-bundle.txt`, beside this one
  and tracked, 7666 lines, 360872 bytes.
- **SHA-256:** `a8e261164b6b91d812225704615966a81727d6375315fefade27d90886bb0b47`
  — and the hash, not the tracked copy, remains the authority. A copy can be
  edited; the hash, with the base and head commits beside it, lets anyone
  regenerate the bundle and prove it is the one that was sent.
- **Contents:** the full contents of every tracked file changed in that range,
  not diff hunks. Forty-seven files:

```
.changeset/a-p4-amendments.md
.changeset/p4-station-machine.md
.claude/skills/review-request/SKILL.md
.claude/skills/triage-review/SKILL.md
.github/protected-paths.txt
.github/workflows/protected-paths.yml
.gitignore
packages/api/src/index.ts
packages/api/src/line.ts
packages/api/src/run.ts
packages/api/src/safety.ts
packages/api/src/validate.ts
packages/api/test/admission.test.ts
packages/api/test/fixtures/hello/acceptance.md
packages/api/test/fixtures/hello/graph.json
packages/api/test/fixtures/hello/spec.md
packages/api/test/fixtures/hello/verify.json
packages/api/test/harness.ts
packages/api/test/line.test.ts
packages/api/test/safety.test.ts
packages/api/test/wrappers.ts
packages/conformance/fixtures/types/i3/test-design-context-is-the-locked-spec.ts
packages/conformance/fixtures/types/i5/transition-has-no-warn-and-continue.ts
packages/conformance/fixtures/types/i6/review-context-excludes-author-material.ts
packages/conformance/pending-baseline.json
packages/conformance/src/registry/i1.ts
packages/conformance/src/registry/i2.ts
packages/conformance/src/registry/i3.ts
packages/conformance/src/registry/i4.ts
packages/conformance/src/registry/i5.ts
packages/conformance/src/registry/i6.ts
packages/conformance/src/registry/line-assertions.ts
packages/conformance/src/registry/line.ts
packages/conformance/src/registry/local-vault.ts
packages/conformance/test/registry.test.ts
packages/core/src/index.ts
packages/core/src/run/types.ts
packages/core/src/station/contracts.ts
packages/core/src/station/machine.ts
packages/core/src/station/types.ts
packages/core/test/station-machine.test.ts
packages/vault/src/local/vault.ts
packages/vault/src/stub/vault.ts
packages/vault/src/types.ts
packages/vault/test/local.test.ts
packages/vault/test/stub.test.ts
```

- **Excluded, by construction:** `docs/decisions.md` carries author reasoning
  and prior review outcomes, and a reviewer reading it inherits conclusions
  already reached and stops questioning them. `docs/reviews/` holds what
  earlier reviewers found. `docs/plan/` is the spec the code is judged against;
  the reviewer gets the invariants restated in the prompt instead. So
  `docs/plan/DECOMPOSITION.md`, which is in the commit range, is **not** in the
  bundle. Nothing from `.plan/` is included; the two section-header guards in
  the `review-request` skill both returned `0`.
- **Not in the bundle because unchanged:** files the changed code calls but this
  range did not touch, among them `packages/core/src/policy/engine.ts`,
  `packages/core/src/driver/contract.ts`, `packages/integrity/src/types.ts`, and
  `packages/sandbox/src/types.ts`. A finding that depends on one of them is
  checked against the file at triage.

## Reviewer

To be filled in when the response arrives, with the family captured at
handover. The requirement set at request time: a temporary chat with no memory
or history, no repository access, and a **different model family** than the
last reviewer. ChatGPT reviewed F3 and S1; Gemini reviewed P1 and P2; Grok
reviewed P3 once, and P3's second review has no recorded family. Grok is out of
the rotation by maintainer preference, so the pool is ChatGPT and Gemini, and
Gemini is the more recent of the two.

## The prompt, verbatim

```
The code under review is in the attached file `olympus-P4-review.txt` — the
full contents of every changed file, with the commit range at its top. If that
file is not present in this conversation, stop and say so; do not review from
the description below alone.

You are reviewing the station machine of a TypeScript software-factory runtime:
the contracts for each station a job passes through, the pure logic that decides
transitions, approvals, and review seats, and the code that runs a job's stations
over a tamper-evident store, a sandbox, and model drivers, including admission,
resume after a stop, and recording a human approval. You have the source and
nothing else — no design documents, no author reasoning, no prior version, no
conversation that produced it.

If you hold any prior context about this project from earlier conversations,
stored memory, or anything you have seen before, set it aside. Do not search
for the project or its author.

CONTEXT YOU NEED

A run moves through eight stations in order: intake, spec, test-design, plan,
build, verify, review, integrate. Before a model builds anything, the runtime
hashes the artifacts the work will be judged by (spec, acceptance tests,
verification manifest, task graph) into a store called the Vault; a model then
builds each task in a sandbox, the runtime runs the checks itself, a reviewer
model from a separate driver reviews the work, and each station exit is gated by
an approval that policy sets per station and autonomy level. A run can be
stopped at any point and resumed later from what the Vault holds, and a human
approval is recorded between runs. Autonomy levels are L0 manual, L1 supervised,
L2 delegated, L3 autonomous. The components shipped in this repository are stubs
that declare themselves unsafe, and the runtime refuses any run above L1 while a
declared-unsafe component is present.

It must hold against a capable, motivated party trying to advance a run past a
gate it has not passed, or to come back from a stop with authority, budget, or
context the run was not admitted with. That party controls what the model
returns, the files in the workspace the model works in, the arguments to the
exported entry points (startRun, resumeRun, approveStation), and when the
process stops. It does not control code running inside the runtime's own
process. Assume no deceptive intent — only that the easiest path gets taken.

The invariants at stake:

- I1: No agent writes to the Vault, at any autonomy level, in any role.
- I2: The runtime derives status; the model never reports it. A model's account
  of its work is a claim, stored separately from evidence.
- I3: An agent may not be judged by an artifact it can write. Specs and
  acceptance tests are hashed before build and re-verified at every station
  transition.
- I4: Default deny. A capability not granted in policy is not available.
- I5: Fail closed. A missing required check, an absent driver capability, an
  unsupported stack, or a shrunken suite is a refusal — never a silent degrade,
  never a warning that lets the run continue.
- I6: Reviewers never share the author's model family. At L0-L2, when only one
  family is available, a same-family reviewer may be seated and the run must
  record reduced independence rather than claim the guarantee. At L3 a
  same-family reviewer is refused and the run does not advance.

The mechanisms that matter most:

- nextStep (packages/core/src/station/machine.ts) chooses every step from the
  committed run state alone, and the line (packages/api/src/line.ts) commits
  after each step; resumeRun enters the same loop, reading the level, policy,
  and artifacts from a write-once admission record.
- Lock re-verification before each task step, after the checks, and on each
  station exit, plus each locking station's comparison of the lock against the
  hash taken at admission.
- transition and effectiveApproval (the stricter of the contract's own approval
  and the policy cell), and approveStation's rule for which grant it records.
- seatReviewer, run before and after the reviewer model, and grantedContext,
  which filters what the reviewer's request is built from; plus the capability,
  policy, and request checks in startRun before anything is written.

EXPLICITLY OUT OF SCOPE FOR THIS UNIT

- the work inside a station beyond what moving a run needs. No prompts or role definitions (P5, M2): `spec`, `test-design`, and `plan` lock artifacts the caller placed in the workspace rather than asking a model to write them, and `plan` validates and locks the task graph it is given
- verification beyond S1's check execution, suite enumeration, and the claim/evidence diff (P6); tamper analysis (P7). `SKELETON_LINE` keeps the two lines that describe those and loses the two this unit pays, so a run above L1 is still refused until P6
- `integrate`'s merge and pull request (I1); a run ends at `integrate`. `observe` and `learn` get contracts and are never entered
- the multi-seat review panel (M3); a contract with `requiresPanel: true` is refused, not seated with one reviewer
- parallel task execution and conflict retries: tasks run one at a time in dependency order. A known limit, not a registry entry; no invariant rests on parallelism
- enforcing a role's `writableGlobs` inside the workspace. It needs the runtime-collected diff, which P6 produces. Owed as `I4.writable-globs-enforced-on-the-diff` (D-P4-01)
- compositional provenance for unsafe declarations (D-S1-07). It becomes necessary when `SKELETON_LINE` is deleted, which P6 does. Owed as `I5.unsafe-declaration-survives-composition` (D-P4-01)
- policy file loading and the HTTP surface for approve, cancel, and status (P9); unparking a parked task (P9)

(P5-P9, M2, M3, and I1 above are later units of work; the D- and S1 references
name records you do not have. Treat each item as a statement of what this code
deliberately does not do.)

THE QUESTION

Given control of the model's output, the workspace files, the entry-point
arguments, and when the process stops, how would you get a run past a gate it
has not passed — an approval nobody granted, a check it failed, a locked
artifact it changed, a reviewer of its own family at L3, a reviewer that sees
the author's own account, a bound on its attempts — or resume it with a higher
level, a different policy, other artifacts, or fresh attempt counts?

Report concretely:

1. Places where the mechanism can succeed while the property it protects is
   violated. Give the specific construction.
2. Checks that are tautological — that would pass regardless of the code under
   test.
3. Anything that fails open: an error, a missing file, an empty result, a
   skipped test, or a thrown exception yielding a pass.
4. Escape hatches specific to the language: casts, unknown, any, declaration
   merging, module augmentation, generic erasure, type predicates.
5. Ways the configuration can be satisfied without doing what it appears to do.
6. Which mechanisms you assess as sound, and why. If none are, say so.
7. Whether the framing above is right. If the adversarial question is the wrong
   question for this code, say so and explain what you would ask instead. That
   is a finding, not a digression.

HOW TO REVIEW

- Report what you find. Do not aim for a count, and do not manufacture findings
  to appear thorough.
- Label each as: factually wrong / unclear / a tradeoff I would have made
  differently.
- Cite file and line.
- State confidence where uncertain, and what you would check to resolve it.
- Do not defer to the code's own comments. A comment asserting a property is
  not evidence the property holds.

OUTPUT

Per finding: file:line — type — severity (high/medium/low) — the concrete bypass
or issue — what would resolve it.

Order by severity, highest first. State at the top whether you had any prior
context and whether you performed any lookups.
```
