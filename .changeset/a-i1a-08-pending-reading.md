---
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

A-I1a-08: `UsageReading` gains `pending`. The line writes a `pending` usage
record through `recordUsage` after provisioning a driver's sandbox and before
calling the driver; the call's terminal reading follows for the same task and
attempt. A process stop while the call was in flight used to leave no record,
so a resume replayed the task and the run total read `exact` without the
killed call. A `pending` that nothing followed is now a lost reading: the
resume is refused `meter-lost`, and `costTotals` counts it as a lost call and
reports `lower`. The pending record is stored without a reference from run
state; `Vault.readUsage` lists it by run (D-I1a-12).

The conformance registry adds `I2.call-recorded-before-it-is-made`, and a
pending entry `I2.relay-bound-to-tier-model` owned by R14 (D-I1a-13), with
I2's pending baseline raised to 1 and R14 added to the registry's units.
