# Decisions: drafting and role compiler (amendment)

## Amendment: drafting at `spec` and `test-design`, and the role compiler

Two gaps found on 2026-10-12 by asking where a seated agent's instructions come
from and who writes what it is judged by. Every run is admitted with its spec,
acceptance tests, and verification manifest already written
(`AdmissionRecord.artifacts`), so a person drafts them outside the line or has
a model do it unrecorded, as the M1 proof did (D-I1b-08). And no seated agent
runs under instructions Olympus wrote: `CompiledRole.instructions` has a
renderer in the Claude Code driver and no producer. Each row was checked against
the code on `v2` at 2dc1f11. No package changes. The amendment adds R19 and its
row; amends R15 (base results per draft hash, and a drafted manifest's
refusals at the `test-design` exit), R16 and D-A-BF-02, R9, and R7 to match,
with R7's and R16's dependency rows; adds a note on local models to R6 and
renames R5's dependency; adds R19 to F1's out-of-scope list; and records a gap
for the role compiler.

### D-A-DS-01: agents draft the spec and the acceptance tests, and policy decides who approves, as R19 in M2

- **Ambiguous:** F1 says `test-design` is black-box and the spec is locked, and D-A-I1-03 had a human write both. It could be read as requiring a person to author them.
- **Chosen:** a unit that seats a drafter at `spec` and at `test-design` when the run is admitted without that artifact. One hash binds a draft: the critic reads the recorded bytes, the base run runs over them, and the critic's result, the base record, and any approval name that hash; the approved bytes are written into the artifacts tree and locked against it. The test drafter's sandbox holds only the locked spec, with no tool that reads outside it and no egress beyond the model API, and after a base-run refusal it learns only the check's id, declaration, and exit code. Who approves is the person's policy under the line's floors (D-A-DS-04). Admitting the artifacts directly stays valid. The contract amendments are listed in R19.
- **Must hold:** the intent comes only through the human principal's channel, never from a trigger's payload, as D-A-DS-02 holds for notes. I3, because the drafter is never the builder's seat, everything about a draft binds to its hash, and the lock is taken before `build`. I1, because a drafter writes only to its workspace. I7, because a trigger's payload reaches the spec drafter only as extracted fields, and no base output reaches the black-box seats. I2, because a draft is a claim until approved and locked.
- **Accepted:** the spec drafter has no family constraint against the builder. D-A-I1-03's concern was a model judging itself through tests it wrote. For the spec, the independent critic and, whenever a floor requires one, the person who approves it are the control.
- **Rejected:** a drafter at `plan` in the same unit. The task graph is R5's question, and R5 is M3.
- **Why:** writing the spec and tests by hand is the step most likely to be skipped or done badly. A drafted, recorded, approved artifact is better evidence than a hand-written one nobody recorded.
- **Why M2:** it needs R15, R17, and the role compiler.
- **Reverse:** drop the drafting seats; runs keep being admitted with their artifacts.
- **Confirmed** by the maintainer, 2026-10-12.

### D-A-DS-02: what a rejected draft carries back

- **Ambiguous:** I7 keeps untrusted text out of prompts, and a note is free text. At `test-design`, a note from an approver who has read the repository would also carry what the black-box rule keeps from the test drafter.
- **Chosen:** at `spec`, a person's notes reach the next attempt, in the request's variable suffix and never in the stable prefix or a role. I7 is about event payloads, and the approver is the principal whose approval the gate already trusts. P9 has one principal, a shared local token with no per-user identity, so "the approver" means whoever holds it. At `test-design`, a person's rejection carries only a reason from a fixed set, such as not black-box, not following the spec, or not runnable. A critic's findings reach the next attempt as text, since the critic is granted no more than the drafter. Each station allows three attempts. When they run out on critic findings or base-run refusals, the latest draft goes to a person; when a person rejects the third, the run parks, terminally, recorded in P14's record.
- **Must hold:** notes come only from the approval call, never from a trigger or a tracker comment.
- **Reverse:** a rejection carries no text at either station.
- **Confirmed** by the maintainer, 2026-10-12.

