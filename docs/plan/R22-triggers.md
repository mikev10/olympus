# R22 — Trigger framework

**Unit:** R22 (M2, maintainer)
**Depends on:** P3, P9, P12, P14, R19
**Blocks:** R8, R10, R13, R16

The `DECOMPOSITION.md` entry is binding and is not repeated here. This spec is
what the entry rests on, checked against the code on `v2` at 89d8200, and the
choices the entry leaves open, each recorded in `docs/decisions.md`
(D-A-TF-01 to D-A-TF-08), all confirmed by the maintainer on 2026-10-29. It replaces the recorded gap "the M2 trigger
framework has no spec" and honours the recorded constraint on event
subscriptions (D-A-DD-02): whatever transport carries an event, its payload is
untrusted and only extracted fields go further (I7), a subscription is a grant
in policy (I4), and the secret that verifies a delivery is held where P12
holds credentials, never inside a sandbox.

Amended when the unit started, confirmed by the maintainer on 2026-10-29
(D-R22-02 to D-R22-04). GitHub signs neither a timestamp nor a delivery id,
so replay is refused by the body's digest and staleness by the body's own
time. A refused delivery has no run, so its outcome is a record kept beside
the runs. A candidate expires after a window of its own.

---

## What the code holds, verified against it

| Input | Where it is | What it means here |
|---|---|---|
| `TriggerPolicy` is validated and cloned, and read by nothing else | `core/src/policy/validation.ts`, `engine.ts`, `cloneTriggers`; no reader in `api/src` | `enabled`, `maxAutonomy`, `minAuthorTrust`, `maxTriggerDepth`, and `budgetPerWindow` bind nothing today, the human trigger included |
| Every run's trigger is a literal | `api/src/run.ts:865`, `{ kind: 'human', eventId: req.runId, lineage: { depth: 0, … } }` | no path admits any other kind; this unit adds the first |
| `CapabilityScope.triggerKinds` is validated and read by nothing | `validation.ts:374`, `engine.ts:75` | a role's trigger kinds are inert, as above |
| The shipped default enables `human` with an empty `taskTemplate` | `core/src/policy/default.ts:53` (D-P3-05) | the template rule is for non-human kinds; `human` keeps its route |
| `TriggerEvent.extracted` is `Record<string, string>` | `triggers/src/types.ts` | the field schemas are what close it (`I7.extracted-field-schemas`) |
| `UntrustedText` is opaque, and the cast scan, three lint rules, and the inline-suppression check guard it | `triggers/src/types.ts`; `conformance/src/registry/i7.ts` | `JSON.stringify(raw)` and widening to `unknown` still pass (D-F3-06); the sink rule closes them |
| Three I7 entries are pending, owner `M2` | `i7.ts`: `enabled-trigger-declares-a-template`, `extracted-field-schemas`, `untrusted-sink-lint-rule` | this unit discharges all three and re-owns nothing |
| An intent is `{ text, from: 'principal' }`, built only by `POST /runs` | `api/src/run.ts` `Intent`; `http/server.ts:329` (R19) | a trigger can never supply one; a triggered event cannot start a drafting run by itself |
| Every route requires the local token | `http/server.ts:417` | a delivery route authenticates by its signature instead, and is the one route that does |
| The service listens on `127.0.0.1` by default | `host/main.ts:75` | reaching it from a provider is the operator's tunnel, not this unit's |
| Host secrets come from the environment, never a sandbox | `host/main.ts`, `FACTORY_ENDPOINT_KEY`; `sandbox/src/types.ts` `RelaySpec.credential` names a credential and never carries it | a subscription names its secret the same way |

Assumptions the unit verifies again at start, because they rest on code it does
not own: the benchmark's line requests no level above its `maxAutonomy.human`
of 1 (`benchmark/src/line.ts:173`), so enforcing the human cap changes none of
its runs; and P14's record has a cause union a trigger refusal joins.

---

## What a trigger does

An admitted event does one of two things, and the policy names which, per
kind, as a template from a closed set in code (D-A-TF-01):

- **`intake-candidate`.** The event is recorded in the Vault as a candidate.
  Nothing runs. A person reads it and, if they choose, admits a run from it
  through `POST /runs`, writing the intent themselves (R19). The run's
  `TriggerRef` is the candidate's kind, event, and lineage, so the kind's
  autonomy cap and trust floor bind it. This is the template R16 uses, and
  the only one this unit ships.
