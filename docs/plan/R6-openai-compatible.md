# R6 — Driver: any OpenAI-compatible endpoint

**Unit:** R6 (M2)
**Depends on:** P5, P10, P12
**Blocks:** nothing named. R21 (a local endpoint) builds on it.

The `DECOMPOSITION.md` entry is binding and is not repeated here. This spec is
what the entry rests on, checked against the code on `v2` at d039910, and the
choices the entry leaves open, each recorded in `docs/decisions.md` (D-R6-01
onwards). The maintainer confirmed the scope below on 2026-10-24 and delegated
every later decision in the unit to the session's recommendation.

---

## What the code holds, verified against it

| Input | Where it is | What it means here |
|---|---|---|
| A relay reaches one `https` origin and refuses one without a credential | `sandbox/src/local/relay.ts`, `checkRelay` and the relay's start checks | a local endpoint over `http` with no key cannot be served; that is R21 |
| The relay's sandbox egress must not name its upstream | `sandbox/src/types.ts`, `RelaySpec` (D-P12-11) | the entry's "the endpoint host is the allowlist's only entry" is read as "the relay's upstream is the only route"; egress stays `deny-all` |
| The meter's dialect is a closed union of one | `RelayMeter.dialect: 'anthropic-messages'` | R6 adds `'openai-chat'` (A-R6-01) |
| The relay writes the credential into its header verbatim | `relay.ts`, `send` | `Authorization: Bearer <key>` cannot be written; R6 adds a scheme (A-R6-02) |
| A driver's gaps are `DriverCapabilities`, `declaredTools()`, and `relayRequest()` | `core/src/driver/contract.ts` | `unavailableControls()` is the adapter set's; the entry's "refuses the levels that need it" is the line's existing refusals of a missing capability, an ungranted tool, and a relayless driver above L1 |
| Only `ClaudeCodeDriver` is attested in a driver seat | `api/src/graph.ts`, `REAL` | any other driver carries no run above L1 until it is attested (A-R6-04) |
| The spine's package list names two drivers | `F1-spine.md`, Packages | `drivers/openai-compatible` is added there (A-R6-03) |
| `ModelIdentity.family` is branded and explicit | `core/src/driver/contract.ts` | the operator's declaration is branded once, in the constructor |
| The relay takes an extra trust anchor | `LocalDockerOptions.relayTrust`, `relay.ts` `RELAY_TRUST` | every assertion runs against a TLS endpoint the test owns, with no model spend |
| `ExecOptions.stdin` | `sandbox/src/types.ts` | a model request reaches the in-sandbox caller on stdin, with no size bound from the environment |

---

## Deliverables

- **`@olympus-ai/driver-openai-compatible`**, at `packages/drivers/openai-compatible`,
  depending on `core` and `sandbox` alone. `OpenAICompatibleDriver` implements
  `Driver`. Its configuration is the operator's, stated in full and validated in
  the constructor: the endpoint's `https` origin and chat-completions path; the
  authentication header and scheme; the provider name, **the family**, and a
  version label; the exact model id for each tier; a price for each of those
  models; the output ceiling per call and the request field that carries it;
  the parallelism; and the turn bound. Nothing has a default that changes what
  the run means, and nothing is inferred from the URL, a model name, or a
  response (D-R6-02).
- **The agent loop is the driver's, on the host** (D-R6-01). Each model turn is
  one `provider.exec` of a fixed `node` program inside the sandbox, handed the
  request body on stdin, which posts it to the relay's address and prints the
  status and body. Each tool call is one or more `provider.exec` calls inside
  the sandbox. Nothing the model asks for runs on the host; the host holds the
  conversation and decides which calls are made.
- **Tools.** The inventory is `Bash`, `Edit`, `Read`, `Write`, named as policy
  already grants them to the Claude Code driver, so one policy serves both
  (D-R6-04). A request granting anything else is refused before the task
  starts. A model is offered only the granted tools' definitions; a call naming
  any other tool is answered with an error the model reads and recorded as a
  refused tool call, never run.
- **Identity.** `resolveModel` returns the configured provider, family,
  model, and version. Every response must name exactly the model the request
  named; a response naming another, or none, refuses the task (D-R6-03).
- **Usage.** Every response must report usage; one that does not refuses the
  task, as the relay has already stopped forwarding (D-R6-05).
  `TaskResult.usage` is the endpoint's own figures summed, priced from the
  operator's table: a claim, as the Claude Code driver's is, and never the
  source of a cost figure (P13).
- **Capabilities.** `subagents`, `hooks`, `mcp`, `computerUse`, `steering`, and
  `stablePrefixCaching` are `false`, and each is proven absent.
  `parallelism` is the configured number, enforced across sandboxes, with one
  task per sandbox at a time, as A-R4-04 requires (D-R6-06).
