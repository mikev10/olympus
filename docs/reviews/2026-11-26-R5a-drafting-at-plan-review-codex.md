# External review of R5a, codex, 2026-11-26

R5a (drafting at `plan`), reviewed from the bundle alone. The triage of this reply
and Gemini's is `2026-11-26-R5a-drafting-at-plan-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a
  read-only sandbox, with recorded approval policy `never`, in an empty scratch
  working directory and a scratch config home holding only `auth.json`, with an
  environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's
  `cleanRoom`.
- **Cross-family agreement:** none. Its one finding (a builder's tree holds the
  locked graph file) was not raised by Gemini, and it raised neither of Gemini's
  two.
- **Date:** 2026-11-26
- **Bundle:** `2026-11-26-R5a-drafting-at-plan-review-bundle.txt`, SHA-256
  `754837ca862f486d2c06d9c26b740c359f5c355f19609ad2dadf410d4917caa1`, base `e3e851c`
  (`reviewed/R58`), head `be7353a` (R5a's tip before the review files). It held 52
  changed files: R5a's, and the one change merged since R58's review (the
  local-check tooling, #250). `docs/decisions.md`, `docs/reviews/`, `docs/plan/` and
  `pnpm-lock.yaml` were excluded. Prompt:
  `2026-11-26-R5a-drafting-at-plan-review-prompt.txt`.
- **Prior context and lookups:** it said it had no prior project context and made
  no external lookups, that a local file-listing command was blocked, and that it
  ran no tests. This is a self-report and cannot be verified independently.
- **Coverage, and any gap:** items 1, 2, 3, 4, 6 and 7 were answered: one
  construction; no tautological assertion, with the objective assertion called too
  narrow; no fail-open path found; no language escape hatch found; five mechanisms
  assessed sound; the framing called right, with an extension. Item 5 (ways the
  configuration can be satisfied without doing what it appears to do) was not
  answered. It said it could not assess `worstCaseCost` or `reviewView`, which the
  bundle did not show whole. Silence is not an endorsement.
- **Citations:** line numbers are positions in the bundle's diffs, not in the
  repository. Each was treated as a hint to the function it names.

---

BASE: reviewed/R58  
HEAD: be7353a  
scripts/test/local-check.test.ts  
7a919b4984e35f27d118c217e250f51f

I had no prior project context and performed no external lookups. I reviewed the bundle supplied in the prompt. A local file-listing command was blocked; I ran no tests.

1. **packages/api/src/line.ts:1607 — factually wrong — high — Objective filtering does not withhold objectives from other builders’ workspaces.**

   `taskGraphGrant` filters the prompt correctly, but `lockApproved` writes the **complete recorded graph file into the base**, including every objective and any extra JSON fields (`packages/api/src/drafting.ts:1004`). Builders subsequently materialize their working trees from that base and accepted changes, then copy them into their workspaces (`packages/api/src/line.ts:1640`).

   **Construction:** Draft two independent tasks, `a` and `b`, under an ordinary builder role with repository-reading tools. Put instructions intended for `b` in `a.objective`. After approval, builder `b` reads `.drafts/<run id>/graph.json` directly. It obtains `a`’s objective despite having no dependency on `a`. No tampering, ungranted role, extra task, or dishonest runtime component is necessary.

   The sensitive-path check does not close this: graph drafts matching sensitive paths are rejected, rather than selectively withholding objectives. Prompt filtering and filesystem access are separate channels.

   The conformance assertion `OBJECTIVE_REACHES_THE_BUILDER` checks builder prefixes and reviewer request strings, but never examines their workspaces. It therefore passes with this exposure present. By contrast, the neighboring discarded-file assertion actually checks workspace contents.

   **Resolution:** Keep the canonical graph in runtime-controlled storage and exclude it from seat workspaces. Give builders only the authorized projection through their context or a separately materialized file. Add an assertion that an unrelated builder cannot read another task’s objective from any mounted file, with a positive control proving its own objective remains available.

   **Confidence:** High for builder-to-builder objective exposure. I cannot establish reviewer filesystem exposure because `reviewView` is not included; its filtering needs separate inspection.

Several mechanisms appear sound within the supplied implementation:

- **Draft shape and scope:** `packages/api/src/planning.ts:50` checks task count and role membership, then delegates station, dependency, uniqueness, cycle, and objective validation to `parseGraph`. Runtime-created review tasks cover every accepted build task.
- **Approval and locking:** `packages/api/src/drafting.ts:963` operates on recorded draft bytes, revalidates the graph, and verifies lock hashes before applying it. Changing the planner’s original working file afterward does not replace those bytes.
- **Task creation order:** `packages/api/src/line.ts:339` creates drafted graph tasks only after `lockApproved` succeeds. `stepGraph` throws when a graph is absent past planning, instead of treating absence as completed work.
- **Critic independence:** `packages/api/src/drafting.ts:859` checks runtime-resolved identities; the later weaker-grade calculation prevents a reported identity from upgrading independence.
- **Default deny:** `packages/api/src/run.ts:1250` refuses drafting without a planning grant. Admission checks all permitted build roles, including roles absent from the costliest synthetic graph.

These are static assessments, not execution results. In particular, the implementation of `worstCaseCost` is absent, so I cannot independently verify its call-count arithmetic or conclude that actual spending is bounded by the approved figure.

I found no demonstrated planner-controlled TypeScript cast, declaration-merging, or generic-erasure bypass. Those require influence over runtime code or objects that this threat model excludes. Nor did I identify a wholly tautological new assertion or a demonstrated exception-to-pass path in the planning runtime; the objective assertion instead checks too narrow a surface.

The adversarial framing is appropriate. Its crucial extension is to ask **what a seat can read through every channel**, including its filesystem—not only what the runtime places in its prompt.