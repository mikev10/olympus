# Triage of the P2 external review, 2026-09-11

The review being triaged is the companion file
`2026-09-11-P2-sandbox-adversarial-review.md`. Findings are cited by the
reviewer's own numbering.

**Six findings. Four hold and were fixed; two hold in part and were recorded;
none were rejected outright.**

One of the four is a genuine I1 bypass — a running container was given the
Vault, read-write, with every containment check passing. That is the most
serious defect this project has found in review so far, and the review earned
its place by finding it.

Calibration note, recorded because it is only useful when it is unflattering in
both directions: the reviewer labelled all six findings "factually wrong" or
"unclear" and four of those labels were right. Its stated severities were also
close to what verification found. Against that, **finding 1's described
mechanism was wrong while its conclusion was right** — the bypass it named is
not constructible, and a different one at the same location is. Had the
mechanism been taken at face value and "fixed", the actual hole would have
stayed open. Verification is what separated those.

| # | Finding | Verdict | Outcome |
|---|---|---|---|
| 1 | Mount argument injection via a resolved path | **Holds** — by a different mechanism than described | **Fixed**, plus a registry assertion |
| 2 | Wall-clock budget unenforced without `exec` | **Holds** | **Fixed** — self-firing timer |
| 3 | Vault path resolution fails open when the root is absent | **Holds** | **Fixed** — resolve the deepest existing ancestor |
| 4 | Vault prototype assertion is narrow | **Holds in part**; belongs to another unit | **Recorded**, not fixed — scope |
| 5 | `sandbox.remote` claim is tautological | **Holds in part**; the tautology claim is overstated | **Recorded**, not fixed |
| 6 | Mount table freeze is shallow | **Holds** | **Fixed**, and extended past the finding |

---

## 1. Docker mount argument injection — holds, fixed

**Verdict: holds. The reviewer's conclusion is right and its mechanism is
wrong.**

The reviewer claimed an attacker could resolve to a directory named
`dir,target=/vault,source=...` and thereby "completely overwrite the mount
target". **That is not constructible.** A `target=` payload needs a `/`, and no
filesystem — POSIX or Windows — permits `/` in a single path component. Tested:
creating such a directory fails with `ENOENT`.

The defect underneath it is real, and worse than an option override. Verified
against a running container:

- `refuseUnrepresentable` ran on `entry.source`, the path the caller declared.
- `mountArgument` interpolated `mount.source`, the path after `realpath`.
- Nothing checked the second, so a comma-free declared path resolving to a
  comma-bearing one reached `docker run` intact.
- Docker's `--mount` grammar splits on the comma and **mounts the prefix before
  it** — a different directory from the one every containment check validated.
  Docker then creates that prefix if it does not exist.

The Vault falls out of that directly. A sibling of the Vault named
`vault,readonly` truncates to `vault`. `containsPath` correctly finds no
overlap between `<base>/vault,readonly` and `<base>/vault` — the former is not
under the latter — so the mount layer allows it, and Docker mounts the Vault.

Reproduced end to end against the real provider:

```
validated source : ...\inject-HNeffS\vault,readonly
--mount argument : type=bind,source=...\inject-HNeffS\vault,readonly,target=/workspace
container sees   : "SECRET.txt"
*** I1 BYPASS ***
```

**Fixed** at `packages/sandbox/src/local/mounts.ts`, in `resolveSource`: the
grammar check now also runs on the resolved path, which is the path Docker is
actually given. Two regression assertions, because this is I1:

- `packages/sandbox/test/mounts.test.ts` — a comma-free source resolving to a
  comma-bearing path is refused at the `mount` layer.
- `I1.mount-layer-refuses-a-vault-mount` in the registry — the `vault,readonly`
  decoy, driven through the real provider.

Both were confirmed to fail when the fix is reverted.

## 2. Wall-clock budget unenforced without `exec` — holds, fixed

**Verdict: holds.** The deadline was consulted only inside `exec`, so it bounded
only sandboxes somebody kept calling. Verified: a sandbox provisioned with a
1500 ms budget, given one `exec` that backgrounds a loop and then left alone,
was still running 4000 ms later.

