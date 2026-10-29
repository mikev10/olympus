# Triage of the R21 external reviews, 2026-10-28

Two counted reviews of R21, a local model endpoint, against bundle `2bc338f9…`
(base `f99ea35`, head `7e52685`):

- codex (`gpt-6-astra`): 2 findings;
- gemini (`gemini-3.1-pro-preview`): 4 findings.

Gemini ran twice. Its first run was `FAILED`: the API answered HTTP 402 and no
reply came back (`2026-10-28-R21-local-endpoint-review-gemini.attempt-1.run.json`).
The rerun counted after the billing account was topped up. Both of codex's
findings were raised by gemini too, so the 6 findings make 4 distinct issues.

| Family | Raised | Hold | Hold in part | Do not hold |
|---|---|---|---|---|
| codex | 2 | 1 | 1 | 0 |
| gemini | 4 | 2 | 1 | 1 |

A subagent with fresh context checked each finding against the cited
construct. Where a finding could be run, it was. Agreement between the families
raised priority. It was not taken as verification.

| Finding | One line | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1, gemini-1 | The sandbox reaches a host service through its own network's gateway, bypassing the relay | both | holds on a Linux engine; the gap predates R21, and R21's assertion does not probe it | held for the maintainer (out of scope), who widened the scope (D-R21-09); fix (F2) |
| codex-2, gemini-4 | A declared, granted port 80 makes the relay refuse to start | both | holds (port 80); the port-0 direction holds in part: no caller can produce it | fix (F1, `d42c56b`) |
| gemini-2 | Under `'none'`, `Authorization` and `x-api-key` reach the endpoint | gemini | does not hold | reject |
| gemini-3 | The framing asks how to trick the relay, not whether the sandbox can route around it | gemini | holds in part: the missing question is codex-1/gemini-1; "moot" overreaches | folds into the held finding |

## codex-1, gemini-1: the sandbox reaches the host through its own gateway

**Checked.** The sandbox joins exactly one network, `relay-in-<id>`, made with
`docker network create --internal --driver bridge` and no other options
(`packages/sandbox/src/local/relay.ts`, `startRelay`; the sandbox is run with
`--network` on it in `provider.ts`). Under an allowlist it is the proxy's
internal network, made the same way. `--internal` removes the route out. It does
not remove the host's address on the bridge. R21's runtime assertion
(`packages/conformance/src/registry/local-endpoint.ts`, the reach probes) tries
`model-host`, `host.docker.internal`, and every address the relay resolves
`model-host` to. That last is the daemon's `host-gateway`, normally `docker0`,
which is not the gateway of the sandbox's own network.

**Run.** This was run on Docker 29.8.0 inside Docker Desktop's VM, which stands
in for a Linux engine host. A listener ran in the host network namespace, bound
to `0.0.0.0` on a port declared nowhere. A container on a plain `--internal`
network connected to that port at its network's gateway (`192.168.0.1`).
Internet egress from the same container failed, as `--internal` intends. A
listener on the Windows host was not reachable that way, because on Desktop
the gateway is the VM. On a native Linux engine the gateway is the host itself.
The spec tells that operator to bind the model server to the bridge address or
all interfaces, because a loopback-only server is unreachable there. So the
same server is reachable straight from the sandbox, with no relay, no
metering, no budget, and no path grant, and so is anything else bound to
`0.0.0.0` on that host.

**Defect and consequence.** The gap is older than R21: P12 (`5536bdc`) created
the internal network. Before R21, though, nothing in the design put a service
on the host for the sandbox to find. R21 asks the operator for one, and its
conformance statement, "the sandbox reaches neither the host nor the
endpoint", does not hold on a Linux engine. The assertion passes on Docker
Desktop for the same reason the attack fails there.

