# Triage of R53's external reviews, 2026-11-23

Reviews: `2026-11-22-R53-harness-integrity-review-codex.md` (gpt-6-astra, counted) and
`2026-11-22-R53-harness-integrity-review-gemini.md` (gemini-3.1-pro-preview, counted).

- Codex ran once.
- Gemini ran twice. Its first run, `…-review-gemini.attempt-1.run.json`, was `FAILED`: Google answered HTTP 402 because
  the project's prepaid credits were depleted, and no reply came back. The maintainer topped up the credits, and the
  rerun counted.
- Both replies matched their manifests' `replySha256` before the headers were prepended. The untouched replies are in
  f4f3ab0 (Codex) and a14df77 (Gemini).

**Counts.**

- Codex raised 3 findings. All 3 hold in part: 2 are fixed, and 1 is recorded as a known limit with a new test.
- Gemini raised none. It assessed every named mechanism as sound, and it answered items 1 to 5 and 7 in one sentence.
- No finding was raised by both families, and none failed to hold.

Each finding was checked by a fresh-context verifier given only the finding and the cited files. The install script
and the binaries were also inspected in the built image. Each fix was shown failing against the old behaviour, or
against the regression it guards, before it was trusted.

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | `check-install.js` checks metadata, not installed bytes, and Claude Code's lifecycle script might place unpinned bytes | Codex | Holds in part. The checker is metadata-only, but the script fetches nothing and links the pinned platform binary | Known limit (D-R53-05), and a new byte-identity assertion, 8f959bc |
| codex-2 | The I2 entry compares records with profile constants, so it never sees what was provisioned, and a bundle taken from the current profile would pass | Codex | Holds in part. The record and the provision share one `spec` today, so only a regression would split them. The profile-swap gap is real | Fixed, ddcca04 |
| codex-3 | The image test checks two lockfile entries, and Claude Code also requires `-linux-x64-musl` | Codex | Holds for Claude Code. Not for Codex, whose lockfile has no such entry | Fixed, 8f959bc |

## codex-1: what the install check proves about the bytes

**Checked.** `check-install.js` reads `node_modules/.package-lock.json`, compares each required entry's recorded
`version` and `integrity` with the lockfile, then reads the installed `package.json` version. It hashes no file, so the
finding's description of the checker is right.

The question the finding leaves open is whether any executable bytes arrive by another route. Inside the built image:

- The only `hasInstallScript` in either lockfile is `@anthropic-ai/claude-code`. Its `postinstall` is
  `node install.cjs`.
- `install.cjs` imports `child_process`, `fs`, `os`, and `path`. Its only spawn is a darwin-only `sysctl`. It makes no
  network call. It hard-links the platform package's binary over `bin/claude.exe`, falling back to a copy.
- `bin/claude.exe` and `claude-code-linux-x64/claude` share an inode, and both hash to `f390eaa0…8ebb`.
  `/usr/local/bin/claude` resolves to `bin/claude.exe`.
- Codex has no install script. `bin/codex.js` resolves the platform package and spawns its vendored executable.

So the executable is the one from the tarball `npm ci` verified against the lockfile's sha512. The suggested
`--ignore-scripts` would leave Claude Code's placeholder as the CLI.

**Outcome.** This is recorded as a known limit in D-R53-05: the checker verifies metadata, and the tarball's integrity
is the boundary. 8f959bc adds an assertion to Claude Code's image test that the executable on PATH is byte-identical
to the platform package's binary, so a postinstall that placed other bytes would fail the test. A later CLI bump that
adds or changes a lifecycle script shows `hasInstallScript` in its reviewed lockfile diff.

## codex-2: the record against what ran, and a bundle against its record

**Checked.** The verifier confirmed the entry reads only Vault records and evidence, and compares them with
`BUILD_IMAGE` and `REVIEW_IMAGE`. Nothing wraps `provision`.

In `runTask` (`packages/api/src/line.ts`), the recorded image is `{ id: spec.image }`, and the same `spec` goes to
`provision`. So a record and its provision differ only after a regression in `runTask`, and the entry would not see
one.

For `buildCallImage`, nothing changes the profile between the build call and verify. A bundle that took
`profile.buildImage` would pass I2. `I5.harness-image-unnamed-is-refused` already catches the record lookup being
deleted, because stripping the record leaves no bundle. But it cannot tell the record from the profile when they name
the same image.

**Fix (ddcca04).** The entry now:

- wraps the rig's sandbox and captures each provisioned spec's image;
- requires each image to be named by as many call records as sandboxes were provisioned from it, and every record's
  image to be one that was provisioned;
- runs a line whose usage records read back naming an image the profile does not, as after a resume on a rebuilt
  image, and requires the bundle to name the record's image.

It was shown failing on two regressions:

- A provision from another image, with the spec's recorded: `0 sandboxes were provisioned from sha256:bbbb…, and 1 call
  records name it`.
- A bundle taking the profile's image: `a bundle names {"id":"sha256:bbbb…"}, not the image its build call's record
  names`.

The entry's title is updated to match.

## codex-3: every entry the install must hold

**Checked.** In `check-install.js`, an entry is required if it is not optional, or if its `os`, `cpu`, and `libc` admit
the platform, and an absent field admits every value. Claude Code's lockfile entry for `-linux-x64-musl` is optional,
`os: linux`, `cpu: x64`, with no `libc`, so it is required on the image. The test's positive loop checked
`[CLI_PACKAGE, platform]`, and its negative cases altered `platform` and the CLI. A check that skipped the musl entry
left both green.

Codex's lockfile has no musl entry and no `libc` field, so its two checked entries were already the whole required set.

**Fix (8f959bc).** Both drivers' tests now derive the required set from the committed lockfile by npm's rule,
independently of the install check. They require it to contain the CLI and the platform package, check every entry's
installed version and integrity, and build once with each required optional entry's hash altered, requiring the
failure to name it.

With `check-install.js` changed to skip `-musl`, the test fails:
`node_modules/@anthropic-ai/claude-code-linux-x64-musl: expected null to be an instance of Error`. Codex's test changed
only to keep the two drivers alike.

## Gemini

Gemini raised no findings. It answered item 6 at length and the rest in one sentence, with no construction attempted.
Its header records that, and the silence is not read as endorsement. Its soundness assessment of the install check is
narrower than the evidence allows: it says `check-install.js` verifies "the correct version and integrity", and that
holds for npm's recorded metadata, as codex-1 points out.
