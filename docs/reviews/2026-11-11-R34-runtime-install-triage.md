# Triage of the R34 external reviews, 2026-11-11

Two counted reviews of the same bundle (`2026-11-11-R34-runtime-install-review-bundle.txt`, SHA-256 `d27e7723…df01`, base `15fddaf` `reviewed/R35`, head `40692f0`): Codex (gpt-6-astra, 79,655 input tokens against a floor of 51,815) and Gemini (gemini-3.1-pro-preview, 73,659 against the same floor). No family was rerun. Each reply's SHA-256 matched its manifest's `replySha256` before its header was prepended; the untouched replies are in ad7095d.

**Counts.** Codex: 3 findings: 2 hold, 1 holds in part. Gemini: 3 findings: 1 holds, 2 hold in part. None was rejected outright. One mechanism was raised by both families (codex-1 and gemini-2). Every finding was checked by a verifier with fresh context, given the finding and the code and nothing about who wrote it. Three were also settled by running the construction: codex-1/gemini-2 in the pinned npm image, codex-2 in the pinned pnpm, and gemini-1 by an assertion that fails without its fix.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | A workspace or local link installs a package (the runner) as a symlink into code the change wrote | codex, gemini (gemini-2) | holds (run) | fixed: 10ab767, fd145bb, df3c184 |
| gemini-2 | npm's reader skips `link: true` entries, so a linked runner is accepted | gemini, codex (codex-1) | holds (run) | fixed with codex-1 |
| codex-2 | pnpm applies a lockfile-declared patch from the tree after the hash is verified | codex | holds (run) | fixed: 10ab767, df3c184 |
| gemini-3 | `runnerMissing` follows links, so a linked runner passes the presence check | gemini | holds in part: true, reachable only through codex-1 | fixed at the install (fd145bb) |
| gemini-1 | `dependencyTrees` skips a symlink named `node_modules`, so it survives the wipe | gemini | holds in part: the code skips it; a task cannot write one (not carried), but a base's survives | fixed: fd145bb, df3c184 |
| codex-3 | The hash-failure assertion scripts npm's failure; pnpm's script check is flag membership | codex | holds in part: npm's script probe is real; the rest is wiring | npm: real-image assertion added (df3c184); pnpm: known limit, #138 |

## codex-1 and gemini-2: links into the tree

**Checked.** `npmPackages` skipped `entry.link === true` before any rule, and `pnpmPackages` never read `importers`. The verifier confirmed both, noting it had not run npm to see whether a lockfile with a link would install. That was then run in `node@sha256:83f4…a7e5`, offline. npm writes the link target's own entry (`"judge": {...}`) with no hash, which the old reader refused. But with an invented `integrity` on that entry, the old reader accepted the lockfile, and `npm ci --ignore-scripts` over the copied manifests installed `node_modules/vitest -> ../fake`. In the check tree that is the change's own directory, so the change chose its runner, which I3 forbids. The construction holds; the consequence holds.

**Options.** (a) Refuse links only for the test runner and its dependency closure. (b) Refuse every link and every tree-directory entry in the readers, and refuse any install that writes a link out of its own trees. (a) was rejected because a pinned command's binary judges too, so any installed package can be the judge. (b) was chosen, with the install-level check as a second line for a link a reader misses.

**Changed.** The npm reader refuses `link: true` and any entry outside `node_modules`; the pnpm reader refuses an importer dependency on `link:` or `file:` (10ab767). `linkOut` refuses an install whose trees hold a link leaving them (fd145bb). `I3.install-installs-no-code-from-the-tree` (df3c184) failed against the old code at its npm case, and with the old `install.ts` at its link-escape case, and passes now. Its pnpm cases are covered by reader unit tests, which failed on the old reader. **Known limit:** npm and pnpm workspace repositories are refused (D-R34-11, issue #138).

## codex-2: pnpm patches

**Checked.** The verifier confirmed the reader ignored `patchedDependencies` and that a file named `package.json` anywhere is copied in, but had not run pnpm. Run with pnpm 10.18.3: a patch stored as `patches/package.json` and declared in `pnpm-workspace.yaml` was recorded in the lockfile's top-level `patchedDependencies`. A frozen install over the copied files, with `--ignore-scripts --ignore-pnpmfile`, exited 0 with the installed `is-number/index.js` patched. The construction holds.

**Changed.** The pnpm reader refuses any `patchedDependencies`, naming them (10ab767); the assertion's patch case and a reader unit test cover it. A frozen install refuses a configured patch the lockfile does not record, so refusing the lockfile's key closes the route.

## gemini-3: the runner presence check follows links

**Checked.** True: `runnerMissing` uses `stat` and `isFile`. It is reachable only when a link out of the install survives, which codex-1 was. **Changed:** nothing in `runnerMissing`. A pnpm layout's runner is itself a link within the install, so `lstat` would refuse every pnpm tree. The install-level `linkOut` refusal removes the precondition.

## gemini-1: a symlinked node_modules survives

**Checked.** `dependencyTrees` skipped non-directories, links included. The verifier found the consequence does not hold for a task: `sub/node_modules` matches `inDependencyTree`, so it is recorded in `notCarried` and never materialized. A base holding one kept it, which contradicts D-R34-04's statement that the base's own trees never decide a check. **Changed:** a link named as a tree is removed (fd145bb). On Windows the copied link could not be resolved by node at all (EPERM), so the assertion checks the tree the checks ran over rather than a check's exit. It failed with the old line and passes now.

## codex-3: the assertions exercise wiring

**Checked.** The hash-failure assertion's sandbox answers the install with a scripted `EINTEGRITY`, so it proves the runtime's handling of a reported failure, not that npm refuses bad bytes. The pnpm script assertion checks flag membership. The npm lifecycle probe is real, with an enabling control. **Changed:** `I5.install-refuses-a-package-failing-its-hash` now also runs npm's declared install in its pinned image, offline. It runs over a local tarball by its true hash, which installs, and by a hash with one character changed, which fails and is named as the failed hash. **Not changed:** pnpm in the pinned image fetches itself through corepack, which needs the network, so its script, pnpmfile, patch, and hash behaviour stays verified by hand (D-R34-02, this triage). Recorded under issue #138.

## Not raised, not assumed

Gemini answered nothing for items 2, 4, 5, and 7; its silence there is not taken as clearing them. Codex judged the framing right and sharpened it: the question is who controls the bytes and references the judge executes, not who launched the installer. Both fixes above follow that reading.
