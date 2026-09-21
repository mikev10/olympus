# Triage of the P5 external reviews, 2026-09-20

Two reviews, taken in one round against the same bundle and prompt:
`2026-09-20-P5-driver-claude-code-adversarial-review.md` (OpenAI, 14 findings)
and `2026-09-20-P5-driver-claude-code-second-adversarial-review.md` (Gemini,
5 findings). Findings are cited below as **C1–C14** and **G1–G5**.

## Counts

| | |
|---|---|
| Findings received | 19 |
| Held in full | 17 |
| Held in part | 2 (C6, G4) |
| Did not hold | 0 |
| Fixed on the branch | 16 |
| Recorded as a known limit with an owner | 2 (C1, C4) |
| Belongs to another unit | 1 (G5, P2) |

**Zero findings did not hold, and that number is worth distrusting rather than
celebrating.** The skill this triage follows exists because agreeing is the
easy failure, so every finding was verified before anything was changed, and
four were verified by running them in a container rather than by reading:

- **C1** — a child process printed the credential (`CHILD_SEES=sk-ant-…`), and a
  *later* exec that was given no credential read it out of `/proc`.
- **C4** — a detached process started by one exec was still running when a
  later exec looked (`sleep_count=2`).
- **C9** — a second process rewrote the MCP config file in `/tmp` and the
  rewritten bytes were what a subsequent read returned.
- **G1** — a role whose instructions contained a line reading
  `FACTORY_ARTIFACT_EOF` closed the here-document and executed the shell
  commands that followed it. The probe printed `INJECTION SUCCEEDED`.

The high hit rate is partly a property of where the reviewers looked. Both
concentrated on provenance and lifecycle — what the report is bound to, what
survives a task, what the session actually came up with — and that is exactly
where this unit was thin, because it spent its attention on getting a model
call to work at all.

## Findings

| # | Restatement | Verdict | Outcome |
|---|---|---|---|
| C1 | The credential is readable inside the container by anything running as the same user | Holds | Known limit, owner named, overclaiming comments corrected |
| C2 | `runTask` never compares the session's actual tools with the grant | Holds | Fixed |
| C3 | A workspace-writable settings file is used as execution configuration | Holds | Fixed |
| C4 | Processes from one task survive into the next task's window | Holds | Known limit, owner named |
| C5 | The tree hash covers one package, not what the run executed | Holds | Fixed |
| C6 | Hashing only after the run can bless code that never ran | Holds in part | Fixed |
| C7 | The I4 assertion does not traverse the driver's own path | Holds | Fixed |
| C8 | The image tag does not bind the Dockerfile or the base | Holds | Fixed |
| C9 | The MCP config file is mutable between inspection and run | Holds | Comment corrected; consequence closed by C2's fix |
| C10 | `McpServerConfig.env` could carry a secret into a readable file | Holds | Fixed |
| C11 | An interrupted run leaves the previous passing report in place | Holds | Fixed |
| C12 | Reconciliation matches any bracketed id, not the registered assertion | Holds | Fixed |
| C13 | MCP inspection ignores exit code and server status | Holds | Fixed |
| C14 | Capability interfaces can be augmented from another compilation unit | Holds | Fixed |
| G1 | Here-document injection in `emitArtifacts` | Holds | Fixed |
| G2 | `#artifactSandbox` is shared across sandboxes | Holds | Fixed |
| G3 | The tree hash covers every file, not source | Holds | Fixed |
| G4 | `test.result()` may be undefined and crash the reporter | Holds in part | Guard added |
| G5 | Ended sandboxes are kept in a map for ever | Holds, P2's | Recorded, not fixed here |

---

### C1 — the credential is readable inside the container

**Checked by running it.** A container was provisioned, a credentialed exec
started a long-lived process, and a *second* exec given no credential at all
read `SECRET_PROBE=sk-ant-the-secret` out of `/proc`. A child of the
credentialed process printed it directly. Both constructions the reviewer
described work.

