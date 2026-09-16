# R1 — Readiness

**Unit:** R1 (M2, contributor-shaped)
**Depends on:** P2 Sandbox, P8 Adapters, P3 Policy engine
**Blocks:** nothing. Readiness is an input to policy, never a station in the line.

A target repository either can or cannot support autonomous work, and today
Olympus finds out by failing partway through a run. R1 answers the question
before the run starts, from executed probes rather than from a model's reading
of the repository, and expresses the answer in the vocabulary the runtime
already has: an autonomy ceiling, with the evidence for it.

---

## Why this unit

The competing frame in this market is a maturity score: eight pillars, five
levels, a points threshold per level, and a portfolio metric over repositories.
It is a good diagnostic and a better sales artifact, and it is inert — a score
tells an organization where it stands and enforces nothing. A repository that
scores well and a repository that scores badly run the same way.

The claim this repository makes is different. Olympus produces auditable,
tamper-resistant evidence that autonomous work is real. Readiness scored the
same way would be the one number in the system that nothing checks, which is
precisely the shape I8 exists to refuse: a document asserting a subsystem is
wired is not evidence that it is.

So R1 does not produce a score that a human interprets. It produces a
**ceiling that the policy engine enforces**, derived from probes that ran. The
scan and the runtime share one mechanism, and a pillar that cannot be probed
lowers the ceiling rather than costing points. A derived headline number for
reporting is a presentation concern (§7) and is never the load-bearing output.

This is also not a new mechanism. P8 already ships `unavailableControls()`,
where an adapter that lacks a control refuses L3 rather than degrading.
Readiness is that idea generalised from *what the adapter can do* to *what the
repository can support*, over the same sandbox and the same adapter set.

---

## The naming problem, settled first

The competing model numbers its maturity levels L1–L5. This repository's
autonomy levels are `L0`–`L3` (F1, frozen). Two ordered scales, both called
levels, overlapping numerals, opposite meanings: `L3` is the top of one and
the middle of the other.

**R1 introduces no second scale.** The output of a readiness scan is an
`AutonomyLevel` — the existing type, the existing four values. The eight
pillars survive only as a grouping for probes in reports. There is nothing to
collide because there is no second axis.

Any future work that wants a 1–5 maturity number derives it for presentation
and never names it a level.

---

## 1. Scope

`packages/readiness` owns the probe set, probe execution in a sandbox, and the
derivation of an `AutonomyLevel` ceiling with its evidence. It answers one
question about one repository at one commit: what is the highest autonomy
level this repository can support, and which executed probe is the reason it
is not higher.

**Package placement is a decision for the maintainer, not for the
implementing session.** F1 freezes the package list, and `readiness` is not on
it, so this unit either amends that list or lives somewhere already named.

- **Option A — a new `readiness` package.** Amends F1's package vocabulary and
  `pnpm-workspace.yaml` (protected path, `gate-change`). Keeps a scan that runs
  outside any run separate from the adapters a run uses. **Recommended.**
  Readiness consumes `adapters`; folding it in inverts that.
- **Option B — extend `packages/adapters`.** No vocabulary amendment. Costs
  `adapters` a dependency on `sandbox` at scan time and blurs "describes a
  stack" with "judges a repository".

The rest of this document assumes A and marks every place B would differ.

---

## 2. Consumed interfaces

From `@olympus-ai/core`: `AutonomyLevel`, `StationId`, `Policy`,
`PolicyResolution`, `PolicyRefusal`.
From `@olympus-ai/sandbox`: `SandboxProvider`, `SandboxHandle`, `SandboxSpec`,
`ExecResult`.
From `@olympus-ai/adapters`: `AdapterSet`, `TestFrameworkAdapter`,
`CoverageAdapter`, `ManifestAdapter`.

Nothing from a sibling's `src/`. No dependency on `vault`, `integrity`, or
`api`: a scan produces a value, and whoever stores or acts on it does so
outside this package.

---

## 3. Probes

A probe is a command executed in a sandbox against a checkout, plus a
predicate over its result. Probes are **binary** — `supported`, `absent`, or
`indeterminate` — and carry the argv, exit code, duration, and a SHA-256 of
captured output. There is no partial credit and no probe whose outcome depends
on a model reading a file.

