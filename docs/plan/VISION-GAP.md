# Vision gap: from idea to production

Status: **draft for the maintainer's review**, 2026-11-13. This is a gap
analysis and a proposed direction. It changes no unit, contract, or invariant
by itself. Every change it proposes to the spine or DECOMPOSITION.md is an
amendment that waits for the maintainer's confirmation (CLAUDE.md rule 6).

## 1. Why this exists

The first real use of v2 (2026-11-12, run `40609434` on the maintainer's
`My-recipes` repository) proved the engine: spec and tests locked, build in a
sandbox, checks, two independent reviews, a PR opened and merged, for $0.09.
It took a full guided session, six blocking bugs, and hand-written JSON to
get there. The engine is real. The path to it is not usable, and most of the
journey the mission describes is not planned.

The mission (CLAUDE.md) is a fully autonomous software factory that
**defines, builds, and ships** working code. The maintainer's statement of
the vision, in their words: *a user should be able to go from idea to working
production code very easily.* This document records what that means, where
the plan stands against it, and the order to close the gap.

## 2. The principle that governs everything below

**Ease strengthens the engine; it never softens it.** Every capability added
for ease — plain-English briefings, idea intake, deploy, a non-engineer
audience — sits on top of the same runtime and passes the same gates. No
mode, persona, or front door may skip a check, lower a threshold, widen a
grant, or let a model report status. A non-engineer gets the same rigor as a
mature engineering team, explained more simply. The ten invariants in the
spine are unchanged by this document.

## 3. Who it is for

Two audiences, one product:

- **Mature software companies.** They want the trust engine: policy, locked
  tests, cross-family review, an audit trail, L0–L3. They read diffs, set
  rules, and can switch on full technical detail.
- **Creative people who are not engineers.** They bring a vague idea and want
  a working, secure, live app that is cheap to run. Olympus supplies the
  engineering discipline; that is what separates it from "vibe coding". They
  can learn to judge a diff or a test if the product explains it.

## 4. Success and failure

**Success, six months after launch, for a non-engineer:** they gave Olympus a
vague idea, iterated on it with Olympus until it was good enough to build,
and Olympus built it production-ready. The app is live, secure, meets their
needs, and is cheap to maintain.

**Failure, even if it technically works:**

1. It is hard to use.
2. It is not secure.
3. It does not follow the rules.
4. It does not produce the result the user expected.
5. It does not learn from past mistakes and corrections.

## 5. Requirements the vision adds

Each is stated as something the runtime enforces, because v1 showed that a
rule the model is only asked to follow is a rule it skips (section 9).

- **R-A Ask, don't assume.** Planning surfaces every assumption as a question
  or a visible, recorded decision. A plan or spec cannot advance while it
  holds an unanswered question.
- **R-B Plans and specs are reviewed like code.** The plan and the spec each
  go through a PR, reviewed by a seat that did not write it, from a different
  model family (the rule code review already follows). Unreviewed, they do not
  advance.
- **R-C Rules are gates, not reminders.** A rule the user or project sets is a
  check that refuses, or it is not a rule.
- **R-D Model and effort per role, set in policy.** Today policy sets a model
  tier per role (R14). Effort level is not a policy field. Both come from
  policy, never the model's own choice; a tier rises only on recorded failure.
- **R-E Security from the plan stage.** The spec carries a required threats
  and abuse-cases section; review refuses it empty. Build-side security
  (`secret-scan`, `static-analysis`, R17) already refuses when missing.
- **R-F Plain-English briefings with a recommendation at every stop.** Each
  approval point says what was done, what was checked, what is needed, and
  the recommended choice — the best solution, not the easiest or fastest —
  with what was rejected and why. Decisions are quick actions, not commands
  with run IDs. The briefing is a required field of the approval event, so no
  front end can skip it. A technical mode shows the full detail.
- **R-G Token efficiency is a first-class constraint.** Fewest tokens that
  still get it right: cheapest sufficient model per role, a budget on every
  step, no re-reading or re-deriving, path-scoped context. Cost caps exist
  (P13); efficiency targets do not.