**The defect is the claim, not the mechanism.** What the driver does is what
the unit entry specifies: the credential arrives as an environment variable on
the exec, never as a mount and never in a prompt. Against a mount it is a real
improvement — a mounted secret is a file that persists for the sandbox's whole
life and lands in any diff of the tree. What it is not is confidentiality from
the model, and the code said otherwise. `D-P5-07` and the comment on
`ExecOptions` both read as though keeping the value out of argv kept it out of
the model's reach, and the unit test asserting "the credential appears in no
argument" reads as a test of that stronger property.

**Fixing it properly is out of scope and would be the wrong shape here.** The
reviewer's own resolution — authenticate at a trusted egress layer so the
credential never enters the container — is an architecture change spanning the
sandbox, the proxy P10 built, and the driver. It is not a review fix.

**Outcome:** the overclaiming comments are corrected to say what is actually
true, and the limit is recorded as `D-P5-20` with a pending registry entry
under I4 owned by **P6**, which is the next unit to touch what a task may
reach. `pending-baseline.json` rises for I4 accordingly, which is a deliberate
edit visible in the diff.

### C2 — the session's tools are never compared with the grant

**Checked by reading.** The only use of `init.tools` was inside
`#ungrantedMcpTools`. `#refuseUnusableStream` checked that a session existed,
that the credential source was the expected one, that a result arrived, and
that a turn was taken — and never that the session offered what was granted.

This is the best finding of the nineteen, because it is the backstop for every
other assumption in the driver. `--tools`, `--disallowedTools`,
`--strict-mcp-config` and `--settings` are all arguments the driver *hopes* the
CLI honours. Two of those hopes were already wrong before either reviewer saw
the code: an inline MCP configuration silently produced no servers, and a
granted server contributed tools nobody granted. Both were caught by running
the suite, which is luck; this check catches that whole class by construction.

**Outcome: fixed.** `#refuseSessionUnlikeGrant` compares the session's reported
tools against the grant in both directions and refuses either way — a tool the
session holds and policy did not grant is the I4 failure; a tool policy granted
and the session lacks is a grant that did not take effect, and running anyway
would describe work done under conditions nobody asked for (I5). It also
refuses an MCP server the driver did not configure and one that is not
connected. A non-empty `permission_denials` refuses too: under
`bypassPermissions` nothing should prompt, so a denial means the task ran with
less than it was granted.

### C3 — execution configuration read from the workspace

**Checked by reading.** The `driver.hooks` assertion set `settingsPath` to
`${WORKDIR}/.claude/settings.json` and the driver passed that path to
`--settings`. The workspace is the one writable mount. A hook is a command the
CLI runs outside the task's tool grant, so a task with `Write` could leave a
hook that a later task holding only `Read` would execute.

**Outcome: fixed.** The driver refuses a `settingsPath` inside the workdir at
construction, with a refusal that names why. The hooks assertion writes its
settings to `/tmp/driver-settings` instead. A unit test covers the refusal, the
accepted case, and the near-miss where a path merely begins with the
workspace's name.

### C4 — processes survive a task

**Checked by running it.** A detached process started by one exec was still
running when a later exec looked. The first attempt at this check used `pgrep`,
which is not in the image, and reported zero; the correct check reads
`/proc/*/comm` and reported two. Worth recording because the false negative
would have retired a finding that holds.

**The consequence is real and the fix is not the driver's.** `#serialized`
bounds the foreground exec per handle, and that is all it claims to do. Bounding
what a task leaves behind means either a process boundary the sandbox enforces
or a container per task — both decisions about the substrate, which is P2's and
P10's, not a driver's to make unilaterally. A driver-side sweep that killed
stray processes would be a partial control that reads like a complete one.

**Outcome:** recorded as `D-P5-21` with a pending registry entry under I4 owned
by **P6**, which already owns collecting a diff in a fresh sandbox and is the
unit where per-task isolation has to become real.

