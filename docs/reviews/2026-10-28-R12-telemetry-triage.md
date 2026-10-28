# Triage of the R12 external reviews, 2026-10-28

Two counted reviews of R12, telemetry export, against bundle `d05f562c…`
(base `6909a7c`, head `8daf393`):

- codex (`gpt-6-astra`): 8 findings;
- gemini (`gemini-3.1-pro-preview`): 8 findings.

There were no reruns. Three issues were raised by both families, so the 16
findings make 13 distinct issues.

| Family | Raised | Hold | Hold in part | Do not hold | Rejected (holds, no change warranted) |
|---|---|---|---|---|---|
| codex | 8 | 6 | 2 | 0 | 0 |
| gemini | 8 | 4 | 2 | 2 | 1 of the holds (gemini-8) |

Each finding was checked by a subagent with fresh context against the cited
construct, and then by this session where a fix depended on it. Agreement
between the families raised priority. It was not taken as verification.

| Finding | One line | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1, gemini-2 | Model-controlled ids leave in the export | both | holds in part: check ids can be drafted by a model, task ids cannot | fix (F1) |
| codex-3, gemini-1 | The no-read-back scan misses barrel, package, and dynamic imports | both | holds | fix (F2) |
| codex-4, gemini-3 | The allowlist check skips resource attributes and span names, and imports its allowlist from the code under test | both | holds | fix (F3) |
| codex-2 | An invalid collector URL is echoed with its credentials | codex | holds in part: the URL echo holds, the fetch-error leak does not as described | fix (F4) |
| codex-5 | Station history can be erased on write and read as "not recorded" | codex | holds in part: the line never does it, but the Vault does not refuse it, and a resumed legacy run reads as recorded | fix (F5) |
| codex-6 | Zone-free times and reversed intervals pass validation | codex | holds; the consequence needs a record the runtime did not write | fix (F6) |
| codex-7 | The stub Vault admits `null` timing and `null` stations | codex | holds (test double) | fix (F7) |
| codex-8 | The untimed-count assertion passes when the attribute is missing | codex | holds | fix (F8) |
| gemini-4 | One legacy call is counted untimed twice | gemini | holds | fix (F8) |
| gemini-5 | A halted run is exported but can still change | gemini | does not hold | reject |
| gemini-6 | A legacy run's start falls back to the resume time | gemini | does not hold | reject |
| gemini-7 | A check with no start crashes the route | gemini | holds in part: it needs a corrupt bundle, and a 500 is a refusal | reject |
| gemini-8 | Decoded Vault records are cast without validation | gemini | holds as described | reject: the Vault is a trusted component, and the pattern is shared |

## codex-1, gemini-2: model-controlled ids leave in the export

**Checked.**

- **Task ids are not the model's.** They come from the task graph the requester
  supplies at admission (`parseGraph`, `packages/api/src/validate.ts`).
  Drafting runs only at `spec` and `test-design`.
- **Check ids can be the model's.** The acceptance manifest can be drafted by a
  model at `test-design` (`packages/api/src/drafting.ts`), and its ids are
  checked only for being non-empty and unique. A drafted check id therefore
  reaches `factory.check.id` and the span name `check <id>` as model-written
  text.

The task-id half does not hold; the check-id half does.

**Change (F1).** When admission recorded the acceptance manifest as `drafted`, a
check's id is exported only as a digest, under `factory.check.id_digest`, and
its span is named `check`. A run whose manifests a person supplied exports the
ids as before.

- **Chosen over** digesting every check id: an operator reading a dashboard needs
  the ids a person wrote, and those are not untrusted text.
- **Chosen over** charset validation at intake: a restricted charset still
  carries encoded text, which is codex's point.

## codex-3, gemini-1: the no-read-back scan is bypassed

**Checked.** The scan matched only a static relative import of `telemetry.js`.
`import { telemetryOf } from './index.js'`, `'@olympus-ai/api'`, and
`import('./telemetry.js')` all evade it.

**Change (F2).** The scan now walks every identifier and every module specifier
in the source of each runtime package. The exempt files are the exporter itself,
the api index that re-exports it, the route that serves it, the CLI (the client
that fetches it), and conformance. Any of the following is a reader:

- an identifier naming one of the exporter's exports;
- a specifier ending in `telemetry` or `telemetry.js`, static or dynamic.

The assertion runs the same scanner over three negative fixtures (a barrel
import, a package import, and a dynamic import) and requires all three to be
caught.

**Limit, recorded.** A computed property name such as `api['telemetry' + 'Of']`
still evades a lexical scan. Closing it would need the dependency graph resolved
by the compiler, which is more machinery than the threat warrants while no
runtime code imports `api`'s barrel at all.

## codex-4, gemini-3: the allowlist check

**Checked.**

- Resource attributes were not visited.
- Span names were not checked against any policy.
- The allowed keys were imported from the implementation, so widening the list
  in the implementation passes the check.

The resource holds only the fixed `service.name` today.

**Change (F3).**

- The assertion now holds its own copy of the allowed keys, so a new key needs
  an edit to the assertion as well.
- It visits resource attributes on both signals.
- Every span name must be one of these shapes:
  - `run`;
  - `station <a station>`;
  - `task <a task id the graph holds>`;
  - `invoke_agent <a role id>`;
  - `check` or `check <a check id>`.

