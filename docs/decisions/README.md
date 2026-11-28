# Decisions

Calls made while executing a unit where the spec was silent, ambiguous, or in
tension with the environment, and calls taken outside any unit where what
changed was the gates or the tooling that runs them. Each entry records what was
unclear, what was chosen, why, and how to reverse it.

One file per unit, so two open branches do not append to the same tail. Within a
file, newest sections are at the bottom.

## Where an entry goes

- **A unit's record** goes in `<ID>.md`, named for the unit exactly as
  `docs/plan/DECOMPOSITION.md` names it (`P3.md`, `R13a.md`). The unit creates
  the file with its first entry and adds its row to the table below, in id
  order rather than at the end.
- **An amendment to one unit**, before or after that unit ships, is appended to
  that unit's file. A unit that was split keeps the split in the parent's file
  (`R13.md`) and each half's record in its own (`R13a.md`, `R13b.md`).
- **An amendment that belongs to no single unit** gets its own file,
  `amendment-<slug>.md`, and a row below. Gate and workflow amendments in the
  `D-A-CI` series are appended to `amendment-ci.md`.
- **Tooling decisions** (`D-TOOLING-nn`) are appended to `tooling.md`.

Ids are unchanged by the split and stay unique across the directory. To find an
entry by id:

```
git grep -n "D-P3-06" -- docs/decisions
```

## Files