### C5 — the tree hash covers one package, not the run

**Checked by reading.** `packageTreeHash(dir)` walked exactly one directory.
The driver's assertions execute `@olympus-ai/sandbox` and `@olympus-ai/core`,
and `I1.driver-executes-inside-the-sandbox` is an assertion *about* the sandbox
provider — so a change to the provider left the driver's hash identical and
yesterday's evidence was accepted for today's mount layer.

**Outcome: fixed.** The hash now covers the owning package and every workspace
package it depends on, transitively, in a stable order keyed by package name. A
dependency resolved through the registry rather than the workspace is pinned by
the lockfile and is not walked.

**What is still not covered, stated rather than implied:** the root
configuration, the lockfile, and the identity of the container image. The
reviewer named all three. The image is now bound by C8's fix from the other
direction — the tag is derived from its inputs — but the report does not record
which image ran. That residue is in `D-P5-22`.

### C6 — hashing only after the run

**Holds in part.** The construction holds: a suite that takes minutes against a
real model loads its source at the start, and an edit made while it runs
produces results from one tree carrying the hash of another. That is ordinary
development behaviour, not an attack.

**The part that does not hold** is the claim that "the comment at
reporter.ts:76-77 says the opposite of what the implementation does". It does
not. That comment gives a deliberate reason for hashing at the end: a test that
wrote into its own package tree invalidates the report it is part of rather
than being blessed by it. Both properties are wanted and the original chose
one.

**Outcome: fixed, keeping both.** The reporter hashes at `onTestRunStart` and
again at `onTestRunEnd`, records both, and reconciliation refuses a report
whose two hashes disagree — a new `tree-moved-during-run` refusal. A test that
writes into its own tree still invalidates the report; a run whose source moved
underneath it now does too. `RUN_REPORT_VERSION` rises to 2, so a report from
the older kit is refused as a version mismatch rather than read as missing a
field.

### C7 — the I4 assertion did not traverse the driver

**Checked by reading, and it is the sharpest finding of the set.**
`sessionTools()` built its own `claude` invocation with its own `--tools` and
ran it through `h.provider.exec`. Delete `--tools` from
`ClaudeCodeDriver.#invocationFor` and the registered I4 assertion still passes:
the unknown-tool refusal is unaffected, the one call that went through the
driver never had its tool list inspected, and the narrow and empty cases used
the helper's own correct arguments. The ordinary unit tests would have failed,
but reconciliation asks only whether the registered assertion id passed.

That is precisely the failure I8 exists to prevent — an assertion that passes
when the property it covers is deleted — sitting inside the unit whose whole
subject is I8.

**Outcome: fixed.** Every case in the I4 assertion now goes through
`driver.runTask` and reads `sessionFor(taskId).tools`: the narrow grant, the
empty grant, and the whole declared inventory. `sessionTools()` is gone. The
cost is two additional model calls; the assertion is worthless without them.

### C8 — the image tag did not bind the image

**Checked by reading.** The tag was `factory-claude-code:${CLI_VERSION}` and
`ensureImage` returned as soon as the daemon held it. Editing the Dockerfile or
the base digest while leaving the CLI version alone left every machine that had
already built the old image running it, under a report that hashed the new
source.

**Outcome: fixed.** The tag is derived from a hash of the Dockerfile's bytes,
the base digest and the CLI version. Different inputs are a different tag, and
a different tag is a build.

### C9 — the MCP config file is mutable

**Checked by running it.** A second process rewrote `/tmp/mcp-probe.json` and
the rewrite is what a later read returned. The comment claiming the location
prevented the agent from editing it was wrong: the driver and the agent's
commands run as the same user.

**The consequence is closed elsewhere.** Tampering between the inspection and
the run changes which servers and tools the session comes up with — and C2's
fix compares exactly that against the grant and refuses. The file being
writable stops mattering once the session is checked rather than trusted.

