---
"@olympus-ai/sandbox": minor
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/driver-claude-code": minor
"@olympus-ai/conformance": minor
---

P13: budget at the relay, cost in the Vault.

`@olympus-ai/sandbox`: `RelaySpec` requires `budget` and `meter` (A-P13-01).
The model relay meters `POST /v1/messages`. It reads the request's model and
the response's usage, and forwards both bodies unchanged. It refuses a model
with no price before sending. Once the tokens (all four classes) or the
dollars reach their bound, it refuses every later request with 402 and
`x-should-retry: false`. Token counting, `GET`, and `HEAD` are forwarded free.
Every other request is refused, because its cost cannot be counted
(D-P13-12). One metered call is in flight at a time (D-P13-13). A response
with no final usage is charged its `max_tokens`. One with no readable usage,
or in an unrequested encoding, marks the budget `unreadable`.
`SandboxProvider.destroy` returns a `MeterReading` (A-P13-02).
`LocalDockerProvider` reads it after the sandbox container is removed, by
stopping the relay and summing its per-call log lines against a closing line.
It throws when the log does not account for itself, and still tears the relay
down. A sandbox its wall clock ended returns its reading from its one
`destroy` (D-P13-14). `StubSandboxProvider` returns `unmetered`.

`@olympus-ai/core`: `RunState.usage` and the `'usage'` ref kind (A-P13-04).

`@olympus-ai/vault`: `UsageRecord` and `Vault.recordUsage` (A-P13-03).
`LocalVault` refuses a record that is not the runtime's, and a run state
without `usage`.

`@olympus-ai/api`: every driver call the line makes writes one `UsageRecord`
from what `destroy` returned: each build attempt, a failed one included, and
each review seat. A call whose cost cannot be read stops the run (D-P13-15).
`costTotals` and `readUsage` derive totals per run, station, and task from
the records alone, and count unmetered calls apart from metered ones.

`@olympus-ai/driver-claude-code`: the CLI is no longer given
`--max-budget-usd` (D-P13-10). The package exports `MODEL_METER`, a dialect
and a price table dated `PRICES_AS_OF`. `MODEL_RELAY` carries the meter and
leaves the budget to whoever provisions the sandbox.

`@olympus-ai/conformance`: added live, none pending. The runtime entries are
`I4.model-relay-enforces-budget`,
`I5.model-relay-fails-closed-on-unmetered-usage`, and
`I2.cost-is-runtime-metered`. The external entry is
`I2.relay-meter-agrees-with-session`, the paid control that the relay's
reading equals the CLI's own account of a session.
