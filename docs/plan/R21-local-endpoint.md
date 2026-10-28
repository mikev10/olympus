# R21 — Local model endpoint

**Unit:** R21 (M2)
**Depends on:** R6
**Blocks:** nothing named.

The `DECOMPOSITION.md` entry is binding and is not repeated here. This spec is
what the entry rests on, checked against the code on `v2` at f99ea35, and the
choices the entry leaves open, each recorded in `docs/decisions.md` (D-R21-01
onwards). On 2026-10-28 the maintainer confirmed three choices: a local endpoint
is the Docker host and nothing else; a relay with no credential is allowed only
for one; and the session writes this spec and takes every later decision.

---

## What the code holds, verified against it

| Input | Where it is | What it means here |
|---|---|---|
| The relay refuses an upstream that is not an `https` origin naming a host | `sandbox/src/local/relay.ts`, `checkRelay` and `RELAY_SOURCE`'s start checks | `http` is reachable only through a new declaration; neither check is relaxed for a URL |
| The relay refuses to start without a credential | `RELAY_SOURCE`, `credential === ''`; `checkRelay`, `held.has` | no credential needs a declaration of its own |
| `RelaySpec.scheme` is `'raw' \| 'bearer'`, required | `sandbox/src/types.ts` (A-R6-02) | `'none'` joins it, paired with a `null` credential |
| The relay's outbound network is a user-defined bridge the sandbox never joins | `relay.ts`, `startRelay` | a name for the host added to the relay container alone gives the relay a route and the sandbox none |
| A container on a Docker `--internal` network cannot reach the host by `host.docker.internal`, by an added name, or by the host gateway's address | run on Docker 29.8.0 (Docker Desktop): timeout, reset, and `ENETUNREACH` | the sandbox's posture is unchanged; an assertion holds it |
| `--add-host <name>:host-gateway` on a bridge container reaches a listener on the host bound to `127.0.0.1` or `0.0.0.0` | run on the same daemon | the route works without a host network. On a Linux engine `host-gateway` is the bridge's address, so a server bound to loopback alone is not reachable; that is the operator's to configure, and the spec says so |
| A provider hands a relay only the credentials it was given | `LocalDockerOptions.credentials`, `checkRelay`'s `held` | a route to the host is held the same way: a port the provider was not given is refused |
| The driver's configuration takes an `https` origin and a scheme of `'raw'` or `'bearer'` | `drivers/openai-compatible/src/config.ts`, `checkConfig` | both widen to the relay's new declarations |
| The host requires `FACTORY_ENDPOINT_CONFIG` and `FACTORY_ENDPOINT_KEY` together | `api/src/host/main.ts`, `parseEndpointFile` | a keyless endpoint comes without a key, and a key beside one is refused |

---

## Deliverables

- **A local upstream** (A-R21-01). `RelaySpec.upstream` is an `https` origin, as
  today, or `{ local: 'docker-host', port }`. The second is the only way the
  relay speaks `http`: it forwards to `http://model-host:<port>`, and the relay
  container alone is started with `--add-host model-host:host-gateway`. A URL
  is never read as local, whatever it names: `http://localhost:11434` is
  refused as it is today.
- **No credential, declared** (A-R21-02). `RelaySpec.credential` is a name, as
  today, or `null`, and `RelayScheme` gains `'none'`. `null` and `'none'` come
  together or the spec is refused, and only with a local upstream. An absent
  credential is refused, never read as none. Under `'none'` the relay writes no
  credential and still drops what the client sent in `header` and every other
  authentication header, so a placeholder key in the sandbox reaches no
  endpoint. `AppliedRelay` records the credential as `null` and the upstream it
  forwarded to.
- **The provider holds the route** (A-R21-03). `LocalDockerOptions.dockerHostPorts`
  names the ports on the Docker host a relay may be pointed at. Absent or
  empty, every local upstream is refused at the `relay` layer, as an unheld
  credential is.
- **The relay checks it again at start.** The relay's own source refuses an
  `http` upstream unless it was started local, a local upstream whose host is
  not `model-host`, and an empty credential unless the scheme is `'none'` and
  the upstream local. Each exits before the server listens.
- **The driver takes it** (A-R21-04). `EndpointConfig.upstream` takes the same
  local declaration and `scheme` takes `'none'`; `relayRequest` sends a `null`
  credential under `'none'`. Nothing else in the driver changes: prices, the
  family, and every R6 refusal are the operator's and the relay's as before.
- **The host seats it** (A-R21-04). An endpoint file whose `scheme` is `'none'`
  needs no `FACTORY_ENDPOINT_KEY`, and one given beside it stops the host. A
  local upstream's port is handed to the provider's `dockerHostPorts`. Every
  other rule of D-R6-07 holds.

## Out of scope

- any address but the Docker host: a LAN machine, a named Docker network, a
  container's name, or an `http` URL of any kind
- an `https` endpoint with no credential
- starting, stopping, pulling, or health-checking the local model server
- binding the host's server for the operator, or detecting one bound to
  loopback on a Linux engine; the relay's call fails, and the run says why
- a price inferred from the endpoint being local. Its prices are the operator's
  table; zero is a price the operator writes
- any change to the sandbox's egress, the proxy, or the allowlist
- a paid suite. Every assertion runs against a listener the test owns

## Conformance

The relay reaches the Docker host only on a port the provider was given and a
spec declared, over `http` only then, and with no credential only then; the
sandbox reaches neither the host nor the endpoint; what the endpoint receives
carries no authentication from the sandbox; metering and the budget are those
of any other relay.

## Acceptance

- `I4.model-relay-reaches-the-docker-host-only-as-declared`, runtime, in
  `packages/conformance/src/registry/local-relay.ts`. Against a real daemon and
  an `http` listener on the host the test owns: a keyless local relay forwards
  its granted path; the listener receives no `authorization`, `x-api-key`, or
  `header` value although the sandbox sent each; the call is metered under
  `openai-chat`; the sandbox cannot reach the listener through `model-host`,
  `host.docker.internal`, or the gateway's address; the relay's argv carries
  the host route and no credential variable; a port the provider was not given
  is refused at the `relay` layer; the relay and its networks go with the sandbox
- `I5.model-relay-refuses-an-undeclared-local-endpoint`, runtime, same file:
  `checkRelay` refuses an `http` URL, `localhost` included; a `null`
  credential with an `https` upstream, with `'raw'`, or with `'bearer'`;
  `'none'` with a credential; an absent credential; a local upstream with a
  port that is not an integer in 1–65535, a `local` other than `'docker-host'`,
  or another field. `RELAY_SOURCE`, run with `node` on the host, exits non-zero
  naming the cause for an `http` upstream not started local, a local upstream
  not named `model-host`, and an empty credential under `'raw'`
- in `packages/sandbox`, `drivers/openai-compatible`, and `api`: unit tests of
  each new branch, each shown failing against the code before it
- `pnpm typecheck` and `pnpm lint` pass; `pnpm -r --filter '!@olympus-ai/driver-claude-code' --filter '!@olympus-ai/conformance' test`
  passes locally, and so does the conformance package's own `vitest` run of
  the two new assertions. `sandbox` is in the Claude Code driver's tree
  (`scripts/driver-report-key.ts` hashes every workspace package it depends
  on), so its paid suite, the conformance package's tests, and
  `pnpm conformance` pass once in CI after the maintainer applies `run-driver`
  (D-A-CI-05), as R6's did. The two assertions are registered and
  `pending-baseline.json` is unchanged
- changesets for `sandbox`, `driver-openai-compatible`, `api`, and `conformance`
- `git ls-files -- .plan/` prints nothing
