# External review of R66, codex, 2026-11-26

R66 (the relay meters what it forwards, and starts on Windows), reviewed from the
bundle alone. The triage of this reply and Gemini's is
`2026-11-26-R66-relay-meters-and-starts-on-windows-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a
  read-only sandbox, with recorded approval policy `never`, in an empty scratch
  working directory and a scratch config home holding only `auth.json`, with an
  environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's
  `cleanRoom`.
- **Cross-family agreement:** none. It raised two findings and Gemini raised none.
  Gemini assessed the tier check as sound, which is the mechanism finding 1 is about.
- **Date:** 2026-11-26
- **Bundle:** `2026-11-26-R66-relay-meters-and-starts-on-windows-review-bundle.txt`, SHA-256
  `e4dd6740fb661c8a7658908383216207472bba068d716951db8e169f465175dc`, base `e3e851c`
  (`reviewed/R58`), head `061f9f3` (R66's tip before the review files). It held 14
  changed files, all R66's: new files in full, modified files as diffs showing each
  changed function whole. `docs/decisions.md`, `docs/reviews/`, `docs/plan/` and
  `pnpm-lock.yaml` were excluded. Prompt:
  `2026-11-26-R66-relay-meters-and-starts-on-windows-review-prompt.txt`.
- **Prior context and lookups:** it said it had no prior context and performed no
  lookups. That is a self-report and cannot be checked from here.
- **Coverage, and any gap:** items 1 and 3 are answered by its two findings, item 4
  (language escape hatches) and item 6 (sound mechanisms) explicitly, and item 7
  (the framing) explicitly: it accepts the question, says the bundle did not show
  the relay's request admission, model lookup, or final accounting, and says the
  prompt's invariant is stricter than the code's ceiling rule. It names no
  tautological check (item 2), saying the oversized-table and source-in-argument
  checks are not tautologies, and says nothing separately on item 5.
- **Citations:** line numbers refer to the new side of the bundle's diffs and are
  treated as hints. Each finding was located by the function it names.

BASE: reviewed/R58
HEAD: 061f9f3
packages/sandbox/test/upstream.ts
111f3c77d9c6e1eee9b2b75e9cb83561

I had no prior project context and performed no lookups. This is a static review of the supplied text; I did not run tests.

1. **packages/sandbox/src/local/relay.ts:360 — factually wrong — medium — An absent or null tier is silently treated as priceable.**  
   `tierOpenai` leaves `offTier` false for both `undefined` and `null`. A Responses answer containing valid token usage but no `service_tier`, or `"service_tier": null`, therefore passes this check. The same applies inside `response.completed`. Nothing here establishes that the answer used the default rate.

   This is a concrete validation gap, not a demonstrated exploit against a particular upstream: the task cannot directly author upstream metadata. It becomes an underpricing path if an upstream omits tier metadata while serving a different rate. **Resolve by** refusing further forwarding when the final tier is missing or null, or explicitly limiting this exception to a trusted endpoint configuration that guarantees default pricing. Add whole-body and streaming cases for both values. Confidence: high about acceptance; upstream exploitability is unestablished.

2. **packages/sandbox/src/local/relay.ts:389–390 — unclear — medium — Missing output usage is deliberately estimated, contrary to the stated invariant.**  
   `takeResponses` accepts readable input without readable output. The supplied Responses tests explicitly require the relay to charge a ceiling and continue forwarding after such answers. Thus a successful answer with `usage: { input_tokens: 1000 }` passes the implemented policy without its actual output usage being known.

   This is not evidence that the ceiling necessarily underprices the answer. It is evidence that the implementation and tests enforce a different contract from “missing or unreadable usage … must stop the spending” and “never estimated.” **Resolve by** marking incomplete usage unreadable and refusing subsequent requests, or revising the stated invariant to explicitly permit conservative ceiling accounting. Confidence: high about the mismatch.

The following mechanisms look sound within the supplied code and trust boundary:

- The search-model expression catches the specified suffixes and optional dates at both provisioning and relay startup. Tests exercise both checks with otherwise valid configurations. It is a naming restriction, however, not proof that every accepted model is token-only.
- Responses tier inspection reaches both whole bodies and `response.completed`. Unexpected non-null values mark the answer off-tier; the supplied tests exercise subsequent refusal for whole and streamed answers.
- `relayCreateArgs` removes the source from arguments and preserves read-only root, dropped capabilities, and absence of mounts. `startRelay` supplies runtime-owned source through stdin. Task-controlled workspace files have no demonstrated route into that delivery.
- Delivery failures, unsuccessful readiness, and empty container IDs lead to failure and cleanup attempts. The shown lifecycle code does not convert these errors into successful provisioning.
- The Windows quoting calculation handles quotes, spaces, and trailing backslashes, and counts UTF-16 code units through JavaScript string length. Its strict `< 32767` assertion leaves room for the terminator. The synthetic oversized-table and source-in-argument checks are meaningful, not tautologies.

I found no demonstrated language-level escape through casts, declaration merging, or type predicates in the shown changes. Runtime meter validation prevents a TypeScript assertion alone from bypassing its checks. Nor did I find a shown skipped-test or exception path that establishes a false pass.

The framing is appropriate, but the bundle does not include the relay’s request admission, model lookup, or final accounting functions. Consequently, I cannot establish whether an attacker-controlled model value bypasses the checked table, whether concurrent requests escape serialization, or exactly how an off-tier answer affects recorded dollars. Those require inspecting the actual omitted functions; comments describing them are insufficient evidence. The two findings above also expose a framing conflict: the stated invariant demands stricter treatment of unknown billing information than the implementation’s intentional compatibility and ceiling-accounting rules.