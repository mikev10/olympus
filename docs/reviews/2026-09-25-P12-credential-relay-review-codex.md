22079d2
1522900
packages/sandbox/test/upstream.ts
6bab41bc088c4cb4167eee43b454577e

I had no prior project context and performed no external lookups. This is a source-only review of the supplied bundle; a local filesystem-listing attempt was blocked. I did not execute tests or independently verify the SHA-256.

1. **packages/drivers/claude-code/test/invariants.test.ts:174–175 — factually wrong — medium — The workspace scan can report absence without reading the leaked file.**  
   Put the credential in `/workspace/subdir/key`. `readdir()` returns `subdir`; `readFile()` on that directory fails; `.catch(() => '')` converts the failure into a successful absence assertion. `docker export` excludes the workspace mount, so it does not close this gap. The positive control writes `/tmp/exploit/leaked`, which exercises the export scanner, not workspace traversal.

   **Resolve:** recursively scan the workspace, handle symlinks explicitly, fail on unreadable entries, and add a positive control in a nested workspace directory. Confidence: high.

2. **packages/sandbox/test/relay.test.ts:362–382; packages/sandbox/src/local/relay.ts:336–338 — factually wrong — medium — “The relay is the only route to its upstream” depends on an unstated configuration restriction.**  
   Provision a relay for `https://api.anthropic.com` alongside an allowlist containing `api.anthropic.com`. The provider passes the allowlist to the proxy without checking its intersection with the relay destination. A sandbox process can then request a proxy `CONNECT` to that host. The test proves rejection only when the allowlist contains the unrelated `example.com`.

   This does **not**, by itself, expose the relay’s credential or authenticate the direct request. It violates the separately stated exclusive-route guarantee.

   **Resolve:** reject overlapping configurations or enforce an upstream exclusion in the proxy, then test the overlapping case. Confidence: high about the missing cross-check; the unchanged proxy implementation is not supplied.

3. **packages/sandbox/src/local/relay.ts:445–447, 468–482 — factually wrong — medium — Cleanup neither attempts every step after an exception nor reports every cleanup failure.**  
   If `dockerCli()` throws during container removal—for example, on a lifecycle timeout—`teardown()` exits before attempting network removal. If removal instead returns a nonzero status, teardown returns an error that the startup catch discards. A failed provisioning attempt can consequently leave its credential-holding relay behind while reporting only the original startup error.

   **Resolve:** catch failures separately for each cleanup operation, continue attempting remaining operations, and propagate or aggregate cleanup failures with the original error. Preserve resource identifiers for retry. Confidence: high.

4. **packages/sandbox/test/relay.test.ts:387–409, 480–492 — factually wrong — medium — Some negative assertions accept infrastructure failure as evidence of enforcement.**  
   The teardown tests use `containerExists()` and `networkExists()`, which return `false` for **any** inspection error. Losing access to Docker after destruction therefore satisfies the “resource is gone” assertions. Separately, the startup-refusal test maps every command rejection to a nonzero result—including executable, daemon, and image failures—then accepts it as the expected refusal.

   These are false-positive paths for the individual assertions; they do not imply that the entire suite would pass without Docker.

   **Resolve:** recognize only explicit “not found” responses as absence. For startup refusals, require the expected relay diagnostic and exit status, with a valid-start control using the same execution path. Confidence: high.

The strongest mechanisms are sound on the supplied source:

- **Path confinement:** `relay.ts:91–97, 130–157` rejects encoded, empty, and dot segments, matches prefix boundaries, and uses a fixed upstream independently of the client’s `Host`. I found no concrete request-target bypass.
- **Transport confinement:** `relay.ts:151–165, 175–185` uses HTTPS verification without disabling certificate checks, returns redirects without following them, and rejects tunnelling and upgrades.
- **Credential placement:** `relay.ts:405–423` passes the credential by environment-variable name to a separate container, adds no mount, and records no credential value in its returned controls. Actual environment forwarding depends on the omitted `dockerCli` implementation.
- **Required refusals:** missing credentials, invalid origins, empty grants, and relay requests to the stub have explicit runtime rejection paths.

I found no demonstrated TypeScript cast, declaration-merging, or generic-erasure escape available to the stated sandbox adversary. Such an escape would require access to trusted runtime configuration or code. I also found no strictly tautological security assertion; the problems above are incomplete scans and errors accepted as negative evidence.

The CI change visibly runs the driver suite once and excludes it from the subsequent recursive test command. It introduces no visible skip-on-missing-secret path. Report reconciliation itself is outside the supplied source.

The adversarial framing is appropriate. I found no demonstrated way to extract the credential through this relay or make it authenticate an ungranted path. The important distinction is between that conclusion and the broader claims that every readable location was searched, every cleanup completed, and every allowed configuration preserves an exclusive route; the supplied evidence does not establish those broader claims.