- **The relay reads `openai-chat`** (A-R6-01). A `POST` to a granted path ending
  `/chat/completions` is metered; a `GET` is free; anything else is refused as
  unmeterable. The request's `model` must be priced, its ceiling is
  `max_completion_tokens` or `max_tokens` times `n`, and its usage is
  `prompt_tokens`, `completion_tokens`, and `prompt_tokens_details.cached_tokens`,
  read from a JSON body or from the stream's usage chunk. Every rule P13 set for
  the other dialect holds unchanged: unpriced refused before sending, no ceiling
  refused, no final count charged the ceiling, no usage at all charged the
  ceiling and stopping the relay.
- **The relay writes a scheme** (A-R6-02). `RelaySpec.scheme` is `'raw'` or
  `'bearer'`, required; `'bearer'` writes `Bearer <credential>`.
- **The line attests the driver** (A-R6-04). `buildGraph` accepts an
  `OpenAICompatibleDriver` as real in every driver seat.
- **The host can seat it** (D-R6-07). `factory-host` reads an optional
  `FACTORY_ENDPOINT_CONFIG`, a JSON file outside the repository naming the
  endpoint and the seats it fills, and `FACTORY_ENDPOINT_KEY`, its credential.
  Either without the other, or a file that does not parse exactly, stops the
  host before it listens.

## Out of scope

- a local endpoint: an `http` upstream, an endpoint with no credential, and the
  sandbox network route to the host that reaching one needs. That loosens two
  fail-closed rules of the relay and changes the sandbox's network posture, so
  it is its own unit, R21
- an endpoint that reports no usage figures. Refused, not served unmetered
- streaming. The driver sends non-streamed requests; the relay meters a stream
  anyway, because a request it forwards is not the driver's to choose
- subagents, MCP, hooks, steering, and any artifact format: `emitArtifacts`
  refuses, as the driver renders a role on each request and nowhere else
- a paid suite against a real endpoint. Every assertion runs against a TLS
  endpoint the test owns
- a model per station (R14's), and changing what the compiler renders
- the egress allowlist; a task's network grant is unchanged by this driver

## Conformance

A task's tools run in the sandbox and nowhere else; a tool not granted is never
offered and never run; the family is the operator's and a response naming
another model refuses the task; the credential never reaches the sandbox and is
written as the endpoint's scheme requires; the relay meters and bounds an
`openai-chat` call exactly as it does an `anthropic-messages` one; each declared
capability is what the driver does.

## Acceptance

- against a TLS endpoint the test owns, inside a real sandbox with a real relay:
  a scripted conversation of `Write`, `Edit`, `Read`, and `Bash` calls changes
  the workspace as written, every command runs in the container, and the result
  records each call as an event and each write in `filesChanged`
- the request the endpoint received offers the granted tools' definitions and
  no others; a grant outside the inventory is refused before any exec; a model
  call naming an ungranted tool is answered with an error and changes nothing
- a response naming another model, or none, and a response with no usage,
  refuse the task; a relay refusal (402) refuses it naming the budget
- the endpoint received `Authorization: Bearer <the provider's credential>`;
  the credential is in no file, environment, or argument of the sandbox
- `parallelism` tasks overlap and one more waits; a second task on one sandbox
  waits for the first
- every capability declared false is absent, in both directions
- in `packages/sandbox`: the `openai-chat` dialect's metering, ceilings,
  refusals, and stream reading; the `bearer` scheme; a spec without a scheme or
  with an unknown one refused at the `relay` layer
- `buildGraph` attests the driver; the host refuses half an endpoint
  configuration and seats the configured seats
- **the ledger.** Added live, none pending: `I1.openai-compatible-driver-executes-inside-the-sandbox`,
  `I4.openai-compatible-driver-tool-inventory-validated`,
  `I4.openai-compatible-credential-not-readable-by-the-task`, and
  `I6.openai-compatible-family-is-declared`, external in
  `@olympus-ai/driver-openai-compatible`; `I4.model-relay-enforces-budget-openai-chat`
  and `I5.model-relay-fails-closed-on-unmetered-usage-openai-chat`, runtime in
  `packages/conformance/src/registry/local-relay.ts`; and a second assertion
  under each `driver.*` claim, `driver.<capability>.openai-compatible`.
  `pending-baseline.json` is unchanged
- `pnpm typecheck` and `pnpm lint` pass; `pnpm -r --filter '!@olympus-ai/driver-claude-code' --filter '!@olympus-ai/conformance' test`
  passes locally. The Claude Code driver gains a `scheme` on its relay, which
  changes its tree, so its paid suite, the conformance package's tests, and
  `pnpm conformance` pass once in CI after the maintainer applies `run-driver`
  (D-A-CI-05), as P13's did
- `git ls-files -- .plan/` prints nothing