```
budget 1500ms; 4000ms later container running = true
```

The reviewer asked whether this belongs in `LocalDockerProvider` or in a higher
orchestrator. **It belongs here.** `wallClockMs` is a field of `SandboxSpec`,
and this unit's deliverable list names the wall-clock limit among the controls
the provider applies. A limit the provider accepts and does not enforce is the
silent degrade I5 exists to refuse; pushing it upward would leave every future
caller responsible for a guarantee the interface already appears to make. An
orchestrator-level budget is a reasonable *additional* control later, but it
cannot be the reason this one is absent.

**Fixed** at `packages/sandbox/src/local/provider.ts`: `provision` arms a
`setTimeout` that destroys the container when the budget expires, whether or not
anyone calls back. It is `unref()`d, because under I9 the runtime is a service
and a pending timer must never be what keeps its process alive; an unref'd timer
still fires while the process runs. `#end` clears it, so a sandbox destroyed by
another route does not fire twice, and `#expire` records a removal failure on the
sandbox rather than raising an unhandled rejection, since nothing is awaiting it.

Regression: `a sandbox nobody calls again is destroyed when its budget expires`
in `packages/sandbox/test/local.test.ts`, confirmed to fail when the timer is
disarmed.

## 3. Vault path resolution fails open — holds, fixed

**Verdict: holds**, and it is a fail-open on an I1 check, which is the category
that must fail closed.

A Vault root that does not exist yet had its `realpath` failure caught and the
unresolved path returned. Containment then compared a fully resolved mount
source against an unresolved Vault string, and two spellings of one location did
not match.

Verified, with a control that isolates the cause — the same mount table, the
same Vault, named two ways:

```
Vault declared behind a symlinked parent, not yet created  -> ALLOWED rw on ...\real
Vault declared by its real path                            -> refused (mount)
```

The agent would hold read-write on the directory where the Vault is about to be
created, and the refusal would arrive only once it existed. That is exactly the
wrong way round.

**Fixed** at `packages/sandbox/src/local/mounts.ts`: a new `canonicalise` walks
up to the deepest existing ancestor, resolves that, and appends the missing
tail, so an absent Vault root still compares as the location it will occupy.
Dropping the path instead was rejected — a Vault root that does not exist yet
still names somewhere nothing may mount.

Regressions in `packages/sandbox/test/mounts.test.ts`: the refusal, plus a
control that an unrelated absent Vault root does not turn into a refusal of
everything. Both confirmed against the reverted code.

## 4. Vault prototype assertion is narrow — holds in part, belongs to another unit, recorded

**Verdict: holds in part, and it is not P2's.**

The observation is correct as stated: `Object.getOwnPropertyNames(LocalVault.prototype)`
would not see methods reached through a superclass, exposed as symbols, or
assigned to the instance in the constructor.

It identifies **no present defect.** Checked against the real class:

```
own prototype props : read, lock, verifyLocks, writeEvidence, recordViolation, readRunState, commitRunState
own symbols         : 0
parent prototype is Object.prototype : true
superclass          : none
instance own props  : (none)
```

`LocalVault` has no superclass, no symbol-keyed members and no instance
properties, so the narrow check and the broad one currently return the same
answer. The gap is a future-proofing one: it would open if someone later added
inheritance.

**Not fixed here.** `I1.vault-implementation-exposes-only-named-operations` is
P1's assertion, untouched by this unit and in the bundle only because
`registry/i1.ts` was edited alongside it. WORKFLOW.md is explicit that a finding
belonging to another unit is recorded and owned rather than absorbed, and a
review does not widen a unit. Recorded in `docs/decisions.md` under P2's known
limits, naming the Vault assertion as the construct and the strengthening as
owed.

## 5. `sandbox.remote` claim is tautological — holds in part, overstated, recorded

**Verdict: holds in part. The "tautological" label is wrong; the residual
weakness is real.**

