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