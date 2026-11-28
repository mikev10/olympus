# Decisions: base and bug intake (amendment)

## Amendment: the base before build, and bug-fix intake

Two gaps found on 2026-10-01 by checking the line against Builder.io's account
of an agent software factory that starts from one bug report. Its loop is:
choose a reproducible report, reproduce it, fix it, run the reproduction again,
and hand over a pull request with the evidence. The line already does the run
after the fix, and more strictly, because the runtime runs the checks. It does
not show that a check could fail before the fix, and it has no way in for a
report that someone outside wrote. Each row was checked against the code on
`v2` at 7fcb611. No package changes; the amendment adds R15 and R16.

### D-A-BF-01: acceptance checks run on the base before build, as R15 in M2

- **Ambiguous:** `test-design` locks the acceptance tests and `verify` runs them over base plus the diff (P6). Nothing runs them on the base, so a test that passes before the change also passes after any change, and the gate it holds proves nothing. This could be read as a review concern, since a reviewer can spot a vacuous test.
- **Chosen:** a unit. Every acceptance check in the locked manifest declares `'fails'` or `'passes'` on the base, with no default. At the `test-design` exit the runtime runs them over the base snapshot P6 already takes, in a fresh read-only `deny-all` sandbox, and refuses the exit if a check does not do what it declared, if one does not start, or if none is declared `'fails'`. The base results go to the Vault and `verify`'s evidence refers to them.
- **Must hold:** the base results are the runtime's (I2) and a resume reads them rather than running them again. A check that did not start is never counted as one that failed.
- **Why:** a gate the change could not fail is a false-done the line cannot catch, which is the failure the claim is about. Declaring `'passes'` keeps guard tests usable without a silent default (I5). As a side effect, a base that cannot run its own checks is found before any model is paid for.
- **Why M2:** M1's scope is closed. The unit costs one sandbox run per admitted run and no model call.
- **Known limit:** the runtime does not judge why a check failed on the base. Mutation testing (M3) is the control for that.
- **Reverse:** drop the run on the base. The `'fails'`/`'passes'` declaration can stay as documentation for the reviewer.
- **Confirmed** by the maintainer, 2026-10-11, when R15 started (D-R15-01).

### D-A-BF-02: bug reports enter as a template whose spec a person writes, as R16 in M2

- **Ambiguous:** the account this amendment checks has an agent read the report, judge whether it can be worked, and reproduce it. A bug report is untrusted free text, and its steps to reproduce cannot pass the extractor's owed field schemas, which cap length and character class (`I7.extracted-field-schemas`).
- **Chosen:** bug fix is a pre-declared template entered at `spec`. A tracker trigger extracts only the issue's reference, allowlisted labels, and author trust. The `spec` exit is `human-required` at every level. The spec has required parts (steps, actual, expected, where, what the check needs), and a missing part is refused. `test-design` must include an acceptance check declared `'fails'` on the base (D-A-BF-01), and that check run by the runtime is the reproduction.
- **Must hold:** no text from the report reaches a driver. A model drafting the acceptance check sees the locked spec only. Refused and abandoned reports are recorded in P14's record with their cause.
- **Rejected:** a model reading the report to judge whether it can be worked, or to draft the spec. Either puts untrusted text in a prompt (I7). A quarantined summariser whose output went to a person would not break I7, but it is left out of R16 so the first version has no model on the payload path at all.
- **Why:** the account's own first step is a person checking the agent's choice of report. Putting the person there by design, not as a dry run, keeps the line's single route for untrusted text, and the line still proves the reproduction rather than taking a model's word for it.
- **Why M2:** it needs the trigger framework and R15.
- **Reverse:** allow the human trigger only, and drop the tracker trigger.
- **Proposed;** not yet confirmed by the maintainer.
