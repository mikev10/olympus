# Triage of the R23 external reviews, 2026-10-30

Two counted reviews of R23, workspace skills and instruction discovery:

- `2026-10-30-R23-workspace-skills-review-codex.md` (gpt-6-astra)
- `2026-10-30-R23-workspace-skills-review-gemini.md` (gemini-3.1-pro-preview)

Both ran against bundle `ad5f28ce…` (base `178d62a`, `reviewed/R22`; head `7188bcb`). Each reply's SHA-256 matched its manifest's `replySha256` before its header was prepended. No reruns.

**Counts.** codex: 4 findings. 2 hold, 2 hold in part, 0 do not hold. gemini: 4 findings. 2 hold, 1 holds in part, 1 holds as a known limit. One defect was raised by both families (codex-2 = gemini-1). 4 fixes applied, 4 findings recorded as known limits or rejected in part.

Every finding was verified against the cited code: by a fresh-context subagent that read each construct, and, where it could be run, by running it. codex-1 was checked on the pinned CLI image, gemini-3 against a real misplaced package, and codex-2/gemini-1 against a borrowed pending id.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-2 / gemini-1 | A driver's row can name any I3 pending id, or share another driver's | both | holds | fixed, bc9209d |
| codex-1 | CLAUDE.md, the rules file, and the agent definition are checked only by the model's reply | codex | holds in part | agent definition fixed, fe72e27; the rest a known limit |
| codex-3 | An init line with no `skills` field reads as an empty list, so the negative check passes vacuously | codex | holds | fixed, edaeed9 |
| codex-4 | Same driver instance and task id could let a message cache mask loading | codex | holds in part: the test reuses both, and no such cache exists | rejected; no defect in the code |
| codex-2 (second construction) | An unrelated passing test registered in the driver's package satisfies the table | codex | holds | known limit |
| gemini-2 | The planted file list is fixed; a new instruction file name would not be planted | gemini | holds | known limit |
| gemini-3 | A driver package outside `packages/drivers/` owes nothing | gemini | holds | fixed in part, 656850e |
| gemini-4 | The R6 comparison ignores method, path, query, and headers | gemini | holds in part: the driver can set none of them | rejected; no channel exists |

## codex-2 / gemini-1: a row can borrow another obligation

- **Checked:** `workspaceInstructionProblems` (`packages/conformance/src/registry/workspace-instructions.ts`) matched a pending entry by id alone. Two rows could also name one id.
- **Shown:** a self-test row mapping a phantom driver to `I3.coverage-report-is-not-writable-by-the-suite` was not refused (red before the fix).
- **Fix chosen:** every row's id must end `workspace-instructions-not-loaded`, and no two rows may share one. The self-test now borrows an unrelated pending id and another driver's id, and requires both refused.
- **Rejected:** binding a pending entry to a package. `PendingAssertion` has no package field. Adding one is a change to the kit's types under `packages/conformance/kit`, wider than this check needs.

## codex-1: three plants are checked by the reply alone

- **Checked:** the assertion read `init.skills` but not `init.agents`. Run on the pinned image, `init.agents` lists a planted `.claude/agents/builder.md` without `--setting-sources ''` and omits it with the flag. `init` has no field naming loaded memory or rules files.
- **Fix:** each driver session must not list the probe role in `init.agents`, and the control must list it. This part is not shown red locally, because the assertion is paid. The pinned-image observation is its evidence, and its first run is under `run-driver`.
- **Known limit:** `CLAUDE.md` and `.claude/rules` remain checked only by their tokens' absence from the reply. A CLI that loaded them while the model omitted the token would pass. Closing it means observing the system prompt the relay forwards, which is a change to the sandbox's relay and outside this unit. Filed as #85; see D-R23-08.

## codex-3: a missing skill list read as an empty one

- **Checked:** `readInit` mapped an absent `skills` field to `[]` (`packages/drivers/claude-code/src/stream.ts`).
- **Fix:** `skills` is undefined when the line carries no list, and the assertion's `toBeDefined()` now means the CLI reported one. The parse test was red against the old code.

## codex-4: one driver instance and one task id for both runs

- **Checked:** the driver holds no per-task or per-instance cache of initial messages; its per-task state is a record of requests already sent (`packages/drivers/openai-compatible/src/driver.ts`).
- **Rejected:** the construction needs a cache that does not exist. A test change to guard against code that is not there is a fix with no defect behind it.

## codex-2, second construction: an unrelated test in the right package

- **Known limit:** the registry binds an external entry to its package, id, file, and title, never to what the test exercises. That holds for every external entry in the registry, not only these. What the assertion tests is checked by review of the test, which is what this review did. Recorded in D-R23-08.

## gemini-2: the plant list is fixed

- **Known limit:** a CLI or driver that starts reading a new file name passes until that name is planted. Tracing file reads in the sandbox is outside this unit. For the Claude Code driver the CLI is pinned exactly (`image.ts`), so a new reader arrives only with a version bump. Recorded in D-R23-08, with the same issue as codex-1's remainder.

## gemini-3: discovery by directory

- **Checked:** `workspacePackages()` filtered by `packages/drivers/` alone. A package `@olympus-ai/driver-stray` at `packages/driver-stray` passed the check (run).
- **Fix:** a package whose name starts `@olympus-ai/driver-` and lives outside `packages/drivers/` is refused (run red with the stray package, green without).
- **Remains:** a driver both named and placed outside the convention is not found. A structural test, such as finding every class implementing `Driver`, would need to parse every package. Recorded in D-R23-08.

## gemini-4: method, path, and headers

- **Checked:** `provider.relayCall` takes `{ path, body }` only (`packages/sandbox/src/types.ts`, `RelayCallRequest`). The driver sends its configured path, and the relay allows that path alone. The driver has no way to set a header or vary the path from the workspace.
- **Rejected:** the channel the finding describes does not exist in the driver's call path.
