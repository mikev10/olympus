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