| File | Sections, oldest first |
|---|---|
| [F2.md](F2.md) | F2: Contracts<br>F2 review gate: approved changes to the contract spec<br>F2 amendment: maintainer review of the nine files |
| [F3.md](F3.md) | F3: Conformance harness + repo scaffold<br>F3 amendment: maintainer review of the conformance kit<br>F3 amendment: external adversarial review<br>F3 amendment: planning documents tracked |
| [S1.md](S1.md) | S1: Walking skeleton<br>S1 amendment: external adversarial review<br>Amendments surfaced by S1 |
| [P1.md](P1.md) | P1: Vault<br>P1 amendment: external adversarial review |
| [P2.md](P2.md) | P2: Sandbox (local Docker)<br>P2 amendment: external adversarial review |
| [P3.md](P3.md) | P3: Policy engine<br>P3 amendment: external adversarial review<br>P3 amendment: second external review |
| [P4.md](P4.md) | P4: Station machine |
| [P5.md](P5.md) | P5 amendment: the egress allowlist becomes P10<br>P5: Driver: Claude Code<br>P5 amendments to the contracts<br>P5 amendment: external adversarial review |
| [P6.md](P6.md) | P6: Verification + evidence<br>P6 amendments to the contracts |
| [P7.md](P7.md) | P7: Tamper detection<br>P7 amendments to the contracts |
| [P8.md](P8.md) | P8: Adapters (TypeScript)<br>P8 amendments to the contracts |
| [P9.md](P9.md) | P9: API + CLI<br>P9 amendments to the contracts |
| [P10.md](P10.md) | P10: Sandbox egress allowlist<br>P10 amendment: external adversarial review |
| [P11.md](P11.md) | P11: Sandbox network probe + HTTP behavioral<br>P11 amendments to the contracts |
| [P12.md](P12.md) | P12: Credential at the egress layer<br>P12 amendments to the contracts |
| [P13.md](P13.md) | P13: Cost control<br>P13 amendments to the contracts |
| [P14.md](P14.md) | P14: Enforcement record<br>P14 amendments to the contracts |
| [I1.md](I1.md) | Amendment: I1 split into I1a and I1b |
| [I1a.md](I1a.md) | I1a: The real line<br>I1a amendments to the contracts |
| [I1b.md](I1b.md) | I1b: Integrate + M1 proof<br>I1b amendments to the contracts |
| [R1.md](R1.md) | R1 planning: readiness specified, not started<br>R1 amendment: the two open decisions, taken<br>R1: Readiness<br>R1 amendment: a negative fixture for every ceiling-bearing probe |
| [R2.md](R2.md) | R2: Outcome measurement<br>R2 amendments to the contracts |
| [R3.md](R3.md) | Amendment: behavioral breadth, browser (R3)<br>R3: Behavioral breadth (browser) |
| [R4.md](R4.md) | Amendment: parallel task execution (R4)<br>Unit: parallel task execution (R4)<br>Amendment: a park records its cause (issue #47) |
| [R5.md](R5.md) | Amendment: R5 splits, and drafting at `plan` gains its spec |
| [R5a.md](R5a.md) | R5a: Drafting at `plan` |
| [R6.md](R6.md) | R6 — Driver: any OpenAI-compatible endpoint<br>R6 amendments to the contracts |
| [R7.md](R7.md) | R7: False-done benchmark<br>R7 amendments to the contracts |
| [R8.md](R8.md) | Amendment: post-merge observation (R8), split into R8a and R8b |
| [R8a.md](R8a.md) | R8a: Post-merge attribution and the baseline |
| [R8b.md](R8b.md) | Amendment: R8b's observation plan (D-A-OB-07 resolved)<br>R8b: The observation plan |
| [R9.md](R9.md) | Amendment: separation of duties (R9)<br>R9: Separation of duties across every seat |
| [R10.md](R10.md) | Amendment: trust ratchet (R10)<br>R10: Trust ratchet |
| [R12.md](R12.md) | R12: Telemetry export (OpenTelemetry)<br>R12 amendments to the contracts |
| [R13.md](R13.md) | Amendment: nightly review (R13), split into R13a and R13b |
| [R13a.md](R13a.md) | Amendment: R13a's three undeclared contract changes (A-R13a-05 to A-R13a-07)<br>R13a: Nightly checks without a model |
| [R13b.md](R13b.md) | R13b: Nightly reviewers |
| [R14.md](R14.md) | R14 amendments to the contracts |
| [R16.md](R16.md) | Amendment: bug-fix intake (R16)<br>R16: Bug-fix intake |
| [R18.md](R18.md) | R18: Stack recorded per run<br>R18 amendments to the contracts |
| [R19.md](R19.md) | R19: Drafting at `spec` and `test-design`<br>R19 amendments to the contracts |
| [R20.md](R20.md) | Amendment: role compiler (R20)<br>R20: Role compiler |
| [R21.md](R21.md) | R21: Local model endpoint<br>R21 amendments to the contracts |
| [R22.md](R22.md) | Amendment: trigger framework (R22)<br>R22: Trigger framework |
| [R23.md](R23.md) | R23: Workspace skills and instruction discovery |
| [R24.md](R24.md) | Amendment: repository instructions (R24)<br>R24: Repository instructions as granted context |
| [R25.md](R25.md) | R25: Property checks<br>R25 amendment: external adversarial review |
| [R26.md](R26.md) | Amendment: Codex driver (R26)<br>Amendment: the Responses API meter (R26)<br>R26: Driver: Codex |
| [R28.md](R28.md) | R28: Finding outcomes, derived by the runtime<br>A-R28-02: a finding's outcome is named for what the runtime proves |
| [R29.md](R29.md) | Amendment: Python installs as a list of steps (R29)<br>R29: Adapter sets beyond TypeScript, Python first |
| [R34.md](R34.md) | R34: Dependencies installed by the runtime from the lockfile |
| [R35.md](R35.md) | R35: Runnable release and first-run docs |
| [R36a.md](R36a.md) | R36a: The shipped example runs on the real driver |
| [R36b.md](R36b.md) | R36b: `init`, and a real feature from a fresh clone |
| [R37.md](R37.md) | R37: A failed gate tells the retry, and the run, why |
| [R38.md](R38.md) | R38: Paid driver evidence that does not flake |
| [R39.md](R39.md) | R39: Tests that cannot pass by accident |
| [R40.md](R40.md) | R40: Admission enforces the readiness ceiling |
| [R52.md](R52.md) | R52: The driver's CLI is current, and Code Mode is off |
| [R53.md](R53.md) | R53: Harness integrity: the agent CLI by content, the image in evidence<br>A-R53-02: one build of a tag at a time (#231) |
| [R54.md](R54.md) | R54: The `deep` tier's model, chosen by the benchmark |
| [R55.md](R55.md) | R55: An operator can read a draft, and the host refuses a rejected key |
| [R56.md](R56.md) | R56: The relay forwards only the tools a task was granted |
| [R57.md](R57.md) | R57: A build runs the locked acceptance tests in its own sandbox |
| [R58.md](R58.md) | A-R58-01: a spent budget is a park cause, and a station refusal names the state it was made at<br>R58: A refused run says so, and a spent budget parks at once |
| [R59.md](R59.md) | R59: Token efficiency is reported, and a regression fails the benchmark |
| [R61.md](R61.md) | A-R61-01: R61's saving is measured in `report`, not in the benchmark |
| [R66.md](R66.md) | R66 — The relay meters what it forwards, and starts on Windows |
| [tooling.md](tooling.md) | Tooling: external review automation |
| [amendment-agent-run-delivery.md](amendment-agent-run-delivery.md) | Amendment: the line checked against an account of agent-run delivery |
| [amendment-base-and-bug-intake.md](amendment-base-and-bug-intake.md) | Amendment: the base before build, and bug-fix intake |
| [amendment-ci.md](amendment-ci.md) | Amendment: CI gets a credential, and the order the gate needs |
| [amendment-drafting-and-role-compiler.md](amendment-drafting-and-role-compiler.md) | Amendment: drafting at `spec` and `test-design`, and the role compiler |
| [amendment-host-refusal-and-script-scan.md](amendment-host-refusal-and-script-scan.md) | Amendment: the host prints its own refusal, and the name scan reads scripts |
| [amendment-lockfile-install-and-python.md](amendment-lockfile-install-and-python.md) | Amendment: lockfile install (R34) and Python adapters (R29) |
| [amendment-security-at-the-gate.md](amendment-security-at-the-gate.md) | Amendment: security at the gate, and two recorded constraints |
| [amendment-skills-instructions-properties.md](amendment-skills-instructions-properties.md) | Amendment: workspace skills, repository instructions, property checks, and reachability review |
| [amendment-tiers-and-paid-boundary.md](amendment-tiers-and-paid-boundary.md) | Amendment: tier per station, the observation plan, delivery measures, and the paid boundary |
