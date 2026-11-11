# External review of R34, codex, 2026-11-11

The Codex family's review of R34, dependencies installed by the runtime from the lockfile. The triage of this review and its Gemini companion is `2026-11-11-R34-runtime-install-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`. Outcome `counted`: 79,655 input tokens against a floor of 51,815; all four bundle markers echoed.
- **Cross-family agreement:** codex-1 (a workspace or local link installs the runner into tree code) was raised by Gemini too, as gemini-2. codex-2 (pnpm patches) and codex-3 (the assertions exercise wiring, not real hash enforcement) were raised by Codex alone.
- **Date:** 2026-11-11
- **Bundle:** `2026-11-11-R34-runtime-install-review-bundle.txt`, SHA-256 `d27e7723aa62fef9f41dff7ae33645e96c973b8519513c13692ff418c022df01`, base `15fddaf` (`reviewed/R35`), head `40692f0` (the unit branch after its acceptance fixes, before review). Every new file in full and every modified file as a function-context diff; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` excluded. Prompt: `2026-11-11-R34-runtime-install-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior project context and that it consulted official pnpm documentation, without searching for the project. Local execution was blocked, so it ran nothing. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 1 (two bypasses), 2 and 3 (codex-3; uncaught exceptions judged not to be passes), 4 (casts and literals judged not exploitable), 6, and 7 (framing judged right, sharpened to "who controls the bytes and references the judge executes") were answered. Item 5 was not answered separately.
- **Citations:** line numbers are positions in the bundle's new side, not the repository, and are hints.

---

BASE: 15fddaf  
HEAD: 40692f0  
packages/vault/test/stub.test.ts  
1f655be32e866858cb9401286613061f

No prior project context. I reviewed the supplied bundle and consulted official pnpm documentation, without searching for this project or its author. Local execution was blocked, so I did not run exploit probes or independently verify the bundle’s SHA-256.

1. **packages/adapters/src/install.ts:77; packages/api/src/install.ts:125,191 — factually wrong — high — Workspace links let an installed dependency resolve to agent-written source.**

   The pnpm reader examines `packages` but never checks `importers`. A valid workspace-only lockfile can contain a dependency represented by `version: link:packages/judge` and no downloaded packages. The reader accepts that as an empty, fully verifiable package set.

   Concrete construction: change the root dependency `vitest` to `workspace:*`, declare `packages/judge` as a workspace package named `vitest`, and put `process.exit(0)` in `packages/judge/vitest.mjs`. Generate a matching lockfile. The install receives the workspace manifest and creates `node_modules/vitest` pointing to that workspace. pnpm normally implements workspace dependencies with symlinks. [Official pnpm documentation](https://pnpm.io/package_json#dependenciesmetainjected).

   The copy at line 191 preserves that relative symlink. In the verification tree it resolves to the agent’s `packages/judge/vitest.mjs`, which was never installed from a hashed registry artifact. `runnerMissing` follows the link and checks only that the resulting file exists (`packages/api/src/verification.ts:108`). A base using the genuine runner can fail its acceptance test while the changed tree’s replacement runner exits successfully.

   This also defeats the install cache’s meaning: changing workspace source without changing its manifest leaves the install key unchanged, while changing what the installed link executes.

   **Resolution:** validate importer resolutions and reject local links into the judging dependency graph. Keep the runner and its dependencies independently pinned outside the changed tree. Validate the destination of installed links after copying; merely hashing the install directory does not establish that its links cannot reach agent-controlled files.

   **Confidence:** high in the source-level gap; confirm the complete construction with the pinned pnpm image and the repository’s materialization path.

2. **packages/adapters/src/install.ts:80,117; packages/api/src/install.ts:125 — factually wrong — high — pnpm patches can replace verified package code with agent-supplied code.**

   The reader checks tarball integrity but ignores patch declarations. The installer receives the root manifest, workspace configuration, and every nested file named `package.json`, without validating that those nested files are manifests.

   Concrete construction: declare a patch for the genuine registry version of `vitest`, storing the patch at `patches/package.json`. Keep that directory outside the workspace package patterns. Its contents are a unified diff replacing the launcher with `process.exit(0)`. Supply matching pnpm patch metadata and a matching frozen lockfile.

   `inputFiles` copies this patch solely because of its filename. pnpm’s patch mechanism modifies installed packages; disabling lifecycle scripts does not disable patch application. The registry tarball can pass its integrity check before the agent’s patch changes the runner. [Official pnpm patch documentation](https://pnpm.io/cli/patch).

   Consequently, a successful install and an installed-tree digest can describe an agent-modified judge. The recorded package diff can also miss a patch-only change: `lockfileDiff` compares package keys and tarball integrity, not patch metadata (`packages/api/src/install.ts:134`).

   **Resolution:** reject repository-controlled patches affecting the runner’s dependency graph, or install that graph separately from immutable runtime inputs. Explicitly validate supported package-manager configuration and include patch identities in evidence for application dependencies where patches are permitted.

   **Confidence:** medium-high. The exact `PNPM_AUDIT_VERSION` value is outside the bundle. Verify the construction against that pinned version, including its patch-configuration location and frozen-lockfile behavior.

3. **packages/adapters/src/stand-in.ts:90; packages/conformance/src/registry/install.ts:1 — factually wrong — medium — The conformance assertions do not establish real installer hash enforcement or pnpm’s execution boundary.**

   The stand-in copies packages by lockfile key and never compares their bytes with integrity values. Its fixtures deliberately use fabricated hashes. The hash-failure assertion supplies an `EINTEGRITY` result through `Recording`, which intercepts execution by image identity instead of running npm.

   Thus, that assertion establishes that the runtime handles a reported failure; it cannot establish that corrupt package bytes cause the real installer to report failure. Changing the intercepted command would not change the supplied result. Similarly, the pnpm script assertion checks argument membership rather than executing pnpm against hostile inputs.

   These are useful wiring tests, **not wholly tautological tests**, but their advertised security properties exceed what they exercise. Workspace-link and patch bypasses can coexist with all these assertions passing.

   **Resolution:** retain the wiring tests and add real-image positive and negative controls for both installers: matching versus mismatching tarball hashes, workspace runner substitution, patch substitution, and script/hook execution attempts. Require installation success in the positive controls so blanket refusal cannot satisfy them.

Several narrower mechanisms are sound within the stated trust model:

- Policy omission resolves to an empty registry grant, and a recognized lockfile with no grant is refused (`packages/core/src/policy/engine.ts:234`; `packages/api/src/install.ts:82`).
- The install sandbox receives the policy allowlist directly and no Vault mount (`packages/api/src/install.ts:210`). I found no demonstrated route to an ungranted host in this code, assuming the trusted provider enforces that specification.
- Nonzero installer exits and execution exceptions become failed outcomes, rather than successful installation records (`packages/api/src/install.ts:226`). The npm lifecycle probe includes an enabling control, so its suppression check is meaningful.
- The shown casts, type predicates, and `collectedBy: 'runtime'` literals do not themselves authenticate anything, but I found no agent-accessible TypeScript escape through them under the stipulated runtime-process boundary. Uncaught filesystem exceptions are not demonstrated passes.

The adversarial framing is appropriate. The distinction that matters is **who controls the bytes and references the judge executes**, not merely who launched the installer. A runtime-created installation of agent-controlled workspace links or patches does not put the judge beyond the agent’s reach.