---
"@olympus-ai/sandbox": minor
"@olympus-ai/adapters": minor
"@olympus-ai/conformance": minor
---

R3: the browser behavioral adapter, and the browser it observes through.

`LocalDockerProvider.browse` starts one container per call in the sandbox's
network namespace (`--network container:<sandbox>`) and not its filesystem or
process tree, from a browser image pinned by digest and run by its content ID.
The container has the probe's limits and a memory and process ceiling: a
read-only root, every capability dropped, no new privileges, an unprivileged
user, nothing mounted. Chrome runs without its own process sandbox, which
cannot start inside those limits; the container is the boundary. The browser
is driven over a pipe, never a port, and its program arrives on standard
input.

A request is a port and a list of steps: `goto` (a path), `click`, `fill`,
`press`, and `observe`. A step names its element by role and accessible name,
by label, or by visible text, and by nothing else. Every request the page
makes to a host other than the loopback is refused inside the container and
its host reported. The browser observes and decides nothing.

`BrowserBehavioralAdapter` starts a scenario's `serve` detached, browses it,
and compares on the host. A refused host fails the scenario unless its
`mayBlock` lists it, a document that navigates off the loopback always fails
it, and a step that could not be done fails it and leaves every later
observation unmade. Text and a value are held against a visible element
unless the scenario names `visible` itself. One browser scenario per handle. Stack detection carries
the adapter when the provider has a `browse` and names `behavioral:browser`,
with the provider as the reason, otherwise.

Contract amendments: `SandboxProvider.browse` (optional; A-R3-01) and the
types it speaks, `BrowseTarget`, `BrowseStep`, `BrowseRequest`,
`BrowseObservation`, `BrowseBlockedHost`, and `BrowseResult` (A-R3-02).
`StubSandboxProvider` has no `browse`.

No real run builds a behavioral adapter of any kind yet. Wiring scenarios into
the line is R76.
