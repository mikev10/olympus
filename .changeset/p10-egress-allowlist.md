---
"@olympus-ai/sandbox": minor
"@olympus-ai/conformance": minor
---

P10: the sandbox egress allowlist. `EgressPolicy.mode: 'allowlist'` is enforced
rather than refused, which reverses D-P2-07.

A container under an allowlist reaches the hosts the policy names and nothing
else. Two mechanisms, and the order matters:

- **The routing table.** The sandbox joins one Docker network created
  `--internal`, which leaves the container with no default route at all. Every
  address off that subnet answers `Network unreachable` from the kernel. There
  is nothing to bypass because there is no second path to take, and a process
  that unsets every proxy environment variable reaches nothing.
- **The proxy.** The only other thing on that network is a filtering proxy,
  separately attached to a second bridge network where its own route out lives.
  The sandbox is never on that network and nothing forwards between the two:
  the proxy terminates the connection and opens its own. It allows or refuses
  by host and reads nothing inside the connection — `CONNECT` is a blind
  tunnel, and TLS is never terminated, inspected, or re-originated.

The proxy is a Node script this package carries, handed to a digest-pinned
image with `node --eval`: one argv element, no shell, no mount, no build step,
`--read-only` and `--cap-drop ALL`. The filter is a file in the repository that
a reviewer reads and a test mutates, not a config dialect interpreted by a
binary nobody here has read.

- **`appliedControls()` records what was applied.** `network: 'none'` becomes
  `egress`, a discriminated union: the `deny-all` branch carries the literal
  `'none'` and nothing else, and the `allowlist` branch carries the internal
  network, the normalised hosts, and the proxy with the argv it was started
  with. `deny-all` cannot carry a network name and `allowlist` cannot exist
  without the proxy that enforces it.
- **The host grammar D-P3-08 deferred lands here**, in the unit that can
  enforce it. An entry is a hostname, an IPv4 address, or an IPv6 address;
  anything the proxy cannot match exactly is refused by name, because a grant
  it cannot honour applied anyway allows or denies a host nobody wrote.
- **An empty `allow` under `allowlist` is refused**, as neither deny-all nor
  allow-all — the rule `validateToolGrants` follows for an empty inventory. The
  proxy fails closed on the same condition independently and exits rather than
  serving with no list.
- **`deny-all` is unchanged.** `--network none`, loopback only, no proxy
  started, no network created, and the same recorded evidence as before.
- **The proxy and both its networks are destroyed with the sandbox they
  serve.** A teardown the provider could not finish is reported rather than
  swallowed.

Adds `I5.sandbox-egress-allowlist-enforced` as a live registry assertion and
adds nothing pending, so the pending baseline is untouched. The assertion was
checked by mutation in both directions: dropping `--internal` fails the bypass
assertion, and making the proxy permit every host fails the refusal assertion.

The suite is hermetic. It starts its own origin container on the proxy's
outbound network rather than reaching the internet, which makes the denied
cases sharper rather than weaker: the strongest assertion allowlists that
origin by name and is then refused it by address, so the refusal is the list
and not a host that was unreachable anyway. Stopping the proxy makes the
allowed host unreachable, so the success is known to have come through it.

**Known limit, narrowed and not closed.** The proxy writes one line per
connection to its own stdout, readable with `docker logs` while the sandbox
lives. Nothing collects those lines into an evidence bundle and they go with
the proxy container, so this is readable during a run and is not evidence after
one. It carries no registry entry and no capability claim; collection is P6's.

**No TLS interception, by decision rather than by omission.** The proxy allows
or refuses a host and reads nothing inside the connection. A man-in-the-middle
holding the workspace's credentials is a larger risk than the one it would
close.
