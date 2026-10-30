# Triage of R22's external reviews, 2026-10-30

There are two counted reviews of one bundle
(`2026-10-30-R22-trigger-framework-review-bundle.txt`, SHA-256 `a5f725b7…`):

- **Codex** (gpt-6-astra): 108,120 input tokens against a floor of 74,111.
- **Gemini** (gemini-3.1-pro-preview): 106,445 input tokens against the same
  floor.

Both replies match their manifests' `replySha256`.

**Reruns.** The first R22 bundle (2026-10-29) counted for Codex. It failed
integrity twice for Gemini, because its final section was `pnpm-lock.yaml`
and Gemini echoed the last code file instead. Bundles now leave out the
lockfile (D-TOOLING-10), and both families ran once on the rebuilt bundle.

**Counts.**

| Family | Findings | Hold | Hold in part | Do not hold |
|---|---|---|---|---|
| Codex | 7 | 3 (codex-1, codex-2, codex-5) | 3 (codex-3, codex-4, codex-6) | 1 (codex-7) |
| Gemini | 2 | 1 (gemini-1) | 0 | 1 (gemini-2) |

Both families raised one finding (codex-1 = gemini-1).

Each finding was verified against the code by a fresh-context subagent, given
only the finding and the file. Where a finding could be run, it was run, and
where a fix was applied, the test or assertion was shown failing first.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1, gemini-1 | The sink rule misses a wrapped payload and generic erasure | both | holds | fixed, 9a83429 |
| codex-2 | The payload assertion never reads the reviewer's requests | codex | holds | fixed, 3d514ed |
| codex-3 | Expiry is checked before slow admission work, not when the candidate is spent | codex | holds in part | fixed, 3576f53 |
| codex-4 | Schedule timers keep the startup schedule | codex | holds in part | fixed, ecd17ec |
| codex-5 | `entryStation` validates any station and is never read | codex | holds | fixed, aaf0243; `human` recorded as a known limit (D-R22-17) |
| codex-6 | The budget is serialized per process only | codex | holds in part | known limit, D-R22-17 |
| codex-7 | `$` lets a class match before a final newline | codex | does not hold | rejected |
| gemini-2 | An oversize body gets a connection reset, not a 413 | gemini | does not hold | rejected |

## codex-1, gemini-1: the sink rule misses wrapped and erased payloads

- **Checked:** ESLint was run on a scratch fixture.
  - Not reported: `JSON.stringify({ payload })`, `sink({ payload })`,
    `const arr = [payload.raw]; sink(arr)`, and `JSON.stringify(erase(payload))`
    where `erase<T>(v: T): unknown`.
  - Reported: `JSON.stringify([payload.raw])`, through the array-element
    check.
  - The cause: `isUntrusted` matched the top-level type name only.
- **Gemini's claim** that the check is "tautological" does not hold. It
  catches every direct construction in its fixture. The gap is containers and
  generics.
- **Fix:**
  - `holdsUntrusted` searches properties, array and tuple elements, and type
    arguments, to depth 6. Function types are not searched.
  - `checkErased` reports an argument that fills a type parameter of the
    called signature's own which the declared return type does not mention.
    A class's type parameter is bound by the receiver and is skipped, so
    `map.set` and `push` are not reported.
- **Considered and rejected:** treating every type-parameter slot as opaque.
  That would report `Object.freeze(payload)` and `Promise.resolve(payload)`,
  which keep the type.
- **Evidence:**
  - Five fixture lines (wrapper object, named nested wrapper, object argument,
    named wrapper argument, generic erasure) failed against the old rule and
    pass now.
  - Two clean lines (`Object.freeze(payload)`, a nested array of payloads
    kept at its type) are not reported.
  - `pnpm lint` and `pnpm -r lint` report nothing new across the repository.
- **Limit:** the rule is intraprocedural. A value erased inside a function
  body, and not at a call site, is still caught only where that function's
  own slots are opaque.

## codex-2: the payload assertion never reads the reviewer's requests

- **Checked:** `admitWith` built a reviewer driver and returned only the
  builder. The assertion stringified only `driver.requests`.
- **Fix:** `admitWith` returns the reviewer, and the assertion searches both
  sets of requests.
- **Evidence:** a marker planted in the reviewer's requests alone failed the
  new assertion and passed the old one. The plant was temporary and was
  removed.

## codex-3: a candidate's window is checked too early