**Outcome:** the comment now says what the location actually buys (keeping the
file out of the tree under work and out of any diff) and names
`#refuseSessionUnlikeGrant` as what makes tampering pointless.

### C10 — a server environment could carry a secret

**Checked by reading.** `McpServerConfig` had an optional `env` record, the
whole object was serialised into a file in `/tmp`, and a comment asserted
"Nothing secret is in it" — unenforced, and contradicted by the type.

**Outcome: fixed by deletion.** `env` is removed from `McpServerConfig`. Nothing
used it, and a field that exists only as a place someone might put a token the
agent can read is worth less than the flexibility it offers. The comment is now
true by construction rather than by hope.

### C11 — an interrupted run leaves the old report

**Checked by reading.** The only write was in `onTestRunEnd`. Kill the run
before it and the previous passing report stands.

**Outcome: fixed by C6's mechanism.** The reporter now records the hash taken at
run start, and reconciliation refuses when the two hashes disagree. A killed
run leaves the old report, whose `startedFromHash` and `treeHash` both belong
to the earlier tree — so it is only accepted while the tree genuinely has not
changed since, which is the case the reviewer allowed was still useful
evidence.

### C12 — reconciliation matched a name, not an assertion

**Checked by reading.** `assertionIdInName` matched `[id]` anywhere in the
test's full name, and reconciliation then checked only the id, the state and
the file. A one-line `test('[driver.hooks] coverage', () => {})` in the right
file reconciled, as would any test nested under a describe block named for the
id.

**Outcome: fixed.** Reconciliation requires the reported name to equal
`[<id>] <the registry's own title>`. A new `title-mismatch` refusal names the
divergence. This has a second effect worth stating: the registry's title and
the test's title can no longer drift apart silently, and one such drift already
existed in this unit — `driver.stablePrefixCaching` was registered under a
shorter title than the test carried.

The reviewer's stronger proposal — structured metadata registered by
`invariantTest` rather than derived from display names — is not possible as
described, because tests run in worker processes and the reporter runs in the
node process, so a module-level registry is not shared between them. The title
binding is what is available without a new channel between the two.

### C13 — inspection accepted an incomplete enumeration

**Checked by reading.** `#ungrantedMcpTools` required only that an `init` line
parsed. A server that failed or was still connecting contributes no tools, so
the disallow list would be short by exactly that server's tools and the task
would then run holding them.

**Outcome: fixed.** Every configured server must be reported connected and
every granted MCP tool must be present before the absence of a name is treated
as meaning anything. Both refusals have unit tests.

### C14 — capability interfaces are augmentable

**Holds on TypeScript semantics.** `DriverCapabilities` and
`SandboxCapabilities` were interfaces, and an interface can be reopened from
another compilation unit. The generated fixture holding the registry equal to
`keyof DriverCapabilities` compiles in the conformance program, which would not
see an augmentation made in the driver's program. The reviewer stated it found
no such augmentation present, and neither did I.

**Outcome: fixed.** Both are now type aliases, which cannot be reopened. This is
a third contract amendment in this unit, **A-P5-03**, and is named in the pull
request body.

### G1 — here-document injection

**Checked by running it.** `writeFileScript` wrapped content in
`<<'FACTORY_ARTIFACT_EOF'`. A quoted delimiter stops expansion *inside* the
document; it does nothing about a line that *ends* it. Content containing a
line reading `FACTORY_ARTIFACT_EOF` closed the document and the following lines
ran as shell. The probe created its marker file: `INJECTION SUCCEEDED`.

The reviewer's reasoning about why the content is untrusted is right and worth
keeping: `CompiledRole.instructions` is compiler output, and a compiler's input
is a specification an agent may have written. This is also the one path in the
driver that reaches the shell without going through the CLI, so nothing in the
event stream would have recorded what ran.

