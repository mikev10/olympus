# Triage of R14's external reviews, 2026-10-06

Two reviews, both `counted`, from one prompt and one bundle:
`2026-10-06-R14-tier-escalation-review-codex.md` (gpt-6-astra, family codex)
and `2026-10-06-R14-tier-escalation-review-gemini.md` (gemini-3.1-pro-preview,
family gemini). Before each header was prepended, each reply's SHA-256 matched
its manifest's `replySha256`, and the reply beneath each header still hashes
to that value. Both runs sent one byte-identical payload (`28d114fa…`), both
ingested it completely, and both echoed every bundle marker. The bundle's
SHA-256 (`cbd8fd6f…`) matches the one named in the prompt. Findings are cited
by family and number, as each reply numbers them.

## Counts

| | Findings | Holds | Holds in part | Does not hold |
|---|---|---|---|---|
| codex | 2 | 1 | 1 | 0 |
| gemini | 1 | 0 | 1 | 0 |

- **Both families raised:** one mechanism. codex-1 and gemini-1 are one
  defect: `review` commits a seat computed from the model the reviewer's
  result reports, so a reported family that differs from the resolved one
  records independence the runtime never had.
- **Did not hold:** none of 3. The paired finding holds only in part: the
  defect is real, but it is reachable at L0 to L2 only, and gemini-1's account
  of the first check is wrong (below).
- **Fresh-context verification:** each mechanism went to its own subagent,
  given the finding text and the repository with no account of who wrote the
  code. Each verdict below agrees with its subagent, and the load-bearing code
  was then read directly: `review` and `runTask` in `packages/api/src/line.ts`;
  `tieredDriver` and `EVERY_MODEL_THAT_BUILT_IS_AN_AUTHOR` in
  `packages/conformance/src/registry/tier.ts`; `dockerCli` in
  `packages/sandbox/src/local/docker.ts`; `LocalDockerProvider.create` in
  `packages/sandbox/src/local/provider.ts`; `packages/sandbox/test/output.test.ts`.
- **Executed evidence:** both findings were reproduced. The paired one by a
  throwaway line run at L1 whose reviewer resolves to the builder's family and
  reports another. The seat was committed `independent`. codex-2 by mutating
  each default cap to `Number.MAX_SAFE_INTEGER`, with the suite still green.
  Both probes were removed, and the tree was clean afterwards.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 / gemini-1 | The committed review seat is computed from the reviewer's reported model, so a reported family different from the resolved one records false independence | codex, gemini | Holds in part | Fix now (proposed) |
| codex-2 | No test or assertion runs the default output cap; a fallback raised to no bound leaves every assertion green | codex | Holds | Fix now (proposed) |

## codex-1 / gemini-1 — the seat trusts the reviewer's reported model

**Checked.** `review` (`packages/api/src/line.ts`, the `review` function)
seats the reviewer twice. First it seats from
`reviewer.resolveModel(tierFor(...))`, and it returns early only when that
seat is refused. Then, after the run, it seats again from `ran.result.model`
and commits that second seat. `ran.result.model` is whatever the driver's
`runTask` returned. Nothing compares it with the resolved model, which
`runTask` records as the call's model ("the record's model is never the
driver's account"). The only check between the two seats is
`taskResultProblems`, which checks shape. The line that commits from the
reported model dates from P4 (`296e28d`). R14 re-routed this function through
the tier and `authorsOf`, and the prompt put it in scope.

**Found.** The defect holds. A reviewer whose resolved family matches an
author's, and whose result reports another family, gets a committed seat of
`independent`, and the seat names the reported family as the reviewer. The
probe output was
`{"independence":"independent","authors":["shared-family"],"reviewer":"other-family"}`
at L1. Here the model's own account decides what the record says about
reviewer independence. That breaks two rules. The runtime, not the model,
decides which model served a call. And a reviewer that shares an author's
family must be recorded as reduced independence.

**What does not hold.** gemini-1 says the second check "ignores the conflict
detected in the first", as though the first check's refusal were overridden.
It is not. At L3, `seatReviewer` refuses a shared family, so the first check
returns before the reviewer runs. A shared-family reviewer cannot get through
at L3. The exposure is L0 to L2. There the first check passes with `reduced`,
the line discards that result, and the false `independent` is written. The run
advances at those levels either way, so the cost is a wrong record, not a
blocked gate opened. Codex's mitigation also holds. The Claude Code driver
spreads its family from a constant, so the only driver that exists today cannot
report another family. The exposure is any driver that passes a model-reported
family through.

**Assertion gap.** Both reviewers note that
`I6.every-model-that-built-is-an-author` builds its reviewer with no `claims`.
`tieredDriver` then reports the resolved identity, so the reported and
resolved models always agree, and this construction passes it unchanged.

**Proposed fix.** In `review`, commit the stricter of the two seats:
`reduced` if either the resolved model or the reported model shares an
author's family, refused if either is refused. That keeps the existing intent
of the second check, which holds a driver that ran another model to the model
it ran. It also stops the report from ever widening what the resolved model
established. Add the case to the conformance entry above: a second scenario
whose reviewer resolves to the first builder's family and reports a third
family through `claims` must still be seated `reduced`. Show it failing
against the current `review` before the fix.

## codex-2 — the default output cap is never exercised

**Checked.** The test named "with no cap given, the default applies"
(`packages/sandbox/test/output.test.ts`) asserts only that
`DEFAULT_MAX_OUTPUT_BYTES` is 64 MiB. Then it passes five explicit invalid
caps. The other two tests pass `maxOutputBytes: 4096`. The conformance entry
`I9.sandbox-output-is-bounded` (`packages/conformance/src/registry/output.ts`)
builds its provider with an explicit cap of 256 KiB. There are two defaults,
`dockerCli`'s `options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES` and the same
fallback in `LocalDockerProvider.create`. No test reaches either. A repo-wide
search found no other test that names the option or the constant.

**Found.** The finding holds. Each fallback in turn was changed to
`Number.MAX_SAFE_INTEGER`. `output.test.ts` passed 3 of 3, and
`I9.sandbox-output-is-bounded` passed against a live Docker daemon; it ran, it
was not skipped. Every default caller would then hold unbounded output with the
suite green. `dockerCli`'s default serves the daemon probe, the proxy and relay
lifecycle calls, and the provider's housekeeping calls. The provider's default
serves every task command's output. So a capability claim exists whose deletion
no assertion catches. Codex correctly calls this a verification gap. It is not
a bypass: the current code bounds output.

**Proposed fix.** Add a test that calls `dockerCli` with the cap omitted,
prints one byte past `DEFAULT_MAX_OUTPUT_BYTES` (Node writes 64 MiB in well
under a second), and asserts `CliOutputExceeded`. Remove the provider's second
fallback, so that an omitted provider cap passes through to `dockerCli`'s
default. The provider still validates an explicit cap at `create`. Then one
default exists and one test guards it. Show the new test failing under the
mutation before trusting it.
