# External review of R53, codex, 2026-11-22

The Codex family's review of R53 (each driver's CLI pinned by sha512 in a lockfile the image installs from, a tag refused unless this host recorded building its image, and the image's content ID in the evidence). Triage: `2026-11-22-R53-harness-integrity-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`. Outcome `counted`: 96219 input tokens against a floor of 62515, and all four bundle markers echoed.
- **Cross-family agreement:** none. Gemini raised no findings, so codex-1, codex-2, and codex-3 were raised by Codex alone. Both families assessed the tag-replacement refusal, the runtime-owned recording, and the Vault's write-time checks as sound.
- **Date:** 2026-11-22
- **Bundle:** `2026-11-22-R53-harness-integrity-review-bundle.txt`, SHA-256 `19939fc0d492297d9c11de6c522ec6f6519cf36a51cf6128116a435938ac04b1`, base `reviewed/R38`, head `02bc9da` (the unit branch before review, with the two amendment commits after R38 in its range). It held 42 sections: every new file in full and every modified file as a function-context diff. `docs/decisions.md`, `docs/plan/`, `docs/reviews/`, and `pnpm-lock.yaml` were excluded. Prompt: `2026-11-22-R53-harness-integrity-review-prompt.txt`.
- **Prior context and lookups:** it reported no prior context, no lookups, and no tests run. Self-reported; not independently verifiable.
- **Coverage, and any gap:** items 1, 6, and 7 answered with content. Items 2, 3, and 4 answered as none found. Item 5 was not addressed separately; graph.ts:189 accepting any well-formed content ID is raised under item 7 instead.
- **Citations:** line numbers refer to the bundle's new-side positions, not the repository, and are hints.

---

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