### D-A-DS-03: the role compiler is recorded as a gap to specify, not a unit yet

- **Found:** `CompiledRole` is in the driver contract and the Claude Code driver renders its instructions, but nothing produces them. F1 lists `compiler` for M2, and no unit specifies it. A seated agent today runs under its CLI's own system prompt plus the granted context the line appends.
- **Chosen:** a recorded gap in `DECOMPOSITION.md` naming what its spec must settle: roles in the Vault and edited only as a versioned, approved change, which adds an artifact to F1's table; instructions only, with grants staying in policy; one driver-neutral `CompiledRole` that each driver's `emitArtifacts` renders; the role version's hash recorded per run; and nothing untrusted or judging inside a role. R5's dependency on "M2 role prompts" is renamed to the role compiler.
- **Why:** R19, R5, and R11 all assume roles with content. A unit started on that assumption would invent the format inside its own scope.
- **Reverse:** drop the note; the gap is then found by the first unit that needs a role.
- **Confirmed** by the maintainer, 2026-10-12.

### D-A-DS-04: policy decides who approves a draft, under the line's floors

- **Ambiguous:** a person approving every drafted spec keeps a person in the loop the mission is to remove. Approvals are keyed by station and level only, so policy cannot tell a drafted spec from an admitted one.
- **Chosen:** policy is unchanged and its cells stand. When the admission record marks an artifact drafted, the line applies a floor in the effective approval, as it applies `integrate`'s: `human-required` unless the level is L2, the cell is `auto`, and every condition for that station holds. At `spec`: the shape check passes, there is no open question, and an independent critic returned no finding for the draft's hash. At `test-design`: the base run passed for the hash, an independent critic returned no finding, and the test drafter is a different family from every model the build driver can resolve. At L3 a drafted artifact's exit is `human-required` until L3's own amendment. Each failed condition is recorded by name.
- **Critical thinking, as structure:** the drafter writes its assumptions and open questions and never settles one itself; a spec with an open question goes to a person, and its absence approves nothing. The critic checks the draft against a rubric a person writes, held in the Vault, read at admission, and outside R11's reach.
- **Must hold:** I4, because `auto` exists only where a person's policy set it. I5, because a condition that cannot be evaluated counts as failed. I2, D-A-DS-07.
- **Known limit:** a critic that finds too little lets drafts through at L2. R7's corpus measures its miss rate, and each draft approved without a person is recorded, so later failures are attributable.
- **Consequence:** with one driver no critic is independent, so every draft goes to a person until a second driver exists. R6 with a local open-weight model is the expected way there.
- **Reverse:** a person approves every drafted artifact at every level.
- **Confirmed** by the maintainer, 2026-10-12.

### D-A-DS-05: a bug report reaches the line as a person's three-part intent, and R19 drafts the rest

- **Ambiguous:** R16 had a person write the whole bug-fix spec, because no model may read the report (D-A-BF-02). With R19, the spec could be drafted, but the drafter's only input would be the report.
- **Chosen:** the person who read the report writes a structured intent with three required parts, the steps, what happens, and what should happen, through the human principal's channel. A tracker event contributes only its reference. R19's drafter writes the rest of the spec from that intent and the repository, never seeing the report. This amends D-A-BF-02: its `spec` exit at `human-required` on every level is replaced by D-A-DS-04's floors. Admission refuses a bug-fix intent missing a part.
- **Must hold:** I7, unchanged: no driver request in a bug-fix run contains report text. Whether a report was workable stays a person's call, made when they write the intent.
- **Reverse:** D-A-BF-02 as written: a person writes the whole spec, and it is approved by a person at every level.
- **Confirmed** by the maintainer, 2026-10-12.

### D-A-DS-06: independence is graded and recorded; only a different family counts

