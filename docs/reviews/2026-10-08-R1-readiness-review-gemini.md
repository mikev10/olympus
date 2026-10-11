# External review of R1, gemini, 2026-10-08

An adversarial pre-merge review of R1 (repository readiness): `materialize`
in `tree.ts`, `scan` and its probes in `scan.ts`, the probe tiers and
`deriveCeiling`, `resolveWithReadiness` and its cap attribution, and the
conformance assertions and type fixtures that state those properties. One of
two reviews run from the same prompt and bundle; the other is
`2026-10-08-R1-readiness-review-codex.md`. Both are triaged in
`2026-10-08-R1-readiness-triage.md`, which cites this review's findings as
`gemini-1` to `gemini-3`, as the reply numbers them.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`
  (`generativelanguage/v1beta`), offering no tools. `cleanRoom` is `null`
  because an API call loads no local configuration. Exit 0, not timed out,
  229.6 s. Ingestion `complete`: 44,843 prompt tokens against a floor of
  32,028. Integrity `verified`: the reply echoes every required bundle marker.
  Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `9844129dfb214af8ab0b839c90b13e98fa4628806ea13b68c039294856048a71`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** gemini-1 (static and executed probes share one
  writable scan directory, so the build script can rewrite what the suite
  probes run) was raised by codex too, as codex-2. gemini-2 and codex-1 both
  concern symlinks that `materialize` reconstructs on the host, but by
  different mechanisms (a host-side read through a link, against a write
  through a colliding destination path), and are not paired. gemini-2 and
  gemini-3 were raised by gemini alone.
- **Date:** 2026-10-08 (run started 2026-10-08T20:32Z).
- **Bundle:** `2026-10-08-R1-readiness-review-bundle.txt`, SHA-256
  `356f9f3cfff3af288a7addb85116a616410f270518c6fe6355e48552d5a2d81f`, base
  `0023602` (`reviewed/R14`), head `0f7a3d8` ("R1: Readiness"). It held the
  full contents of 24 of the 26 changed paths in that one commit: the
  `readiness` package source and tests, the conformance registry entries and
  the two type fixtures, the changeset, configuration, and the lockfile diff.
  The changed `docs/decisions.md` and `docs/plan/R1-readiness.md` were
  excluded, and so was every unchanged file. Prompt:
  `2026-10-08-R1-readiness-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context
  about the project and performed no external lookups. This is a self-report
  and is not independently verifiable.
- **Coverage, and any gap:** items 1 (gemini-1, gemini-2), 4 ("Language
  Escapes: none found"), 6 (the "Sound Mechanisms" list) and 7 (the framing is
  "exactly the right question") were answered. Item 2 (tautological checks)
  and item 5 (configuration satisfied without doing what it appears to do)
  came back empty: the reply neither reports a finding nor states that it
  found none. Item 3 (fail-open) is touched only by gemini-3's remark that the
  memory exhaustion it describes fails closed; it makes no general statement.
  Silence on those items is not a clearance.
- **Citations:** line numbers refer to positions in the bundle's files (new
  side of each diff), not to the repository. They are hints; the triage
  locates each construct before citing it.

---

BASE: 0023602
HEAD: 0f7a3d8
pnpm-lock.yaml
7d078e4b932d667881919a2fc9e12604

I have no prior context about this project and have performed no external lookups. 

The adversarial framing provided in the prompt is exactly the right question to ask for this code. By assuming the repository content is completely controlled by a capable party, we can evaluate whether the scanner correctly isolates dynamic execution, sanitizes static inputs, and fail-closes on edge cases.

Here are my findings, ordered by severity.