`indeterminate` is not a third grade between the other two. It means the probe
could not be executed (no adapter for the stack, a timeout, a provisioning
failure), and it is treated exactly as `absent` when deriving a ceiling — I5,
applied to measurement. It is distinguished from `absent` only so a report can
say "not established" rather than "not present", which is a different thing to
tell a human and the same thing to tell the policy engine.

The eight pillars group the probes. They carry no weight of their own, and
three of them are load-bearing for autonomy while the rest are advisory:

| Pillar | Probes | Bears on |
|---|---|---|
| Build system | clean checkout builds in a fresh container; pinned dependency manifest | **Load-bearing.** P6 verifies at base+diff in a *fresh* sandbox; a repo that only builds incrementally cannot be verified at all |
| Testing | an `AdapterSet.test` exists for the stack; suites enumerate; the suite runs green at base | **Load-bearing.** I2 derives status from a suite; no enumerable suite means no derivable status |
| Security & governance | protected paths declarable; branch protection on the integration branch; secret scan clean | **Load-bearing at `integrate`.** Autonomous merge without branch protection has no backstop |
| Style & validation | linter, formatter, type checker present and runnable non-interactively | Advisory. Feeds `verify` checks; their absence narrows evidence without preventing it |
| Dev environment | cold container provision under the spec's wall clock | Advisory; a hard failure here already surfaces as a build probe failure |
| Documentation | agent instructions discoverable at a conventional path | Advisory. Affects `spec` and `plan` quality, which this unit cannot measure |
| Observability | structured log output on a known channel | Advisory until `observe` exists (M2+) |
| Code quality | file and function size distribution | **Advisory, and the weakest of the eight.** Recorded, never ceiling-bearing: no threshold on file length survives contact with a generated file, and a probe that cannot be defended is a probe that gets argued with instead of fixed |

Adding a probe requires naming its pillar and whether it is ceiling-bearing.
A ceiling-bearing probe requires a registry assertion (§6).

---

## 4. Deriving the ceiling

One function, total over the probe set, with no defaulting rule left implicit:

```
L0  if any load-bearing probe in Build system or Testing is not `supported`
L1  if those hold but coverage or tamper analysis is unavailable for the stack
L2  if those hold and the `integrate` probes are `supported`
L3  never — M3 canary owns L3, and no scan grants it
```

Three properties are binding, and each has an assertion:

**It only ever lowers.** The effective level stays
`min(requested, stationCap, globalCap)` with the readiness ceiling as one more
term. A scan cannot raise a cap policy set, cannot grant a capability policy
withheld, and cannot make an ungranted tool available. A readiness result that
could raise anything is a default-deny violation (I4) wearing a metric as a
disguise.

**An absent scan is not a pass.** A repository with no readiness result
carries the ceiling policy already gives it, unchanged — readiness is
subtractive or it is nothing. A missing scan must never read as `L3`, and the
type must not permit an optional ceiling that an absent value could satisfy.

**It is derived, never reported.** `ReadinessReport` has no field a model
writes, exactly as `TaskResult` has no status field (I2). The probe outcome is
computed from the exit code by the runtime; a driver never supplies one.

> **Amendment owed to the maintainer before this unit starts.** F1 states the
> effective level as `min(run.requested, policy.stationCap, policy.globalCap)`.
> Adding a fourth term changes frozen vocabulary, and F1 says changing anything
> there means revising that section deliberately first. This document does not
> make that edit. Two ways to take it: amend the F1 formula to name readiness,
> or keep the formula and have the caller lower `globalCap` before resolution,
> which leaves the spine untouched at the cost of making the ceiling invisible
> in the resolved `Policy` an auditor reads. **Recommended: amend the formula.**
> The auditor should see why a run was capped.

---

## 5. Out of scope

Binding. Adjacent work becomes an issue, not a commit.

- **Any portfolio or multi-repository rollup.** "Share of repositories at or
  above a level" aggregates across repositories, which is the hosted control
  plane's job and a separate product in a separate repository (D24). This
  package scans one repository and returns one result.
- **Remediation.** Scaffolding a repository up to a ceiling is a second unit
  with a different risk profile: it writes to a repository, and every probe it
  satisfies is one it also authored (I3). If it is ever built, it must not be
  built by whoever owns the probes.
- **Any write to the target repository.** A scan is read-only and provisions
  its sandbox with no `rw` mount beyond the checkout it was given.
- **Scheduling, watching, or re-scanning on a timer.** Triggers own that (M2).
- **Storing the result.** No `Vault` operation for readiness exists, and
  adding one is an amendment owed to the first unit that stores a result.
