# Triage of P11's external review, 2026-09-28

One review, `counted`: `2026-09-28-P11-network-probe-review-codex.md`
(gpt-6-astra, family codex). Before its header was prepended, the reply's
SHA-256 matched its manifest's `replySha256` (`052ae88f…`), and the reply
beneath the header still hashes to that value. The run ingested the payload
completely (59,821 input tokens against a floor of 37,394) and echoed every
bundle marker. Findings are cited by family and number.

**One review, no cross-family pass.** Gemini was not run. The Gemini call was
blocked by the authoring session's permission classifier, and the maintainer
then chose to proceed on codex alone for cost. Every finding below was raised
by codex alone and had no chance of corroboration. This triage is evidence of
one family's scrutiny, not two.

## Counts

| | Findings | Holds | Holds in part | Does not hold |
|---|---|---|---|---|
| codex | 6 | 5 | 1 | 0 |
| gemini | not run | — | — | — |

- **Both families raised:** not available; one family reported.
- **Did not hold:** 0 of 6.
- **Held in part:** codex-4. The defect is real and reproduced, but the code
  does what the unit spec says; the doc comment claimed more than either.
- **Reproduced, not only read:** all six. Each finding was given, with its
  cited file, to a subagent with fresh context that was not told who wrote the
  code, and each constructed the case the reviewer described and ran it.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | A body of `1e400` parses to `Infinity`, which canonicalizes as `null`, so it equals an expected `json: null` | codex | holds | fixed |
| codex-2 | An oversized response passes a status-only expectation, though it may never have completed | codex | holds | fixed |
| codex-3 | A hole in a scenario array is skipped by `map`/`forEach`, removing its comparison | codex | holds | fixed |
| codex-4 | "One scenario per handle" is enforced per adapter instance, not per handle | codex | holds in part | doc comment corrected; known limit D-P11-07, owner I1 |
| codex-5 | The probe-isolation assertion does not inspect PID mode, `no-new-privileges`, or user, and reads any failed exec as "marker absent" | codex | holds | fixed |
| codex-6 | The response timeout is a socket-idle timer, so a trickled body outlasts the stated limit | codex | holds | fixed |

## codex-1: a number past JSON's range compares equal to `null`

**Checked.** `canonical` in `packages/adapters/src/http.ts` writes a number with
`JSON.stringify`, which writes `Infinity` as `null`, and `JSON.parse('1e400')`
is `Infinity`. The subagent ran `compareHttp` with `json: null` expected
against a body of `1e400`, and nested (`{"a":[1e400]}` against `{a:[null]}`):
both held.

**Consequence.** As stated: reachable from response bytes alone, for any
scenario whose expected JSON holds a `null` where the product can put an
overflowing number.

**Changed.** An `isJson` predicate: no `undefined`, no function, no number
outside JSON's range. The reader refuses an expected `json` that fails it,
naming the field. The comparison reports a parsed body that fails it as a
mismatch before comparing. Tests: the top-level and nested overflow cases
fail to hold, a real `null` still holds, and `Infinity`, `NaN`, a nested
`undefined`, and a function are each refused in `expected`. All failed
against the old code.

## codex-2: an oversized response satisfies a status-only expectation

**Checked.** The probe settles `oversized` with the status line's status the
moment the body crosses its cap, and `compareResponse` pushed a mismatch for
it only when the scenario expected something of the body. The subagent ran the
real probe source against a server advertising `Content-Length: 1000000000`,
sending just over 1 MiB and going silent. The probe returned `oversized`,
status 200, and `compareHttp` with `{ status: 200 }` expected held.

**Consequence.** As stated. The unit spec lists "a body over the cap" among
the product's failures, without regard to what the scenario expected, so the
code fell short of its own spec.

**Changed.** `oversized` is a mismatch on `exchanges[i].body` whatever the
expectation. The reviewer's other option, draining past the cap to
require completion, was not taken: the spec's rule is simpler and already
decides the case. Test: an oversized observation against a status-only
expectation does not hold. It failed against the old code.

## codex-3: a hole in a scenario array removes a comparison

**Checked.** `readHttpScenario` read `expected.exchanges` with `map`, and
`compareHttp` iterated it with `forEach`; both skip holes, and `length` still
counts them. The subagent ran `expected: { exchanges: new Array(1) }` with one
request against a `no-response` observation, and it held. `strings`, used
for `serve` and `bodyIncludes`, validated with `every`, which skips holes too.

