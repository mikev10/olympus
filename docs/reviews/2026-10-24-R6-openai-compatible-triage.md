# Triage of the external reviews of R6, 2026-10-24

Two reviews of R6, run from one prompt and one bundle
(`2026-10-24-R6-openai-compatible-review-bundle.txt`, SHA-256
`256ed8c0b1843dee21fcda94566010d41c2c706c68688053e933fbd4e7b3057c`, base
`d039910` (`reviewed/R19`), head `bd07193`):

- `2026-10-24-R6-openai-compatible-review-codex.md`: gpt-6-astra, family
  codex, outcome `counted`
- `2026-10-24-R6-openai-compatible-review-gemini.md`:
  gemini-3.1-pro-preview, family gemini, outcome `counted`

Both replies matched their manifests' `replySha256` before their headers were
prepended, and the text beneath each header still does.

## Counts

| Family | Findings | Holds | Holds in part | Does not hold | Belongs to another unit |
|---|---|---|---|---|---|
| codex | 5 | 2 | 3 | 0 | 0 |
| gemini | 2 | 0 | 1 | 1 | 0 |

No mechanism was raised by both families. codex-2 and gemini-1 reach the same
consequence, an answer recorded under a model that did not produce it, by
different mechanisms, so they are not paired. Two of codex's findings (codex-1,
codex-3) hold as descriptions of the code but describe limits P13 already chose
and recorded (D-P13-03, D-P13-04); they are not R6 defects. One gemini finding
(gemini-2) does not hold.

Each finding went to a verifier with fresh context, given the finding's text
and the repository and not told who wrote the code. All seven were settled by
reading; none was settled by a constructed run. gemini-1's evidence (the bare
`node` call, the task container's run arguments, the harness's uid) was
spot-checked in this session.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| gemini-1 | Code in the sandbox replaces `node`, and every later model turn is the sandbox's forgery, attributed to the declared model | gemini | holds in part: attribution holds, unmetered spend does not | amendment A-R6-05, applied |
| codex-2 | A `model` field equal to the requested id is consistency, not proof of identity | codex | holds in part: code is right, the claim text overreaches | review fix, applied (D-R6-03, I6 entry) |
| codex-4 | The I1 assertion's title claims the host filesystem is never written; nothing asserts that | codex | holds in part: the deletion of the capability fails the test; the title overclaims | review fix, applied (I1 title) |
| codex-5 | `.catch(() => 'absent')` turns every read error into absence | codex | holds | review fix, applied |
| codex-1 | The meter trusts the endpoint's usage; zero usage and non-2xx are free | codex | holds in part: mechanics real, inherited from P13 | no change; recorded trust assumption |
| codex-3 | The budget stops after the crossing call; one call can overshoot by its whole ceiling | codex | holds, as a recorded design limit | no change (D-P13-03) |
| gemini-2 | The credential assertion is tautological, since the driver never holds the secret | gemini | does not hold | reject |

## gemini-1: a replaced `node` forges every later turn

**Checked.** `#call` (`packages/drivers/openai-compatible/src/driver.ts:416`)
runs `exec(['node', '--eval', CALL_SOURCE, path])`: a bare `node`, resolved by
the task container's `PATH`, in the same container the tools run in
(`tools.ts`, through the same `provider.exec`). The task container is started
by `runArgsFor` (`packages/sandbox/src/local/provider.ts:336`) with no
`--read-only`, no `--cap-drop`, and no `no-new-privileges`; the relay, proxy,
and probe sidecars have all three. The user is the operator's
`spec.user`, and `checkUser` accepts uid 0; this driver's own harness runs as
uid 0 (`test/harness.ts:131`).

**Found.** With a root sandbox user (or any user-writable directory earlier in
`PATH`), a granted `Bash` or `Write` replaces `node`, and every later turn is
whatever that program prints. The host checks the forged reply's `model`
against the requested id (`driver.ts:365`), and a forgery names the right one.

- *Holds:* the answers are attributed to the configured model and family though
  no model produced them. The sharper construction is the reviewer seat, not
  the author's: a reviewer that runs the author's tests as root runs code the
  author wrote, and that code can write the rest of the review under the
  reviewer's family. That is an artifact the author can write judging the
  author's work, which is what the rule against self-judgment and the rule that
  reviewers never share the author's family exist to prevent.
- *Does not hold:* spend without the relay counting it. A forged reply never
  reaches upstream, so it costs nothing; the loop is bounded by `maxTurns` and
  the deadline (`driver.ts:350`), not "infinite". Forged usage only falsifies
  the host's own `costUsd` estimate; the relay's meter, which the budget
  enforces, is untouched.