### 1. State Crossover Between Probes (TOCTOU Bypass of Tamper Analysis)
**packages/readiness/src/scan.ts:105-115** — factually wrong — High
**The concrete bypass:** 
Static probes (like `testing.tamper-analysis`) and executed probes (like `build.clean` and `testing.green-at-base`) share the exact same host directory `ctx.scanDir`. Because `execute()` mounts this directory as `rw` (read-write), an attacker can use the `build` script in `package.json` to alter the repository after the static analysis has finished.
For example, an attacker can commit a strong, valid test suite that easily passes the static `tamperAnalysis` check. They then configure their `build` script to overwrite those test files with trivial tests (e.g., `echo "test('dummy', () => {})" > sum.test.js`). When `testing.green-at-base` and `testing.coverage` run, they execute against the overwritten files. This successfully tricks the scan into reporting the test probes as `supported` when the actual repository property does not hold.
**What would resolve it:** 
Do not share a mutable `ctx.scanDir` between the `build` phase and the `suite` phase, or run the static analysis *after* the build phase on the exact state of the tree that the `suite` probe will see. Alternatively, if tests should not depend on build artifacts, execute the tests against a fresh `ro` (read-only) copy of the materialized tree.

### 2. Arbitrary Host File Read via Git Symlinks
**packages/readiness/src/scan.ts:171 (and 140)** — factually wrong — High
**The concrete bypass:** 
The `materialize` function in `tree.ts` perfectly reconstructs Git symlinks (mode `120000`) on the host file system. Since static probes like `fileSizes` and `readManifest` run in the runtime's own host process, they will follow these symlinks outside the `tree` boundary.
If an attacker commits a symlink `link.js` pointing to `/etc/passwd`, it will pass `checkPath` (because the path *name* is just `link.js`). When `fileSizes` loops over `files`, it will call `readFile` on it, successfully reading the host's `/etc/passwd`. It will then parse the file and leak the exact line count of the host file in the report's `largest` file detail. Similarly, if `package.json` is a symlink to `/etc/shadow`, `readManifest` will attempt to parse it and leak the first character/token of the file in the `SyntaxError` exception string.
**What would resolve it:** 
In static analysis probes that run on the host, always use `fs.lstat` to verify that files are not symlinks (or that they resolve to a path strictly within `tree`) before calling `readFile`. Better yet, read the file contents directly from git blobs using `git cat-file` rather than trusting the materialized file system.

### 3. Memory Exhaustion (OOM) During Materialization
**packages/readiness/src/tree.ts:72-74** — a tradeoff I would have made differently — Low
**The concrete bypass:** 
When reading from `git cat-file --batch`, the code uses `pending = Buffer.concat([pending, chunk])` inside an async iteration loop. `Buffer.concat` allocates a entirely new buffer every time a chunk is received. For very large files (e.g., a 2GB dummy file an attacker commits), this results in quadratic memory copying (O(N^2)) and forces the entire file to be held in V8's memory at once, likely crashing the host Node process with an Out Of Memory error. While this effectively fails closed (stopping the scan), it allows any user to perform a Denial of Service against the scanner process.
**What would resolve it:** 
Stream the output from `git cat-file` directly to the disk via `fs.createWriteStream`, or enforce a strict file-size limit when parsing the `ls-tree` output to refuse materialization of unreasonably large blobs.

---

### Sound Mechanisms
Most of the core business logic is highly robust and fails closed gracefully:
- **`deriveCeiling` (`derive.ts`)**: Sound. The fallback logic correctly guarantees that no outcome can push the ceiling higher than L2. The explicit requirement that *every* identical probe result must be `supported` prevents an attacker from outvoting a gap with duplicate results.
- **`resolveWithReadiness` (`resolve.ts`)**: Sound. The function applies the fourth term exactly as intended. It perfectly handles `NOT_SCANNED` as an explicit state that does not alter the policy, and it correctly attributes refusals to the tightest bounds without ever elevating a cap.
- **Command execution (`inTree`)**: Sound. Wrapping user arguments with `"$@"` securely forwards them as positional parameters to the shell, completely mitigating command injection vulnerabilities even if file names contain shell metacharacters. 
- **Language Escapes**: None found. The codebase uses `unknown` and casts responsibly (e.g., in `readManifest`, the cast to `Record<string, unknown>` is protected by strict type-checking that properly rejects Arrays and `null`).