**Consequence.** As stated, and correctly limited by the reviewer: JSON cannot
carry a hole, so this needs a scenario built as a JavaScript value. Today
every scenario is one (the conformance registry builds them as literals), and
`readHttpScenario` is exported.

**Changed.** Every array the reader validates is first made dense with
`Array.from`, so a hole reaches the validator as `undefined` and is refused
naming its index. Tests: a hole in `expected.exchanges`, `input.exchanges`,
`input.serve`, and `bodyIncludes` is each refused. All failed against the old
code.

## codex-4: one scenario per handle, per adapter

**Checked.** `#served` is a field of each `HttpBehavioralAdapter`. The
subagent built two adapters over one provider; the second ran a scenario on a
handle the first had served, and held.

**Holds in part.** The defect is real. But the unit spec's rule is "a second
on a handle the adapter already served is refused", and the code does exactly
that. It was the adapter's doc comment that claimed a handle-wide rule. The
reviewer also states the limit correctly: nothing in the codebase builds two
adapters over one handle, and nothing yet assigns sandboxes to checks.

**Changed.** The doc comment now says the refusal is per adapter, and that a
fresh sandbox per check is what closes the gap. Recorded as D-P11-07, a known
limit owned by I1, which wires P6's fresh sandbox per check, with the
assertion owed there named. Moving the served set into the provider (the
reviewer's resolution) is recorded as the reversal.

## codex-5: the isolation assertion does not cover the whole isolation claim

**Checked.** `I2.http-probe-shares-network-not-filesystem` inspected network
mode, mounts, read-only root, and dropped capabilities. It did not inspect PID
mode, even though the unit spec says the probe shares "neither its filesystem
nor its process tree". It also left out `no-new-privileges` and the user,
which `probeRunArgs` sets. Its marker check mapped every failure of
`docker exec … cat` to "absent". The same gaps were in
`packages/sandbox/test/probe.test.ts`. All three sub-claims held.

**Consequence.** As stated. The reviewer is also right that the assertion is
not a tautology: it fails on the changes it does inspect.

**Changed.** Both the entry and the sandbox test now inspect `PidMode` (empty,
Docker's private namespace), `SecurityOpt` (`["no-new-privileges"]`), and
`Config.User` (`65534:65534`). The marker is checked by running `node` inside
the probe, reporting both the marker and the probe's own node binary as a
positive control and requiring `{"marker":false,"control":true}` exactly. A
failed exec now throws instead of reading as absent. The entry's title names
the process namespace, no new privileges, and the unprivileged user. Shown
failing against the old behaviour: with `--pid container:<sandbox>` added to
`probeRunArgs` temporarily, the sandbox test failed. With it removed, the test
and the conformance entry pass.

## codex-6: the response limit is idle time, not elapsed time

**Checked.** The probe's `PROBE_RESPONSE_MS` is documented as "from the moment
it is sent", and it was implemented with `req.setTimeout`, Node's socket-idle
timer, which every received chunk resets. The subagent ran the probe source
with a 300 ms limit against a server writing a chunk every 150 ms for 900 ms,
and it returned a complete response.

**Consequence.** As stated, and limited correctly: the sandbox's wall-clock
budget still bounds the whole call.

**Changed.** A timer of the probe's own, started when the request is sent and
cleared when it settles, replaces `req.setTimeout`. Test: the probe source
run with a 400 ms limit against a server trickling a byte every 100 ms for
1.2 s reports `no-response`, "no complete response within 400ms". It failed
against the old code.

## Gates

- `pnpm typecheck` and `pnpm lint`: clean.
- `packages/adapters` `test/http.test.ts`: 30 passed. `packages/sandbox`
  `test/probe.test.ts`: 13 passed, against Docker.
- `pnpm test`: every package passes except `packages/conformance`, where 13
  entries fail, all for one reason. The Claude Code driver's run report
  hashes the source of every workspace package the driver executes,
  `@olympus-ai/sandbox` among them. The probe fix changes that source, so the
  report no longer matches the tree (`tree-changed`), and the seven
  `driver.*` claims read as missing. This is the reconciliation working as
  designed, not a regression. All four HTTP conformance entries pass. The CI
  driver run the unit's done-when already names regenerates the report, and it
  is a paid run for the maintainer to approve.
