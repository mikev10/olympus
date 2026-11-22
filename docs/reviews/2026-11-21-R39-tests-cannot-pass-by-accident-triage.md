# Triage of the R39 external reviews, 2026-11-21

Two reviews, both `counted` on their first run, no reruns:
`2026-11-21-R39-tests-cannot-pass-by-accident-review-codex.md` (gpt-6-astra, 54,877 input tokens against a floor of 31,928) and
`2026-11-21-R39-tests-cannot-pass-by-accident-review-gemini.md` (gemini-3.1-pro-preview, 45,138 against 31,928). Both replies match their
manifests' `replySha256`. Bundle SHA-256 `82809a1161cc0c2188a1c8b7e49a861f6ad31eb634590bd12181e3596504533a`, base `10d2236`
(`reviewed/R52`), head `f7a33c4`.

**Counts.** Codex: 6 findings, 6 hold (1 in part), 0 do not hold; 5 fixed, 1 rejected as a tradeoff. Gemini: 5 findings, 5 hold
(2 in part), 0 do not hold; 5 fixed, the safe-direction half of gemini-1 rejected as a tradeoff. Three mechanisms were raised by both
families independently: codex-1/gemini-1, codex-2/gemini-2, codex-6/gemini-4.

**How each was verified.** Every finding was quoted, as material to check, to one fresh-context subagent with the cited files and
no account of who wrote the code; it answered confirmed, not in the code, or partly right for each. One subagent for all eleven
rather than one per finding, to keep the spend down; its answers are evidence, not verdicts. Every finding that could be run was
run: the static, Proxy, and symlink cases against the code as reviewed before any fix, and each fix's new test against the old code
afterwards.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1, gemini-1 | The sweep's liveness test reads a pid on the hostname alone, so a runner in another PID namespace or on another machine with the same hostname can have its live objects removed | both | holds; gemini-1's other half (another hostname's leftovers are never swept) holds but is the safe direction | fixed, 388a020; the safe half rejected as a tradeoff |
| codex-2, gemini-2 | The Vault surface check skips `constructor`, so a static member reachable as `vault.constructor.x` passes | both | holds in part: `LocalVault` has no static member today, and the check could not see one | fixed, 742603f |
| gemini-3 | A Proxy instance whose traps hide keys passes the surface check | gemini | holds | fixed, 742603f |
| codex-6, gemini-4 | `allText` reads only `isFile()` entries, so a symlink, to a token file or dangling, is skipped | both | holds | fixed, 8c02a46 |
| codex-3 | Probe containers do not carry the provider's labels | codex | holds in part: a probe is `--rm` and its own timers end it, so it is short-lived, but the option documents every container | fixed, 6052bf9 |
| codex-4 | `afterAll` sweeps before it checks, so a teardown that leaves a container passes | codex | holds | fixed, 388a020 |
| gemini-5 | `treeSnapshot` follows symlinks, so a link replaced by a file of its target's bytes compares equal | gemini | holds | fixed, 19d7c18 |
| codex-5 | A reused pid keeps a dead run's objects | codex | holds; the failure is a leftover, never a removal | rejected as a tradeoff |

## codex-1, gemini-1: the sweep's liveness test

**Checked.** `ownerIsGone` compared only `hostname()` and took any `ESRCH` from `process.kill(pid, 0)` as death; the run's UUID was
never read. A process in another PID namespace on the same hostname, such as a container on the host network sharing the Docker
socket, gets `ESRCH` for a live owner's pid, and `sweep` would remove that run's containers and networks. D-R39-05 said a reused pid
"never removes a live run's"; that held for reuse and not for namespaces. Not reproduced: this machine has no second namespace to
run in. Confirmed by reading and by the subagent.

**Fixed (388a020).** The owner label carries a scope: hostname, boot identity, and PID namespace. On Linux the boot is
`/proc/sys/kernel/random/boot_id`, the namespace is the link `/proc/self/ns/pid`, and a read that fails throws rather than letting
two namespaces look alike. Elsewhere there are no PID namespaces, and the boot is the minute the host started. A pid is judged only
when the scope matches exactly. A new test shows an exited pid in this scope is gone, and the same pid under another boot, another
namespace, another host, or the owner form before this fix is not. Under the old hostname-only rule the test fails.

**Options weighed.** Gemini proposed a per-run UUID; that identifies the run but says nothing about whether it is alive, so it
cannot decide a sweep. A shared liveness record (a heartbeat file or lock) would work across machines, but it needs a place every
client of the daemon can reach, which a test file cannot assume. The scope keeps the rule local and errs toward a leftover.

**Rejected half of gemini-1.** Leftovers from another hostname are never swept. That is the safe direction, chosen on purpose: a
leftover costs disk and a credential held until someone removes it; removing a live run's objects fails that run. The owner label
makes them findable by hand.

## codex-2, gemini-2: static members

**Checked.** The prototype walk skipped `constructor` and never read the function. The case was run against the code as reviewed:
a class with `static put` passed (`[]`). `LocalVault` has no static members today (`packages/vault/src/local/vault.ts`).

**Fixed (742603f).** Each constructor on the chain is read, with its own static chain up to `Function.prototype`. Any own key
beyond `length`, `name`, and `prototype` is refused, and a `constructor` that is not a plain function value is refused. The new
test, an own static and an inherited static, fails against the old function and passes against the new one. The real `LocalVault`
passes.

## gemini-3: a Proxy

**Checked.** Run against the code as reviewed: a Proxy over a clean instance, with `ownKeys` returning `[]` and `get` serving
`wipe`, passed the check while `wipe()` returned. Nothing in `LocalVault` returns a Proxy today.

**Fixed (742603f).** `util.types.isProxy` refuses a Proxy as the instance, as any prototype on the chain, or as any constructor,
before anything is read through it. The new test fails against the old function and passes against the new one.

## codex-6, gemini-4: symlinks in `allText`

**Checked.** Run against the code as reviewed: a symlink in the store pointing at a file holding the token left the token out of
the text. `readdir`'s recursive walk does not descend through a symlinked directory either.

**Fixed (8c02a46).** An entry that is neither a file nor a directory refuses the call. Gemini proposed following the link; that
reads text from outside the directory the check is about, and a dangling link would still need a rule, so refusing is the one
answer that fails closed for both. The new test, a link to a token file and then a dangling link, fails against the old reader and
passes against the new one. The real merge-token entry (`I4.merge-credential-reaches-no-sandbox`) passes, so the store holds no
symlink today.

## codex-3: probe containers

**Checked.** `probe()` called `probeRunArgs` without labels (`packages/sandbox/src/local/provider.ts`); `probeRunArgs` emitted
none. The probe is `docker run --rm --interactive`: when its parent is killed, its own timers end it within about `readyWithinMs`
plus 10 s per exchange, and `--rm` removes it. So the gap is short-lived, but the `labels` option says every container, and D-R39-02
excluded the probe on the strength of `--rm` alone.

**Fixed (6052bf9).** `probeRunArgs` takes the labels as a required argument, so a caller cannot leave them out by omission, and the
provider passes its own. The in-flight probe test, which already inspects a running probe, asserts the label; with the labels
withheld it fails.

## codex-4: the sweep hid a teardown leak

**Checked.** `afterAll` swept this run's objects and then asserted none remained, which fails only if a removal fails. A teardown
that reported success and left a container was cleaned up into a pass. Shown by a temporary mutation that made `afterEach` forget
one sandbox: the old order passed.

**Fixed (388a020).** `afterAll` records this run's leftovers before it sweeps, sweeps, and fails if anything was left or remains.
A container Docker is already removing itself (`--rm`, exited) is not counted, because the daemon removes it after the call that
ran it returns. Under the same mutation the new `afterAll` fails, naming two containers and two networks, and the full file passes
33 of 33 without it.

## gemini-5: the tree snapshot followed symlinks

**Checked.** `treeSnapshot` hashed `readFile`, which follows a link, and recorded no entry type for files. A symlink to a directory
would throw `EISDIR`, which is loud.

**Fixed (19d7c18).** A symlink is recorded by the target it names (`readlink`), a file as `file <hash>`, a directory as itself, and
any other entry type is refused. A new test, `test/snapshot.test.ts`, which needs no daemon, fails against the old helper on both
cases and passes against the new one.

## codex-5: pid reuse

**Rejected as a tradeoff.** True: a reused pid makes a dead run look alive, so its objects stay. That is the direction D-R39-05
chose. Binding the owner to a process start time would need a different source on each platform, and an error in it would point
the other way, removing a live run's objects. A leftover persists until the pid is free again, or is removed by hand by its label.
To reverse: add the process start time to the scope where the platform reports one.

## Coverage, per family

- **Codex** answered items 1, 3, 5, 6, and 7, and said it found no wholly tautological assertion (item 2). On item 4 it said
  casts and generic erasure do not remove `first`'s runtime check, and named no other language escape. On item 7 it found the
  framing appropriate, with the standard it would add: tests that fail before recovery hides a defect (codex-4).
- **Gemini** answered items 1, 3, 4 (the Proxy), 6, and 7 ("correct and essential"). It left item 2 (tautological checks) and
  item 5 (configuration satisfied without effect) empty.

## Notes on the fixes

- The static-and-Proxy commit (742603f) holds the symlink test too, which fails until 8c02a46 lands. Both commits are on the branch
  before the acceptance rerun.
- The two relay-test fixes (codex-1/gemini-1 and codex-4) share one commit, because both are in one file and one hook.
- No fix needed a contract change, a gate path past `packages/conformance/`, or work past the out-of-scope list.
