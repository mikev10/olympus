---
"@olympus-ai/core": minor
"@olympus-ai/triggers": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

The trigger framework (R22). Work enters the factory from a signed GitHub
webhook or a daily schedule as an intake candidate a person reads and may
admit. Nothing a trigger delivers starts a build or becomes an intent.

- `core`: `TriggerKind` gains `'issue'` (A-R22-01). `TriggerPolicy` gains
  `subscriptions`, `schedules`, `maxDeliveryAgeMs`, and `candidateExpiryMs`,
  and `taskTemplate` takes a `TemplateId` from the closed registry (A-R22-02).
  The validator refuses a non-human kind enabled without its whole route.
  Field schemas per kind, `checkFields`, and `admitTrigger`, the trigger check
  admission makes for every kind, `human` included.
- `triggers`: `TriggerEvent.extracted` is the kind's typed record (A-R22-03).
  The HMAC-SHA256 signature check, and the GitHub extractor, which is the only
  reader of `UntrustedPayload.raw`.
- `vault`: the intake store. A trigger decision and its candidate are one
  write under the body's digest. Refused-delivery counts, and the admitted and
  expired marks. `AdmissionRefusal` gains `trigger-refused` and
  `candidate-expired`, and `AdmissionRecord` names the candidate a run came
  from (A-R22-04, A-R22-05).
- `api`: admission reads the trigger policy, and `RunRequest.candidate`
  admits a run from a candidate, once. Routes: `POST /events/<subscription>`,
  the one route outside the local token, plus `GET /intake` and
  `GET /intake/<id>`. The daily schedule records missed firings. The host
  reads each subscription's secret from a `FACTORY_WEBHOOK_*` variable.
- `conformance`: the sink lint rule `i7/no-untrusted-sink`, and twelve trigger
  assertions. The three pending I7 entries are registered.
