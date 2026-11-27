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