---
"@olympus-ai/sandbox": minor
"@olympus-ai/driver-claude-code": minor
"@olympus-ai/conformance": minor
---

P12: the model credential never enters the sandbox.

`@olympus-ai/sandbox`: `SandboxSpec` gains an optional `relay: RelaySpec`
(A-P12-01) — an `https` upstream origin, the path prefixes it may be asked
for, the header the credential is written into, the *name* of a credential,
and the variable the sandbox is told the relay's address in.
`LocalDockerProvider.create` takes `credentials` by name, and `relayTrust`
for an upstream a private authority signed. The relay is a container the
provider starts beside the sandbox and destroys with it (`relay.ts`): it
discards every authentication header the client sent, writes the one it
holds, forwards the granted paths to its one upstream over verified TLS,
refuses every other path, absolute-form target, `CONNECT`, and upgrade, and
passes redirects back rather than following them. It is independent of the
egress mode: under `deny-all` the sandbox is on an internal network holding
the relay alone, and beside an allowlist it shares the proxy's networks and
is named in `NO_PROXY`. `deny-all` without a relay is unchanged.
`appliedControls()` records the relay by credential name, never value. A
relay whose credential the provider was not given, whose upstream is not an
`https` origin naming a host, whose grant is empty or unmatchable, or whose
header or variable is reserved is refused at the new `relay` refusal layer;
`StubSandboxProvider` refuses every relay.

`@olympus-ai/driver-claude-code`: the driver holds no credential.
`ClaudeCodeDriverOptions.credential` and `CREDENTIAL_VARIABLE` are deleted
(D-P5-20's reverse); every exec carries `KEY_PLACEHOLDER` in `KEY_VARIABLE`,
and the session check still refuses a key from any other source. The driver
exports `MODEL_RELAY`, the relay request its sandbox must be provisioned
with, and `MODEL_CREDENTIAL`, the name the provider holds the key under.

`@olympus-ai/conformance`: `I4.model-credential-not-readable-by-the-task` is
paid — a live external assertion in the driver's suite that replays P5's
exploit and finds nothing, beside a control that finds a value an exec was
given. `I4.model-relay-forwards-only-its-grant` is added live. The I4 pending
baseline drops from 1 to 0.