- **A job template** a later unit adds: R13's nightly jobs on `scheduled`,
  R8's signal recorded against a run on `post-merge` and `ci-failure`. A job
  template takes extracted fields as its only input, seats no drafter, and
  never enters the line's build. This unit defines the registry and its
  rules; it adds no job.

No trigger starts a build. A template that does is a later amendment, and
must say what supplies the spec when no person wrote an intent.

---

## Deliverables

- **Admission reads the trigger policy, for every kind** (D-A-TF-02). A run is
  refused, before any driver call and recorded in P14's record, when its
  kind is not in `enabled`; when its requested level exceeds `maxAutonomy` for
  the kind, or the kind has no entry; when its author's trust is below
  `minAuthorTrust`, or the kind has no entry; when its lineage depth exceeds
  `maxTriggerDepth`; or when a task's role does not list the kind in
  `triggerKinds`. A request over the cap is refused, never clamped. The human
  trigger's principal is `owner`. A run admitted from a candidate counts
  against `budgetPerWindow` when its candidate is admitted, not again.
- **A non-human kind is enabled only with its whole route** (D-A-TF-03,
  `I7.enabled-trigger-declares-a-template`). The policy validator refuses a
  non-human kind in `enabled` without an `entryStation`, a `taskTemplate` that
  names a template in the registry, a `maxAutonomy`, a `minAuthorTrust`, and a
  field schema in code. `human` keeps D-P3-05's route. A `taskTemplate` naming
  no registered template is refused, so a payload has nothing left to fill.
