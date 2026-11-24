# External review of R53, gemini, 2026-11-22

The Gemini family's review of R53 (each driver's CLI pinned by sha512 in a lockfile the image installs from, a tag refused unless this host recorded building its image, and the image's content ID in the evidence). Triage: `2026-11-22-R53-harness-integrity-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration. Outcome `counted` on the second run: 93261 input tokens against a floor of 62515, and all four bundle markers echoed. The first run, `2026-11-22-R53-harness-integrity-review-gemini.attempt-1.run.json`, was `FAILED`: Google answered HTTP 402, with the project's prepaid credits depleted, and no reply came back.
- **Cross-family agreement:** none. It raised no findings. It assessed as sound the same mechanisms Codex did, plus the install check and `harnessLockProblems`, which Codex left open in its codex-1 finding.
- **Date:** 2026-11-22
- **Bundle:** `2026-11-22-R53-harness-integrity-review-bundle.txt`, SHA-256 `19939fc0d492297d9c11de6c522ec6f6519cf36a51cf6128116a435938ac04b1`, base `reviewed/R38`, head `02bc9da` (the unit branch before review, with the two amendment commits after R38 in its range). It held 42 sections: every new file in full and every modified file as a function-context diff. `docs/decisions.md`, `docs/plan/`, `docs/reviews/`, and `pnpm-lock.yaml` were excluded. Prompt: `2026-11-22-R53-harness-integrity-review-prompt.txt`.
- **Prior context and lookups:** it reported no prior context and no external lookups. Self-reported; not independently verifiable.
- **Coverage, and any gap:** item 6 answered with content. Items 1 to 5 and 7 were answered in one sentence as none found, with "the adversarial framing fits". No construction was attempted for any of them.
- **Citations:** it cited no line numbers.

---

BASE: reviewed/R38
HEAD: 02bc9da
packages/vault/test/stub.test.ts
db024308de1ee178716e897f2cb84a1b

I had no prior context about this project and performed no external lookups.

### 6. Sound Mechanisms

I assess the supply-chain and evidence integrity mechanisms introduced in this bundle as **sound**. 

**The Image Build and Lockfile Enforcement**
The adversary's goal of getting an agent call to run in an image whose CLI bytes do not match the committed lockfile is effectively prevented:
- `npm ci` verifies the `sha512` integrities of all tarballs. Because the lockfile is in the committed repository, the adversary cannot modify the expected hashes. The registry must serve tarballs matching these hashes or the installation fails.
- The `harnessLockProblems` function rigorously checks the lockfile's format and contents *before* any build starts, enforcing that the `CLI_VERSION` exactly matches the hardcoded application requirement, that all entries use `sha512` integrity, and that all packages resolve strictly from the official npm registry. 
- The `check-install.js` script successfully closes the gap where `npm ci` might silently skip optional platform-specific packages (if a malicious registry serves an invalid tarball, forcing a skip). It verifies that every required package for the build platform was genuinely installed at the correct version and integrity. Any mismatch explicitly fails the Docker build.

**The Image Identification and Anti-Retagging (TOCTOU) Protection**
The adversary's goal of bypassing the image through local Docker daemon tag manipulation is prevented:
- `ensureImage` and `recordedImage` derive the image tag securely from the build inputs (the Dockerfile, the lockfiles, and the base digest).
- They use `--iidfile` during `docker build` to reliably capture the content ID (`sha256:...`) of the exact image built, storing this ID securely in the host's `IMAGE_RECORDS` directory (which the adversary cannot access).
- If the Docker daemon already holds the tag, the mechanism does not blindly trust it. It inspects the tag's current ID and verifies it against the host's historical build records (`await recorded(records, tag, id)`). A maliciously re-tagged image will have an unrecognized content ID and will be explicitly refused, completely mitigating Time-of-Check to Time-of-Use (TOCTOU) substitution attacks.

**The Evidence Integrity**
The adversary's goal of falsifying the evidence bundle to name an image the call did not run in is prevented:
- The runtime passes the verified content ID directly to the sandbox provider (`spec.image`).
- `runTask` records this exact ID in the usage record (`record.harnessImage`).
- When constructing the evidence bundle, `buildCallImage` retrieves the usage record directly from the Vault. The Vault's `harnessImageProblem` securely guarantees that any stored image ID is strictly a content ID (rejecting mutable tags, repository digests, or legacy `not-recorded` states).
- If an adversary attempts to provide missing or malformed records, the type checks and legacy parsing safely fail closed (e.g., throwing when `typeof image.id !== 'string'`). 

### 1-5, 7. Other Findings
I found no mechanisms that succeed while violating their invariants, no tautological checks, no fail-open conditions, no language-specific escape hatches (type erasures safely fail closed), and no configuration bypasses. The adversarial framing fits the threat model accurately.