**A fix exists, and was run.** An internal network made with
`-o com.docker.network.bridge.gateway_mode_ipv4=isolated` gives the host no
address on the bridge. From such a network, the same listener was unreachable
at all 24 of the VM's IPv4 addresses, `docker0` and every other bridge
gateway included. The plain internal network's own gateway reached it, as
before. The fix has two parts. Every network a sandbox joins (`relay-in-*` and
the proxy's internal network) is made isolated, with IPv6 isolated or
disabled to match. Engine support for the option is checked at provision time,
and an engine without it is refused. R21's reach probe gains the gateway of
the sandbox's own network and every host address.

**Why it was not applied.** Both networks belong to the sandbox's egress. R21's
out-of-scope list names "any change to the sandbox's egress, the proxy, or the
allowlist". The fix also adds an engine-version refusal that every sandbox,
not only a local relay, would meet. Under working rule 6 that is a scope
change, and it is the maintainer's to take. A probe added alone would pass on
Desktop and fail only where the defect is real, so it is held with the fix.

**Decided and fixed (F2).** The maintainer took the fix into R21 (D-R21-09).
`createSandboxNetwork` (`packages/sandbox/src/local/docker.ts`) now makes both
the relay's and the proxy's internal networks. It creates each with the
isolated gateway mode and reads it back. A network that has a gateway, has
IPv6, or lacks the mode is refused and removed. Tests were written first:

- **Sandbox suite.** A new Docker test provisions a deny-all sandbox with a
  relay and an allowlist sandbox. For each, it asserts that the network has no
  gateway, and that a listener in the engine host's namespace is reached at
  none of the host's addresses. A control shows the same probe reaching that
  listener from a plain internal network. On the old code, the real sandbox
  reached it at `192.168.0.1`. A unit test drives the refusal through four
  shapes an engine might report.
- **R21's runtime assertion.** It probes the same engine-host listener. With
  `packages/sandbox/src` reverted it fails with `192.168.0.1 reached 200`.
  With the fix it passes.

## codex-2, gemini-4: port 80 refused at relay start

**Checked.** `checkLocalUpstream` admits any integer port from 1 to 65535 that
the provider holds, 80 included. `checkRelay` plans
`http://model-host:80`. `new URL('http://model-host:80').port` is `''` because
the parser drops a default port. The start check in `RELAY_SOURCE` refused
`upstream.port === ''`, so a declared, granted port 80 failed closed at relay
start rather than at plan time. Had it started, the http path dialled
`Number(upstream.port)`, which is port 0. `new URL('http://model-host:0').port`
is `'0'`, so the start check would have taken port 0. No caller produces it:
`checkLocalUpstream` and the provider's `dockerHostPorts` check both refuse 0.

**Fixed (F1, `d42c56b`).** The start check and the http path now read the port
from `RELAY_UPSTREAM` as written: the text after `http://model-host:`, which
must be a canonical integer from 1 to 65535. Another fix was considered:
refusing port 80 in `checkLocalUpstream`. It was rejected because it hides a
parser quirk behind an arbitrary rule. The test was written first and failed on
the old code ("the local upstream is not http://model-host:<port>" for port 80).
It now passes, with 80 and 65535 starting and `0`, `65536`, `080`, and an empty
port refused. All 29 relay tests pass against a real daemon.

## gemini-2: other authentication headers under `'none'`

**Checked.** Both request paths pass every incoming header through
`forwarded(req.headers, DROPPED)` before `send`. `DROPPED` (`relay.ts`, P12)
is fixed and scheme-independent. It includes `authorization`, `x-api-key`,
and `proxy-authorization`, and any header the client names in `Connection`.
`send` then deletes the configured header under `'none'`. R21's runtime
assertion sends `authorization`, `x-api-key`, and `api-key` under `'none'`.
It fails if the listener receives any of them or `proxy-authorization`
(`local-endpoint.ts`, the `leaked` check).

**Verdict.** The finding does not hold: the two headers it names are the first
two stripped. The true remainder is that a header under any other name is
forwarded. Under `'none'` the endpoint was declared to take no key, and the
relay holds none to protect. A complete answer would be a forward allowlist,
which would change the relay for every scheme. **Rejected.**

## gemini-3: the framing

The prompt asked how the relay could be tricked, and did not ask whether the
sandbox could route around it. That gap is real, and it is codex-1/gemini-1.
The claim that relay questions are "moot" does not hold: codex-2/gemini-4 was a
relay defect, independent of the network. No separate outcome: it rides on the
held finding.