The reviewer said the assertion "trusts the provider's own state". That is not
quite right — `daemon().endpoint` comes from `docker context inspect`, an
external command, not from something the provider invented. And the assertion is
demonstrably not tautological in the sense I8 requires: flipping
`remote: false` to `true` in `capabilities()` **fails the registry**, which was
confirmed by mutation before the review arrived.

What is real: `probeDaemon` already refuses a non-local endpoint, so by the time
the assertion runs the endpoint is local by construction and the comparison can
only fail on a mis-declaration. It verifies the declaration, not the
independent fact.

The reviewer's proposed fix does not work. Observing network locality "by
executing commands inside the container" is impossible here: the container runs
with `--network none` and has no interface but loopback, and nothing visible
from inside a container establishes where its daemon lives.

**Not fixed.** A materially stronger check would have to compare the container's
filesystem against the host's — provisioning with a known host path and
confirming the bytes match is the only honest local/remote discriminator — and
that is a new mechanism, not a tightening. Recorded in `docs/decisions.md` as a
known limit with the reasoning above.

## 6. Mount table freeze is shallow — holds, fixed and extended

**Verdict: holds.** `mountTable` froze the returned object and the `others`
array, leaving the `workspace` entry writable.

The reviewer stopped one step short: **the entries inside `others` were
unfrozen too**, and it did not mention them. Both are fixed — every entry is
frozen, not only the two containers. A validated table whose entries can still
be edited afterwards is worth nothing, and that applies to `others` exactly as
it applies to `workspace`.

The reviewer's "practically safe" reading is right today — the table does not
escape to untrusted scope — so this is defence in depth rather than a live
bypass, and the severity label of low is fair.

**Fixed** at `packages/sandbox/src/local/mounts.ts`. The existing freeze
assertion in `packages/sandbox/test/mounts.test.ts` was extended to cover the
workspace entry and every `others` entry, and confirmed to fail against the
shallow freeze.

---

## On the reviewer's coverage gap

The prompt asked seven numbered things. **Items 3 and 4 came back empty** and
that is recorded in the review's header rather than read as endorsement.

Item 3, fail-open conditions, turned out to be the most productive category in
the whole review — finding 3 is precisely a fail-open, and the reviewer found it
without filing it as one. Item 4, language-level escape hatches, was not
addressed at all, and it is the one this unit most needed a second opinion on:
P2 deliberately widened an input type to `mode: string` (`UnvalidatedMountEntry`)
so its run-time guards would not be compiled away, and the tests reach those
guards through `as unknown as` casts. Nothing in this review examined that
choice. It remains unreviewed, and the next reviewer should be pointed at it.

## On the framing

The reviewer endorsed the adversarial framing (item 7) and offered no
alternative question. Given that the framing did surface a real I1 bypass, that
endorsement is worth something — but a reviewer agreeing with the question it
was handed is the weakest of the seven answers, and it is recorded as
concurrence, not as validation.

## A defect in the fix for finding 2, found by CI

The first version of the finding-2 fix was wrong, and the record should say so
rather than present the second version as though it were the first.

Arming a timer gave the sandbox two independent destroyers: the timer and an
`exec` that outlives its budget expire at the same instant and both issued
`docker rm --force`. The second returns as soon as the first has marked the
container, while removal is still in progress, so the pre-existing assertion
`a command that outlives the wall-clock budget is terminated and the container
destroyed` found the container still there. It failed on the Linux runner and
passed on the Windows development host, which is why it reached CI at all.

Fixed in D-P2-17: `Sandbox.ending` holds one in-flight removal, and whoever
arrives second awaits it instead of starting another.

A regression test for it was written and then deleted. It raced two `destroy`
calls, which are already serialised by the `ended` flag set before the first
`await`, so it passed with the fix reverted and discriminated nothing. Keeping
it would have added a green line claiming coverage that did not exist. The real
guard is the wall-clock assertion above, annotated in place to say what it
protects and that the race reproduces on Linux and not on Windows.

## Gates after the fixes

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm conformance` — all pass. No
check, test, assertion, or acceptance criterion was weakened to accommodate any
finding. Every fix added coverage; none removed it.
