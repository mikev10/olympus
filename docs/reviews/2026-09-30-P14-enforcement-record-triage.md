# Triage of P14's external reviews, 2026-09-30

Two reviews, both `counted`, from one prompt and one bundle:
`2026-09-30-P14-enforcement-record-review-codex.md` (gpt-6-astra, family codex)
and `2026-09-30-P14-enforcement-record-review-gemini.md`
(gemini-3.1-pro-preview, family gemini). Before each header was prepended,
each reply's SHA-256 matched its manifest's `replySha256`, and the reply beneath
each header still hashes to that value. Both runs sent one byte-identical
payload (`df2bb705…`), and both ingested it completely and echoed every bundle
marker. Findings are cited by family and number; gemini's five findings are
unnumbered in its reply and are numbered here in the order they appear.

## Counts

| | Findings | Holds | Holds in part | Does not hold |
|---|---|---|---|---|
| codex | 9 | 3 | 6 | 0 |
| gemini | 5 | 1 | 1 | 3 |

- **Both families raised:** two mechanisms. codex-3 and gemini-1 are the same
  defect (the proxy's 400 refusals are never logged), and both hold. codex-1
  and gemini-2 describe one loss, egress verdicts the proxy acted on that never
  reach the Vault, from two triggers: codex-1 an interrupted process, gemini-2 a
  log that cannot be read.
- **Did not hold:** 3 of 14, all gemini. gemini-3 describes the code exactly and
  is the known limit D-P14-01 and D-P14-14 record. gemini-4 reads a mark's
  check as tautological when the check asserts exactly what the mark claims
  (D-P14-12). gemini-5 describes an early return the code does not have.
- **Held in part** is most of codex's list. In each case the mechanism is as
  described, and the stated consequence is wider than the code bears out: a run
  that fails closed rather than continuing (gemini-2), a gap that resume
  closes (codex-2), a field the HTTP layer already validates (codex-4), a
  semantics mismatch rather than a missing record (codex-8), a framing sentence
  rather than code (codex-9).
- **Fresh-context verification:** all fourteen findings went to three
  subagents, grouped by package, each given the review files and the
  repository, with no account of who wrote the code. codex-1 was not covered by
  its subagent and was checked by reading `runTask` and `#dismantle` directly.
  Every verdict below agrees with its subagent.
- **Executed evidence:** codex-3 / gemini-1 were run against the proxy source:
  an origin-form `GET /` and a garbage request each got 400 and wrote nothing;
  an absolute-form request to a non-allowlisted host got 403 and one `refused`
  line. codex-6's mutation was applied and the conformance suite run: the
  P14 table still passed with the claim-mismatch decision removed, then the
  mutation was reverted. codex-4 and codex-5 were run against `LocalVault`: an
  object-valued `approvedCostUsd` was stored and read back unchanged, and the
  same decision recorded twice read back as one entry.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-3 / gemini-1 | Proxy 400s (bad target, `clientError`) are refused with no log line; the closing count cannot see them | both | holds | fix now |
| codex-1 / gemini-2 | Proxy verdicts live only in its log until teardown; an interrupted process or unreadable log loses them | both | holds in part | known limit |
| codex-2 | Park state is committed before its decision; a violation is written before its decision | codex | holds in part | fix now (park); known limit (violation) |
| codex-4 | `approvedCostUsd` is unvalidated by `requestProblems` and copied into the decision | codex | holds in part | fix now |
| codex-5 | Identical decisions in one millisecond collapse into one content-addressed entry | codex | holds | fix now (contract change) |
| codex-6 | The table proves one example per cause, not every write site; `failsClosed` accepts any throw | codex | holds in part | fix now |
| codex-7 | The unconstructed-arm scan misses quoted keys and wrapped literals | codex | holds | fix now |
| codex-8 | `opened` / `tunnelled` are recorded before the upstream connection succeeds | codex | holds in part | fix now (contract wording) |
| codex-9 | The model's claim decides whether a claim-mismatch decision exists | codex | holds in part | reject (framing only) |
| gemini-3 | A non-string run id is refused with no decision recorded | gemini | does not hold | reject |
| gemini-4 | The blocked-above-L1 mark is tautological | gemini | does not hold | reject |
| gemini-5 | `controls-unavailable` returns early and skips `recordDecision` | gemini | does not hold | reject |

## codex-3 / gemini-1 — the proxy's 400s are unrecorded

**Checked:** `packages/sandbox/src/local/proxy.ts` — the request handler's
target check, the `clientError` handler, `record()`, the closing line, and
`egressLogFrom`.

**Found:** when `new URL(req.url)` throws or the protocol is not `http:`
(origin-form, `https://`, garbage), the handler answers 400 and returns without
calling `record()` (proxy.ts:146-150). `clientError` answers 400 the same way
(proxy.ts:219-221). The closing line's count is the number of `record()` calls
(proxy.ts:228), and `egressLogFrom` only checks that count against the lines it
parsed (proxy.ts:441-470), so a proxy that issued only these refusals closes
with `connections: 0` and parses as an empty `proxied` log. Run: origin-form
and garbage requests got 400 and wrote nothing; a disallowed absolute-form host
got 403 and its `refused` line. The sandbox contract already covers this case:
`refused` includes "no readable host" (`packages/sandbox/src/types.ts:127-128`),
and `host` is `string | null`. The table's egress rows drive a provider that
returns a hand-built log (`reportingProvider`, decisions.ts:145-178), so no
test reaches these branches.

**Outcome: fix now.** Record `refused` with a null host before each 400, and
add raw-request tests asserting the response and the collected decision.

## codex-1 / gemini-2 — verdicts between the proxy and the Vault

**Checked:** `runTask` (`packages/api/src/line.ts:528-545`), `verify`'s
teardown (line.ts:805-809), `#dismantle` and `destroy`
(`packages/sandbox/src/local/provider.ts:682, 740-762`), `#stopSidecars`.

**Found:** the defect holds. The proxy acts on a connection and only logs it;
the log is read at teardown, the sidecars are then force-removed, and from that
point the verdicts exist only in process memory until `recordEgress`
(line.ts:538) writes them. A stop in that window loses them with their source.
Where `readEgress` throws, `destroy` throws that error after the proxy is
removed, and the partial log is gone. The consequence gemini-2 states does not
hold: a failed `destroy` stops the run (line.ts:530-535, and `verify`'s
`finally` propagates it), so nothing continues on an unrecorded account. The
all-or-nothing read is deliberate (`egressLogFrom`'s doc, proxy.ts:435-440;
A-P14-02): gemini-2's fix, recording the lines that did parse, would record a
partial account the parser refuses to trust as a whole. codex-1's literal
standard — in the Vault before it takes effect — is ruled out by the unit's
own design: the proxy has no route to the Vault (D-P14-03, D-P14-09), and the
prompt said so.

**Outcome: known limit**, recorded in `docs/decisions.md`: verdicts are
collected after the fact, and a process stop between teardown and
`recordEgress`, or an unreadable log, loses them while the run fails closed.
Owner: the later unit the P14 entry names for ordering and completeness, which
has no id yet (see the decision below).

## codex-2 — the park and the violation are written before their decisions

**Checked:** `startAttempt` (line.ts:375), `spendRetry` (line.ts:394),
`verify` (line.ts:857-858), `refused` (line.ts:207-216), `recordViolation`
(line.ts:220-228), `commit` (line.ts:985), `nextStep`
(`packages/core/src/station/machine.ts:330-331`).

**Found:** the park half holds. `commit` is a durable `commitRunState`, and all
three sites commit `'parked'` before the refusal reaches `refused()`, which
writes the decision. A stop between the two leaves a parked task with no park
decision. Part of the consequence does not hold: on resume, `nextStep` refuses
any parked task and `runLine` records that refusal, so the decision is written
on the next drive; it is missing only if the run is never resumed. The refusal
returned to the caller is still recorded before it is returned. The
violation half holds and does not self-heal: the decision needs the violation's
ref (D-P14-08), so the violation is written first, and the claim-mismatch
violation is not in run state (line.ts:826), so nothing re-creates its decision.

**Outcome:** the park is **fix now**: D-P14-07 says a decision is written before
it takes effect, and a committed park is the effect. Record the park decision
before committing the parked state, and record it once. The violation ordering
is a **known limit**, forced by the reference, with the same owner as
codex-1.

## codex-4 — `approvedCostUsd` is not validated where the decision is built

**Checked:** `requestProblems` (`packages/api/src/validate.ts:101-113`),
`admissionRefusalOf` (`packages/api/src/run.ts:407-408`), `decisionProblem`
(`packages/vault/src/local/vault.ts:250-263`), `parseStartBody`
(`packages/api/src/http/server.ts:127-128`).

**Found:** `requestProblems` does not check `approvedCostUsd`, and a
`cost-unapproved` refusal copies it into the decision. Run: an object value was
stored and read back unchanged. Over HTTP it cannot happen: `parseStartBody`
answers 400 for anything but a finite number or null before `admitRun`. Only a
direct caller of `admitRun` / `startRun` reaches it, and the runtime is a
service whose API is its contract (I9), so the validator must hold on its own.
Vault-level payload validation is not needed under the stated model: the
Vault's only caller is the trusted runtime.

**Outcome: fix now.** `requestProblems` refuses an `approvedCostUsd` that is not
a finite number or null, as `parseStartBody` does.

## codex-5 — identical decisions collapse

**Checked:** `recordDecision` (`packages/api/src/decisions.ts:25-33`),
`storeObject` and `createExclusive` (`packages/vault/src/local/vault.ts:124-133,
170-172, 355-359`).

**Found:** holds. A decision's bytes are its six fields with a
millisecond-resolution time and no per-occurrence id, and `storeObject` treats
an existing identical object as success, as its comment intends. Run: the same
decision recorded twice read back as one entry. Nothing is left unrecorded —
each refusal still has an entry — but two decisions share one, so a count of
entries undercounts occurrences, and R2 derives its rates by counting them.

**Outcome: fix now, as a contract change.** `EnforcementDecision` gains a
runtime-generated occurrence id, so each decision is its own entry. This amends
A-P14-01, and is confirmed as such below.

## codex-6 — what the table proves

**Checked:** `expectDecision` (decisions.ts:95-106), the `violation-recorded`
row (decisions.ts:474-486), `failsClosed` (decisions.ts:593-615), the
violation sites in `line.ts` (340, 669, 719, 826).

**Found:** the defect holds. Run: with the claim-mismatch branch calling the
Vault's `recordViolation` directly, so no decision is written, the P14 table
still passed. The row drives only the escape scenario (`recordEscape`); the
tamper, findings, and claim-mismatch sites have no scenario. The line half of
`failsClosed` asserts only that `startRun` threw (decisions.ts:599-602), so an
unrelated throw before any write passes it. The approval half is stronger than
codex says: it asserts a not-ok outcome and no grant in state. The table's
promise is one row per cause, and it keeps it; that a row is an example, not
every producer, is what I8 asks the table to close where a write site exists.

**Outcome: fix now.** A scenario for the claim-mismatch violation's decision,
shown failing against the mutation above before it is trusted; and the line
half of `failsClosed` asserts that the refusing Vault received the
`recordDecision` it refused. The findings and tamper sites share
`recordViolation` with the escape site; covering claim-mismatch closes the one
site that bypasses run state.

## codex-7 — the unconstructed-arm scan

**Checked:** `stationRefusalReasons` (decisions.ts:510-540).

**Found:** holds, read not run. The scan matches a property only when
`name.getText(sf) === 'reason'` (518), which a quoted key's text never equals,
and only a direct string literal initializer (519), which `('gate-failed' as
const)` is not. Nothing in `packages/*/src` uses either form today, so no arm
evades it now; a routine edit could.

**Outcome: fix now.** Match quoted `reason` keys and unwrap parentheses, `as`,
and `satisfies` before testing the literal, with positive controls for each
form beside the existing one.

## codex-8 — `opened` before the connection opens

**Checked:** `record('opened')` (proxy.ts:158), `record('tunnelled')`
(proxy.ts:194), the 502 paths (proxy.ts:179-182, 212-214), the verdict docs
(`packages/sandbox/src/types.ts:125-127`).

**Found:** the ordering holds: the verdict is logged before the upstream
connection, and a failed attempt is answered 502 with the log unchanged. The
contract's own wording disagrees with that: `opened` is "a request it
forwarded" and `tunnelled` "a `CONNECT` it joined". No decision is hidden; a
permitted attempt that failed reads as one that succeeded.

**Outcome: fix now, wording only.** The verdict is the proxy's decision to
permit, logged before it acts, which is what the record is for; the docs on
`EgressConnection` and A-P14-02 say so, and that a permitted attempt may still
fail upstream.

## codex-9 — the claim decides whether a violation exists

**Checked:** `verify`'s claim-mismatch branch (line.ts:817-830).

**Found:** true of the prompt's sentence, not of the code. The model's claim
decides whether the runtime records that the claim was false; it sets no
field, changes no status, and grants nothing (status follows `failed` alone,
line.ts:857). D-P14-09's rule — nothing a model returned is an input to any
field — holds. The prompt paraphrased it more widely.

**Outcome: reject** as a defect. Codex's restatement — model assertions cannot
establish success or grant authority; the runtime may record that they are
false — is the better framing for the next prompt that states this invariant.

## gemini-3 — a non-string run id

**Found:** the code is as described (`approveStation`'s `refuse`,
run.ts:633-635), and it is the known limit D-P14-01 and D-P14-14 record: a
decision is stored under its run, and an id no store can name has no run to
store it under. Over HTTP the id comes from the URL and is always a string.
The reviewer's fix would throw or invent a run.

**Outcome: reject.**

## gemini-4 — the blocked-above-L1 mark

**Found:** the check asserts that L2 and L3 runs are refused `unsafe-above-l1`
by the skeleton's own declaration (decisions.ts:545-556). It would pass with
the `controls-unavailable` code deleted, and it claims nothing about that code:
it claims no run can reach the cause today, and it fails the moment one can,
forcing the row to gain a scenario (D-P14-12). That is not a tautology.

**Outcome: reject.**

## gemini-5 — an early return that skips the record

**Found:** not in the code. `admission()` returns the `controls-unavailable`
refusal as an ordinary not-ok outcome (run.ts:474-477), `admitRun` records
every not-ok outcome (run.ts:385-392), and `admissionRefusalOf` has the case
(run.ts:409-410). The one unrecorded `controls-unavailable` is at resume
(run.ts:590-593), which no run reaches and D-P14-14 records.

**Outcome: reject.**

## Gates

- The P14 conformance table passes at `5762bb2`. The full suite has 13
  failures locally, all the Claude Code driver's external reports
  (`tree-changed`: the driver's tests changed in P14 and its funded run has not
  been redone) and the registry-completeness check they feed. Not caused by
  this triage.
- CI on `9180391` is red at the check that no tracked file names a path under
  the gitignored planning directory: the bundle carries `CLAUDE.md` verbatim,
  and the check exempts only `CLAUDE.md` itself (`.github/workflows/ci.yml:63`).
  The bundle cannot be edited — its hash is the record — so the exemption must
  cover tracked bundles. That is a gate change on `v2`, not a review fix.