## codex-2: collector URL errors print credentials

**Checked.** `telemetry` threw a usage error quoting the raw `--endpoint` value,
and `runCli` prints it. `ftp://user:secret@host` reaches the protocol branch,
and a malformed value reaches the parse branch. The fetch-error part does not
hold as described: Node's `fetch` reports "fetch failed" without the URL. A
supplied `io.fetch` could do otherwise.

**Change (F4).**

- Both URL errors are fixed messages that quote nothing.
- A URL carrying user information is refused, since credentials go in
  `--header`.
- A failed POST to the collector is reported as a fixed message, without the
  error's text.

## codex-5: station history erased on write

**Checked.** The line never writes a state without `stations`: admission sets
the first entry, and `apply` spreads the stored list. But
`LocalVault.commitRunState` validated nothing about `stations`. And a pre-R12
run resumed after R12 holds only the entries made after the resume, so
`factory.stations.recorded` read `true` for a partial history.

**Change (F5).**

- `commitRunState` refuses a state whose `stations` is not a list of timed
  entries, or does not begin with every entry of the state it replaces.
- The exporter reports `factory.stations.recorded=true` only when the history
  begins with the admission entry, `intake` at the admission time.

## codex-6: ambiguous and reversed times

**Checked.** `isTime` accepted any string `Date.parse` reads, and nothing
compared `endedAt` with `startedAt`. The runtime writes `toISOString()`, so only
a record the runtime did not write reaches either. A clock stepped backwards
during a call could produce a reversed interval.

**Change (F6).**

- Times must be ISO 8601 with a zone (`Z` or an offset).
- A terminal `endedAt` before its `startedAt` is refused.
- Station entries use the same rule.

## codex-7: the stub Vault's parity

**Checked.** `StubVault.recordUsage` passed `null`, `{}`, and arrays, and its
`readRunState` turned `stations: null` into `[]`. The local Vault refuses both.

**Change (F7).**

- The stub refuses timing that is not an object with a `startedAt` string.
- It normalises only an absent `stations` field, and refuses `null`.

## codex-8, gemini-4: the untimed count

**Checked.** `callsOf` counted a legacy terminal record and its legacy pending
record each as an untimed call, so one call counted twice. The assertion's
`Number(undefined) < 1` is false, so deleting the attribute still passed it.

**Change (F8).**

- A legacy pending record counts only when no legacy terminal record exists for
  the same task, station, and attempt.
- The assertion requires the attribute to equal the number of the run's
  terminal usage records.

## gemini-5: halted runs (does not hold)

`runStanding` reads a halted run as `stopped`, and `cancelRun` refuses a stopped
run (`packages/api/src/run.ts`). `halted` is never cleared, and the station
machine refuses every step of a halted run. Nothing can change its records after
the halt, so its export is stable.

## gemini-6: legacy start time (does not hold)

`readRunRecords` sets `startedAt` from the admission record for every run with
state (`packages/api/src/outcomes.ts`). It is null only for a run refused at
admission, which the exporter handles before it reads state. The fallback the
finding describes is never reached.

## gemini-7: a check with no start (rejected)

`EvidenceBundle.checks` holds `CheckResult`s, whose `startedAt` has been
required since the contracts were first written. Checks that never started are
recorded apart, in `unstarted`. A bundle without one is a corrupt record, and
the route's `500` on it refuses. That is the fail-closed answer, not a silent
pass.

## gemini-8: casts on decoded records (rejected)

The Vault is a trusted, runtime-selected component. Its records are written
through named operations that validate them, and they are content-addressed.
`outcomes.ts` and the report read them the same way. Validating at every read is
a cross-cutting change outside this unit; a malformed record still fails as an
error rather than as a pass.

## Fixes applied

Each fix was written test-first, and each test failed against the old behaviour
before the fix landed:

| Fix | Findings | Commit | Change |
|---|---|---|---|
| F6 | codex-6 | 1a9006d | Times need a zone, and a call cannot end before it starts (Vault tests) |
| F7 | codex-7 | abd8f22 | The stub Vault refuses malformed timing and a present non-list history |
| F5 | codex-5 | f95c0a5, 248d69a | A commit keeps every stored station entry, and a history is recorded only if it begins at admission |
| F8 | codex-8, gemini-4 | 248d69a | Each untimed call is counted once, and asserted exactly |
| F1 | codex-1, gemini-2 | 282ca73 | A drafted manifest's check ids leave only as digests |
| F2 | codex-3, gemini-1 | 8fbdcf6 | The read-back scan finds exported names and any `telemetry` import |
| F3 | codex-4, gemini-3 | f0f7fe1 | The assertion holds its own key policy, checks resource attributes, and checks span-name shapes |
| F4 | codex-2 | f2753d2 | Fixed collector-error messages, URL user information refused |

Two departures from one commit per fix:

- **248d69a carries F8 and the exporter half of F5.** Both change the same run
  attributes and the same assertion.
- **F2's evidence is its negative fixtures, not a failing run.** The old regex
  would have missed the barrel fixture and the package-namespace fixture.

## Re-run after the fixes

The full acceptance criteria are rerun after F4, and the result is recorded in
`docs/decisions.md` (D-R12-06).