**Outcome: fixed, using the reviewer's own suggestion.** The content travels as
an environment value and reaches the file through `printf %s`. Only the
variable's name and the path are on the argv, and `--` ends option parsing so a
path beginning with a dash cannot become a flag. The MCP configuration write
uses the same path. The unit test now feeds `emitArtifacts` the exact line that
broke the old implementation and asserts it appears in no command line.

### G2 — one artifact sandbox across many

**Checked by reading.** `#runTask` assigned `this.#artifactSandbox = req.sandbox`
on a field shared by the whole driver, while `#serialized` bounds concurrency
per handle rather than across handles. Two tasks on two sandboxes run
concurrently, and the second retargets the field while the first is still
running.

**Outcome: fixed.** `#runTask` no longer touches the field. Only `useSandbox`
sets it, so the caller names the sandbox it means and the driver never infers
one from whatever ran last. A driver asked to emit before being told still
refuses.

### G3 — the hash covered every file, not source

**Holds.** `walkFiles(dir, { extensions: [''] })` with `isInput` rejecting only
`.tsbuildinfo` hashes whatever a tool left in the directory.

**Consequence is smaller than the severity suggests**, and the reviewer said so:
a stray file makes the hash mismatch, which refuses. It costs a re-run, not a
false pass. It is still worth fixing, because a check that refuses at random
teaches people to re-run until it passes.

**Outcome: fixed.** An explicit allow-list of input extensions replaces the
deny-list.

### G4 — `test.result()` may be undefined

**Holds in part.** The described crash is not demonstrable from the types:
`state: test.result().state satisfies ReportedTestState` compiles, so vitest's
own type says the result is always present, and the reviewer's claim that it
"returns `undefined`" contradicts that. The reviewer was also right that the
consequence is correct behaviour — a reporter crash writes no report, and a
missing report refuses.

**Outcome: guard added anyway.** It costs one optional chain, and the value is
not in preventing a bypass but in not hiding a suite-level failure behind a
crash in the kit. Recorded as hardening rather than as a defect fixed.

### G5 — ended sandboxes are kept for ever

**Holds, and belongs to P2.** `#sandboxes` retains every provisioned record so
`appliedControls` can answer for a sandbox that has ended, which is a
deliberate choice made when that method was added. Unbounded growth over a
long-running process is a real cost.

**Not fixed here.** It is in `packages/sandbox`, it is a lifecycle decision that
unit took on purpose, and P5's out-of-scope list does not admit re-deciding it.
Recorded here so it is findable, and named in the pull request body for the
maintainer to route.

## The framing findings

Both reviewers answered item 7. They disagreed, which is the most useful thing
about having taken two.

**Gemini** endorsed the framing in one sentence. **OpenAI** rejected it in two
places, and both rejections are accepted:

- *"What tools does this session expose" is too narrow because the sandbox is
  persistent.* The stronger question is what processes and mutable control
  state from every previous task can still act during this one. C3, C4 and C9
  are all instances, and they were found because the reviewer asked the wider
  question rather than the one the prompt asked.
- *"Does the report hash match the current package" is too narrow.* The right
  question is whether the report identifies one completed execution of this
  exact assertion against the complete inputs being evaluated. C5, C6, C11 and
  C12 are all instances.

Both reframings are recorded in `D-P5-22` and should shape the prompt the next
unit's review is given.

## Gates after the fixes

| | |
|---|---|
| `pnpm -r typecheck` | pass |
| `pnpm -r lint` | pass |
| `packages/conformance` | 183 passed, 11 failed — every failure is an external assertion refusing for want of a credential in this shell |
| `packages/drivers/claude-code` | 47 passed, 9 failed — the same nine |
| `packages/sandbox` | 85 passed, 2 skipped |

The nine model-calling assertions cannot run without `ANTHROPIC_API_KEY`, and
they refuse rather than skip. The maintainer's acceptance run is what closes
them, and it must be re-run after these fixes: the tool-grant assertion now
makes two additional model calls, and the driver refuses several conditions it
previously accepted.
