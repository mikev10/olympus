# Decisions: skills instructions properties (amendment)

## Amendment: workspace skills, repository instructions, property checks, and reachability review

Gaps found on 2026-10-29 by checking the line against the week's announcements
of 2026-10-19 to 2026-10-26. Anthropic donated the Agent Skills standard to the
Agentic AI Foundation. Anthropic published research on model-assisted formal
verification and on reducing attack surface. OpenAI shipped a classification
endpoint, and a Codex CLI release with credential masking. GitHub turned chat
notifications into coding tasks. Each row was checked against the code on `v2`
at f99ea35, and rechecked after R21 merged at 89d8200: R21 changes the R6
driver's credential handling, not how it builds its messages, so R23's
assertion for that driver stands as written. No package changes: the amendment adds R23, R24, and R25, extends
R9 and R13, and adds dated notes to two recorded constraints. The vendor facts
it cites come from public coverage of the announcements and are not checkable
from this repository, except the CLI behaviour in D-A-WI-01, which was run.

The units are numbered from R23 because R22 is the trigger framework, drafted
in its own amendment at the same time (D-A-TF-01 to 08) and merged first, at
3a2aea8. D-A-DD-04 rests on two things R22's spec says, both checked there:
no schema carries a free-text field (`docs/plan/R22-triggers.md`, the field
schema rule), and a job template takes extracted fields as its only input and
seats no drafter (D-A-TF-01). If R22 changes either, D-A-DD-04 is rechecked.

Three announcements change nothing, and are recorded so they are not raised
again. The CLI's new safety telemetry event is CLI telemetry, which the line
does not use (D-A-LC-09); P14's record and R12's span events already carry
every enforcement decision, and the Claude Code driver already refuses a
session with any permission denial (`packages/drivers/claude-code/src/driver.ts`).
Cross-client usage metrics are R2's rates and R20's role hash, compared by R11.
Vendor-side defaults for agent features are I4.

### D-A-WI-01: skills are planted in the workspace-instruction assertion, and the plant is shown to be visible

- **Found:** `I3.workspace-instructions-not-loaded` (`packages/drivers/claude-code/test/invariants.test.ts`) plants `CLAUDE.md`, `.claude/rules/override.md`, and `.claude/agents/<role>.md`, and runs the task with `tools: []`. It plants no skill. `Skill` is in `DECLARED_TOOLS` (`packages/drivers/claude-code/src/tools.ts`), so policy can grant it.
- **Observed:** CLI 2.1.312, in a scratch repository with a skill at `.claude/skills/probe-alpha/SKILL.md` and another at `.agents/skills/probe-beta/SKILL.md`, asked to list its skills. With `--tools Skill` and no `--setting-sources`, it listed `probe-alpha`. With `--tools Skill --setting-sources ''`, it listed none. With `--tools ""` it listed none, with or without the flag. It never listed `probe-beta`. The pinned image runs 2.1.277, which was not run.
- **Consequence:** the guarantee holds on 2.1.312 for `.claude/skills`, but the assertion would not notice if it stopped holding. With no tools offered, the CLI lists no skills whatever the flag does, so a skill added to the assertion as written passes vacuously.
- **Chosen:** R23. The assertion plants both skill locations, runs once with `Skill` granted, and carries a control in the same image that must see the `.claude/skills` plant without the flag. Whether the driver also passes `--disable-slash-commands` is decided by running it on the pinned image: it is passed only if the session still offers exactly the granted set, so `#refuseSessionUnlikeGrant` is not tripped and `DECLARED_TOOLS` is not narrowed.
- **Must hold:** I3: an agent cannot rewrite what instructs the next seat through the tree it hands on. I5: a control that cannot see its plant fails rather than passes.
- **Rejected:** removing `Skill` from `DECLARED_TOOLS`. It closes the question by narrowing what policy can grant, which is a policy decision, not a test's.
- **Reverse:** drop the skill plants and the control; the three existing plants stand alone.
- **Confirmed** by the maintainer, 2026-10-29.

### D-A-RI-01: whether a seat receives the target repository's own instructions

- **Found:** no seat receives a target's `CLAUDE.md`, `AGENTS.md`, rules, or skills on its own, because the Claude Code driver runs with `--setting-sources ''` (D-A-RC-03) and the R6 driver builds its system message from the request alone (`packages/drivers/openai-compatible/src/driver.ts`). A seat granted `base-repo-readonly` can open them, and nothing points it at them. No decision records this as a choice. `ContextGrant` (`packages/core/src/station/types.ts`) has no kind for them, and `test-design` is allowed only `locked-spec` (`packages/core/src/station/contracts.ts`).
- **Option A:** record the status quo as the decision. A seat reads the target's instructions only if its role tells it to open them, and the line delivers nothing. This costs nothing, and conventions the target documents are followed only by chance.
- **Option B:** R24. The runtime reads a fixed list of instruction paths from the base commit at admission, under R20's compiler rules, and pins each by hash in the admission record. It delivers them as a new granted context, `'repo-instructions'`, off by default and never at `test-design`. Front matter is dropped, so no target file widens a grant, and only `SKILL.md` bodies are delivered. Above L2 the grant waits on R10.
- **Must hold under B:** I3, because the files come from the base and not the workspace, and are pinned before any driver call. I4, because the grant is policy's and a skill's `allowed-tools` changes nothing. I5, because a file the reader refuses refuses admission and is named. I7 is not engaged: the files are the target's content, not an event payload. Their author is still not the line, which is why the grant above L2 waits on R10.
- **Chosen: B**, with the maintainer. The claim is about whether work is really done, and work that ignores the target's documented conventions is rejected at `integrate` for reasons no check names. A lets that cost hide in R2's rework rate.
- **Reverse:** remove the grant from the station contracts; the admission record's set can stay, unused.
- **Confirmed** by the maintainer, 2026-10-29.

