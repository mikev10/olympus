# External review of R1, codex, 2026-10-08

An adversarial pre-merge review of R1 (repository readiness): `materialize`
in `tree.ts`, `scan` and its probes in `scan.ts`, the probe tiers and
`deriveCeiling`, `resolveWithReadiness` and its cap attribution, and the
conformance assertions and type fixtures that state those properties. One of
two reviews run from the same prompt and bundle; the other is
`2026-10-08-R1-readiness-review-gemini.md`. Both are triaged in
`2026-10-08-R1-readiness-triage.md`, which cites this review's findings as
`codex-1` to `codex-8`, as the reply numbers them.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone; the pre-run listing of both is the manifest's
  `cleanRoom`. Exit 0, not timed out, 284.1 s. Ingestion `complete`: 54,082
  input tokens against a floor of 32,028. Integrity `verified`: the reply
  echoes every required bundle marker. Outcome `counted`. Reply SHA-256 as the
  runner wrote it:
  `02d9d666e798086b0621943990330327ee9edced49f045af7757ce528a04360b`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** codex-2 (repository commands run in one
  writable scan directory, so an earlier command can rewrite what later probes
  execute and read) was raised by gemini too, as gemini-1. codex-1 and
  gemini-2 both concern symlinks that `materialize` reconstructs on the host,
  but by different mechanisms (a write through a colliding destination path,
  against a host-side read through a link), and are not paired. codex-1 and
  codex-3 to codex-8 were raised by codex alone.