- *Does not hold:* that it reaches an ungranted tool. The host's grant check
  (`driver.ts:394`) runs on the host and is unaffected.

**The reviewer's resolution contradicts a recorded decision.** D-R6-01 puts the
model call inside the sandbox because the relay is on the sandbox's network and
not the host's, and a host-side call would have to hold the credential or reach
the relay another way. D-R6-01 does not consider a tampered `node`, so the
residual is unrecorded. The same exposure exists for `claude-code`, whose whole
CLI runs in the sandbox; R6 makes it visible because R6 is the first driver
whose loop is outside the sandbox and could have avoided it.

**Outcome: amendment A-R6-05, chosen by the maintainer (option A below) and
applied.** Either fix changed an interface or the sandbox's posture, so the
choice was put to the maintainer first:

- **(A) Chosen — amendment A-R6-05:** make the model call from a container
  the task cannot write. The relay sidecar is already read-only, capability-free,
  and on the sandbox network; the provider gains one optional method that posts
  a body to the sandbox's relay from there and returns status and body, and the
  driver refuses construction with a provider that lacks it (fail closed). An
  assertion replaces `node` in the task sandbox and requires the next turn to
  still reach the relay; shown failing against `bd07193` first. This changes the
  `SandboxProvider` interface in `@olympus-ai/sandbox`.
- **(B) Known limit:** record the residual in D-R6-01 and add a pending I6
  registry entry with an owner (a sandbox-hardening unit: read-only task root,
  non-root user enforced, absolute interpreter path), raising the baseline as
  D-S1-18 did. Cheaper, but a reviewer seat on this driver stays forgeable by
  the code it reviews until that unit lands.

## codex-2: `model` equality is consistency, not identity

**Checked.** `driver.ts:365` refuses unless the reply's `model` equals the
requested id. D-R6-03 calls this the one mismatch the driver can see. The I6
registry entry (`packages/conformance/src/registry/openai-compatible.ts`) says an
answer naming another model refuses the task rather than being attributed, which
is mismatch rejection. Nothing states that an endpoint returning a false `model`
defeats the check; `docs/decisions.md` defers whether a driver's identity is
true to P5.

**Found.** The code is correct and nothing stronger is possible from the
response alone. The endpoint is the operator's configuration, outside this
adversary's reach, so its identity mapping is an operator trust assumption, and
the docs do not say so. A forged `model` from inside the sandbox is gemini-1, not
this finding.

**Outcome: fix now, docs only.** Add a sentence to D-R6-03 and to the I6 entry's
description: the check is consistency validation, and that the endpoint serves
the model it names is the operator's trust assumption.

## codex-4: the I1 title claims more than the assertion checks

**Checked.** `test/invariants.test.ts:36` asserts that the workspace holds the
Write and Edit results, that a Bash-created marker exists inside the container
and holds the container's hostname (compared with `docker inspect`), that every
exec carries the sandbox handle, that four model calls ran, and that a driver
with no provider is refused.

**Found.** The real deletion of the capability, tools run on the host instead,
fails this test: the marker would not be found by `provider.exec`, and the
hostname would not match. The reviewer's mutation (keep the sandbox calls and
add a host write) passes, but it adds a side effect rather than deleting the
capability. The registry title does say "the host's own filesystem is never
written", and nothing asserts that; a canary can only catch writes to the path it
watches.

**Outcome: fix now.** Narrow the title to what is asserted: every tool and model
call runs inside the sandbox through `provider.exec`, and a driver with no
provider cannot be constructed. No assertion is weakened; a claim is brought
down to its assertion.

## codex-5: every read error becomes `absent`

**Checked.** `test/invariants.test.ts:110-111` read `forbidden.txt` and
`also-forbidden` from the host side of the workspace mount with
`.catch(() => 'absent')`.

**Found.** As described. In this test a non-`ENOENT` error masking a real write
is implausible: the same test reads other files from that mount, a run Write
would leave `x`, and a run Bash would leave `''`, both of which fail. The
assertion at `:113` (no tool exec at all) is independent. Fail-open handling in a
check is still a defect regardless of how unlikely the error.

**Outcome: fix now.** Map only `ENOENT` to absence and rethrow every other error.

## codex-1: the meter trusts the endpoint's usage