### D-A-PC-01: property checks are a check kind locked at `test-design`, as R25 in M3

- **Ambiguous:** the formal-verification research suggests proof of properties, and the line could take that as a proof station, a reviewer, or a check.
- **Chosen:** a check. `CheckKind` gains `'property'`. It is written at `test-design`, locked and hashed with the acceptance tests, run by the runtime at `verify` with a pinned seed and case count, and run on the base by R15. The evidence carries the seed, the cases run, and any counterexample. Each stack gets a nullable adapter slot.
- **Must hold:** I3, because the property is locked before `build`. I2, because the verdict is the runtime's run of a pinned seed. I5, because zero cases, fewer than pinned, or a file that registers no property is a refusal.
- **Rejected:** machine-checked proof now. Machine-checked proof needs a specification language and a checker per stack, and nothing in the corpus measures it. It is recorded as a later check kind with its own spec, and no unit owes it.
- **Measured by:** R7, through `hard-coded-output`, which is a measured miss today, and a new `edge-case-only` item. No claim waits on anything else.
- **Why M3:** it needs R7, R15, and R19 in place, and M2's claim does not need it.
- **Reverse:** drop the kind; nothing else depends on it.
- **Confirmed** by the maintainer, 2026-10-29.

### D-A-EX-01: the reachability question is reviewer content, in R9's role and R13's fourth job

- **Ambiguous:** the attack-surface research asks of code whether it should be reachable at all, not only whether it is vulnerable. The line could take that as a check, a new seat, or a question for the seats it already plans.
- **Chosen:** reviewer content. R17 settled that a model reading code for security is a reviewer, not a check (D-A-SC-01). R9's security reviewer role, which R9 writes in R20's format, asks the reachability question of each change. A fourth R13 job asks it of the default branch's head, read-only under `deny-all`, with findings as typed `intake` candidates. Every finding names a file and line, or the runtime refuses it.
- **Must hold:** I2, because findings are claims recorded beside a verdict and never read as one until the M3 panel. I6, because the reviewer's family differs from the authors' or reduced independence is recorded. I7, because the reviewer's text does not enter a later prompt; only the typed fields do.
- **Rejected:** a deterministic "new exposure" check, built from routes and entry points extracted per stack. It needs a per-stack extractor for every framework a target uses, and R17's static analysis already pins rules for known sinks. It can be added to an adapter later if the reviewer's findings show a pattern a rule can catch.
- **Reverse:** drop the paragraph from R9 and the fourth job from R13.
- **Confirmed** by the maintainer, 2026-10-29.

### D-A-DD-03: the Codex driver turns off workspace instruction discovery, and owes R23's assertion

- **Found:** the Codex CLI is reported to read `AGENTS.md` and skill directories from its working tree, and inside the sandbox that tree is the workspace. Its latest release is reported to mask credentials in its own output.
- **Chosen:** a dated note on the recorded constraint. The driver runs with every workspace instruction source off, or the session refuses, and it is not registered without its own R23 assertion. Masking is noted as not relied on, because P12 keeps credentials out of the sandbox.
- **Why:** a second family is what R9 waits on, and the first driver to read workspace instructions by default should meet the rule before it is built, not in its review.
- **Reverse:** drop the note; it binds nothing until the driver is picked up.
- **Confirmed** by the maintainer, 2026-10-29.

### D-A-DD-04: no model classifies a raw payload, whatever the endpoint is called

- **Found:** chat platforms now turn a notification into a coding task, and a vendor endpoint built to classify and score shipped generally. Both invite a model reading the incoming event to choose what runs.
- **Chosen:** a dated note on the event-subscription constraint, which binds R22, the trigger framework. R22 seats no classifier, and its schemas carry no free-text field, so it meets the note as drafted. A chat message is an `UntrustedPayload`. The template and its parameters come from extracted fields only. A classifier a later unit seats reads only the extracted fields, chooses only among the registered templates, and returns a claim.
- **Must hold:** I7. A classification call is a model call, so `UntrustedPayload.raw` never reaches one.
- **Reverse:** drop the note; R22 holds without it.
- **Confirmed** by the maintainer, 2026-10-29.
