# Review request for P3, 2026-09-11

The prompt and bundle provenance for the external adversarial review of the
policy engine (`packages/core/src/policy/`, its package tests, and the P3
conformance additions).

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

- **Base:** `f1127eb` (`reviewed/P2`), head `6dd2688` (the tip of `unit/p3`).
- **Range:**
  - `2ac7e33` docs: P3 gains the five parts it lacked, and the tools gap splits in two
  - `6dd2688` P3: Policy engine
- **File:** `olympus-P3-review.txt`, 2141 lines, 95774 bytes.
- **SHA-256:** `df7302c997cf419c479a7f2d0dd756c2ca24f91613fc4a202163a1e954612afe`
- **Contents:** the full contents of every tracked file changed in that range,
  not diff hunks — a reviewer hunting for bypasses needs the surrounding
  context, and a hunk hides it. Thirteen files:

```
.changeset/p3-policy-engine.md
packages/conformance/fixtures/types/i4/tool-grant-requires-an-inventory.ts
packages/conformance/pending-baseline.json
packages/conformance/src/registry/i4.ts
packages/conformance/src/registry/i5.ts
packages/conformance/src/registry/policy.ts
packages/core/src/index.ts
packages/core/src/policy/constants.ts
packages/core/src/policy/default.ts
packages/core/src/policy/engine.ts
packages/core/src/policy/validation.ts
packages/core/test/policy-engine.test.ts
packages/core/test/policy-validation.test.ts
```

- **Excluded, by construction:** `docs/decisions.md` carries author reasoning
  and prior review outcomes, and a reviewer reading it inherits conclusions
  already reached and stops questioning them. `docs/reviews/` holds what
  earlier reviewers found. `docs/plan/` is the spec the code is judged against;
  the reviewer gets the invariants restated in the prompt instead. So
  `docs/plan/DECOMPOSITION.md`, which is in the commit range, is **not** in the
  bundle. Nothing from `.plan/` is included; the two section-header guards in
  the `review-request` skill both returned `0`.

## Reviewer

To be filled in when the response arrives. The requirement set at request time:
a temporary chat with no memory or history, no repository access, and a
**different model family** than the last reviewer. ChatGPT reviewed F3 and S1;
Gemini reviewed P1 and P2. The P2 review did not rotate and said so in its own
header, so agreement between P1 and P2 is one opinion sampled twice. A third
family is owed here.

## The prompt, verbatim

```
The code under review is in the attached file `olympus-P3-review.txt` — the
full contents of every changed file, with the commit range at its top. If that
file is not present in this conversation, stop and say so; do not review from
the description below alone.

You are reviewing the policy engine of a TypeScript project. You have the
source and nothing else — no design documents, no author reasoning, no prior
version, no conversation that produced it.

If you hold any prior context about this project from earlier conversations,
stored memory, or anything you have seen before, set it aside. Do not search
for the project or its author.

CONTEXT YOU NEED

This code decides what an autonomous agent is allowed to do. An operator
authors a policy document declaring, per role, which of ten pipeline stations
the role may act at, which tools it holds, whether it has network egress, and
how much autonomy it may be granted. The engine validates that document,
resolves it into the total form the runtime consumes, and answers two questions
at run time: may this role act at this station, and at what autonomy level.
Nothing else in the system decides what is permitted; a capability the engine
reports is a capability the agent gets.

It must hold against a capable, motivated party trying to obtain an ungranted
capability — a tool, a station, an egress host, a trigger kind, or an autonomy
level above the cap. Assume no deceptive intent — only that the easiest path
gets taken.

The invariants at stake:

I4 — Default deny. A capability not granted in the policy is not available.
Adding one is an explicit, versioned edit to a policy file. Anything the
document did not state must not be reachable through resolution, through a
default, or through a value the validator let past.

I5 — Fail closed. A missing required check, an absent capability, an
unsupported input, or a malformed declaration is a refusal — never a silent
degrade, never a warning that lets the run continue. Specifically: an autonomy
request above the applicable cap must be refused and must never be answered
with a lower level, because a caller that receives a level it did not ask for
proceeds believing it was granted what it requested.

I7 — Event payloads are data, never instructions. Untrusted text never reaches
a prompt. Triggers select pre-declared templates; a payload supplies parameters
only and can never name a template. The trigger section of the policy document
is where those templates are pre-declared.

The mechanisms that matter most:

- `validatePolicyDocument` (validation.ts) narrows an already-parsed `unknown`
  to a typed document: unknown keys at any nesting level, out-of-domain values,
  and malformed `station:level` approval keys are refusals, and an accepted
  document is rebuilt field by field rather than passed through.
- `resolvePolicy` (engine.ts) turns the sparse authored document into the
  resolved form, filling all forty `station:level` approval keys, deep-copying
  and freezing the result. It carries a runtime totality check and one type
  assertion.
- `resolveAutonomy` and `resolveCapabilities` (engine.ts) do the cap arithmetic
  over three bounds — a global cap, an optional per-station cap, and a
  per-role ceiling — plus the role and station lookup, returning frozen copies
  of any scope they grant.
- `validateToolGrants(policy, inventory)` (engine.ts) checks each granted tool
  against an inventory of tools that actually exist; the inventory is a
  mandatory second parameter.

EXPLICITLY OUT OF SCOPE FOR THIS UNIT

- The YAML parser and file loading. The engine's input is an already-parsed
  value, so no package gains a third-party runtime dependency here. The loader
  and its hardening are owed to a later unit.
- The driver-side tool inventory. `validateToolGrants` takes the inventory as a
  mandatory argument; nothing in this repository can yet produce a real one,
  because the driver capability type holds feature flags and no tool list.
- The station machine's consumption of a resolved policy; writing or hashing a
  policy into the vault; role definitions and the role compiler, so the shipped
  default carries an empty `roles` map; approval *evaluation* — this unit
  resolves the forty-key table and a later unit reads it; trigger admission; a
  CLI surface for policy; any modification to the contract type files.

Absent work listed here is not a defect.

THE QUESTION

How would I obtain a capability this policy does not grant? Construct the
specific path: a document the validator accepts that grants more than it
appears to, a resolution step that widens a grant, a lookup that returns a
scope it should have refused, an autonomy request answered with a level rather
than a refusal, or a granted value a caller can mutate into a wider one.

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

## What the unit itself flagged for a second opinion

Carried from the pull request body, because the reviewer does not receive it
and a reader of this file should know what the author already doubted:

- `totalApprovals` carries the unit's only type assertion. Building a total
  `Record<ApprovalKey, ApprovalOutcome>` key by key is not expressible without
  one. It is guarded by a runtime count check that throws rather than returning
  a partial table.
- `frozenCopy` discards `Object.freeze`'s `readonly` return so the declared
  mutable array type survives while the value is frozen.
- D-P3-06: whether an omitted station cap should mean "no cap" or L0.
- The `__proto__` refusal in role ids guards nothing currently reachable,
  because `Object.fromEntries` stores such a key as an own property.