**Checked.** `takeOpenai` (`packages/sandbox/src/local/relay.ts:266`) accepts
zero counts; all-cached usage is priced at the cache rate. A non-2xx response is
charged nothing and does not exhaust. The Anthropic dialect has the same
`charge()` and the same 2xx rule; both predate R6. D-P13-04 records "an error
response that is not a success is not billed upstream and is charged nothing";
D-P13-03 chose counting after the response; D-R6-05 and the R6 spec say every
P13 rule holds unchanged for `openai-chat`.

**Found.** The mechanics are as described. The consequence is not one this
adversary reaches: the usage is the operator's own endpoint's report of its own
bill, and the endpoint is outside the adversary's control. The prompt framed
`usage` as adversary-controlled, which overstated the threat (codex's item 7 says
the same). A reservation scheme is D-P13-03's option C, which was rejected.

**Outcome: no code change.** The trust assumption is stated by D-P13-04 and
D-R6-05; the D-R6-03 sentence added for codex-2 names the endpoint as a trusted
party for usage as well as identity.

## codex-3: one call can overshoot by its whole ceiling

**Checked.** `openaiCeiling` (`relay.ts:415`) is `max(max_completion_tokens,
max_tokens) * n` with no upper bound; `metered` (`:443`) checks only whether the
budget is already exhausted. The conformance case at
`packages/conformance/src/registry/local-relay.ts:449` does require two $0.002
calls under a $0.003 budget to succeed.

**Found.** As described, and deliberate: D-P13-03 chose to count after each
response and "overshoots by at most one call, which is stated as a known limit",
rejecting reservation because it refuses long sessions far below their cost.
D-P13-13 serializes calls so the overshoot is one call. The `openai-chat` ceiling
is the same exposure as the Anthropic dialect's `max_tokens`. The conformance
case asserts the chosen contract; changing it is an amendment to P13, not a
review fix.

**Outcome: no change.** Recorded limit, D-P13-03.

## gemini-2: the credential assertion is not tautological

**Checked.** The driver holds only the credential's name; the harness gives the
secret to the provider. But code this change owns decides where the secret could
land: `relayRequest()` (`driver.ts:213`) chooses the header, scheme, credential
name, and URL variable; `call.ts` runs inside the sandbox; the driver passes no
`env` to any exec. The test searches a workspace `env` dump, every process's
environment and command line, a `docker export` of the whole container, and
`docker inspect`, with positive controls: a planted value is found by the same
searches, and the relay is shown to have attached the bearer.

**Found.** A mutation that embeds the value in `call.ts`, an exec's environment,
or its argv fails the test, so "passes regardless of the code under test" is
false. What the reviewer gets right is narrower: a leak by the provider or relay
internals is covered as an integration property, not by the driver's code.

**Outcome: reject.**

## Notes on the sound-mechanisms lists

Neither list contradicts a verdict above. codex's "credential placement" and
gemini's "relay configuration" and "type coercion" items agree with what the
verifiers read. codex's list does not consider the interpreter the model call
runs in, which is gemini-1.

## What changed

Applied on `unit/r6` after the maintainer confirmed the four outcomes above.

- **gemini-1, A-R6-05.** `SandboxProvider.relayCall` (`packages/sandbox/src/types.ts`)
  and its `LocalDockerProvider` implementation (`packages/sandbox/src/local/provider.ts`,
  with `RELAY_CALL_SOURCE` in `relay.ts`) post from the relay's own container.
  `OpenAICompatibleDriver` refuses a provider without it and makes every turn
  through it; `CALL_SOURCE` is gone from `call.ts`. The I6 assertion now
  replaces `node` in the sandbox and requires the next turn to be the
  endpoint's. Run against `bd07193`'s driver it fails with
  `expected 'forged' to be 'answered by the endpoint'`, so the old driver
  recorded the forgery under the declared model; against the fix it passes. The
  I1 assertion also requires a provider without `relayCall` to be refused. Two
  sandbox tests cover `relayCall`: it reaches the upstream with the credential,
  is metered, and still gets a 403 for an ungranted path; it refuses a relayless
  sandbox, a path without `/`, and an ended sandbox. D-R6-01 is amended, and
  the R6 spec and changeset say so.
- **codex-2.** D-R6-03 gains a limit: the check is consistency validation, and
  the endpoint's identity and usage are the operator's trust assumption. The I6
  entry's comment says the same.
- **codex-4.** The I1 title no longer claims the host's filesystem is never
  written.
- **codex-5.** `contentsOrAbsent` in `test/invariants.test.ts` maps only
  `ENOENT` to absence.

No check, test, or acceptance criterion was weakened. One claim title, I1's, was
narrowed to what its assertion checks.
