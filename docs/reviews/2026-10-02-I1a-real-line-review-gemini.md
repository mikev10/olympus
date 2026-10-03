# External review of I1a, gemini, 2026-10-02

An adversarial pre-merge review of I1a (the real line): the graph builder and
its provenance record, the metering relay wired into every driver sandbox and
the usage record `runTask` writes, the resume check for lost readings and the
cost totals' bound, and the integrate escalation for an unanalysed suite. One
of two reviews run from the same prompt and bundle; the other is
`2026-10-02-I1a-real-line-review-codex.md`. Both are triaged in
`2026-10-02-I1a-real-line-triage.md`, which cites this review's findings as
`gemini-1` and `gemini-2`, numbered in the order they appear (the reply does
not number them).

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview` (v1beta),
  offering no tools. `cleanRoom` is `null` because an API call loads no local
  configuration. Exit 0, not timed out, 272.3 s. Ingestion `complete`: 206,196
  prompt tokens against a floor of 136,211. Integrity `verified`: the reply
  echoes every required bundle marker. Outcome `counted`. Reply SHA-256 as the
  runner wrote it:
  `ea52a19e12b46538c1edf6a5c87167639b087381df646aa0a643eefd73425a83`, which
  matched the manifest's `replySha256` before this header was prepended.
  This is the second run. The first (started 2026-10-02T13:07Z, kept as
  `2026-10-02-I1a-real-line-review-gemini.attempt-1.run.json` with its session
  record) was `FAILED`: exit 1, ingestion `complete`, integrity `failed` with
  `base`, `head`, `finalSection`, and `endNonce` absent, and no reply
  written. The output cap was raised to the model's 65,536 ceiling in
  `0d03d8d` and the family re-run from the same prompt and bundle.
- **Cross-family agreement:** gemini-1 (a process stop between the model call
  and `recordUsage` leaves no record, so resume replays it unmetered) was
  raised by codex too, as codex-1. gemini-2 (`relayless` and a delegating
  wrapper that drops `relayRequest`) was raised by gemini alone.
- **Date:** 2026-10-02 (counted run started 2026-10-02T20:39Z).
- **Bundle:** `2026-10-02-I1a-real-line-review-bundle.txt`, SHA-256
  `93f3dab0b565f993fc721005e3d58c1b9d85c67854f4a30364fd29ab040efa2e`, base
  `7fcb611` (`reviewed/P14`), head `6de39c9` (the I1a implementation commit,
  "I1a: Integration: the real line"). It held the full contents of the 47
  changed source, test, registry, workflow, skill, and lockfile paths, and the
  changeset; the changed docs (`docs/decisions.md`,
  `docs/plan/DECOMPOSITION.md`, `docs/plan/F1-spine.md`) were excluded, and so
  was every unchanged file, including the relay implementation in
  `packages/sandbox`. Prompt: `2026-10-02-I1a-real-line-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context
  about the project, did not search for the project or its author, and looked
  up no external documentation. A self-report, not independently verifiable.
- **Coverage, and any gap:** findings are not numbered by prompt item. Item 1
  is answered by gemini-1, item 2 by gemini-2. Items 3 (fail-open), 4
  (language escape hatches), 5 (configuration), 6 (mechanisms assessed sound),
  and 7 (whether the framing is right) came back empty. Silence on 6 and 7 is
  not an endorsement of any mechanism or of the framing.
- **Citations:** line numbers refer to positions in the reviewed source files
  as the bundle carried them, not to the repository at any later commit. They
  are hints; the triage located each construct by name.

---

BASE: 7fcb611
HEAD: 6de39c9
pnpm-lock.yaml
4faa137b43a3990ab5d81a669995a2ad

I have no prior context about this project. I did not search for the project or its author, nor did I look up any external documentation.

packages/api/src/run.ts:643 — concrete bypass — high — An attacker controlling when the runtime process stops can kill the process while a task is `running`, after `driver.runTask` finishes executing the model but before `recordUsage` successfully commits the meter reading to the Vault. Because `resumeRun` determines lost readings by calling `lostReadings(vault, state)`—which only scans for explicitly recorded `lost` entries physically present in the Vault—it will not detect the missing usage record. Finding `lost` to be empty, `resumeRun` proceeds, and `nextStep` re-schedules the `running` task. `startAttempt` will replay the model call, allowing the attacker to exploit retries (up to the `maxStarts` limit) to execute calls whose costs are completely unmetered and omitted from the run's bounds. — To resolve this, `resumeRun` must cross-reference tasks in the `running` state against their usage records; if a task's current attempt lacks a `UsageRecord` in the Vault, the runtime must synthesize a `lost` reading and refuse to resume, ensuring the cost bounds fail closed.

packages/api/src/graph.ts:98 — tautological check — low — `relayless` checks if the `relayRequest()` method returns `null`. While this prevents the driver from deliberately passing `null`, the code assembling the graph could wrap the driver in a proxy or delegating object that drops the `relayRequest` property entirely without throwing an error (e.g. by letting the property read return `undefined`). Although accessing it at runtime would throw a `TypeError` (because it expects a function), the type definition is technically bypassed. However, since the graph builder is trusted code and a dropped property results in a crash (fail-closed) rather than an unmetered bypass, this is a minor robustness issue rather than a direct exploit. — Require `typeof driver.relayRequest === 'function'` before invoking it, or enforce strict object shape validation on trusted components.