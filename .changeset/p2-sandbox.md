---
"@olympus-ai/sandbox": minor
"@olympus-ai/conformance": minor
---

P2: `LocalDockerProvider`, the sandbox contract over a local Docker daemon.

This is the substrate every other package's safety rests on, so every control a
`SandboxSpec` names is either applied to the container or the provision is
refused. There is no path through the provider that hands back a handle to a
sandbox with fewer controls than were asked for.

- **The mount layer** is two steps, deliberately separate. `mountTable`
  validates the shape a caller asked for; `resolveMounts` resolves every source
  through symlinks and `..` and only then asks whether the mount lands on the
  Vault. The order is the point: a containment check run against the path a
  caller wrote passes for a symlink whose target is the Vault, and the
  container gets the Vault anyway.
- **A Vault path is refused under any mount**, `ro` included. I1 is about
  writes, but a Vault in an agent's container is one flag away from a writable
  one and has no reason to be there.
- **The workspace is mounted with the mode the table gives it**, so a `ro`
  workspace is read-only to the container. That is what lets verification run
  against a tree it cannot modify, and it closes the class of problem behind
  P1's recorded `hashArtifact` TOCTOU limit.
- **Egress** is `--network none`. An `allowlist` policy is refused rather than
  applied as deny-all or as allow-all: enforcing one needs a filtering proxy
  that does not exist at M1, and a control that cannot be enforced is a
  refusal, not a default (I5).
- **Limits** reach the container as `--cpus`, `--memory` and `--pids-limit`,
  and are asserted against the container's own `HostConfig` rather than against
  the arguments that were sent. The wall clock is the sandbox's lifetime
  budget, enforced by the provider: a command that outlives it is terminated,
  the container is destroyed, and the refusal names the limit.
- **`create()` probes the daemon first** and refuses when there is none, when
  it is not a Linux-container daemon, or when it is not local — the three
  things `capabilities()` goes on to claim.

Pays down `I1.mount-layer-enforcement`, lowering the I1 pending baseline from 2
to 1, adds `I1.mount-layer-refuses-a-vault-mount` beside it, and makes all five
`sandbox.*` capability claims live, each lowering from 1 to 0. A claim of
`false` is asserted as hard as a claim of `true`: each one observes the
container and requires the declaration to match, so flipping a flag without
changing what the provider does fails the suite.

**The conformance suites now require a Docker daemon and fail without one.**
The mount layer is where I1 is enforced, and an assertion that skipped itself
on a host without containers would report green having proved nothing about it.

`StubSandboxProvider` is unchanged and still wired into the skeleton; replacing
stubs is the integration unit's job.
