# Triage of the P10 external review, 2026-09-18

The review is `2026-09-18-P10-egress-allowlist-adversarial-review.md`; its
header carries the reviewer, the bundle hash, and what the reviewer disclosed.
Findings are cited by the order they appear there.

**Counts.** Three findings. **Three verified against the code, three held, none
did not hold.** Two were reproduced as live attacks against a running proxy
before anything was changed; the third was settled by reading what the test
actually constrains. Three fixed on the unit branch, none recorded as a known
limit, none rejected.

This is the best-calibrated review the project has had: no finding was
speculative, and the two security findings were both exploitable exactly as
described. It is also the narrowest — four of the seven numbered prompt items
came back empty, including the one asking which mechanisms the reviewer
assessed as sound. Nothing here clears the parts the reviewer did not mention.

| # | Finding | Verdict | Outcome |
|---|---|---|---|
| 1 | The proxy forwards the client's `Host` header, so an absolute-form request to an allowlisted host can carry someone else's `Host` and be served by it | **Holds.** Reproduced: the upstream received `HOST-SEEN=evil.example` | **Fixed.** The received `Host` is discarded and rebuilt from the request target |
| 2 | A non-numeric port in the authority reaches `net.connect` as `NaN`, throws where nothing catches it, and kills the proxy | **Holds.** Reproduced: `ERR_SOCKET_BAD_PORT ... NaN`, proxy container exited, sandbox lost egress entirely | **Fixed.** A port that is not a port makes the authority unreadable and the target is refused; both upstream-connect sites also catch |
| 3 | The "removing the proxy" test cannot distinguish a stopped proxy from an absent route, because `wget` is pointed at the proxy either way | **Holds in part.** It is sound for what it was written to prove, and is weaker than it should be | **Fixed.** The assertion now also tries direct with every proxy variable unset |

---

## Finding 1 — the client's `Host` header reached the upstream

**Verdict: holds.** The most serious of the three, and correctly reasoned from
the source alone.

**What was checked.** The cited construct is the `http.createServer` request
handler, which built its upstream request with `headers: req.headers`. For an
absolute-form request the connection is opened to the host in the request
target, but the `Host` header sent along it was whatever the client wrote. Any
infrastructure that routes by `Host` — a CDN, a shared reverse proxy, a
virtual-host web server — is then asked for a site the allowlist does not name.

**How it was settled.** By constructing the attack rather than by reading. An
origin container was started that echoes back the `Host` header it receives,
and allowlisted by name. A Node client inside the sandbox then issued a proxied
`GET` whose request target was the allowlisted origin and whose `Host` header
was `evil.example`:

```
control: STATUS=200 BODY=HOST-SEEN=egress-origin-536d8e7f-...:8080
attack : STATUS=200 BODY=HOST-SEEN=evil.example
```

The upstream received the attacker's `Host`. The finding is exact.

**Separating the defect from the consequence.** The reviewer's severity is
right and its framing is slightly generous to the code. The connection itself
never leaves the granted host, so this is not a route to an arbitrary address;
it is a way to select a different *site* behind a granted address. That makes
it conditional on the allowed host sitting on shared infrastructure — which, for
the model APIs this unit exists to reach, is the normal case rather than the
exception. Medium is correct.

**What changed.** The received `Host` is discarded and replaced with the
authority from the request target, which is what RFC 7230 §5.3.2 requires of a
proxy given an absolute-form target: it "MUST ignore the received Host header
field" and replace it. The rewrite is in `authorityOf`, which re-brackets an
IPv6 literal and omits the port when it is the scheme default. The reviewer's
suggested alternative — validating that the two match — was not taken: a client
has no reason to send a `Host` at all for a proxied request, and refusing a
mismatch would break correct clients to catch a case that rewriting simply
removes.

**Residual, stated rather than claimed.** `Host` is the header that selects a
virtual host in HTTP/1.1, and it is now the proxy's. A CDN configured to honour
`X-Forwarded-Host` or a similar header could still be steered by one, but that
is the origin's trust configuration and not something a forward proxy can fix
without inspecting or rewriting headers it has no contract for. Not fixed, not
claimed fixed. The reviewer's own note stands unchanged: the equivalent over
HTTPS is unreachable by design, because this unit does not terminate TLS.

**Assertion added.** `egress.test.ts` › "a client's own Host header is
discarded…". It runs the honest client as a control and the fronting client as
the attack. Against the pre-fix proxy it fails with
`expected 'STATUS=200 BODY=HOST-SEEN=evil.exampl…' not to contain 'HOST-SEEN=evil.example'`.

## Finding 2 — a malformed authority killed the proxy

**Verdict: holds,** including the mechanism, the trigger, and the consequence.

