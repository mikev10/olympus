# Triage of P9's external reviews, 2026-09-28

One review, `counted`: `2026-09-28-P9-api-cli-review-codex.md` (gpt-6-astra,
family codex). The Gemini run from the same prompt and bundle was `FAILED`:
the call to `gemini-3.1-pro-preview` returned HTTP 402 after 371 ms, with
ingestion `unreported`, integrity `failed`, and no reply written. The maintainer
chose to proceed on the Codex review alone rather than re-run Gemini, so this
unit has **one review and no cross-family pass**. Before its header was
prepended, the Codex reply's SHA-256 matched its manifest's `replySha256`
(`52fb3667…`), and the reply beneath the header still hashes to that value.
Findings are cited by family and number.

## Counts

| | Findings | Holds | Holds in part | Does not hold |
|---|---|---|---|---|
| codex | 6 | 5 | 1 | 0 |
| gemini | — (`FAILED`, no reply) | — | — | — |

- **Both families raised:** not available. Only codex counted, so nothing
  could be paired, and no finding here had a chance of corroboration.
- **Did not hold:** 0 of 6.
- **Held in part:** codex-1. The rounding defect is exactly as described. Its
  second paragraph calls the strict spending guarantee "unclear" because a
  call may overshoot by one response. That overshoot is not unclear: D-P9-03
  and the P9 spec's known limits both state it, as inherited from P13.
- **Fresh-context verification:** every finding went to a subagent given the
  finding's text and the repository, with no account of who wrote the code;
  three subagents, two findings each. All six were reproduced by execution,
  not reading alone: codex-1 by the reviewer's own example, codex-2 by the
  full construction through a live server, codex-3 by editing `graph.json`
  after a pass and after a cancel, codex-4 by applying each of its three
  mutations, codex-5 by placing both escapes in `packages/api/src` under the
  real I9 assertion, and codex-6 by reading what the assertion observes. Every
  verdict below agrees with its subagent.
- **Executed evidence for the fixes:** every fix's test was run against the
  unfixed code and failed before the fix was trusted. Details are in each
  section.

## Findings

| ID | Finding | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | The worst-case figure rounds each task's share to nearest, so it can be below the ceiling | codex | Holds in part | Fixed |
| codex-2 | A drive that ends in an error leaves the run `open`, and a cancel relabels it | codex | Holds | Fixed by amendment A-P9-02, with the maintainer |
| codex-3 | A passed or cancelled run's standing flips when an admitted artifact is edited afterwards | codex | Holds | Fixed |
| codex-4 | The policy-limit assertion passes with weakened defaults and never exercises `loadPolicyFile` | codex | Holds | Fixed |
| codex-5 | The terminal scan follows type names, so a structural type or a cast hides `process` | codex | Holds | Fixed; the static-scan limit recorded (D-P9-12) |
| codex-6 | The headless assertion does not prove a refused create started nothing, or that the CLI has no route but HTTP | codex | Holds | Fixed |

## codex-1: the worst-case figure rounded to nearest

**Claim.** `worstCaseCost` rounds each task's `calls × perCall` to the nearest
millionth before summing, so the figure can be below the ceiling it stands
for. Nine calls at $1.00000004 is $9.00000036, and the figure said $9.

**Checked.** `packages/api/src/cost.ts` `worstCaseCost` used
`Math.round(calls * perCall * MICRO)`. The subagent ran the reviewer's example:
$9.0000000 for $9.00000036, and five such tasks $45.0 for $45.0000018. The
policy validator (`packages/core/src/policy/validation.ts`
`isNonNegativeNumber`) admits any finite non-negative `maxCostUsd`, so a
sub-microdollar ceiling is reachable from a policy file. The "strict guarantee
unclear" paragraph does not hold as a new defect: the one-response overrun is
stated in D-P9-03 and the P9 spec's known limits, inherited from P13.

**Consequence.** The figure a person approves could be below what the line can
spend, by at most half a millionth of a dollar per task: small in size, but a
bound that is not a bound.

**Changed.** `microsCeiling(usd, calls)` computes each task's share exactly
from the number's shortest decimal spelling, the one the policy author wrote,
and rounds up. So `0.07` is 70000 millionths, not the 70001 that
`Math.ceil(0.07 * 1e6)` gives from the binary value. The new test in
`packages/api/test/cost-bound.test.ts` failed against the old `cost.ts`
(`[9, 9]` where `[9.000001, 9.000001]` was expected) and passes now. D-P9-03
records it.

## codex-2: a drive that ends in an error is reported `open`, and a cancel relabels it

**Claim.** A build result with the right task id and a forbidden `status` field
is refused by `taskResultProblems`, and the line throws after recording usage
and before committing anything else. The server keeps the error only in memory
(`lastOutcome`), the task stays `running`, status reads `open`, and `/cancel`
then records a cancellation. A restart loses the error.