- **Making the result consumable by the station machine.** P4 reads a resolved
  `Policy`; wiring the ceiling into run creation belongs to whichever unit owns
  that path once the §4 amendment is settled.
- **The pillar-to-score presentation number** beyond what §7 names.
- **Any edit to a contract file**, `packages/core/src/policy/types.ts`
  included. R1's result types live beside its implementation, as P3's do.

---

## 6. Conformance suite

Written before the implementation. Under the existing invariants — R1 adds no
invariant, since adding one edits `InvariantId` and the spine.

| Id | Level | Proves |
|---|---|---|
| `I2.readiness-outcome-is-runtime-derived` | compile-error | `ProbeResult.outcome` is `collectedBy: 'runtime'`-shaped and has no setter a driver result can reach; a fixture assigning a model-supplied outcome fails to compile |
| `I4.readiness-never-raises-a-cap` | runtime | over every probe-set permutation, the ceiling returned is never above the cap the policy already carried |
| `I4.absent-scan-is-not-a-pass` | compile-error | the ceiling is not optional and has no value an absent scan could satisfy; `ReadinessReport | undefined` does not typecheck at the consumption site |
| `I5.indeterminate-probe-lowers` | runtime | a probe that could not execute yields the same ceiling as one that failed, and never a higher one |
| `I5.unsupported-stack-refuses` | runtime | a stack with no `AdapterSet.test` derives `L0` and names the missing adapter |
| `I8.ceiling-bearing-probe-has-an-assertion` | runtime | a registry meta-test: every probe declared ceiling-bearing maps to an executable assertion, and deleting the probe fails it |

`pending-baseline.json` rises by one for each of I2, I4, I5, and I8 when the
pending entries are added, and each is paid down in the pull request that lands
the unit. Raising a baseline number is a deliberate edit a reviewer sees; it is
called out here so it is expected in the diff rather than argued about in it.

**The probe suite needs a Docker daemon and fails closed without one**, for the
reason P2 already establishes: a probe that skips itself reports green having
executed nothing, which is the failure I5 exists to refuse.

---

## 7. Reporting

A `ReadinessReport` renders to a table: the derived ceiling, the probe that
holds it there, and every probe's outcome grouped by pillar. The binding rule
is that **the reason is always a specific probe**, never a pillar and never a
score. "L1, because no coverage adapter exists for this stack" is actionable.
"L1, because testing scored 4 of 9" is not.

A 1–5 presentation number may be derived here for an audience that expects one.
If it is, it is labelled a readiness index, never a level, it appears nowhere in
code or config (§"the naming problem"), and nothing in the runtime reads it.

---

## 8. Acceptance criteria

Verifiable by someone who has read the README, CONTRIBUTING.md, and this file.

- a repository with no test suite derives `L0`, and the report names the
  enumeration probe as the reason
- a repository that builds only incrementally derives `L0`; the build probe
  runs in a fresh container and its failure is reported with the argv and exit
  code that produced it
- a stack with no `AdapterSet.test` derives `L0` and names the absent adapter
  rather than reporting an empty suite as a clean one
- a probe that times out and a probe that fails derive the same ceiling; the
  report distinguishes them in prose and the derivation does not
- every `ProbeResult` carries argv, exit code, duration, and an output hash,
  and a second scan at the same commit produces the same ceiling
- a readiness ceiling above the policy's existing cap cannot be constructed;
  the `I4` assertions fail if the derivation is edited to permit one
- scanning a repository leaves it byte-identical: no file created, modified, or
  deleted, verified against a hash of the tree taken before the scan
- the six registry assertions in §6 are live and `pending-baseline.json` is
  lowered by the four entries this unit paid down
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm conformance` all pass
- `git ls-files -- .plan/` prints nothing

---

## 9. Session scope

1. Load `CLAUDE.md`, `F1-spine.md`, this unit's entry in `DECOMPOSITION.md`,
   and this file. Nothing else.
2. **Confirm the two open decisions first** — package placement (§1) and the
   F1 effective-level amendment (§4). Both are the maintainer's, and neither is
   resolved silently by the implementing session.
3. Conformance suite first (§6); watch it fail.
4. Probes, then derivation, then reporting.
5. Run the acceptance criteria (§8). The unit touches `pnpm-workspace.yaml`
   and `packages/conformance/`, so the pull request carries `gate-change`.
6. **Stop.** Human review before anything consumes the ceiling.