- **Field schemas, per kind, in code** (D-A-TF-04, `I7.extracted-field-schemas`).
  Each kind with a schema has a closed set of fields; each field has a byte cap
  and a character class, checked whole. An extractor that returns an unknown
  field, a missing required field, or a value outside its class has its event
  refused, naming the field; a value is never truncated or cleaned to fit. No
  schema has a field for free text: no title, body, comment, commit message,
  or log. `TriggerEvent.extracted` becomes the schema's typed record. This unit
  ships schemas for `scheduled` (the job id, from the policy's list),
  `post-merge` and `ci-failure` (repository, ref, commit, and for a failure the
  check name and conclusion), and the new `issue` kind (repository, the issue's
  number, labels drawn from an allowlist the policy names, author trust).
  `review-feedback` gets none, so it cannot be enabled.
- **The `issue` kind** (A-R22-01). `TriggerKind` gains `'issue'`, the tracker
  trigger R16 names.
- **Subscriptions are granted in policy** (D-A-TF-05). `TriggerPolicy` gains
  `subscriptions`: each has an id, a kind, a source, a transport, and the name
  of the secret that verifies its deliveries, never the secret. A delivery for
  an id the policy does not name is refused before its body is read. Adding a
  subscription is a policy edit, versioned and pinned as any other.
- **One transport, signed webhooks** (D-A-TF-06). `POST /events/<subscription>`
  is the one route outside the local token. The body is capped in bytes
  before it is read; its HMAC-SHA256 over the exact bytes is checked against
  the named secret in constant time before it is parsed; a body whose digest
  the Vault already holds for the subscription is refused as replayed, the
  digest stored in the same write as the delivery's outcome; and a body whose
  own signed timestamp is older than the policy's `maxDeliveryAgeMs` is
  refused as stale, after the parse and before extraction. GitHub signs no
  timestamp and no delivery id, so neither is read (D-R22-02). The
  host resolves the secret from its environment, as it does
  `FACTORY_ENDPOINT_KEY`, and no sandbox spec can name it. MCP Events is not a
  transport here; it is a draft.
- **One source, GitHub** (D-A-TF-07). Extractors from GitHub's webhook shapes
  for `post-merge` (a push to the default branch), `ci-failure` (a completed
  check run whose conclusion is a failure), and `issue` (an issue opened or
  labelled). Author trust comes from the delivery's `author_association`,
  capped by a ceiling the subscription declares; absent or unknown is
  `anonymous`. Each extractor is the only code that reads `raw`, through the
  one cast the cast scan allows.
- **The schedule** (D-A-TF-08). `TriggerPolicy` gains `schedules`: each has an
  id, a template, and a daily time in UTC. The service fires each once a day
  as a `scheduled` event whose one field is the schedule's id. A firing missed
  while the service was down is recorded as missed, never run late in a burst.
- **Lineage, budget, and the record.** An event that names a commit or a pull
  request an Olympus run produced carries that run's chain plus the run, and
  its depth is one more. `budgetPerWindow` counts admitted events across kinds
  in a sliding window; an event over it is refused and recorded, never queued.
  Every refusal names its cause: `not-subscribed`, `unverified`, `replayed`,
  `stale`, `oversize`, `schema`, `not-enabled`, `depth`, `budget`, or
  `trust`. A refusal at a run's admission is in that run's P14 record. A
  verified delivery's outcome is a trigger decision kept beside the runs, not
  under them; a request refused before its signature verifies is counted per
  subscription and hour, by cause, and never written alone (D-R22-03). A
  candidate stores the raw payload in the Vault beside its hash, readable by
  the principal through the API and never by a driver.
- **The sink rule** (`I7.untrusted-sink-lint-rule`). A type-aware ESLint rule
  in the workspace configuration rejects a value typed `UntrustedText` or
  `UntrustedPayload` as an argument to `JSON.stringify` and as the source of an
  assignment, argument, or return whose target type is `unknown` or `object`.
  It joins the three I7 rules in `I7.lint-rules-active`, `-fire`, and
  `-not-suppressed-inline`.
- **The API.** `GET /intake` lists candidates; `GET /intake/<id>` returns one
  with its raw payload; `POST /runs` takes `candidate`, admitting the run under
  the candidate's trigger, once, and the admission record names the candidate
  and its trigger decision. A candidate admitted cannot be admitted again; one
  older than the policy's `candidateExpiryMs`, on the runtime's clock from
  when it was recorded, is recorded as expired and refused (D-R22-04).

## Contract amendments, owed by the unit's pull request

- **A-R22-01:** `TriggerKind` gains `'issue'`
- **A-R22-02:** `TriggerPolicy` gains `subscriptions`, `schedules`,
  `maxDeliveryAgeMs`, and `candidateExpiryMs`, the last two required when a
  non-human kind is enabled; `taskTemplate` values are a `TemplateId` from
  the registry, not a string
- **A-R22-03:** `TriggerEvent.extracted` is the kind's typed field record
- **A-R22-04:** `RunRequest` gains `candidate: CandidateId | null`; the Vault
  gains the candidate record, the trigger decision, the refused-delivery
  counts, and their operations; `AdmissionRecord` gains the candidate it was
  admitted from
- **A-R22-05:** admission's refusal union gains `trigger-refused` and
  `candidate-expired`; the trigger decision's cause union is the ten causes
  above

## Out of scope

- any template that starts a build, and every job template: R13's jobs,
  R8's signal, R16's bug-fix template
- narrowing a task's capability on untrusted input (R10)
- `review-feedback`'s schema and extractor, and any source but GitHub
- MCP Events, polling a provider's API, and writing back to a tracker
- exposing the service to the internet: the tunnel, TLS, and the provider's
  webhook settings are the operator's
- a CLI for candidates beyond what the API returns
- a cron grammar; one daily time per schedule

## Conformance

A kind not enabled, a level over its cap, an author below its floor, a depth
past the limit, and a role that does not list the kind each refuse admission,
for `human` as for any other; a non-human kind enabled without its whole route
does not validate; an extracted value outside its schema refuses the event and
nothing is truncated; no schema carries free text; a delivery for an unnamed
subscription, unsigned, wrongly signed, replayed, or oversized is refused
before it is parsed, and one stale or with no readable timestamp before it is
extracted; a refused body reaches no record but the refusal's hash, and a
request refused before verification is only counted; a failed write leaves
no digest, so a retry is admitted; no sandbox spec can name a subscription's secret; no driver request in a
run admitted from a candidate contains any byte of the raw payload; an event
over the budget is refused, not queued; a candidate admits one run; the sink
rule rejects each sink it names.

## Acceptance

- `I7.enabled-trigger-declares-a-template`, `I7.extracted-field-schemas`, and
  `I7.untrusted-sink-lint-rule` move from pending to registered, and
  `pending-baseline.json` lowers I7 by three in the same change
- new assertions for each sentence of the conformance paragraph, in
  `packages/conformance/src/registry/triggers.ts`, each shown failing against
  the code before it
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm conformance`, and
  `pnpm typecheck:tooling` pass
- changesets for `core`, `triggers`, `vault`, `api`, and `conformance`
- `git ls-files -- .plan/` prints nothing