- **Ambiguous:** a user on one provider asked whether another model from the same family, such as Opus drafting and Sonnet critiquing, could serve as the independent seat. Models from one provider share data and methods, agree more often on the same mistakes, and rate their own family's work more kindly, and I6 says a reviewer never shares its author's family.
- **Option A, chosen with the maintainer:** three grades, `different-family`, `different-model`, and `same-model`, derived from the models the runtime resolved and recorded for every compared pair of seats, the review seat's included. Only `different-family` is independent and only it satisfies any R19 condition. The other grades are recorded so R2 reports outcomes per grade, and a single-provider user can see what the cheaper setup costs.
- **Option B, rejected:** let a policy accept `different-model` for `auto`. That would let a same-family seat's result gate the line, which needs an amendment to I6's text in F1.
- **Must hold:** I6 unchanged. I2, because the grade comes from the models the runtime resolved, never from a driver's or a model's account.
- **Also recorded:** R6 with a local open-weight model is the expected way for a single-provider user to reach `different-family` at no cost per token.
- **Reverse:** two grades, independent or reduced, as `ReviewSeat.independence` has today.
- **Confirmed** by the maintainer, 2026-10-12.

### D-A-DS-07: a scoped exception to D-P4-07 for R19's critics

- **Ambiguous:** D-P4-07 and R9 keep any model verdict from gating the line until the M3 panel. Under D-A-DS-04, a clean critic result is one condition for `auto` at L2, so its absence of findings takes part in the decision.
- **Option A, chosen with the maintainer:** a written exception, scoped to R19's two drafting gates. The critic's result is a list of findings with no severity, so no model grades its own finding. Any finding sends the draft back; a missing, malformed, or unreadable result counts as a finding (I5). A clean result approves nothing by itself: it is a necessary condition among others the runtime checks itself, under a policy a person wrote, at L2 only, never a sufficient one. R9's text names the exception.
- **Option B, rejected:** keep every drafted artifact `human-required` until the M3 panel, with the critic advisory.
- **Must hold:** I2, which D-P4-07 rests on. Status stays the runtime's: the draft's approval is derived from the policy cell, the level, and conditions the runtime evaluated, and the critic's clean result is necessary for `auto`, never sufficient. The exception does not extend to `review`, `integrate`, or any later station. A critic that is not a different family from the drafter is advisory at every level: its findings are shown to the person and change nothing else (D-A-DS-06).
- **Reverse:** Option B.
- **Confirmed** by the maintainer, 2026-10-12.

### D-R17-01: the boundary R17 was confirmed on

- **Ambiguous:** the R17 entry had no runnable acceptance criteria. A spec is a list of file paths (`RequestedArtifacts.spec`), so there was no part to require and no rule name for a denial check to cite. Nothing said how a security check is invoked, where its configuration comes from, which static-analysis scanner the TypeScript set carries, or where the shared scanner image lives.
- **Chosen:** acceptance criteria in R15's shape. The security part is a typed JSON file named under `RequestedArtifacts.specParts.security`, admitted and locked with the spec. The runtime owns a security check's invocation, as it does a suite check's (no `command`), and admission refuses a security check whose image is not the one declared for its kind. The configuration is inline text in the manifest, locked by the manifest's own hash; `null` means the image's built-in rules, and a scanner with none refuses `null`. The TypeScript set carries Semgrep with locked local rules, verified to report rule, path, and matched lines with no network and no login. The scanner declarations live in `@olympus-ai/adapters`, which both `api` and `readiness` already import. The base set is the findings of the base run's own security results rather than a second field beside them, so the two cannot disagree; a security check with no findings on the base refuses the `test-design` exit as a `base-mismatch` whose `declared` is `null`.
- **Confirmed** by the maintainer, 2026-10-15, on the recommendations stated at `start-unit`; the base set's placement narrows the confirmed `BaseRunRecord.findingFingerprints` to no new field.
- **Reverse:** each is one rule in `parseManifest`, admission, or the line, removable alone.

### D-R17-02: the runtime derives a finding's fingerprint

