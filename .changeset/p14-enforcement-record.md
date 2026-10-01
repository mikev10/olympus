---
"@olympus-ai/vault": minor
"@olympus-ai/core": minor
"@olympus-ai/sandbox": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

P14: the enforcement record. Every decision a control makes is written through
`Vault.recordDecision` before it takes effect, and a write that fails throws.
That covers each admission and resume refusal, each station refusal and park by
cause, each approval granted or refused, each connection the egress proxy
decided, each violation, and each driver call whose relay refused anything.
Each decision names the component that decided, the run, the task, and the
station. `readDecisions` lists a run's decisions (A-P14-01; `VaultRefKind`
gains `'decision'`). `SandboxProvider.destroy` returns a `Teardown` of the meter
reading and the proxy's egress log, which is read after the proxy stops and
parsed as JSON lines (A-P14-02). Admission refuses a run id that is not one
directory name (`runId`/`unusable`), so nothing is written for it. The
conformance table `I2.enforcement-decisions-recorded-by-the-enforcer` has a row
for every cause.

After review: `EnforcementDecision` carries an `occurrence` id, so identical
decisions are separate entries. A park is recorded before it is committed. The
proxy records the requests it answers 400 as `refused` with no host. Admission
refuses an `approvedCostUsd` that is neither a finite number nor null
(`approvedCostUsd`/`not-a-cost`).