- **Date:** 2026-10-08 (run started 2026-10-08T20:27Z).
- **Bundle:** `2026-10-08-R1-readiness-review-bundle.txt`, SHA-256
  `356f9f3cfff3af288a7addb85116a616410f270518c6fe6355e48552d5a2d81f`, base
  `0023602` (`reviewed/R14`), head `0f7a3d8` ("R1: Readiness"). It held the
  full contents of 24 of the 26 changed paths in that one commit: the
  `readiness` package source and tests, the conformance registry entries and
  the two type fixtures, the changeset, configuration, and the lockfile diff.
  The changed `docs/decisions.md` and `docs/plan/R1-readiness.md` were
  excluded, and so was every unchanged file. Prompt:
  `2026-10-08-R1-readiness-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior project
  context and made no external lookups, and that shell execution was blocked,
  so its findings are source readings, not reproductions. This is a
  self-report and is not independently verifiable.
- **Coverage, and any gap:** the reply does not number its answers by prompt
  item, but each of the seven is addressed: item 1 by codex-1, codex-2 and
  codex-7; item 2 by codex-5; item 3 by codex-3 and codex-4; item 4 by codex-8;
  item 5 by codex-6; item 6 by the closing list of sound mechanisms; item 7 by
  the closing paragraph, which argues the readiness half of the framing asks
  the wrong question (which observations are independently checked, against
  which merely repeat a repository-chosen command's success).
- **Citations:** line numbers refer to positions in the bundle's files (new
  side of each diff), not to the repository. They are hints; the triage
  locates each construct before citing it.

---

BASE: 0023602  
HEAD: 0f7a3d8  
pnpm-lock.yaml  
7d078e4b932d667881919a2fc9e12604

No prior project context; no external lookups. I reviewed the supplied inline bundle. These are source findings, not executed reproductions; shell execution was blocked.

1. **`packages/readiness/src/tree.ts:56`, `:120`, `:126` — factually wrong — high — filename decoding can turn materialization into an external write.**

   On a Unix repository, commit a symlink whose filename is the single byte `0x80`, targeting `/tmp`, and a directory named byte `0x81` containing `readiness-escape-proof`. These are distinct Git paths. `execFile` decodes stdout as UTF-8, turning both names into the replacement character `�`. Materialization creates `dest/� -> /tmp`, then follows it when writing `dest/�/readiness-escape-proof`. The write happens on the host, before any sandbox, and survives removal of the scan directory. A known checkout path could instead be the symlink target.

   **Resolve:** read filenames as bytes; reject unrepresentable names and destination aliases before writing; enforce containment without following symlink ancestors. Test invalid UTF-8 and case-insensitive filesystem collisions. Confidence is high for the Unix construction, though unexecuted here.

2. **`packages/readiness/src/scan.ts:138`, `:140`, `:142`, `:409` — factually wrong — high — repository scripts can replace the later probes’ executables and inputs.**

   Declare genuine Vitest dependencies, commit an enumerable failing test, and use the build script to replace `node_modules/.bin/vitest` with an executable that writes `/scan/out/coverage/coverage-final.json` and exits zero. Installation succeeds; the build succeeds; both suite probes succeed without running the failing test. The same script can replace ESLint, Prettier, and TypeScript executables.

   Fresh containers do not prevent this: they reuse the same writable scan directory. Static enumeration examines the original tree, while execution examines a tree the repository has rewritten. With the trusted integration prerequisites satisfied, this can produce L2.

   **Resolve:** isolate probe inputs, verify the tested source against the materialized commit, and protect runner code and configuration from preceding repository commands. Runtime observation of an attacker-controlled program’s zero exit is insufficient evidence of the named property.

3. **`packages/readiness/src/scan.ts:128`, `:418` — factually wrong — high — an entirely skipped suite can establish “green at base.”**

   Keep a recognizable test file but mark every test skipped. Static enumeration can still find the file, and a normal successful test-runner exit is accepted without checking whether any tests executed. Enumeration and execution are never reconciled. This can cross the L0 boundary without one passing test.

   **Resolve:** require a nonempty executed suite and reconcile its identities and outcomes with enumeration. Explicitly define how skipped, filtered, and todo tests affect readiness. Add negative fixtures for all-skipped and configuration-excluded suites.

4. **`packages/readiness/src/scan.ts:405`, `:419` — factually wrong — high — arbitrary nonempty bytes qualify as coverage.**

   The sole artifact check is `test -s`. A repository command can prewrite `garbage` to the fixed report path, then arrange for the coverage invocation to return zero without generating coverage. The probe accepts the stale file. An empty JSON object also passes; no Istanbul structure, source identity, or measured entry is required.

   **Resolve:** use a fresh output location, reject preexisting artifacts, parse and validate the report, and require measurements corresponding to the scanned sources. These checks must accompany the executable-integrity fix above; JSON supplied by the repository is not independently trustworthy.

5. **`packages/conformance/src/registry/readiness.ts:304`, `:313`, `:317` — factually wrong — medium — the per-probe assertion does not test the probe implementation.**

   Replace `tamperAnalysis` with an unconditional `supported` result while preserving its identifier. This assertion still passes: it imports declarations and `deriveCeiling`, then manufactures outcomes. It never executes that probe. The supplied positive scan test would also accept that replacement.

   This is a useful derivation test, but it is independent of whether the scanner actually checks the claimed capability. It does not fulfill the stronger deletion-sensitive claim.

   **Resolve:** give each ceiling-bearing probe an executable negative fixture that loses support when its checking logic is removed or replaced with success. Retain these derivation tests separately.

6. **`packages/readiness/src/scan.ts:129` — unclear — medium — “tamper analysis” establishes adapter presence, not successful analysis.**

   `tamperAnalysis` returns `supported` when the test and manifest slots are non-null. It invokes no analysis and checks no result. A repository whose tests require analysis those adapters cannot perform would receive the same answer as an analyzable repository, provided adapter selection still supplies those slots.

   The missing adapter implementations prevent confirming a particular unsupported syntax as an exploit. The source does establish that this probe never observes analysis succeeding.

   **Resolve:** clarify whether this means “adapters available” or “this repository can be analyzed.” For the latter, execute analysis and refuse unsupported constructs. Check dynamic test generation and indirect assertions against the actual adapters.

7. **`packages/readiness/src/tree.ts:66`; `packages/readiness/src/scan.ts:155` — unclear — medium — omitted submodules do not constrain the ceiling.**

   Add an untested application submodule to a root project that otherwise passes. Materialization omits it; the omission appears only in `skipped`; derivation remains eligible for L2. Build, testing, and secret scanning therefore establish nothing about that component.

   The unresolved issue is scope: does L2 describe the root project excluding submodules, or the repository’s application? The report’s overall ceiling does not encode that distinction.

   **Resolve:** either make unexamined components constrain readiness or explicitly bind the ceiling to the included scope so consumers cannot treat it as whole-repository clearance.

8. **`packages/conformance/fixtures/types/i2/readiness-outcome-is-runtime-derived.ts:11` — factually wrong — medium — the provenance assertion proves a label, not an origin.**

   A model or driver can produce the same structural object with `collectedBy: 'runtime'`; no cast is needed. The fixture’s accepted object spread already demonstrates that callers can construct a qualifying record.

   Likewise, TypeScript `readonly` is not runtime immutability. A mutable structural alias can modify these ordinary objects; casts, `any`, and dishonest type predicates provide additional escapes. Declaration merging or generic tricks are unnecessary.

   **Resolve:** describe this fixture as a shape check. Establish provenance through the runtime construction and consumption boundary; use runtime immutability if that is required. Under the stated threat model, this is an assertion defect, **not** a demonstrated repository-to-runtime-process exploit.

The following mechanisms look sound within the supplied scope:

- **`derive.ts:23`:** missing results fail closed; only exact `supported` outcomes pass; a failing duplicate cannot be outvoted; the implementation never returns L3.
- **`resolve.ts`, `resolveWithReadiness`:** success requires the policy engine’s success and returns its level. Policy refusals cannot become grants. Explicit `NOT_SCANNED` preserves policy behavior, and cap attribution checks each exceeded policy term. I found no repository-content construction that makes this resolver grant something the trusted engine refuses.
- **`scan.ts`, execution judgment:** provisioning failures, thrown execution errors, and nonzero exits do not become support. Missing adapters and missing branch-protection checkers lower readiness.
- **`tree.ts`:** raw blob extraction avoids checkout filters, and revision validation blocks option-shaped revisions. These protections do not cure the filename/symlink escape.

The adversarial framing is appropriate for filesystem containment and policy monotonicity. For readiness, it exposes a fundamental distinction: the runtime computes the final label, but much of its evidence comes from repository-controlled programs. The stronger question is which observations establish an independently checked property, and which merely establish that the repository’s chosen command reported success. Even an authentic runner and valid coverage report cannot prove that repository-authored tests meaningfully test the application.