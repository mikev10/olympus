BASE: reviewed/R38  
HEAD: 02bc9da  
packages/vault/test/stub.test.ts  
db024308de1ee178716e897f2cb84a1b

I have no prior project context. I performed no lookups and ran no tests; this review uses the bundle supplied in the prompt.

**I found no demonstrated end-to-end bypass under the stated attacker controls.** I did find gaps between the properties claimed and what the checks establish.

1. **Both drivers’ `image/check-install.js:53` — unclear — medium — installed integrity is inferred from metadata, not verified from installed bytes.**

   The checker compares npm’s recorded integrity with the committed integrity, then reads only the installed `package.json` version. Replacing an executable while retaining those metadata values passes this checker.

   That construction demonstrates the checker’s limitation, **not a demonstrated registry attack**: the attacker cannot directly edit this build filesystem, and `npm ci` supplies the tarball-integrity boundary. The unresolved issue is installation-time behavior. Both Dockerfiles execute `npm ci` with lifecycle scripts enabled, and Claude’s lock entry explicitly declares an install script (`packages/drivers/claude-code/image/cli-lock.json:16`). The bundle does not include that script, so it does not establish whether the final executable comes exclusively from verified tarballs or can be fetched or replaced separately.

   **Resolution:** inspect the pinned package’s installation and executable-selection code. Where feasible, disable lifecycle scripts and explicitly install the verified platform executable; otherwise verify any additional downloaded bytes against committed hashes. Confidence is high about the checker’s limitation; exploitability remains unestablished.

2. **`packages/conformance/src/registry/harness-image.ts:75` — factually wrong — medium — the assertion does not establish that the recorded image equals the provisioned image.**

   The assertion compares usage and evidence with profile constants, but never captures the image supplied to `sandbox.provision`. A regression that records the expected profile ID while provisioning another image would pass these comparisons.

   Similarly, replacing `buildCallImage` with a lookup of the current profile would pass this test: the profile never changes between the build call and verification. That deletes the historical-record binding the assertion is supposed to protect.

   **Resolution:** capture provisioning specs and associate them with individual calls; compare those specs with pending records, completed records, and evidence. Add a resume case where the current profile names image B while the stored build call ran in image A. Confidence: high.

3. **Both drivers’ `test/image.test.ts:85` — factually wrong — low — the “every package” assertion checks only two entries.**

   The positive install test iterates over `[CLI_PACKAGE, platform]`. Claude’s committed lock also requires the matching musl package under the checker’s platform rules because its entry has matching `os` and `cpu` and no `libc` restriction. That package is not checked by this test.

   A checker regression that ignores the musl entry can therefore leave the positive test and the existing negative test green: the negative test corrupts the other platform package.

   **Resolution:** enumerate all applicable committed entries independently in the test, verify their presence, and exercise omission or corruption of each required platform package. Confidence: high.

The mechanisms I assess as sound, within the stated trust boundary, are:

- **Tag replacement resistance:** `packages/sandbox/src/local/image.ts:169` checks the inspected ID against protected host records and returns that same ID. The build path takes its ID from `--iidfile` at line 191. A subsequent tag change does not change either selected ID.
- **Runtime-owned recording:** `packages/api/src/line.ts:1103` captures the image from the sandbox specification before the driver runs. Agent output does not supply this value.
- **Historical evidence binding:** `packages/api/src/line.ts:1239` searches recorded usage for the task’s current attempt. Missing image information stops evidence creation. This is materially stronger than copying the current profile.
- **Write-time validation:** `packages/vault/src/local/vault.ts:1444` rejects missing, malformed, and `not-recorded` values; both Vaults invoke it. TypeScript casts do not bypass these runtime checks.

I found no new check that is wholly tautological, nor a demonstrated exception-to-success path in the image controls. Missing install metadata throws; missing or malformed build IDs refuse; unreadable build records cannot authorize an image. The casts and type predicates shown do not provide an attacker-controlled route into the trusted runtime. The retry-message amendment copies messages from draft-only validation into the suffix and bounds each message; I found no concrete defect in that change.

The framing is appropriate, with two distinctions. **An image ID proves identity, not approved origin:** `packages/api/src/graph.ts:189` accepts any syntactically valid content ID, so correct composition must still obtain CLI images through `ensureImage`. Supplying an arbitrary ID is not an attacker bypass under your trusted-composition assumption. Also, image provenance does not by itself establish the origin of every executable subsequently run inside that image.

The remaining supply-chain question is therefore precise: **can the pinned CLI’s installation or executable-selection logic consume unpinned bytes despite all required locked packages being present?** The supplied source does not resolve that question, and the metadata checker cannot resolve it alone.