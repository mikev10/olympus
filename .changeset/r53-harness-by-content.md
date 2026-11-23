---
"@olympus-ai/vault": minor
"@olympus-ai/sandbox": minor
"@olympus-ai/api": minor
"@olympus-ai/driver-claude-code": minor
"@olympus-ai/driver-codex": minor
"@olympus-ai/benchmark": patch
"@olympus-ai/conformance": patch
---

The agent CLI is installed by content, and the evidence names the image every driver call ran in (R53, #169).

Each driver's image now installs its CLI from `image/package-lock.json`, which pins the CLI and every platform package by `sha512`, using `npm ci`. It never installs by name. npm skips an optional platform package whose tarball fails its hash, so `image/check-install.js` then fails the build unless every package pinned for the image's platform is installed as locked. `ensureImage` refuses a lockfile with an entry that has no `sha512` integrity, or that resolves outside the npm registry, or a lockfile whose CLI is not `CLI_VERSION`. It now returns the image's content ID instead of its tag. It refuses, and never rebuilds over, a tag the daemon holds as an image this host did not record building. The record is kept under `~/.factory/images/`, and `EnsureImageOptions.records` overrides that location.

`@olympus-ai/vault` adds `HarnessImage` and `harnessImage` on `UsageRecord` and `EvidenceBundle` (A-R53-01). Both Vaults refuse `not-recorded` and any ID that is not a content ID. `@olympus-ai/sandbox` adds `imageId()`, which pulls only when asked and only for a digest-pinned reference, `harnessLockProblems()`, and `recordedImage()`. In `@olympus-ai/api`, the line records the image it provisioned each call from, and a bundle copies the image from its build call's usage record. `buildGraph` refuses a profile whose `buildImage` or `driverImages` value is not a content ID. `readUsage` reads a record written before R53 as `not-recorded`.

New assertions: `I2.harness-image-recorded-by-the-runtime`, `I5.harness-image-unnamed-is-refused`, `I5.claude-code-image-installs-the-cli-by-content`, `I5.claude-code-image-replaced-is-refused`, `I5.codex-image-installs-the-cli-by-content`, and `I5.codex-image-replaced-is-refused`.
