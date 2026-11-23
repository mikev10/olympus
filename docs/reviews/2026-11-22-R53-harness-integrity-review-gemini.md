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