**What was checked.** `split()` took everything after the first colon as the
port and never validated it. `CONNECT allowed:8080@evil.example` therefore
produced a host that *is* on the allowlist and a port of `8080@evil.example`.
The allowlist check passed, and `Number('8080@evil.example')` is `NaN`.

**How it was settled.** By sending exactly the reviewer's construction from
inside a sandbox and watching the proxy container:

```
proxy running before: true
proxy logs: RangeError [ERR_SOCKET_BAD_PORT]: Port should be >= 0 and < 65536. Received type number (NaN).
proxy running after : false
egress after: "wget: bad address 'egress-proxy:3128'" exit 1
```

The proxy died and the sandbox lost its egress outright — the alias stopped
resolving, because the container behind it was gone.

**Separating the defect from the consequence.** The reviewer calls this a
denial of service that fails closed, and that is right as far as it goes. The
sharper problem is *how* it fails closed. Nothing refuses, nothing is recorded,
and the provider does not notice: `exec` keeps working and the sandbox simply
stops being able to reach the host it was granted. A run would fail later,
somewhere else, for a reason nothing in the evidence explains. Silent is the
part that matters, not unavailable.

**What changed.** Both of the reviewer's suggestions, because they close
different things. `portOf` requires one to five digits in range, and an
authority whose port half is not a port is unreadable — `split` returns `null`,
`permitted` is false, and the request is refused with a 403 that says the
request did not name one host and one port. That removes the `NaN` at its
source. Separately, both upstream-connect sites are wrapped, so any future
parse slip ends one request rather than the process. No global
`uncaughtException` handler was added: a proxy that swallows arbitrary throws
and keeps serving is the warn-and-continue shape this project refuses
everywhere else.

**Assertion added.** `egress.test.ts` › "an authority whose port is not a port
is refused, and the proxy survives to refuse the next one". It requires the
403, that the proxy container is still running, and that the sandbox still
reaches the host it was granted. Against the pre-fix proxy it fails with
`expected '' to contain '403'` — the empty string being the proxy dying
mid-request.

## Finding 3 — the counterfactual test was weaker than it read

**Verdict: holds in part.** Accepted, with the reviewer's characterisation
narrowed.

**What was checked.** The test stops the proxy container and requires the
allowlisted host to become unreachable. `wget` is pointed at the proxy by the
injected environment variables, so when the proxy stops, `wget` fails because
the proxy is gone. The reviewer is right that this outcome does not depend on
the absence of a direct route, and would be unchanged on a network that had
one.

**Where "tautological" overstates it.** A tautological check passes regardless
of the code under test; this one does not. It is the counterfactual for a
different property — that the earlier success came *through* the proxy rather
than around it — and for that it discriminates exactly as intended: with the
proxy up the request succeeds, with it stopped it fails. Remove the proxy from
the path in the provider and it fails too. What the reviewer correctly
identified is that the test's *name* claims more than its body proves, and that
the stronger claim is one test away.

**It was also not the only cover.** The absence of a direct route is asserted in
the test immediately before it, which unsets every proxy variable and checks
both `ip route` for a default and a direct request for `unreachable`. That
assertion was already mutation-checked before the review: dropping `--internal`
from the network makes it fail. So the property the reviewer worried was
unproven was proven elsewhere; the gap was that the two halves were never
asserted together in the one state that matters, with the proxy gone *and* the
variables unset.

**What changed.** The reviewer's fix, as suggested. The stopped-proxy test now
also tries the origin's address directly with `http_proxy`, `https_proxy`,
`no_proxy` and their upper-case forms unset, and requires that to fail with
`unreachable` as well. With the proxy stopped and the variables gone there is
no path out by either route, which is what the name claimed all along. This
strengthens an assertion; nothing was relaxed to accommodate the finding.

---

## Scope

No finding required work the unit's out-of-scope list excludes. Findings 1 and
2 are defects in code this unit wrote, and finding 3 is in a test this unit
wrote. Nothing was absorbed from another unit and nothing was handed to one.

The reviewer noted that HTTPS domain fronting is unpreventable given the
decision not to intercept TLS. That decision is on the out-of-scope list
verbatim, the observation agrees with it, and it is recorded here rather than
treated as a finding.

## Gates after the fixes

- `pnpm typecheck` — pass
- `pnpm lint` — pass
- `pnpm test` — pass. conformance 175, sandbox 85 (+2 pre-existing platform
  skips; 83 before this triage), core 133, vault 56, api 38
- `pnpm conformance` — pass. 72 assertions, 0 external, 0 missing.
  `Pending entries: 23 (baseline 23)`, unchanged: no finding added owed work
- `git ls-files -- .plan/` — empty

The registry assertion `I5.sandbox-egress-allowlist-enforced` is unchanged. The
two new assertions are package-level, in `packages/sandbox`, beside the eight
that were already there.
