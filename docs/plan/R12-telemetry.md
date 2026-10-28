# R12 — Telemetry export (OpenTelemetry)

**Unit:** R12 (M2, maintainer)
**Depends on:** P9 API + CLI, P13 Cost control, P14 Enforcement record, R2 Outcome measurement
**Blocks:** nothing. The control plane will chart what this exports.

An operator needs to see the line running, and a dashboard is where they look.
R12 turns a finished run's records into OpenTelemetry traces and metrics that
any OTLP backend accepts. It reads the records an auditor reads: the Vault, the
usage records P13 writes from the relay's meter, and the decisions P14 records.
Anyone holding those records can recompute what it emits (D-A-LC-09).

Nothing reads telemetry back. No gate, level, rate, or refusal takes it as input,
because anyone on the collector's path can alter the stream. No prompt,
completion, claim narrative, check output, or event payload is exported. Every
attribute comes from a fixed allowlist of typed fields (I7).

---

## What the records hold, verified against the code

| Span or metric | Record | Time it carries |
|---|---|---|
| run | `AdmissionRecord.run.createdAt`; a refused admission's `decidedAt` | start only |
| station | `RunState.station`, the latest only | **none** |
| task / attempt | `UsageRecord`, one per driver call | **none** |
| check | `EvidenceBundle.checks[]`: `startedAt`, `durationMs` | start and duration |
| decision | `EnforcementDecision.decidedAt` | an instant |
| merge | `IntegrationMerged.mergedAt` (GitHub's time) | an instant |

The entry promised spans for each station, task, and attempt. No record holds
their times, and the only per-call duration, `TaskResult.usage.wallClockMs`, is
the driver's own account (I2). Building spans from that would make times up. Two
contract amendments close the gap (below), as the maintainer chose on 2026-10-28.

The relay normalises every dialect so that `inputTokens` excludes cached input
and cache reads and writes are counted on their own
(`packages/sandbox/src/local/relay.ts`). The OpenTelemetry convention counts
`gen_ai.usage.input_tokens` *including* cached tokens. So the export sums the
three. Nothing is rescaled or estimated.

## Deliverables

- **Call times, recorded (A-R12-01).** A `UsageRecord` gains a required `timing`
  field. The pending record carries `{ startedAt, endedAt: null }`, stamped by
  the runtime's clock just before the driver is called. The terminal record
  carries the same `startedAt` and an `endedAt` stamped after the sandbox is torn
  down and its meter read. A `lost` record is stamped the same way. The Vault
  refuses a record without `timing`. A pre-R12 record is read as
  `timing: 'not-recorded'`, never as a guess, by `readUsage` in `api`, which
  parses every usage record the Vault returns as bytes.
- **Station entries, recorded (A-R12-02).** `RunState` gains `stations`: one
  `{ station, enteredAt }` for every station the run entered, in order. Admission
  writes the first entry, and the line appends one on every commit that changes
  the station. The Vault reads a pre-R12 state as `[]`. Because every state
  committed from now on holds at least the admission entry, an empty list means
  "not recorded" and never "no stations".
- **`telemetryOf(vault, runId)` in `api`.** It returns `{ traces, metrics }` as
  OTLP/JSON request bodies (`ExportTraceServiceRequest`,
  `ExportMetricsServiceRequest`), hand-written with no third-party dependency. It
  refuses a run whose R2 ending is `unfinished`, so an export never describes a
  run that may still change.
  - **Trace.** One trace per run. The trace id and every span id come from a
    SHA-256 of the run id and the record the span is drawn from, so exporting the
    same run twice sends the same ids.
  - **Spans.** One `run` span runs from admission to the latest time any record
    holds. Under it sits one `station` span per entry, from its `enteredAt` to the
    next entry's, or to the run's end. Under a station sits one `task` span per
    task that acted there, covering its calls and checks. Under a task sits one
    `invoke_agent` span per terminal usage record, from `startedAt` to `endedAt`,
    and one `check` span per check result, from `startedAt` for `durationMs`.
    Checks hang under the task's span at `verify`.
  - **Span events.** Each enforcement decision becomes an event on the span of
    the station it names, at its `decidedAt`. It carries its `cause` and
    `decidedBy` and nothing else.
  - **Attributes (GenAI semantic conventions, pinned at
    `open-telemetry/semantic-conventions-genai@51a0f58`).** An `invoke_agent`
    span carries:
    - `gen_ai.operation.name` = `invoke_agent`
    - `gen_ai.provider.name` = the model's provider
    - `gen_ai.request.model`
    - `gen_ai.agent.name` and `gen_ai.agent.version` = the role id and the role's
      sha256
    - `gen_ai.usage.input_tokens` (inclusive, as above), `gen_ai.usage.output_tokens`,
      `gen_ai.usage.cache_read.input_tokens`, and
      `gen_ai.usage.cache_write.input_tokens`

    Facts the conventions have no name for go under the `factory.` namespace:
    run, task, station, attempt, cost in USD, relay call count, relay refusals,
    the reading's kind, the run's ending, the requested level, a check's id and
    exit code, and the driver's own tool-call count. The tool-call count is named
    `factory.claim.tool_calls` because it is the driver's account, not the
    runtime's (I2).
  - **Absence is explicit.** A `lost` or `unmetered` reading carries no token or
    cost attribute, and is never exported as a zero. A `lost` call's span has
    status `ERROR`. A run recorded before the amendments exports no station or
    call spans it cannot time. Its run span carries
    `factory.stations.recorded=false` and `factory.calls.untimed=<n>`.
  - **Metrics.** Every data point is per call, with `DELTA` temporality, and its
    start and end are the call's own times:
    - `gen_ai.client.operation.duration` (histogram, s)
    - `factory.usage.tokens` (counter, by `factory.token.kind`)
    - `factory.usage.cost` (counter, USD)

    A re-export sends the same series, timestamps, and values.
- **`GET /runs/:id/telemetry`** returns `{ traces, metrics }`. It answers `404`
  when no run has that id and `409 not-finished` for an unfinished run.
- **`olympus-ai telemetry <run id>... [--endpoint <url>] [--header <name=value>]...`**
  - Without `--endpoint` it prints each run's export as JSON lines.
  - With `--endpoint` it POSTs the traces to `<endpoint>/v1/traces` and the
    metrics to `<endpoint>/v1/metrics` as `application/json`, then reports each
    response's status.
  - The endpoint and headers may also come from `OTEL_EXPORTER_OTLP_ENDPOINT` and
    `OTEL_EXPORTER_OTLP_HEADERS`.
  - The server never makes the outbound request, so a token holder cannot point
    the runtime at an arbitrary host. The client the operator ran does it.

## Contract amendments, landed in this unit's pull request

- **A-R12-01.** `UsageRecord` gains
  `timing: { startedAt: string; endedAt: string | null } | 'not-recorded'`. Only
  the Vault's read of a pre-R12 record produces `'not-recorded'`, and the
  Vault's write refuses it. `endedAt` is null on a `pending` record and on no
  other.
- **A-R12-02.** `RunState` gains `stations: readonly { station: StationId; enteredAt: string }[]`.

Anything further found in the work stops the unit for confirmation.

## Out of scope

- live instrumentation of the line, or spans for a run still in flight
- the server pushing to a collector, a background exporter, or a retry queue
- any metric or attribute that is read back by a gate, a level, or a rate
- prompt, completion, claim narrative, check stdout or stderr, event payloads, or
  any opt-in to export them
- the Claude Code CLI's own telemetry (D-A-LC-09)
- a dashboard, local or hosted, or a reference dashboard definition. The entry
  allows one ("may"), and it is left to the control plane's work.
- OTLP/protobuf or gRPC transport. Only OTLP/HTTP JSON is supported.
- listing every run over the API so that `telemetry` can export a window (the
  caller names the runs)
- re-timing records written before the amendments

## Conformance

- A fixture Vault of hand-built finished runs with known answers:
  - The span tree has the shape above.
  - Ids are equal across two exports.
  - Input tokens are the inclusive sum.
  - A `lost` call has no token attribute and status `ERROR`.
  - A pre-R12 run exports no station or call spans and says so.
  - An unfinished run is refused.
  - A refused admission exports one run span.
- **Allowlist scan.** No attribute key outside the declared allowlist appears,
  and no attribute value equals a claim's narrative or a check's stdout.
- **No read-back scan.** No module in `api` other than the export and its route
  imports the telemetry module.
- **The amendments.**
  - The line stamps `timing` on the pending and the terminal record.
  - The Vault refuses a usage record without `timing`.
  - A pre-R12 record reads as `'not-recorded'`.
  - Admission and every station change append to `stations`.
- **The CLI test.**
  - `telemetry` prints the same export the library returns.
  - With `--endpoint`, it posts both bodies to a local HTTP listener with the
    given headers.

## Acceptance

- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
- `pnpm conformance` passes, with the R12 assertions registered.
  `pending-baseline.json` is unchanged.
- There are changesets for `@olympus-ai/vault`, `@olympus-ai/api`, `olympus-ai`,
  and `@olympus-ai/conformance`.
- `git ls-files -- .plan/` prints nothing.

**Gate paths:** `packages/vault/src/types.ts`, `packages/core/src/run/types.ts`,
and `packages/conformance/` are protected. The pull request carries the
`gate-change` label, and the squash body carries `Gate-Change: acknowledged`.

**Invariants:**

- **The model never reports status (I2).** Every time comes from the runtime's
  clock or GitHub's, never from the driver. The driver's tool-call count is
  labelled as its claim.
- **Fail closed (I5).** An unfinished run is refused. A missing time is
  `not-recorded`, never a guess, and a missing reading is never a zero.
- **Payloads are data, never instructions (I7).** No text field is exported.
- **Every capability claim has an executable assertion (I8).** Each span kind and
  each amendment has an assertion that fails when its derivation is deleted.
- **The runtime is a service; the CLI is a client (I9).** The export is a route
  on the service. The CLI only fetches and posts.
- **No Greek names in code (I10).** The attribute namespace is `factory.`, not
  the product's name.