- **Checked:**
  - The clock is read once, before candidateFor (`packages/api/src/run.ts`).
    Role, rubric, cost, and workspace work follows, and the exclusive admitted
    mark comes last.
  - A candidate could therefore be admitted after its window passed. The
    delay is bounded by admission's own work.
- **Partly wrong:** "admitted twice" does not follow. The exclusive admitted
  mark still admits one run, and an expired mark written concurrently does
  not make a second.
- **Fix:** the window is read again on a fresh clock just before the
  admitted mark. If it has passed, the candidate is recorded as expired, the
  run's workspace is discarded, and admission refuses as `candidate-expired`.
- **Considered and rejected:** making `markCandidateAdmitted` refuse when an
  expired mark exists. That changes the Vault's operation for a race the
  fresh check already closes to the same instant.
- **Evidence:** a new case in `I5.candidate-admits-one-run` uses a Vault
  that waits out the deadline on the first call after the candidate is read.
  It failed before the fix (the candidate was admitted) and passes now.

## codex-4: the scheduler keeps the startup schedule

- **Checked:**
  - The timer re-armed with the schedule object read at startup, so a
    retimed schedule kept its old time.
  - Schedules added after startup were never armed.
  - The policy is read from disk on each call (`packages/api/src/http/server.ts`),
    so editing the file while the service runs is a real path.
- **Partly wrong:** a removed schedule already stopped firing.
- **Fix:**
  - Timers are keyed by schedule id.
  - A firing whose schedule was retimed arms the new time and fires nothing.
    A removed one is not re-armed.
  - The policy is read every `RECONCILE_MS` (one minute) for added
    schedules.
- **Evidence:** in `packages/api/test/schedule.test.ts`, the retimed and
  added cases failed before the fix and the removal case passed. All three
  pass now. `I5.missed-firing-recorded-not-run` still passes.

## codex-5: `entryStation` validates without effect

- **Checked:**
  - The relational check required the key and accepted any station.
  - Nothing in `api` or `core` reads `triggers.entryStation` for routing,
    and every run starts at intake.
- **Fix:** an enabled non-human kind whose entry station is not `intake` is
  refused, at path `triggers.entryStation.<kind>`.
- **Not fixed for `human`:** requiring it could refuse an existing policy
  that validates today (D-R22-10). It is recorded as a known limit in
  D-R22-17, owned by the first template that enters elsewhere.
- **Evidence:** a new case in `I7.enabled-trigger-declares-a-template`
  (`ci-failure` entering at `integrate`) failed before the fix and passes
  now.

## codex-6: the budget is serialized per process only

- **Checked:** `#serial` is a per-instance promise chain. Two instances on
  one store can each read the budget as open. No store-ownership lock exists,
  and no decision recorded the single-process assumption.
- **Consequence:** the overrun is bounded by the number of services, and
  each candidate still waits for a person to admit it.
- **Outcome:** recorded as a known limit (D-R22-17). Closing it needs a
  store-ownership lock or an atomic reservation in the Vault, which is a
  contract change outside this unit's declared scope.

## codex-7: `$` lets a class match before a final newline

- **Does not hold.** Every class in `CHAR_CLASSES` carries the `u` flag and
  not `m`. Without `m`, JavaScript's `$` matches only at the end of input, so
  the "before a final newline" behaviour belongs to other regex dialects.
- **Evidence:** run in node, all eight classes accept their valid value and
  reject the same value followed by `"\n"`, `"octo/hello\n"` included.
  Nothing changed.

## gemini-2: an oversize body gets a connection reset

- **Does not hold.**
  - The declared-length path refuses before any read.
    `I4.delivery-refused-before-it-is-parsed` posts `MAX_DELIVERY_BYTES + 1`
    bytes and receives 413, and it passes.
  - For the streamed path, a replica of the `readCapped` and `discard`
    pattern was sent 8 MB chunked and declared-length bodies. Both got 413
    and neither got a reset.
- **Residual:** that replica is not the real server, and the real chunked
  path has no test. This is a gap in coverage, not a demonstrated defect.
  Nothing changed.

## Framing (item 7)

Codex judged the framing right, but asked for two questions to be kept
apart: whether outside input can cross today's boundary, and whether
conformance would certify a future change that breaks it. Its findings on
the second question (codex-1, codex-2) were the ones both families shared or
that changed an assertion. Gemini did not answer item 7.
