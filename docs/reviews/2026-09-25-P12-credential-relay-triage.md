# Triage of P12's external reviews, 2026-09-25

Two reviews, both `counted`, from one prompt and one bundle:
`2026-09-25-P12-credential-relay-review-codex.md` (gpt-6-astra, family codex)
and `2026-09-25-P12-credential-relay-review-gemini.md`
(gemini-3.1-pro-preview, family gemini). Each reply's SHA-256 matched its
manifest's `replySha256` before its header was prepended. The reply beneath
each header still hashes to that value. Both runs sent one byte-identical
payload, and both ingested it completely and echoed every bundle marker.
Findings are cited by family and number.

## Counts

| | Findings | Holds | Holds in part | Does not hold |
|---|---|---|---|---|
| codex | 4 | 2 | 2 | 0 |
| gemini | 0 | — | — | — |

- **Both families raised:** none. Gemini reported no findings.
- **Did not hold:** 0 of 4.
- **Held in part:** codex-2 and codex-3. In both, the defect is exactly as
  described and the consequence is narrower than stated. See each section.
- **Gemini's calibration.** Gemini's item-2 answer held up the control as
  proof that the credential search "is not blind". The control never reached
  the workspace scan, and that scan could not see a nested file (codex-1).
  Gemini's item-3 answer said a failed start "tears down the partially created
  networks and throws". A failed teardown was dropped, and a teardown that
  threw stopped before the networks (codex-3). Recorded as it is: a counted
  review that found nothing in a change where the other family found four
  defects that hold, as in P6.
- **Executed evidence:** codex-2, codex-3, and codex-4's new tests ran against
  the pre-fix `src` (stashed): the three behaviour tests failed, each for the
  reason its finding gives, and 19 of 22 passed. codex-1's old loop was run
  against a nested file without a model call: it missed the file, and the new
  helper found it. The driver assertion itself is funded and runs in CI.
- **Fresh-context verification:** each finding went to a subagent given only
  the finding's text and the repository, with no account of who wrote the
  code. Every verdict below agrees with its subagent. Where a subagent
  narrowed the consequence (codex-2, codex-3), this triage takes the
  narrowing.

## Findings

| ID | Finding | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | The workspace scan is one level deep and reads a failed read as clean; the control never exercises it | codex | holds | fix now (D-P12-13) |
| codex-2 | An allowlist naming the relay's upstream host gives the sandbox a second route to it | codex | holds in part: no credential exposure, runtime-chosen configuration | fix now (D-P12-11) |
| codex-3 | Relay teardown stops at a thrown step, and failed starts discard cleanup failures | codex | holds in part: the leftover relay is unreported, not reachable | fix now (D-P12-12); the proxy's twin handed on |
| codex-4 | Relay-suite absence checks and startup refusals accept infrastructure failure | codex | holds | fix now (D-P12-14); the P10/P2 twins handed on |

## codex-1: the workspace scan could not see below its first level

**Checked.** `I4.model-credential-not-readable-by-the-task`
(`packages/drivers/claude-code/test/invariants.test.ts`) searched the
workspace with `readdir` over its top level and `readFile(...).catch(() => '')`
on each entry. The workspace is a bind mount (`provider.ts`), and
`exportContains`'s own documentation says the export covers "none of the
mounts, which a caller searches on the host". `PROCESS_DUMP` reads
`/proc/*/environ` and `cmdline` only, and `docker inspect` reads configuration.
The control wrote its canary to `/tmp/exploit/leaked` and checked it with the
dump and the export only. The harness makes the workspace `0777` so the
container's user can write it, subdirectories included.

**Found.** Holds as written. `readFile` on a directory rejects with `EISDIR`
(checked), so `/workspace/subdir/key` is searched as `''` and the assertion
passes. No other part of the assertion reads that path, and the control does
not exercise the workspace scan.

**Fix.** `workspaceContains` (`test/harness.ts`) walks the mount at every depth
with `lstat`. It reads link text without following the link, and throws on
anything it cannot read or that is not a file, directory, or link. The control
now also writes its canary two directories deep in the workspace and requires
the scan to find it. Shown without a model call: against a directory holding
`subdir/deeper/key`, the old loop reports absent and `workspaceContains`
reports present. The assertion runs with the driver suite in CI.

## codex-2: an overlapping allowlist is a second route to the upstream

**Checked.** `checkEgress` (`egress.ts`) builds the allowlist from
`egress.allow` alone. `checkRelay` computes `upstreamHost`, which nothing in
the provider or the proxy read. `#applyEgress` (`provider.ts`) starts the
proxy and the relay independently. The proxy (`proxy.ts`) matches `CONNECT`
targets against its host set with no exclusions. The test beside an allowlist
used `example.com`, which is disjoint from the upstream. The P12 entry says
"the relay is the only route to the model", and the prompt says the network
construction "should leave the relay as the sandbox's only route to the
model's API host".

**Found.** Holds in part. The missing cross-check and the untested case are
exactly as described. The consequence is narrower, as the reviewer itself
says: a direct tunnel carries no credential, so nothing is exposed and nothing
is authenticated. The configuration is also not the task's to choose.
`SandboxSpec.egress` and `relay` are built by the runtime from policy. What
breaks is the stated exclusivity, for a spec the runtime would have to write.

