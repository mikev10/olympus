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