**Checked.** Each step holds in code (`packages/api/src/line.ts`,
`packages/api/src/http/server.ts` `drive`, `packages/api/src/run.ts`
`runStanding` and `cancelRun`). The subagent reproduced the chain end to end
through `createApiServer`: `lastOutcome` held the contract error, the task
state was `{hello: running}`, standing was `open`, and cancel returned 200
with a `cancelled` refusal. No existing test drove a malformed result through
the server.

**Consequence.** Invariant I2 itself holds: the forbidden `status` field was
refused and never became status. What fails is the status surface's own
promise. A run the runtime stopped reads as open, the durable record then says
a human cancelled it, and the real cause is lost on restart. This is one of
the outcomes the prompt named: a stopped run reported as something else. It
applies to any drive that ends by throwing, not only to this construction.

**Changed.** This needs a record the Vault did not have, so it was put to the
maintainer as either an amendment now or a known limit owned by I1. The
maintainer chose the amendment, A-P9-02. `RunState` gains
`halted: RunHalt | null`, which the server commits when a drive ends in an
error, unless the run is already cancelled. `StationRefusal` gains a `halted`
arm that `nextStep` returns right after `cancelled`, and `LocalVault` refuses a
stored state without the field. The new server test drives the reviewer's
construction and checks four things: status reads `stopped` / `halted`, a
cancel is refused 409 as `finished`, `cancelled` stays null, and a second
server over the same Vault, with nothing in memory, reads the same. With the
halt commit removed from `server.ts`, the test failed. It passes with the
commit in place. A machine test covers the refusal and its order after
`cancelled`, and a vault test covers the malformed field. Recorded as A-P9-02,
in the P9 spec, D-P9-11, and a changeset. The amendment changes `core`, which
the driver's report key hashes. A-P9-01 already required the run-driver CI
pass, so A-P9-02 adds no second one.

## codex-3: a finished run's standing depends on workspace files edited afterwards

**Claim.** `runStanding` re-hashes the admitted artifacts before it recognises
a spent last grant or a cancellation. Edit `graph.json` after a run passes and
the run reads `stopped` / `lock-tamper`; restore it and it reads `passed`.
Edit after a cancel and the tamper refusal masks the cancellation.

**Checked.** `runStanding` called `reloadExecuted` first and returned
`lock-tamper` before `nextStep` or the spent-grant check ran. The subagent
confirmed both flips with a temporary server test. `server.test.ts` never
edited an artifact after completion.

**Consequence.** Tampering never produced a false `passed`: the failure only
ran the other way. But `passed` and `cancelled` were not durable facts. They
depended on whatever the workspace held at read time.

**Changed.** `runStanding` now reads what was committed before what the
workspace holds. A cancellation or a halt returns the refusal `nextStep` gives
it, and a spent grant for the last exit returns `passed`, both before any
re-hash. Every passed M1 run holds that spent grant, because `integrate`'s
contract floor is `human-required` and no policy relaxes it (D-P4-03). So no
passed run is left to re-derive, and the finding is closed rather than
narrowed. The new server test edits `graph.json` after one run passes and one
is cancelled. It failed against the old `run.ts` and passes now. D-P9-08
records it.

## codex-4: the policy-limit assertion permits weakened defaults

**Claim.** (a) A byte cap of 65537 still passes, because the fixture is well
past the cap. (b) A depth of 33 still passes, for the same reason. (c) A
`loadPolicyFile` handed relaxed limits still passes, because the assertion
calls only `parsePolicyYaml`. (d) The relaxed-depth half accepts every refusal
except `too-deep`.

**Checked.** The subagent applied (a), (b), and (c) to
`packages/api/src/policy-file.ts`, and the assertion passed each time. (d)
holds by reading `expectNotRefusedFor`. D-P9-09 claimed that "raising a
default fails it", which the mutations showed was false.

**Consequence.** `I5.policy-document-load-is-hardened` proved that
`parsePolicyYaml` obeys the limits it is handed, and nothing about the defaults
or the file-loading path the service uses. An I5 entry was paid against an
assertion that could not detect its own regression.

**Changed.** The assertion
(`packages/conformance/src/registry/policy-file.ts`) now tests each limit at
the limit and one step past it:
- a valid document of exactly 65536 bytes is admitted, and 65537 is refused;
- a document nested exactly 32 deep passes the depth check, and 33 is refused;
- the same cases, plus an alias and a missing file, run through
  `loadPolicyFile` with no limits passed.

No policy field nests freely, so the depth documents must be refused as
`invalid-policy` and only as that. That refusal is the evidence the depth
check let them through. The relaxed halves now require admission, or exactly
`invalid-policy`. Each of the reviewer's three mutations was applied again,
and each failed:
- 65537 failed with "a document one byte past the byte cap was not refused";
- 33 failed with "a document nested 33 deep was not refused as too-deep";
- the relaxed loader failed with "a policy file one byte past the byte cap
  was not refused".

The source was restored after each. D-P9-09 records it.

## codex-5: the terminal scan follows type names, not the value

