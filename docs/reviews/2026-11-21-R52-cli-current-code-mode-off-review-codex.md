# External review of R52, codex, 2026-11-21

The external review of R52: the Claude Code driver's CLI pin moved to 2.1.330, and Code Mode switched off on every exec. The triage is `2026-11-21-R52-cli-current-code-mode-off-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. It ran as a headless `codex exec` under a read-only sandbox, with recorded approval policy `never`. The run had an empty scratch working directory and a scratch config home holding only `auth.json`, and its environment held `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`.
- **Cross-family agreement:** codex-1 and codex-2 were raised by codex alone. Codex's item 7 asks whether a granted operation can start another authenticated execution path. Gemini raised that concern too (gemini-2). Gemini's 1 and 3 are its own.
- **Date:** 2026-11-21
- **Bundle:** `2026-11-21-R52-cli-current-code-mode-off-review-bundle.txt`, SHA-256 `bfb2e5b95bfea1fac6ed0fc405693d6b614bc9ac62d12087e6a68b1a31edc47d`. Base `reviewed/R37`, head `f6837cc` (the unit's code commit). It holds the 10 files changed in that range: the R52 driver and test changes and their changeset, plus maintainer tooling and docs commits that landed after R37. Excluded: `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, `pnpm-lock.yaml`. Prompt: `2026-11-21-R52-cli-current-code-mode-off-review-prompt.txt`.
- **Prior context and lookups:** the reviewer reported no prior context and no lookups. That is a self-report and cannot be verified.
- **Coverage, and any gap:** items 1 and 2 are answered (findings 1 and 2), and so are 3 and 4 (no fail-open, no casts that matter), 6 (sound mechanisms), and 7 (the framing). Item 5 gets no separate answer; finding 2 covers it in effect.
- **Citations:** line numbers are positions in the bundle's new-side diffs, not in the repository, so treat them as hints.

---

BASE: reviewed/R37
HEAD: f6837cc
packages/drivers/claude-code/test/invariants.test.ts
75ee49a26c58257660d9aae9741fe55e

I have no prior project context and performed no lookups. I reviewed the bundle embedded in your message; I did not independently verify its SHA-256 or run tests. Citations use new-side line numbers.

1. **packages/drivers/claude-code/test/invariants.test.ts:85 — factually wrong — medium — Refusing a `REPL` grant does not verify that Code Mode is disabled.**  
   Delete `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE` from the driver while leaving its tool declaration unchanged: this added assertion still passes because the driver still rejects an undeclared tool. It never starts the CLI with Code Mode enabled or observes whether another granted tool can expose that execution path.

   The existing session-inventory assertions might detect Code Mode if it changes the reported inventory, but the supplied source does not establish that relationship. With Code Mode defaulting off, removing the explicit switch can also leave those sessions unchanged.

   The new recording-provider tests **do** catch deletion or replacement with `'1'`; the gap is specifically in treating the added live refusal as evidence of effective Code Mode suppression. Resolve this with a behavioral test against the pinned CLI under a configuration that otherwise enables Code Mode, and demonstrate that removing the driver’s override makes that test fail. **Confidence: high** about the refusal assertion’s independence; actual CLI behavior remains unverified.

2. **packages/drivers/claude-code/test/driver.test.ts:495 — unclear — medium — The settings-file case does not exercise conflicting settings.**  
   This test supplies `/tmp/settings.json` and a fabricated successful stream. Nothing in the shown test creates a settings file containing an enablement setting or has the CLI interpret it. Consequently, a CLI that ignored the environment override when settings enabled Code Mode could satisfy this test unchanged: the recorded environment would still contain `'0'`.

   This is useful coverage of what the driver passes, but it does not establish the claimed precedence over task-writable settings. Resolve with a real conflicting settings file and a pinned-CLI behavioral assertion, including a control demonstrating that the enablement setting takes effect without the override. Under the vendor semantics stipulated in the question, this is an evidence gap, **not a demonstrated production bypass**. **Confidence: high.**

Several parts are sound within the evidence provided:

- **`src/driver.ts:219`:** Explicitly setting `'0'` is the appropriate mechanism under the supplied vendor semantics. A task cannot change its parent process’s environment by writing files. Given the stipulated precedence, a settings-file `'1'` cannot override this value.
- **`test/driver.test.ts:484–492`:** The recording assertions are not tautological. They inspect driver-produced calls, require an exact session count, and compare the environment against a literal expected value. An empty call list cannot pass through vacuous iteration.
- **`test/driver.test.ts:502–519`:** Coverage includes both MCP inspection and task execution, plus all three tiers.
- **`test/driver.test.ts:523–527`:** The undeclared-grant test checks rejection and zero recorded CLI calls. It provides useful evidence of admission refusal.
- **`src/image.ts:26`:** The version is an exact literal. Image-tag and build-argument derivation are not shown, so I cannot independently verify those connections.

I found no shown catch, skip, swallowed exception, or empty-result fallback that turns these new tests green. The `?? []` at `test/invariants.test.ts:117` warrants attention only if `DECLARED_TOOLS` can be empty; its definition is absent, so that is not an established defect. The shown `as const` and `as TaskId` casts do not supply an attacker with runtime authority. No relevant `any`, declaration merging, augmentation, or type-predicate escape is shown.

The framing needs one distinction: **a CLI tool-selection boundary is not necessarily a transitive capability boundary**. If policy grants arbitrary command execution, a model could potentially launch a child CLI with a different environment. Whether that child can authenticate, reach the API, and execute additional tools depends on restrictions absent from this bundle. The parent’s fixed environment alone does not settle that question.

The useful adversarial question is therefore: *Can any granted operation create another authenticated execution path outside the driver’s controlled invocation?* The bundle omits `environmentFor`, both invocation builders, the tool declaration, and relevant credential/relay enforcement. I cannot establish or exclude that construction from the supplied source. No concrete production bypass is demonstrated here; the demonstrated findings concern what the tests actually prove.