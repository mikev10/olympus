# Triage of R57's external reviews, 2026-11-25

Both families counted on their first run, so nothing was rerun. Codex (gpt-6-astra) raised 2 findings, and both hold. Gemini (gemini-3.1-pro-preview) raised 1, and it holds. Both families raised one finding, the same one. **Findings that did not hold: 0.**

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-2 / gemini-1 | `installForBuild` lets a build continue to the builder when the install fails for any reason other than provisioning | codex, gemini | holds, and worse than stated | fixed, 3a8e3e8 |
| codex-1 | the dependency-write record compares the final state with the start, so a write the builder reverts before it returns leaves no trace | codex | holds | known limit, recorded (D-R57-05) |
| codex (coverage note) | the cache entry checks `notCarried` but not the change's diff | codex | holds | fixed, f196e6e |

## codex-2 / gemini-1: a failed install at build still reaches the builder

**Claim.** When `installInto` fails at anything other than provisioning, `installForBuild` returns `undefined`, and the builder is invoked over a tree with no install. Codex reads this as a breach of fail-closed that `verify` still catches. Gemini reads it as wasted budget.

**Checked.** By running it. A new api test (`a build whose install fails is not handed to the builder`, `packages/api/test/line.test.ts`) uses a sandbox that removes the run's install cache after each base-run check, so the build has to reinstall, and that fails every install after the first. On the old code the builder was asked three times.

**Found.** The defect is wider than both reviews say. `installForBuild` returned `spendRetry`'s result. An `undefined` from `spendRetry` means a retry is still to come, and its caller should return. `build` read it as "go on". So even the provisioning failure, which the unit did route to `spendRetry`, went on to the builder whenever a retry remained. The consequence is limited in practice. The build-tree entry now asserts that a run provisions exactly one install sandbox, the base run's. A build's inputs are always ones the run already installed, so `installInto` reuses that install and does not fail. The path is reachable only when that cache is missing.

**Changed (3a8e3e8).** `installForBuild` returns `{ ok: true }`, or `{ ok: false, outcome }` holding whatever `spendRetry` returned. `build` returns that outcome on any failure, so every failed install ends the attempt, and the builder is never asked. With the fix, the test passes and the task parks. Rejected: keeping the provisioning-only retry and documenting the rest as optional preparation. That rests on the cache argument and not on the code.

## codex-1: a reverted dependency write leaves no record

**Claim.** With `Bash`, the builder can replace an installed package, run against it, and restore the original bytes before it returns. `ownDiff` then shows nothing, so nothing is recorded or escalated. Codex states that the verify install is not affected.

**Checked.** A fresh-context check of `ownDiff`, `notCarriedEntries`, and `verify` confirmed it. The record is a comparison of the final working copy with the start copy, and no other write journal exists in `workspace.ts` or `line.ts`. Dependency-tree paths are dropped from what is carried, and `verify` installs its own tree, so nothing reverted or left behind reaches a check.

**Outcome.** A known limit, not fixed, and not new: before R57, the builder's `Write` tool could already write a file and then write it back. What D-R15-05 records is what a task's change leaves in a dependency tree, not every write it ever made. The prompt overstated the property as "every write". The safety does not rest on the record, because `verify` replaces every dependency tree before any check. A write journal would need monitoring outside the builder's sandbox, which is sandbox work no unit owns, and it would protect nothing a check reads. Recorded in D-R57-05.

## Codex coverage note: the cache entry checked only the record

**Claim.** `I3.builder-tool-cache-is-not-a-dependency-write` checks `notCarried` and not `bundle.diff`, so it does not show that the cache is not carried.

**Changed (f196e6e).** The entry now also fails when the change's diff holds any path under `node_modules`. Its other remark, that the init entry does not exercise the network isolation of `Bash`, is not a gap here. Egress `none` is enforced by the sandbox and asserted by its own entries, and this unit does not change it.

## Mechanisms assessed sound

- Codex: the order of `dependencyEntry` and the cache match, the separation of verification, the install's place before `omitWithheld`, and the type boundaries.
- Gemini: the dependency-write path, the cache exemption, and the `Bash` grant.

Neither family proposed a different adversarial question. Codex endorsed the framing, with the two distinctions above. Gemini did not answer item 7.
