# Triage of the R52 external reviews, 2026-11-21

Both families counted on their first run, with no reruns. Codex (gpt-6-astra) took in 29,650 input tokens against a floor of 11,564; Gemini (gemini-3.1-pro-preview) took in 15,512 against the same floor. Each reply's SHA-256 matched its manifest's `replySha256` before its header was prepended.

**Counts.** Codex had 2 findings: 2 hold, and both become known limits. Gemini had 3: 1 holds in part and is fixed; 1 has a false premise but holds in part, and is filed as an issue; 1 holds in part and is rejected with no change. One concern was raised by both families: a granted command tool can start a second authenticated session (Codex item 7 and gemini-2). No finding was wholly false, but gemini-2's premise was: there is no credential in the container.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | The paid `REPL` refusal does not show that Code Mode is off | codex | holds | known limit |
| codex-2 | No test runs a real CLI against a settings file that turns Code Mode on | codex | holds | known limit |
| gemini-1 | The `REPL` check in `expectOff` passes vacuously when `--tools` is absent | gemini | holds in part | fixed, 13eee68 |
| gemini-2 | With `Bash`, the model can start an authenticated nested `claude` that bypasses the switch and `--tools` | gemini, codex (item 7) | premise false; holds in part | issue #189 |
| gemini-3 | The argv check for the variable name is tautological | gemini | holds in part | rejected, no change |

Every finding was checked by a subagent with fresh context against the cited code, and the fix below was also checked by running it.

## codex-1: the `REPL` refusal is not evidence that Code Mode is off

**Checked.** `test/invariants.test.ts` (the I4 tool-inventory assertion), `src/driver.ts` (the declared-tool refusal), and `test/driver.test.ts` (`expectOff`).

**Found: this holds.** The refusal comes from `DECLARED_TOOLS`. It never reads `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE`, so deleting the switch leaves it passing. That was the intent: D-R52-03 records the refusal as a second, independent layer, and the free `expectOff` tests are what fail when the switch is deleted or set to `1`. A behavioural assertion is asked for, but none is available. With `REPL` granted, the CLI's init line was identical whether the switch was unset, `0`, or `1`, and stayed identical with the opt-in caveats planted (D-R52-02).

**Outcome.** Known limit, recorded in D-R52-04. The switch's effect rests on the vendor's documented semantics, and no test observes it. The owner is R53, the next unit to change the CLI image. It re-verifies the pin and can add an observation if the CLI exposes one by then.

## codex-2: precedence over a settings file is not exercised

**Checked.** The settings-path case in `expectOff`'s first test.

**Found: this holds.** The path `/tmp/settings.json` is never created and no real CLI runs. The assertion covers what the driver passes, not how the CLI resolves a conflicting `1`. Codex itself calls this an evidence gap, not a demonstrated bypass.

**Outcome.** Known limit, folded into codex-1's entry in D-R52-04, with the same owner and for the same reason.

## gemini-1: the `REPL` check reads `cmd[0]` when `--tools` is absent

**Checked.** `expectOff` in `test/driver.test.ts`, and the argv builders in `src/driver.ts`.

**Found: this holds in part.** In the real driver `--tools` is always present, in both the inspection and the task run, so the vacuous path cannot occur today. But `expectOff` never asserted it was there. Had a change dropped `--tools`, `indexOf` would return -1, the check would read `cmd[0]` (which is `sh`), and it would pass. The reviewer's consequence, "fails to detect if the tool restriction is absent", is right for this helper. Other tests do pin `--tools`.

**Fix (13eee68).** `expectOff` now asserts that `--tools` is present before reading its value. Shown failing: with `--tools` renamed in `#invocationFor`, the three switch tests failed with "the session carries --tools: expected -1". With the driver restored, all 63 pass. Rejected: removing the `REPL` check. It is still worth having, since a grant naming `REPL` is the route Code Mode would need.

## gemini-2: a nested `claude` under a `Bash` grant

**Checked.** The container environment (`KEY_PLACEHOLDER`, `driver.ts`), the relay in `packages/sandbox/src/relay.ts`, and the paid `I4.model-credential-not-readable-by-the-task`.

**Found: the premise is false, and a narrower defect holds.** The container holds a placeholder, not the API key. The real credential lives in the relay and is substituted when the request is forwarded, and the client's own auth headers are dropped. A nested `claude`, or a plain `curl`, inherits the relay URL and the placeholder, so it can still make model calls. Those calls are held to the same path grant, the priced models, and the shared budget. Anything such a session does with its own tools is something `Bash` could already do in the same sandbox, so the Code Mode switch and `--tools` bound the driver's session, not the container. One thing is genuinely beyond `Bash`. For the Anthropic dialect the relay does not inspect the request's `tools`, so a request can name server-side tools such as web search that the task's grant never included. Per-call fees for those tools go unmetered.

**Outcome.** This is outside R52: it is relay work in `packages/sandbox`, not the driver's pin or switch. Filed as #189 with done-when criteria. Codex's item 7 asked the same question and found no construction from the bundle; the relay was not in it.

## gemini-3: the argv check for the variable name

**Checked.** The argv builders in `src/driver.ts`.

**Found: this holds in part.** No argv element names the variable today, so the check passes for a trivial reason. It is not tautological, though. It fails on an inline `--settings '{"env":{...}}'` argument or any other element that carries the name, and that is the plausible way a later change would turn Code Mode back on from the argv. The vendor documents no command-line flag for Code Mode (D-R52-02), so the reviewer's proposed flag check has nothing to check.

**Outcome.** Rejected, no change.

## Bundle

The committed bundle's SHA-256 is `bfb2e5b95bfea1fac6ed0fc405693d6b614bc9ac62d12087e6a68b1a31edc47d`, which matches the prompt's first paragraph. No copy was left outside the repository.