- **R-H Learning from corrections.** Rejected approvals, review overrides,
  user corrections and production bugs become lessons. A lesson applies only
  after a human approves it, as a versioned policy or role-prompt change
  (R11's rule: the loop proposes, a human applies).
- **R-I Stack and hosting.** For a new app, Olympus recommends the stack and
  hosting, the user approves or brings their own. The record says which
  choices were the user's.

## 6. The journey, A to Z, against today

| # | Step | Today | Gap |
|---|---|---|---|
| 1 | Idea and brainstorm | Missing | No conversational intake. The user writes `spec.md` by hand. |
| 2 | Plan / PRD in phases and tasks | Missing | `graph.json` is hand-written; R5 (goal decomposition) is M3, unstarted. |
| 3 | Plan reviewed in a PR, cross-family | Missing | R-B. |
| 4 | Spec and acceptance tests | Partial | R19 drafting shipped but halts in real use (#151). `verify.json` is hand-written. |
| 5 | Spec and tests reviewed | Partial | R19 has a critic seat; no PR, no plain-English briefing. |
| 6 | Build | Works | Proven by run `40609434`. |
| 7 | Verify and review | Works | Review fails out of the box (#152). |
| 8 | Integrate (PR, merge) | Works | Halts on every default Windows checkout (#154). |
| 9 | Deploy | Ruled out | D-A-LC-03. See section 7. |
| 10 | Watch the live app | Partial | R8a/R8b read post-merge outcomes from git and CI. R30 (deploy signals) unstarted. |
| 11 | Production bug in, triaged, reproduced, fixed | Partial | R16 (bug-fix intake) and R22 (GitHub triggers) shipped. No runtime-error or user-report source; R33 (chat) unstarted. |
| 12 | Fix approved by human, or by AI at full trust | Partial | R10 (trust ratchet) shipped. |
| — | Learn | Missing | R11 unstarted. |
| — | Front door | Missing | CLI only (`olympus-ai`). No Claude Code / Codex skills, no connector for the ChatGPT or Claude apps, no `olympus init`. |
| — | New app from nothing | Missing | No unit plans a greenfield run. |

**The first real run's blocking bugs** must be fixed before anything here
matters: #148 (gitignored files such as `.env` copied into the run's tree),
#149 (a driver's real error discarded), #150 (example policy's tool names
refused), #151 (drafting halts), #152 (review cannot call the deep tier),
#154 (CRLF checkout halts integrate). Doc gaps: #133–#136, #139–#142, #144,
#145, #147. All six bugs passed every test because the tests use stand-in
drivers; none ran the shipped example against the real driver.

## 7. Decisions this document proposes

1. **Reverse D-A-LC-03 (no deploy).** Its three reasons, answered:
   *provider-specific* — solved as git hosting is, with provider adapters
   (Vercel first, then a plain server such as AWS Lightsail, then
   self-hosted); *frozen vocabulary* — a deliberate spine amendment adding a
   station; *a step toward a lights-off claim* — shipping behind a human
   approval at L1–L2 is not a lights-off claim. The mission says "ships".
   Watching the live app comes first and does not need deploy: the target's
   own pipeline ships, and Olympus reads deploy status, runtime errors, logs,
   and user reports.
2. **Keep the paid boundary.** Deploy adapters are free and open (MIT). The
   paid product sells the hosted experience over them: dashboard, managed
   secrets, rollout controls. Every capability, record, and metric stays free.
3. **The front door is Olympus's own skills,** usable wherever the user
   already works: a Claude Code / Codex plugin, and a connector (MCP) so a
   conversation in the ChatGPT or Claude apps can brainstorm with Olympus and
   send the result to the line. The paid dashboard is a later front end over
   the same briefings. **Where the runtime runs** (maintainer, 2026-11-13):
   both. A local runtime is free and fully capable; a hosted runtime is part
   of the paid product, as a service rather than a capability, so anyone may
   still self-host everything. The hosted runtime is what lets a person on a
   phone, or without Docker, use Olympus at all. R33's chat source is narrower (a message selects a
   template) and stays as is.
4. **New apps are in scope.** A run that starts from an empty repository,
   with stack and hosting recommended and approved (R-I).

## 8. Proposed order

1. **First run works out of the box.** Fix the six bugs. Add a conformance
   case that runs the shipped example policy and manifest through the real
   driver, so this class of break cannot recur. `olympus init` writes a
   working policy, manifest and checks for the detected stack.
2. **Idea → spec → locked tests, excellent.** The first-release headline. The
   front-door skills (brainstorm, plan, spec), R-A, R-B, R-E, R-F, and the
   plan decomposition (pull R5 forward from M3).
3. **Build quality.** Model and effort per role (R-D), build-side role
   prompts, token-efficiency targets (R-G).
4. **New apps from nothing** (R-I).
5. **Watch, then deploy.** Deploy signals and runtime-error intake into the
   existing bug-fix path (R30 extended, R16), then deploy adapters.
6. **Learning from corrections** (R-H, R11).

Each becomes one or more units through the normal amendment path.

## 9. What to borrow from v1, rebuilt

v1 (`main`) almost never enforced its rules: asking questions before
planning, reviewing the plan, and not doing a delegated task itself were all
prompt text. Borrow the content, not the mechanisms.

- **Planning interview** (v1 `prometheus`, `metis`, overconfidence rule):
  classify the idea (trivial, refactor, new app, mid-sized) to set interview
  depth; a gap pass for missed questions, assumptions, edge cases and missing
  acceptance criteria; questions in files with options plus "Other". v2: a
  front-door skill and a spec role; unanswered questions block (R-A).
- **Plan critic** (v1 `momus`, review skill): clarity, testable acceptance,
  completeness, big picture, by simulating the build; criteria per document
  type. v2: a cross-family review seat for plans and specs (R-B).
- **Security requirements stage** (v1 `nfr-requirements`), made required
  (R-E); **reproduce-first bug fixes** (v1 pathway rules) as a check.
- **Learning data model** (v1 `src/learning`): correction categories,
  verified flag, decay, minimum samples, retrospective. v2: from structured
  events, applied only on human approval — never v1's silent prompt patching.
- **Path-scoped rule loading** and a capped learned-context block (~500
  tokens) for R-G.

Not borrowed: v1's keyword-scored model routing (the source of inconsistent
model choice; v2 uses a fixed role → model + effort table), model-reported
alignment scores (a model may not report status), nudge hooks, Greek agent
names.

## 10. Non-goals

- Weakening any invariant, check, or threshold for ease.
- Claiming lights-off autonomy before R2/R7 measure it.
- Paid-only capabilities.

## 11. Calls made in this draft (the author's, for the maintainer to check)

- **Status of section 7.** Its decisions are proposals. Approving this
  document accepts them as direction; each still lands as an amendment that
  waits for confirmation before any unit builds on it.
- **Measurable bar for the first release (I8).** Order step 1 is done when a
  conformance case takes a fresh clone, `olympus init`, and the shipped
  example through the real driver to a merged PR with no hand-written file.
  Step 2 is done when a scripted conversation turns a one-paragraph idea into
  a locked spec and tests with every assumption answered or recorded, and
  every requirement in section 5 has an assertion that fails when the
  capability is removed. A session with a real non-engineer is evidence
  recorded beside these, never in place of them.
- **PRs for people who don't use git.** The PR is the mechanism, not the
  interface. Plans and specs live in the target repository under a fixed
  folder; for a new app Olympus creates the repository first. The user sees
  the briefing; the PR is there for anyone who wants it.
- **How R-A and R-E are detected.** Structurally, never by a model's word:
  open questions are records with an answered/recorded state the runtime
  counts; the threats section is a required schema field. Whether the
  answers are *good* is the cross-family reviewer's judgment, as for code.
- **Where deploy sits.** A `deploy` station between `integrate` and
  `observe`, added by a spine amendment.
- **Who approves a lesson (R-H).** The project owner, through a briefing that
  states what changes and on which evidence. A lesson may add guidance or
  tighten a gate; one that would loosen a check, a test, a threshold, or a
  grant is refused, as R11 already refuses edits to what judges it.

## 12. Left to the builder

Unit boundaries and sizes; the briefing schema's exact fields; which stack
`olympus init` supports first after TypeScript; how the connector
authenticates to a local or hosted runtime.