- **Found:** the pinned gitleaks 8.21.2 reports `Fingerprint` as `path:rule:line`, so a moved line reads as a new finding, and under `--redact` the secret is `REDACTED`. The entry's rule, that a scanner without a line-independent fingerprint cannot be pinned, excluded the scanner R1 already pins.
- **Chosen:** the runtime derives the fingerprint from fields of the report. A secret is the SHA-256 of its rule and its secret, with no path, so a secret moved to another file is still the base's. A static-analysis finding is the SHA-256 of its rule, its path, and its matched lines with whitespace collapsed. gitleaks runs without `--redact` inside the sandbox, and the runtime replaces a security check's stored stdout with its own rendering of the findings, so no secret reaches the Vault.
- **Confirmed** by the maintainer, 2026-10-15, over accepting line-bound fingerprints.
- **Reverse:** read the scanner's own fingerprint field in each parser.

### D-R17-03: a security check scans a copy of the tree without the scanner's in-tree ignore files

- **Found:** run against the pinned image, gitleaks reads `<source>/.gitleaksignore` whatever `--gitleaks-ignore-path` names, and a fingerprint listed there hides the finding. Semgrep reads `.semgrepignore`. A sandbox mount cannot cover one file inside the workspace: the mount table refuses nested targets.
- **Chosen:** each scanner declares the in-tree files it reads regardless of its flags. A security check runs over a copy of the tree the runtime made with every such file removed, mounted read-only, beside its configuration on a second read-only mount. The copy costs one tree copy per security check per run over a tree.
- **Reverse:** scan the tree in place once a scanner can be told not to read them.

### D-R17-04: the diff is read for suppression markers whatever the scanner allows

- **Found:** the entry says gitleaks cannot ignore `gitleaks:allow`; the pinned image has `--ignore-gitleaks-allow`, and Semgrep has `--disable-nosem`. With both flags a suppressed finding is still reported, so it already fails as new.
- **Chosen:** both flags are passed, and the runtime reads the diff for each scanner's declared markers anyway. The conformance sentence requires the `suppression-marker` violation, and a flag that a later image drops would otherwise lose the control silently. A marker added by the diff fails the check as `suppression-added`, and is recorded as a violation that raises the `integrate` exit to `human-required`.
- **Reverse:** drop the diff read for a scanner whose flag is asserted by its own conformance row.

### D-R17-05: stand-in scanners carry the line's tests, and the real images carry two Docker rows

- **Found:** the stub sandbox runs commands on the host and ignores the image and every mount but the workspace, so no line test on it can run gitleaks or Semgrep.
- **Chosen:** `@olympus-ai/adapters` exports two stand-in scanners, `node` scripts that find a seeded secret or a seeded `eval(` and report in gitleaks' and Semgrep's formats, parsed by the real parsers. A graph names its scanners in `GraphParts.scanners`; the graph builder declares any it does not attest unsafe, so no run on a stand-in goes above L1, as with the stub sandbox. The line's security run is `scanTree`, exported, so the two rows that need Docker run the real images through the runtime's own copy, strip, mount, and parse. Each test rig pins its security checks to its graph's scanner images when the request is made.
- **Reverse:** drop the stand-ins once every line test runs on the Docker provider.

### D-R17-06: every failed `verify` iteration is recorded as a `gate-failed` decision

- **Found:** the entry says a failed security check reaches P14's record as `station-refused` with a `FailedCheck` naming its cause. Nothing recorded a failed gate for any check: the task iterated, only the final park was recorded, and the P14 table marked `station:gate-failed` unconstructed (D-P14-10).
- **Chosen:** the line records `station-refused` with a `gate-failed` refusal carrying every `FailedCheck`, at each failed `verify` iteration and for every check kind, before the status it sets is committed. A last iteration that fails is recorded as `gate-failed` and then as its park. The line decides it, since the line judges the results, so `stationDecider` moves `gate-failed` from the station machine to the line. The P14 row is now a scenario, and R2's refusals by reason count failed gates.
- **Confirmed** by the maintainer, 2026-10-15, over amending the entry to make the evidence bundle and the park the record.
- **Reverse:** record only the park, and mark the row unconstructed again.

