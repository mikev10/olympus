---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"olympus-ai": minor
"@olympus-ai/conformance": minor
---

Telemetry export (R12). A finished run's records can be exported as
OpenTelemetry traces and metrics in OTLP/HTTP JSON:

- one trace per run;
- spans for each station, task, driver call, and check;
- token counts and cost from the relay's meter;
- decisions as span events.

`GET /runs/:id/telemetry` serves the export, and `olympus-ai telemetry <run id>...`
prints it or sends it to a collector. The runtime never makes that request; the
client does.

Two contract amendments supply the times the spans need:

- A usage record carries the runtime's start and end of the call (A-R12-01).
- Run state records each station the run entered, with the time (A-R12-02).

Records written before R12 are read as untimed, never given a time.
