# Triage of the R36b external reviews, 2026-11-21

Two reviews, both `counted`, with no reruns:
- **Codex** (gpt-6-astra): 4 findings. 0 hold as stated, 4 hold in part, 0 do not hold.
- **Gemini** (gemini-3.1-pro-preview): 2 findings. 0 hold as stated, 2 hold in part, 0 do not hold.

Both families raised two of the defects: the scan filter and the budget claim. Each finding was checked by a subagent with fresh context against the cited code, and by a test where one could be run. Four fixes were applied, one per defect, each test-first. One residue predates this unit and is filed as #203.

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 / gemini-1 | The scan's copy leaves out anything *named* like a dependency tree, at any depth, file or directory, so content no install made goes unscanned | both | holds in part | fixed, b286fba; residue #203 |
| codex-2 | A dangling link at a file `init` writes passes its existence check on Linux, so `init` writes the rest before the last write fails | codex | holds in part | fixed, 01a067b (asserted in f683ce1) |
| codex-3 | No assertion fails when the refusal of a configuration directory overlapping the repository is deleted | codex | holds | fixed, f683ce1 |
| codex-4 / gemini-2 | The token-budget test, policy comment and changeset claim the dollar budget binds first; it does not on read-heavy work | both | holds in part | fixed, cd82baa |

## codex-1 / gemini-1: the scan's filter judged by name

**Checked.** `copyScanned` (`packages/api/src/scan.ts`) filtered on `isDependencyTree(basename(path))`, a case-insensitive name match on `node_modules`, `.venv`, `site-packages` and `__pycache__`. It checked neither type nor depth. Its callers are:
- the base run and `verify`, in `line.ts`, both after `installInto`;
- nightly, which installs nothing.

**What holds.** A name is not provenance. A regular file named `node_modules`, or a `.venv`, `site-packages` or `__pycache__` directory in a Node.js tree, went unscanned. The Node.js install touches only `node_modules`, so those directories are not the install's. The test written first (`test/scan.test.ts`, "anything the install did not make is scanned, whatever it is named") failed against the old filter. The old filter returned `src/app.ts` alone, where the test expects four paths.

**What does not hold.**
- *Gemini's claim that a builder can hide merged code under `src/node_modules/`.* The carry rule (`line.ts`, `inDependencyTree` in `workspace.ts`) matches any path segment. A builder's write there is recorded as not carried and escalated, never put in the judged tree or the pushed diff.
- *Gemini's premise that `npm ci` clears only the root `node_modules`.* Irrelevant here: `installInto` itself removes every directory or link of the stack's tree names, at any depth, before it installs.

**Fix chosen.**
- `installInto` returns the trees it put in (`trees`), and `scanTree` takes them as `installed` and leaves out exactly those paths.
- The install removes every tree of those names first, so each returned path is the install's own.
- Nightly passes an empty list and scans everything, as it did before this unit.

**Rejected:**
- matching only at the root, which breaks workspaces with nested `node_modules`;
- name plus directory type alone, which still drops a Node.js tree's `.venv`.

**Residue, filed as #203.** Because the install removes directories of those names at any depth, content the *repository* committed there is never in the tree the checks judge. That predates R36b (R34's install) and needs a design decision: refuse such a base, or install around tracked content.

## codex-2: a dangling link at a file init writes

**Checked.** `exists()` in `init.ts` used `access(F_OK)`, which follows links. The preflight lists every file before writing, then writes in this order:
1. the policy, roles and rubrics;
2. the environment file;
3. the manifest and graph, each `wx`.

The file's doc says "either every file is written or none is".

**What holds.** On Linux and macOS, `access` fails on a dangling link, so the preflight passes, the external files are written, and the last exclusive write fails. That is a partial setup, against the doc. On this Windows host, the verifier found that `access` resolves a dangling link and `init` already refused, so the defect is POSIX-only and could not be shown failing here. CI runs Linux.

**What does not hold.** Codex itself notes that no file is overwritten, and the `wx` writes see to that.

**Fix.** `exists()` uses `lstat`, so a link is something there. Any error but `ENOENT` or `ENOTDIR` is thrown, not read as room to write: the old code also read a permission error as absence. `I5.init-refuses-to-overwrite` gains a dangling-link case.

**Rejected.** A transactional write with rollback. With every refusal moved before the first write, the remaining failures are disk errors, which this does not change.

## codex-3: the overlap refusal had no assertion

**Checked.** `init.ts` refuses `config-inside-repository` when either path contains the other. No test or conformance entry named it, and every conformance case used a sibling directory.

**Fix.** `I5.init-setup-admitted` now runs `init` with a configuration directory equal to, inside, and containing the repository. It requires each to be refused, with neither a policy nor `.factory/` written.

**Shown.** With the refusal disabled (`if (false && …)`) and the package rebuilt, the entry failed with "a configuration directory equal to the repository was answered {"ok":true…}". The source was then restored.

**Not taken.** Resolving symlinks and junctions before the containment check. Codex marks this as needing an operator-chosen alias path, and the configuration directory is the operator's, which the prompt placed outside the adversary's control.

## codex-4 / gemini-2: the token-budget claim

**Checked.**
- The relay (`packages/sandbox/src/local/relay.ts`) checks the token sum, cache reads included, before the dollar sum.
- The standard tier is `claude-sonnet-5`, with cache reads at $0.20 per million (`drivers/claude-code/src/driver.ts`).
- 1,000,000 cache-read tokens therefore cost about $0.20, under `maxCostUsd` 1.
- The test named "a token budget its dollar budget binds before" asserted only `maxTokens >= 1_000_000`.

**What holds.** The claim is false for read-heavy work, which is exactly the build's profile. The test's name overstates what it asserts.

**What does not hold.** Gemini's $0.30 figure is the older model's price. Its recommendation of about 3,500,000 tokens would reach $1 only at that price.

**Fix.** The number stands: the passing build read 302,512 tokens, and the user asked for the limit to be raised and spent wisely, not maximised. The policy comment, the test's name and the changeset now say what 1,000,000 buys: room to read a small repository and still write the change. D-R36b-12 carries the correction.

**Rejected.** A token figure chosen to make dollars bind first (about 5,000,000 today). It moves with every price change, and tuning it belongs to the measurement work in #197.

## Acceptance after the fixes

`pnpm -r typecheck`, `pnpm -r lint`, and every test suite except the two paid drivers' were rerun after the four fixes. The results are in the report at the merge gate. The init conformance entries pass. The only failures in that subset are the paid external reports (`I5.init-setup-merges-on-the-real-driver` and the Claude Code driver's), which CI produces.
