---
"@olympus-ai/sandbox": minor
"@olympus-ai/adapters": minor
"@olympus-ai/conformance": minor
---

P11: the sandbox network probe and the HTTP behavioral adapter.

`LocalDockerProvider.probe` starts one container per call in the sandbox's
network namespace (`--network container:<sandbox>`) and not its filesystem or
process tree: pinned image, read-only, every capability dropped, nothing
mounted. It connects to the sandbox's loopback only, reports raw status,
headers, and body as JSON, and decides nothing. A deny-all sandbox stays
`--network none`. `destroy()` removes a probe still in flight.

`HttpBehavioralAdapter` starts a scenario's `serve` detached, probes it, and
compares on the host. One HTTP scenario per handle. Stack detection carries it
when the provider has a probe and names `behavioral:http` otherwise.

Contract amendments: `SandboxProvider.probe` (optional; A-P11-01) and
`ExecOptions.detach` (A-P11-02). `StubSandboxProvider` has no probe and refuses
`detach`. A failed provision's `SandboxRefusal` now names its sandbox, so the
egress cleanup test checks only what it created (issue #14).