**Claim.** `const p: Pick<NodeJS.Process, 'stdout'> = process;
p.stdout.write(...)`, and the same through `as unknown as { stdout: ... }`,
pass both the binding scan and the spelling scan.

**Checked.** `terminalBindings` in `packages/conformance/src/kit/scan.ts`
matched only a receiver whose type the checker named `Process`. The subagent
placed both snippets in `packages/api/src` and ran
`I9.api-never-touches-a-terminal`, and neither was reported. ESLint was clean
too: neither snippet uses `any`, and no other scan flags `as unknown as`.

**Consequence.** As the reviewer said, this is a regression escape, not a
remote exploit. Runtime code could regain a terminal dependency while I9's
assertion stayed green.

**Changed.** The scan now follows `process` as a value.

- **Still allowed:** reading a member by name, destructuring named members,
  and `typeof process`.
- **Now reported:** any other reference, which covers an assignment, an
  argument, a cast, a spread, a computed key, `globalThis.process`, and a
  shorthand property. Past that point a structural type or a cast hides the
  object from the scan.
- **Imports:** `process` and `node:process` join the modules the runtime may
  not import, because they hand out the same streams.

A new scan test covers both of the reviewer's forms and the allowed ones. It
failed against the old `scan.ts` and passes now. Both escapes, and an
`import { stdout } from 'node:process'`, placed in `packages/api/src`, now fail
the real I9 assertion. `core` and `api` pass it unchanged.

**Known limit** (D-P9-12): the scan reads source, so a lookup built at run
time (`globalThis[name]`, `eval`, `Function`) reaches `process` without naming
it, and no source scan can follow that. The claim now says what is checked: no
file spells or binds a terminal.

## codex-6: the headless assertion does not prove what its header claims

**Claim.** The refused create is judged by exit code and message alone, so a
regression that admits or starts a run and then prints the refusal passes. And
separate processes do not prove the CLI has no in-process route to the
runtime. The type-only imports are good practice, but nothing enforces them.

**Checked.** `assertApiRunsHeadless` in
`packages/conformance/src/registry/headless.ts` checked only `code === 1` and a
regex on stderr. The subagent found no other check on the CLI's imports: no
dependency-cruiser config, and no import scan over `packages/cli`. The module
header claimed that "a CLI that reached the runtime by any route but HTTP,
fails here", and nothing enforced it.

**Consequence.** Both halves of `I9.api-runs-headless` held as practice today,
but nothing would catch either one regressing.

**Changed.** Two checks were added to the assertion.

- **The census.** The headless host now counts every Vault write and every
  driver call at the components themselves, and reports the count over IPC.
  After the refused create, both counts must be zero. After the run passes,
  both must be non-zero, as the positive control.
- **The CLI's program is read first.** Every import of a workspace package
  must be type-only. Nothing outside `packages/cli/src` may be imported by
  path, and nothing may be loaded at run time. The CLI's manifest may take no
  workspace package as a runtime dependency.

Two mutations were run against the new checks:
- A value import of `worstCaseCost` added to `packages/cli/src/cli.ts` failed
  with "imports @olympus-ai/api as a value".
- A Vault write added before the `cost-unapproved` return in `admitRun` failed
  with `{"vaultWrites":1,"driverCalls":0}`.

Both files were restored afterwards. D-P9-10 records it.

## Item 7, the framing

The reviewer accepted the adversarial framing and drew two distinctions. The
first: holding the token is the definition of an authenticated principal, so
an echoed cost figure cannot be told apart from a human's approval. D-P9-06
already states this as the one-secret, one-principal known limit, and
multi-user is out of scope. The second: scan escapes measure regression
resistance, not remote authorization. That is right, and it is how codex-5 is
classed above. The sharper question it proposed, whether every advertised
guarantee has a test that fails when its mechanism is removed, is the question
codex-4, codex-5, and codex-6 each answered "no" to before this triage.

## State after the fixes

- `pnpm typecheck` and `pnpm lint` pass.
- `pnpm -r --filter '!@olympus-ai/driver-claude-code' --filter '!@olympus-ai/conformance' test`
  passes: core 135, vault 62, api 87, cli 6, sandbox 148, adapters 692.
- The conformance package: 206 pass. 13 fail, and every one has one cause: the
  driver package has no `.conformance/run.json`. That covers the 11
  external driver assertions, the registry completeness check, and
  `I8.registry-complete`. The P9 spec already says these pass only in CI,
  after the maintainer applies `run-driver`, because A-P9-01, and now A-P9-02,
  change `core`, which the driver's report key hashes.
- The ledger is unchanged: no pending entry is added or paid by these fixes.
- The bundle `2026-09-28-P9-api-cli-review-bundle.txt` is tracked (committed
  in `3499d80`). Its SHA-256 is
  `cc7251d1a310e205912ac665787d6d04d862ad8790aa7123b2a88c939f48f6f9`, which
  matches the value named in the first paragraph of the review prompt.