**Fix.** `provision` refuses, at the `relay` layer and before any container
starts, a spec whose allowlist names the relay's upstream host. Both sides go
through the same normalization, so case does not get around it. `RelaySpec`'s
documentation makes the refusal an obligation, and A-P12-01 is amended to say
so. A refusal, not a proxy exclusion: a spec asking for both routes
contradicts itself, and the proxy is P10's. The new test covers the exact host
and an upper-cased host in a longer list. It failed before the fix ("expected
a SandboxRefusal, but the call returned"). The residual, a name or address
that reaches the same service, is stated in D-P12-11.

## codex-3: cleanup that stops early and failures that are dropped

**Checked.** `dockerCli` (`docker.ts`) rejects with `CliTimeout` or
`DockerUnavailable`, rather than resolving with a status. The relay's
`teardown` called it unguarded for `docker rm` and then looped over the
networks. `startRelay`'s catch awaited `teardown` and ignored its result.
`provision`'s catch awaited `#stopSidecars` and ignored its result, and so did
the relay-start catch in `#applyEgress`, for `stopProxy`. The destroy path
(`#dismantle`) returns its failures and does not drop them.

**Found.** Holds in part. Both halves of the defect hold: a thrown `rm` skips
network removal, and a failed cleanup on a failed start is reported nowhere.
The consequence is narrower than "leave its credential-holding relay behind"
suggests. The relay's networks are named per sandbox (`relayNames(id)`), so a
relay left behind sits on a network no other sandbox joins, and its
credential is readable only through the host's Docker daemon, which is inside
the trust boundary. The failure is an unreported copy of the credential left
on the host, not a sandbox able to read it.

**Fix.** Each step of `teardown` catches its own failure, every step runs, and
the returned error names every object left behind. `withLeftovers`
(`refusal.ts`) reports a cleanup failure together with the error that caused
the cleanup, and a refusal keeps its layer. It is used in `startRelay`, in
`provision`, and on the relay-start path of `#applyEgress`. Two new tests:
`stopRelay` with a `docker` that cannot be run must return a failure naming
the container and both networks, and `startRelay` in the same state must
report the cleanup failure beside its cause without the credential. Before
the fix, the first rejected outright and the second reported only
`DockerUnavailable`.

**Handed on.** The egress proxy's `teardown` (`proxy.ts`, P10) has the same
shape. A proxy teardown that throws still stops early, and it still ends
`#stopSidecars` before `withLeftovers` can run. That code is P10's and is
outside this unit's scope. It should become an issue against the sandbox
package.

## codex-4: infrastructure failure accepted as enforcement

**Checked.** `containerExists` and `networkExists` in `relay.test.ts` returned
`false` from a bare `catch`, for any failure `execFile` raised. The deny-all
teardown test checked existence before destroying. The allowlist one did not.
The startup-refusal test mapped every rejection to its exit code and asserted
only `not.toBe(0)`, with no diagnostic and no control. `RELAY_SOURCE`'s
`fail()` writes `model-relay: <reason>` and exits 1.

**Found.** Holds as written, for both halves. As the reviewer says, these are
false-positive paths for individual assertions, not for the suite: every
other test in the file needs a working daemon.

**Fix.** Absence is only Docker's "No such container" or "not found" (both
strings checked against Docker 29.7.2), and any other failure is thrown. The
allowlist teardown test now checks each object before destroying it. The
startup-refusal test requires exit status 1 and the relay's own diagnostic
for each missing piece. A control runs the same image, program, and flags with
nothing missing and requires the relay to be running two seconds later. These
are test-only changes and passed before and after the source fixes, as they
should: they tighten what a pass means rather than change behaviour.

**Handed on.** `egress.test.ts` (P10) and `local.test.ts` (P2) carry the same
bare-`catch` helpers. They are outside this unit's scope and should go into the
same issue as codex-3's proxy teardown.

## Gemini's reply

No findings. It was checked for anything it asserted about the code that
would bear on the fixes. Its item-5 point about the `--mcp-config` file and
its NO_PROXY point both describe the code correctly and ask for nothing. Its
two claims that the code disputes are recorded under the calibration note
above.

## Acceptance

Run locally after the fixes, on `unit/p12`, Docker 29.7.2:

- `pnpm typecheck`, `pnpm lint`, `pnpm typecheck:tooling`: clean.
  `pnpm test:tooling`: 239 passed.
- Every package but the driver and the registry: sandbox 119 passed and 2
  skipped, core 133 passed, vault 56 passed, adapters 692 passed and 1
  skipped, api 65 passed and 1 skipped.
- `pnpm conformance`: fails, as it must until the driver suite runs again.
  All ten external driver entries refuse with `tree-changed`: `harness.ts` and
  `invariants.test.ts` changed for codex-1, so the committed report is evidence
  about other bytes. Those ten refusals are the whole of the registry's
  incompleteness, and every pending count is within its baseline. The driver
  suite calls a real model. The maintainer chose to let CI's single funded run
  of it (`ci.yml`, before the registry) produce the report that reconciles
  them, rather than spend on a local run as well.
- One incident, from the pre-fix run and not the fix: under the old code, the
  new overlap test provisioned a sandbox that `refusal()` never passed to
  `afterEach`, so it outlived the run. Two P10 and P2 tests that require no
  proxy or network on the host then failed. The leaked containers and networks
  were removed by hand, the two tests passed on rerun, and the overlap test now
  provisions through `provisioned()`, so a sandbox handed back wrongly is still
  destroyed.
