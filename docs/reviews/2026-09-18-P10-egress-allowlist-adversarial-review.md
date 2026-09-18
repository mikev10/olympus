# External review of P10, 2026-09-18

An adversarial review of the P10 sandbox egress allowlist — the `--internal`
Docker network the sandbox is placed on, the filtering proxy the provider
starts and owns, the validation that runs before any container exists, and the
teardown path. The reviewer worked from the bundle alone. What each finding was
checked against, and what changed because of it, is in
`2026-09-18-P10-egress-allowlist-adversarial-triage.md`.

## Source

- **Reviewer:** Gemini, as the maintainer named it. Family: **Google Gemini.**
  The exact model version was not recorded at handover; rotation is tracked by
  family, and that is what is written down. Conditions: handed over for a
  temporary chat with no memory, history, or project context, working from the
  attached bundle and the prompt and nothing else.
- **Family rotation:** ChatGPT reviewed F3, S1, and P4; Gemini reviewed P1 and
  P2; Grok reviewed P3, and the second P3 review was never attributed. Gemini
  is both a non-repeat against P4 and the less recently used of the two
  families in the current pool — it last reviewed P2 on 2026-09-11.
- **Date:** 2026-09-18
- **Bundle:** `2026-09-18-P10-egress-allowlist-review-bundle.txt`, SHA-256
  `276f8db9d48fbcdc112cbc87430386fa5bc44556b9450df051baf34d15b17f7c`, base
  `421d633` (`reviewed/P4`), head `8869891` (the P10 unit commit). The bundle
  held the full contents of every file changed in that range, which is the
  egress allowlist plus the earlier A-P4-06 amendment to the station machine
  and the run line. `docs/decisions.md`, `docs/reviews/`, and `docs/plan/` were
  excluded by construction, so the reviewer had no author reasoning, no prior
  review outcomes, and no specification. Prompt:
  `2026-09-18-P10-egress-allowlist-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context
  about the project, its author, or previous reviews, and that it performed no
  external lookups. This is a self-report and is not independently verifiable.
- **Coverage, and any gap:** the reply is three findings and no sectioned
  answer to the seven numbered prompt items. Items 1 (mechanism succeeds while
  the property is violated) and 3 (fails open) are answered by findings 1 and
  2; item 2 (tautological checks) by finding 3. **Items 4, 5, 6, and 7 came
  back empty.** Item 6 matters: the reviewer named no mechanism it assessed as
  sound, so nothing here should be read as a clean bill for the parts it did
  not mention. Item 7 matters most: the reviewer did not say whether the
  adversarial question was the right one, so the framing is unchallenged rather
  than endorsed.
- **Citations:** line numbers refer to positions in the bundle, not in the
  repository, and are hints rather than located references. Each was resolved
  to the construct it describes before being acted on; all three resolved
  correctly.

---

I have no prior context about this project, its author, or previous reviews, and I performed no external lookups while reviewing this bundle.

Here are the findings, ordered by severity.

**packages/sandbox/src/local/proxy.ts:56** — factually wrong — medium — The proxy forwards `req.headers` to the upstream server exactly as received, including the `Host` header. If the allowed host is hosted on shared infrastructure (like a CDN or a generic reverse proxy), an attacker can reach a non-allowlisted site on that same infrastructure by sending an absolute-form HTTP request to the allowed host but setting `Host: attacker.com`. While HTTPS domain fronting is unpreventable due to the explicit decision not to intercept TLS, HTTP domain fronting is entirely preventable and violates the egress control. — **Resolve it by** overriding the `Host` header in `req.headers` with `target.host` (or validating that they match) before passing it into `http.request`.

**packages/sandbox/src/local/proxy.ts:76** — factually wrong — medium — The proxy blindly parses the port from the request authority using `Number(target.port)`. If an attacker sends a crafted request with non-numeric port data (e.g., `CONNECT allowed.com:443@attacker.com HTTP/1.1`), `Number` evaluates to `NaN`. Passing `NaN` as a port to `net.connect` (line 76) or `http.request` (line 53) synchronously throws an unhandled `RangeError`. Because this occurs inside an event callback without a `try/catch`, the Node.js process crashes and the proxy container permanently exits. This fails closed (a Denial of Service for the sandbox's remaining egress), but represents a configuration satisfied without behaving as intended. — **Resolve it by** validating that `target.port` contains only valid digits before parsing, or wrapping the upstream connection blocks in a `try/catch` to gracefully terminate the socket on error.

**packages/sandbox/test/egress.test.ts:183** — factually wrong — low — The test asserting that "removing the proxy from the path makes the allowlisted host unreachable" is tautological. It runs `wget`, which is configured by the injected `http_proxy` environment variables to always route through the proxy. When the proxy container is stopped, `wget` immediately fails because it cannot reach the proxy port — not because a direct route to the internet is absent. This test would pass even if the internal network had a direct default route. — **Resolve it by** unsetting the proxy environment variables inside the `wget` shell command (similar to the test preceding it) to truly prove that the network itself provides no route out when the proxy is absent.
