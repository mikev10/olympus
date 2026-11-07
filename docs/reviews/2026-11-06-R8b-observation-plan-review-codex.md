# External review of R8b, codex, 2026-11-06

Codex's adversarial review of R8b, the observation plan, from the bundle alone. The triage is `2026-11-06-R8b-observation-plan-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`.
- **Cross-family agreement:** codex-1 (a partial write of plan signals read as complete) and codex-2 (a check's identity does not bind what it runs) were raised by Gemini too, as gemini-1 and gemini-2. codex-3 and codex-4 were raised by codex alone.
- **Date:** 2026-11-06
- **Bundle:** `2026-11-06-R8b-observation-plan-review-bundle.txt`, SHA-256 `f9be8ee14c52a95505e295b6763f146cfc06bf0b72e6e29741473ed55e669ab6`, base `bd03b6f` (`reviewed/R8a`), head `174bf3a` (R8b's implementation commit on `unit/r8b`). It holds every new file in full and every modified file as a function-context diff, 23 sections; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` were excluded. Prompt: `2026-11-06-R8b-observation-plan-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior project context, performed no external lookups, and that a local directory command was blocked. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 1, 3, 5 (through codex-2), 6, and 7 were answered. Items 2 and 4 were answered as none found (no tautological assertion, no attacker-reachable escape hatch).
- **Citations:** line numbers are positions in the bundle's new-side diffs, not in the repository; each was located by construct before it was checked.

---

BASE: bd03b6f  
HEAD: 174bf3a  
packages/vault/src/types.ts  
a83cd161fa6cb4d37145f5d606f4c11a

I had no prior project context and performed no external lookups. I reviewed the inline bundle. A local directory command was blocked; I did not run tests or independently verify the file’s SHA-256.

1. **packages/api/src/observe.ts:170 — factually wrong — high — One recorded check substitutes for a completed observation.**  
   `observePlan` returns `'recorded'` if **any** plan signal exists, but writes the checks separately at line 195 and the rollback condition afterwards.

   Construction: the first `works` check succeeds; the remaining checks fail and meet the rollback condition. Recording stops after the first signal because of a process interruption or storage error. The next walk sees that single signal, skips the plan and provider reads, and closes the window. The report contains one working check, no recorded regressions, and no rollback condition.

   Persist the complete judgment atomically, or persist a completion marker bound to the plan and observed history only after every required record is durable. Retry incomplete recordings. Add fault injection between writes, including immediately before recording the rollback condition. **High confidence; this does not require an attacker-controlled Vault.**

2. **packages/api/src/observation-plan.ts:117 — unclear — high — Locking an app/name pair does not lock the check’s executable meaning.**  
   Matching uses only app and name; line 147 translates a matching provider success directly into `working`.

   Under the stated control model, keep the locked name `smoke` and app `github-actions`, but replace that CI job’s commands with an unconditional successful exit. The actual smoke tests never execute, yet the reader truthfully receives a successful check and the runtime records `working`. Neither editing the locked plan nor compromising the reader is necessary.

   This exposes a framing boundary: the mechanism authenticates **what GitHub reported under a selected identity**, not whether the intended test ran. If the stronger property is required, the executing workflow and its dependencies need protection or independently trusted execution evidence. Otherwise, explicitly scope `working` to the provider’s report. **High confidence about the construction; the intended strength of the guarantee is unclear.**

3. **packages/api/src/observation-plan.ts:120 — factually wrong — medium — A later nonpassing completion erases a reported failure.**  
   `decidingRun` retains only the latest completed matching run. `verdictOf` then maps skipped, neutral, or cancelled conclusions to `missing`.

   Construction: the same planned app/name reports `failure`, then later reports a completed `neutral` result on that commit. No matching run ever succeeds. Nevertheless, the check becomes `missing`, and that commit no longer contributes to the rollback failure streak. Repository-controlled duplicate jobs with the same name can produce the same selection problem.

   Preserve failed attempts, or explicitly distinguish retries and define an authorized supersession rule. A later nonpassing completion should not silently erase failure evidence. Add a failure-followed-by-neutral test and a duplicate-name collision test. **High confidence.**

4. **packages/api/src/observation-plan.ts:173 — a tradeoff I would have made differently — medium — One success conceals missing coverage across subsequent commits.**  
   For regression checks, missing readings are discarded; line 181 reports `working` whenever any success remains and no selected failure exists.

   Construction: `smoke` succeeds on the merge commit. Subsequent commits disable it entirely. Every later provider response is readable but contains no `smoke`. The final reading is still `working`, with no missing count exposing those unobserved commits. Missing commits also interrupt rollback streaks.

   Preserve per-commit coverage, or expose an incomplete-coverage result alongside the aggregate verdict. This is implemented deliberately, but it weakens the claim that observation covers every later first-parent commit. **High confidence about behavior; whether partial coverage may count as working needs an explicit requirement.**

The plan-integrity mechanisms shown are sound within the stated trust boundary. Supplied plans are parsed into admission records (`run.ts:479`), included in the test-design lock, and read from admission rather than the workspace (`observe.ts:125`). Drafted plans are recovered through the locked draft and checked against its approved file hash (`observe.ts:139–156`). I found no demonstrated workspace-only route to substitute the plan after locking.

Provider failures also generally fail closed: the reader checks response shape, commit identity, totals, and duplicate IDs; provider exceptions prevent initial observation recording (`observe.ts:183–187`). Empty results become missing readings. The rollback path writes records without invoking a revert, integration, or new run (`observe.ts:197–204`).

I found no demonstrated tautological assertion or attacker-reachable TypeScript escape in this change. The casts in `planOf` do not validate stored structures, but malformed structures throw into the walk’s refusal path; forging those structures requires control excluded by the prompt. The tests omit interrupted-recording recovery and the selection cases above.

Finally, **window closure and R8a’s `clean` label are not assertions that this plan passed**. The conformance test explicitly expects `clean` alongside a missing planned check (`packages/conformance/src/registry/observe-plan.ts:174`). Changing R8a is expressly out of scope, so I do not count that as a defect. The sharper review question is whether the plan reading completely and faithfully represents the locked checks and their observation coverage—not whether the unchanged R8a label says `clean`.