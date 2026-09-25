# External review of P12, codex, 2026-09-25

An adversarial pre-merge review of P12 (Credential at the egress layer): the
model relay that holds the credential, how the local provider starts it beside
a sandbox under either egress mode and tears it down, how the Claude Code
driver is pointed at it, the exploit-replay assertion and its control, and the
earlier CI change to how often the driver suite runs. One of two reviews run
from the same prompt and bundle; the other is
`2026-09-25-P12-credential-relay-review-gemini.md`. Both are triaged in
`2026-09-25-P12-credential-relay-triage.md`, which cites this review's
findings as `codex-1` to `codex-4`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone. The pre-run listing of both is the manifest's
  `cleanRoom`: `configHome` `["auth.json"]`, `workDir` `[]`. Exit 0, not timed
  out, 234.7 s. Ingestion `complete`: 77,247 input tokens against a floor of
  51,552. Integrity `verified`: the reply echoes every required bundle marker.
  Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `a43fcf6f2f2b37f7deb8206743bec6aa4b0b88c95e82527877ad67f2a029d1bb`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** none. Gemini raised no findings. All four
  findings here were raised by codex alone. Gemini's item-2 and item-3 answers
  assessed as sound two things that codex-1 and codex-3 dispute: that the
  control proves the credential search is not blind, and that a failed start
  tears down what it created. The triage records which account the code bore
  out.
- **Date:** 2026-09-25 (run started 2026-09-25T16:17:21Z UTC).
- **Bundle:** `2026-09-25-P12-credential-relay-review-bundle.txt`, SHA-256
  `922953cb079f962ec66d85ddb95fc94d4e2ebcc9f452c0d8994415ba25e47f8e` (the
  manifest's `bundleSha256`), base `22079d2` (`reviewed/P6`), head `1522900`
  (P12: tool search stays on behind the relay, and the owed driver run
  passes). It held the full contents of 19 of the 21 files changed in that
  range. It excluded `docs/decisions.md` and `docs/plan/DECOMPOSITION.md`, the
  design documents, as the prompt states ("no design documents"). Prompt:
  `2026-09-25-P12-credential-relay-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated that it had no prior
  project context and performed no external lookups. It added that a local
  filesystem-listing attempt was blocked, and that it neither executed tests
  nor verified the SHA-256. This is a self-report and cannot be independently
  verified. The blocked listing is consistent with the read-only sandbox and
  the empty working directory.
- **Coverage, and any gap:** the reply is not organized by the prompt's item
  numbers. Items 1 and 3 are answered by the four findings. Item 2: "no
  strictly tautological security assertion". Item 4: no demonstrated escape
  through a cast, declaration merging, or generic erasure. Item 6: path
  confinement, transport confinement, credential placement, and the required
  refusals are named as sound, with reasons. Item 7: the framing is
  appropriate, with a distinction drawn between "no extraction found" and the
  broader completeness claims. **Item 5, configuration satisfied without doing
  what it appears to do, is not answered as such.** codex-2 and the paragraph
  on the CI change come nearest to it.
- **Citations:** line numbers are positions in the bundle, not the repository.
  The triage located each finding by the construct it describes.

---

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