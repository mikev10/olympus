# External review of R14, codex, 2026-10-06

An adversarial pre-merge review of R14 (model tier per station and
escalation): `tierFor` and `escalationAt`, the tier's use in the line's
`startAttempt`, `runTask`, and `review`, `boundTo` and the Claude Code
driver's tier-to-model map, `authorsOf`, and the Docker CLI output cap with
the provider's handling of it. One of two reviews run from the same prompt and
bundle; the other is `2026-10-06-R14-tier-escalation-review-gemini.md`. Both are triaged in
`2026-10-06-R14-tier-escalation-triage.md`, which cites this review's findings as `codex-1` and
`codex-2`, as the reply numbers them.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone; the pre-run listing of both is the manifest's
  `cleanRoom`. Exit 0, not timed out, 72.6 s. Ingestion `complete`: 68,915
  input tokens against a floor of 43,663. Integrity `verified`: the reply
  echoes every required bundle marker. Outcome `counted`. Reply SHA-256 as the
  runner wrote it:
  `024653c50e1884da43b3485fb342aa5cfeb1044ef96241a19b1bb10bd16e08ba`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** codex-1 (the committed review seat is computed
  from the model the reviewer's result reports, so a reported family can turn
  reduced independence into independence) was raised by gemini too, as
  gemini-1. codex-2 (no test runs the default output cap) was raised by codex
  alone.
- **Date:** 2026-10-06 (run started 2026-10-06T20:39Z).
- **Bundle:** `2026-10-06-R14-tier-escalation-review-bundle.txt`, SHA-256
  `cbd8fd6f1f6012ccc23cf91755a87120c52d5a0bdba4afa37bf2dcee5876faee`, base
  `4bf9487` (`reviewed/I1b`), head `cdb4af6` ("R14: Model tier per station
  and escalation"). It held the full contents of 36 of the 39 changed paths
  across two commits (`8055cb4`, `cdb4af6`): source, tests, registry,
  fixtures, the pending baseline, and the two changesets. The changed
  `docs/decisions.md`, `docs/plan/DECOMPOSITION.md`, and
  `docs/plan/F2-contracts.md` were excluded, and so was every unchanged file.
  Prompt: `2026-10-06-R14-tier-escalation-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior project
  context, performed no lookups, and did not execute tests. A self-report, not
  independently verifiable.
- **Coverage, and any gap:** findings are not numbered by prompt item. Item 1
  is answered by codex-1; item 2 by a paragraph finding no strictly
  tautological assertion and calling codex-2 narrower than its name; item 3 by
  the same paragraph, which finds no exception-to-pass path and notes the
  helpers and runner were not in the bundle; item 4 by a paragraph finding no
  in-scope bypass through casts or brands; item 6 by a list of mechanisms
  assessed sound (policy-derived tiers, relay restriction, command output,
  escalation recording); item 7 by a closing paragraph accepting the framing
  and refining it (separate enforcement from the assertions, a per-command
  bound from total memory safety). Item 5 (configuration satisfied without
  doing what it appears to do) got no answer of its own; codex-2 is the
  nearest.
- **Citations:** line numbers refer to positions in each file as the bundle
  carried it, not to the repository at any later commit. They are hints; the
  triage located each construct by name.

---

BASE: 4bf9487  
HEAD: cdb4af6  
packages/vault/test/local.test.ts  
e3d2be1340138c3541ae7a8497a62843

No prior project context; no lookups performed. I reviewed the supplied text only and did not execute tests.

1. **packages/api/src/line.ts:1140 — factually wrong — high — The reviewer’s reported identity can turn reduced independence into claimed independence.**

   Construction: an author ran as family `A`; the runtime resolves the reviewer to family `A` too. At a level permitting reduced independence, the preliminary seat at line 1110 permits that reviewer. The reviewer then returns an otherwise valid result naming family `B`. Line 1140 seats it again using `ran.result.model`, and line 1146 commits that second seat. The record now claims independence even though the runtime selected a reviewer sharing an author’s family.

   Adding runtime usage identities to **authors** does not fix the untrusted identity on the **reviewer** side. The new `EVERY_MODEL_THAT_BUILT_IS_AN_AUTHOR` assertion supplies a reviewer whose reported identity agrees with its resolved identity, so this bypass passes that scenario unchanged.

   **Resolve:** carry the runtime-resolved identity out of `runTask` and use it for the committed review seat. Treat the result’s identity as an untrusted claim. Add a scenario where a same-family reviewer reports a different family and must still record reduced independence. At the highest autonomy level, retain refusal before invocation.

   Confidence: high under the prompt’s explicit control over returned model identity. The shown Claude driver fixes its returned family to `FAMILY`, which blocks this particular construction through that driver; the generic line nevertheless violates the stated result-trust boundary.

2. **packages/sandbox/test/output.test.ts:32 — factually wrong — medium — The test claiming to exercise the default output cap never invokes the default path.**

   The test checks that `DEFAULT_MAX_OUTPUT_BYTES` equals 64 MiB, then supplies explicit invalid caps. The Docker conformance assertion likewise constructs its provider with an explicit `CAP` (`packages/conformance/src/registry/output.ts:25`).

   Concrete mutation: change the fallback in `dockerCli` to `Number.MAX_SAFE_INTEGER`, leaving the exported constant unchanged. All supplied output assertions still pass, while ordinary calls using the default can retain enough output to exhaust the host. This is a verification gap, not a demonstrated bypass of the current implementation.

   **Resolve:** execute an over-limit command with `maxOutputBytes` omitted and assert `CliOutputExceeded`. Also exercise the provider’s omitted-option path, so deleting its default enforcement fails an assertion.

   Confidence: high for the supplied assertions; other tests outside the bundle might cover this.

The following mechanisms look sound within the shown boundaries:

- **Policy-derived tiers:** `packages/core/src/policy/tier.ts:16,37,59` uses an own-property station override and computes escalation solely from policy and runtime attempts. Validation requires an explicit escalation setting and rejects invalid ceilings and station overrides (`packages/core/src/policy/validation.ts:317,346`). The remaining dependency is whether all attempt transitions actually preserve “previous iteration means failed gate”; those transitions are not fully supplied.
- **Relay restriction:** `packages/api/src/line.ts:629` rejects a missing own price and constructs a table containing only the resolved model. Given the stipulated trusted relay enforcing that table, another request model cannot pass. The new conformance assertion checks provisioning arguments, however, rather than sending a forbidden request through a live relay.
- **Command output:** `packages/sandbox/src/local/docker.ts:130` counts stdout and stderr together before retaining chunks, clears retained buffers on overflow, and rejects instead of returning truncation. The provider then ends the sandbox. This bounds one invocation’s retained payload; it is not an aggregate host-memory guarantee across concurrent invocations or downstream copies.
- **Escalation recording:** `packages/api/src/line.ts:419` records before committing the escalated attempt. A stop between those operations can leave an unapplied or repeated decision, but the shown ordering does not allow the escalated call to precede its record.

I found no strictly tautological new assertion or demonstrated exception-to-pass path in the supplied code. The default-cap test is narrower than its name, rather than tautological. Test helpers and the assertion runner are omitted, so their missing-file, skipped-test, and exception handling cannot be certified here.

The shown casts and branded types are not security boundaries. They are erasable, but exploiting casts, declaration merging, or module augmentation would require control over runtime code or compilation outside the stated threat model. I found no concrete in-scope bypass through them.

The adversarial framing is appropriate. It should distinguish runtime enforcement from the assertions claiming to prove it, and distinguish a per-command output bound from total service memory safety. The clearest enforcement defect here is trusting the reviewer’s returned identity when recording independence.