### D-R17-07: the scan copy sets the scanner's in-tree files aside, and still scans them (external review, codex-1)

- **Found:** D-R17-03 removed every entry named `.gitleaksignore`, `.gitleaks.toml` or `.semgrepignore` from the scan copy, at any depth, directories included. A credential written into `.gitleaks.toml`, or into any file under a directory with one of those names, was never scanned, and passed `verify`.
- **Chosen:** each such entry is renamed in the copy with the suffix `.scan-set-aside`, so the scanner never reads it as configuration and still scans its bytes. A tree that already holds the renamed name is refused as the scan's provisioning failure, which retries and then parks: there is no safe name to guess. The base and `verify` copies are renamed alike, so fingerprints stay comparable. A finding inside one reports the renamed path.
- **Shown** on the pinned Semgrep by `I5.static-analysis-runs-offline-on-pinned-rules`: a sink under `lib/.semgrepignore/` is reported at its set-aside path. The stand-in row `I3.scanner-config-names-are-still-scanned` shows the line failing `verify` for each name.
- **Reverse:** remove the entries again, with the gate refusing any diff that adds or changes one.

### D-R17-08: a secret in a path (external review, codex-4; known limit for the diff record, issue #44)

- **Found:** a file's name is the agent's to choose. A file named after the credential it holds was reported with the credential in its path, and `renderFindings` stored that path, so "no secret reaches the Vault" (D-R17-02) did not hold. The evidence bundle's diff records every changed path verbatim too, and that channel predates R17.
- **Chosen:** the gitleaks parser replaces every secret the report holds, in every finding's path, with `[redacted:<fingerprint>]`. The diff record's paths are a known limit, tracked as issue #44. Raw scanner `stderr` is stored as well; it runs under `--log-level error` and `--quiet` and is normally empty, and whether an error line can name a path is unverified.
- **Until then:** D-R17-02's claim is that a secret a scan finds is never stored as a finding. A credential an agent also uses as a file name reaches the Vault as a path in the diff.

### D-R17-09: what the denial check guarantees (external review, codex-2, gemini-1 and codex-3)

- **Found (codex-2, gemini-1):** a check naming `deniesRule` could be `required: false` and need not declare `onBase`. It satisfied `test-design`, got no base run, and could fail every `verify` without effect.
- **Chosen:** admission refuses a check naming `deniesRule` unless it is `required: true` (`not-required`) and declares `onBase` (`undeclared`).
- **Found (codex-3):** the requirement is met by a locked, required check that names the rule. Nothing shows that its command reaches the product or exercises a refused caller; the conformance control's command is `process.exit(0)`.
- **Known limit:** the requirement is declared coverage, not exercised authorization. The check manifest is the submitting client's, approved with the spec at `test-design` and locked before build, so this rests on that approval and is not a route the build agent can take. The unit's stated limit already says the denial checks are only as complete as the security part the person approved.

### D-R17-10: known limits of the fingerprint, the marker count, and a failed provision (external review, codex-5, codex-6, codex-7)

- **codex-5:** `staticFingerprint` collapses whitespace inside literals too, so `eval("a  b")` and `eval("a b")` share a fingerprint. Occurrences are counted, so an extra copy still fails; only an in-place, whitespace-only rewrite of a finding the base already had passes. Tolerating reformatting is what D-R17-02 chose; language-aware normalization would be the reversal.
- **codex-6:** `markersAdded` counts marker-bearing lines per file, so a marker moved to another line, or a second marker on a line that has one, is not counted as added. Both scanners run with suppression disabled, so the finding is still reported and fails as new; what escapes is the `suppression-added` violation and its `human-required` escalation. "Added" means a higher count of marker-bearing lines per file, so that moving existing lines does not fail a change (D-R17-04).
- **codex-7:** a provisioning failure part way through `verify`'s checks returns to retry before the iteration's results or its `gate-failed` decision are written, so that attempt's findings are not recorded. The retry re-runs every check, and an exhausted retry parks the task, so nothing advances. Recording partial results before a retry would change the record of every infrastructure failure, which is outside R17.
