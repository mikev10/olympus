# Triage of the R26 external reviews, 2026-10-31

Two reviews, both `counted`: Codex (`gpt-6-astra`, 84,065 input tokens against a floor of 54,852) and Gemini (`gemini-3.1-pro-preview`, 79,350 against 54,852). No rerun was needed. Each reply's SHA-256 matched its manifest's `replySha256` before its header was added.

**Counts.** Codex raised 5 findings: 3 hold and were fixed, and 1 holds in part and was fixed for the part that holds. 1 holds only under a precondition the line does not create, and is recorded as a known limit. Gemini raised 2: 1 holds and was fixed (paired with codex-1), and 1 holds under the same precondition (paired with codex-3). Every finding describes the code. None was found not to hold. Two findings were raised by both families.

Every finding was verified against the cited code before any change: three by fresh-context subagents given the finding and the files (codex-1/gemini-1, codex-4, codex-5), and codex-4 also by running the parser on the reviewer's input. Each fix was shown failing against the old behaviour first.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1, gemini-1 | A sandbox process can POST to the relay with a hosted tool or another service tier, billed outside the meter | both | holds | fixed, 0a296d7 |
| codex-2 | A process left by one task acts during a later task on the same sandbox | codex | holds in part: only for a reused sandbox | known limit, D-R26-15 |
| codex-3, gemini-2 | A same-uid survivor rewrites the inspection's capture file | both | holds in part: same precondition | known limit, D-R26-15 |
| codex-4 | A missing thread id or missing usage reads as a completed zero-usage turn | codex | holds | fixed, cadc4e0 |
| codex-5 | Several plants have no positive control, so their negative checks could pass vacuously | codex | holds | fixed for six of seven plants, 3cecb49; the config plant recorded, D-R26-14 |
| codex (closing note) | A call under budget can end over it by one call | codex | holds, by design | rejected: P13's stated rule (D-P13-03) |

## codex-1, gemini-1: hosted tools and service tiers through the relay

**Checked.** The relay's `metered` reads only `model` and the output ceiling, then forwards the buffered body unchanged. Nothing in the relay source reads `tools`, `service_tier`, or `prompt`, and `charge` prices tokens alone. The sandbox gets the relay's address by design. Confirmed by a subagent, with line citations.

**Found.** The defect holds. Its consequence holds for spend: a hosted tool such as web search or a remote MCP server is billed per call, and a priority tier at another rate. Neither shows up in the usage the meter reads. Gemini's wording, "use ungranted tools", is right only for hosted tools. A client `function` tool defined in a direct request runs nothing on the vendor's side, and the only executor in the sandbox is the task's own grant.

**Changed.** Under `openai-responses` the relay refuses unsent any request offering a tool other than `function`/`custom`, naming a `service_tier` other than `default`, or naming a stored `prompt` (D-R26-14). Rejected: making the relay hold the task's tool grant, which is a `RelaySpec` change and an amendment. Tests: `meter.test.ts` (7 cases, shown red first) and `I5.model-relay-fails-closed-on-unmetered-usage-openai-responses`. The free driver test asserts the CLI's own requests stay inside the rule. The same gap in `openai-chat` is issue #88.

## codex-2: processes surviving between tasks

**Checked.** `cancel` forgets an inspection and kills nothing, and serialization waits for the exec, not for its descendants. The line, though, provisions a sandbox per task: `I4.task-capabilities-do-not-outlive-the-task` (`packages/conformance/src/registry/verification.ts:440`) runs two build tasks in real containers and asserts the second finds no process from the first.

**Verdict.** It holds for a caller that reuses a sandbox, as this driver's own tests do, and not on the line. The driver killing processes it did not start would end checks the runtime started (A-P11-02 starts detached servers). So the boundary stays the runtime's, recorded as a known limit (D-R26-15).

## codex-3, gemini-2: the capture file is writable by a survivor

**Checked.** The capture directory is made by the sandbox's uid under a sticky directory, and the file is rewritten per request. A process of the same uid can replace it before the wrapper prints it.

**Verdict.** It holds under the same precondition as codex-2: a process alive in the sandbox when the inspection runs. Without sandbox reuse, the inspection runs before the task's model has acted, so no such process exists. Recorded with codex-2 (D-R26-15).

## codex-4: fail-open event parsing

**Checked.** A subagent ran `parseEvents` on `{"type":"thread.started"}` then `{"type":"turn.completed"}`. It produced `threadId: ""` and all-zero usage, which `refuseUnusable` accepts.

**Changed.** A thread id must be non-empty, and a completed turn must carry integer, non-negative `input_tokens` and `output_tokens`, with the optional counts valid when present. Otherwise the line is unreadable and the task refused. The six-case test was shown red first.

## codex-5: plants without a live counterpart

**Checked.** All four sub-claims were confirmed. The root `AGENTS.md` sits beside the override that shadows it. The nested plants were never eligible from `/workspace`. The config plant sets a key the argv also sets. The control required three paths.

**Changed.** `plantsAreLiveAndAbsent` (test/plants.ts) runs three controls: from the root, from `sub/` under a project-root marker, and from the root with the override removed. Together they read six of the seven plants. Both a root driver and a driver started in `sub/` carry none of them. Used by the free test and by `I3.codex-workspace-instructions-not-loaded`, whose title now names the exception.

**Not closed.** The config plant: on the pinned CLI, neither `developer_instructions` nor `model_instructions_file` in `.codex/config.toml` reached a request even with the directory explicitly trusted, so no live control exists. Its negative check is evidence of nothing, and the record says so (D-R26-14).

## The closing budget note

The reviewer labels it a tradeoff it would have made differently. A call begun under budget may end over it by one call. That is P13's rule as written (D-P13-03), and changing it is not this unit's work. Rejected.

## Framing

Codex answered item 7: the framing is right, and the boundary is wider than the CLI's advertised tools, because shell access is also an HTTP client and a way to leave processes behind. That is what codex-1 and codex-2 act on. Gemini did not answer items 2–7.
