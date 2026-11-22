BASE: 7931508
HEAD: 7b70ccd
packages/conformance/src/registry/init.ts
0d6af3cef33ee5b6268735e88d15ea79

No prior project context. No external lookups. I reviewed the inline bundle; local command execution was denied, so I did not run tests.

1. **packages/api/src/scan.ts:87 — factually wrong — high — Repository-controlled names determine what the scanner cannot see.**

   The copy filter excludes every entry whose basename matches a dependency-tree name, without establishing that it is a directory or that the runtime installed it. A repository can contain `src/__pycache__/payload.py`, `assets/site-packages/secret.txt`, or even a regular file named `node_modules`; none reaches either scanner. Case variations work too. A Python application can execute the first through `runpy.run_path`, so the directory name does not establish that its contents are disposable dependencies.

   The assertion that these bytes are necessarily the runtime’s installation is unsupported by this function. The new test demonstrates the omission but never establishes the provenance that would make it safe.

   **Resolve:** exclude only directories established as runtime-created installation outputs, and scan repository-owned content regardless of its name—or refuse such repository content before admitting a run. Add cases containing executable code and secrets under these names, including regular files.

   **Confidence:** high for scanner blindness. A complete merge bypass depends on admission and dependency-write handling outside this bundle; the comment asserting those protections is insufficient to establish either their coverage or their absence.

2. **packages/api/src/init.ts:107 — factually wrong — medium — A dangling destination symlink defeats the “existing file means nothing is written” guarantee.**

   Commit `.factory/graph.json` as a dangling symlink. `access(F_OK)` follows it, fails, and `exists()` returns false. The preflight therefore proceeds. `initSetup` writes the external policy, roles, rubrics, environment file, and verification manifest before the exclusive creation of `graph.json` fails with `EEXIST`.

   This requires neither a race nor control of the external configuration directory. It leaves a partial setup, and retrying then refuses because the newly written files exist. It contradicts the all-or-nothing claim in the file’s opening documentation and README.

   **Resolve:** use `lstat` to detect existing directory entries, including dangling links; distinguish absence from other filesystem errors. Validate destination ancestors and implement rollback or a transactional publication strategy for failures after writing begins.

   The exclusive creation flags prevent overwriting the symlink itself; this is a partial-write defect, not a demonstrated overwrite.

3. **packages/conformance/src/registry/init.ts:43 — factually wrong — medium — The conformance assertions do not enforce the claimed configuration-location boundary.**

   Delete the overlap refusal at **packages/api/src/init.ts:169**. Every new conformance case still supplies a sibling configuration directory, so none fails because that protection disappeared. The positive case’s path-string inspection only examines the outputs of that already-safe fixture.

   Thus the claim that each protection fails its corresponding assertion when deleted does not hold for keeping policy, roles, and rubrics outside the repository.

   **Resolve:** add negative cases for configuration equal to, inside, and containing the repository, asserting refusal and no writes. Include filesystem aliases: `resolve` and `relative` establish lexical containment, not containment through symlinks or junctions. An alias exploit requires an operator-selected configuration path resolving into the repository; I do not assume the adversary controls that external path.

4. **packages/api/test/init.test.ts:48 — factually wrong — low — The token-budget test does not establish that dollars bind first.**

   The test extracts both budget fields but only asserts `maxTokens >= 1_000_000`. Raising `maxCostUsd` arbitrarily would still pass. It never evaluates token pricing or the mix of input, output, and cache tokens.

   **Resolve:** describe this as a test of the configured token allowance, or test the claimed ordering against the supported pricing and usage combinations. A fixed token threshold alone cannot prove that ordering.

Several mechanisms appear sound within the supplied code:

- Host environment-file processing rejects unknown parsed names and conflicting nonempty environment values. Parsing or reading errors do not become successful startup.
- Missing container IDs on a host without UIDs produce a configuration refusal; the conformance case exercises both refusal and valid controls.
- The host awaits `listen`, converts rejection into a nonzero refusal, and prints success afterward. The shown tests mostly inspect source and formatting, so an occupied-port executable test would provide stronger evidence.
- Scanner provisioning and execution failures do not become clean findings. Unsupported exit codes and unparseable reports produce `findings: null`, although downstream interpretation is outside the shown function.
- Exclusive writes protect existing final destination entries from replacement. They do not provide transactional setup.
- The CLI’s added functionality remains client-side configuration and HTTP targeting, with type-only API imports.

I found no literal tautology in the new executable assertions. The important weaknesses are incomplete coverage and assertions narrower than their claims. The shown casts, `unknown`, and type predicates do not establish an adversary-accessible privilege escalation: the threat model excludes control of runtime-process code and trusted injected components.

The adversarial framing is appropriate, especially for repository-controlled filesystem names. It should distinguish **scanner coverage**, **admission enforcement**, and **permission to merge**: demonstrating a blind scanner does not independently prove that every later gate permits the change. The real-run record establishes one reported successful workflow and explicitly acknowledges reduced independence and omitted merged tests; it does not establish resistance to these constructions.