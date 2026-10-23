# External review of R20, codex, 2026-10-22

An adversarial review of R20, the role compiler: `compileRoles` and how it
reads a roles directory, admission's pinning of every compiled role in the
write-once admission record and resume's reading of roles only from it, the
line's seat-to-role assignment and the role id and hash on every usage record,
and the Claude Code driver's rendering of the role on the CLI's argv. One of
two reviews run from the same prompt and bundle; the other is
`2026-10-22-R20-role-compiler-review-gemini.md`. Both are triaged in
`2026-10-22-R20-role-compiler-triage.md`, which cites this review's numbered
findings as `codex-1` to `codex-4`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone; the pre-run listing of both is the manifest's
  `cleanRoom`. Exit 0, not timed out, 93.8 s. Ingestion `complete`: 116,233
  input tokens against a floor of 81,523. Integrity `verified`. Outcome
  `counted`. Reply SHA-256 as the runner wrote it:
  `87560222a60e1c4e41d91db78fce1b5de590a1e203291aa3b3b3088ae602ca0f`, which
  matched the manifest's `replySha256` before this header was prepended; the
  untouched reply is in commit `13c7302`.
- **Cross-family agreement:** none. codex-1 to codex-4 were raised by codex
  alone; gemini reported no findings. gemini's assessment judged the driver's
  `--setting-sources ''` sufficient to keep workspace configuration out, which
  codex-1 questions; on CLI 2.1.309 the triage found gemini's reading correct,
  but nothing in the repository showed it.
- **Date:** 2026-10-22 (run started 2026-10-23T01:28Z).
- **Bundle:** `2026-10-22-R20-role-compiler-review-bundle.txt`, SHA-256
  `8470141b619068de2278340de754e03f0ed70ca02474a9a9af7e2aef69598587`, base
  `60b83a0` (`reviewed/R18`), head `a61aac4` ("R20: Role compiler"), two
  commits (the R20 spec amendment, #60, and the unit itself). It held 49 of the
  52 changed paths, new files in full and modified files as whole-function
  diffs; `docs/decisions.md`, `docs/plan/DECOMPOSITION.md` and
  `docs/plan/F1-spine.md` were excluded, and so was every unchanged file.
  Prompt: `2026-10-22-R20-role-compiler-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior project
  context and performed no external lookups, reviewed the supplied bundle, had
  a local file-listing attempt blocked, and ran no tests. This is a self-report
  and is not independently verifiable.
- **Coverage, and any gap:** item 1 answered (codex-1, unresolved rather than
  demonstrated); item 2 answered (codex-2, codex-3); item 3 answered (codex-4, a
  setup failure that returns as success); item 4 answered (codex-3's second
  half: `unknown` widening, structural types, `readonly`); item 5 answered in
  substance by codex-1 (the flag configures settings, which may not be every
  instruction source); item 6 answered (compiler byte handling, admission and
  resume, recording and grants, rendering); item 7 answered (framing
  appropriate, with the distinction between pinning a role's bytes and proving
  they are the only instructions the CLI loads). No item came back empty.
- **Citations:** line numbers refer to positions in the bundle's new-side diff
  hunks, not to the repository; they are hints, and each was located by
  construct during triage.

---

Prior context: none. External lookups: none. I reviewed the bundle supplied in the prompt; a local file-listing attempt was blocked. Tests were not run.

BASE: 60b83a0  
HEAD: a61aac4  
pnpm-lock.yaml  
1dc1f30465a80cf93bb99499d0b20382

1. **packages/drivers/claude-code/src/driver.ts:303 — unclear — high — The argv does not establish that repository-supplied instructions are excluded.**

   The driver starts the CLI in the workspace, supplies `--agents` and `--agent`, and disables *settings* sources. The supplied source does not establish whether that also excludes repository instruction files, rules, skills, or agent definitions.

   The concrete attack to test is a builder adding `CLAUDE.md` or `.claude/rules/override.md` containing instructions for the reviewer or next builder. A later seat receives the changed repository. If the CLI loads those instructions, its configured role can still be `reviewer`, and the usage record can still contain the correct pinned hash, while agent-authored instructions also govern execution.

   **Resolution:** test the pinned CLI with hostile repository instruction files and inspect the actual model request. Disable or isolate every automatic instruction source that the repository can supply. **Confidence:** this is an unresolved boundary, not a demonstrated exploit from the supplied source. The CLI implementation and its effective prompt would resolve it.

2. **packages/conformance/src/registry/roles.ts:99 — factually wrong — medium — The resume assertion can pass without exercising resumed role delivery.**

   `runHello` drives through build and review to the integrate approval. The test then resumes without granting that approval and checks:

   ```ts
   again.requests.some(...)
   ```

   An empty request array passes. Consequently, deleting resumed-role delivery—or loading today’s files only when a resumed builder actually runs—can leave this assertion green. The “later run” check at line 104 also only invokes `compileRoles`; it never admits another run.

   **Resolution:** pause before an unexecuted model seat, edit or remove the role directory, resume, require a positive call count, and compare the received instructions and hash against admission. Separately admit a second run and inspect its record.

3. **packages/conformance/src/registry/roles.ts:319 — factually wrong — medium — Dependency names and function arity do not prove input provenance.**

   This check can succeed while the compiler reads additional instruction sources. For example, `compileRoles(directory, extra = process.env.EXTRA)` still has `.length === 1`; reading an environment variable requires no new dependency. The import regex also misses double-quoted imports, dynamic imports, and imports in nested source directories.

   Similarly, `compiler-refuses-untrusted-input.ts:11` proves rejection of particular typed expressions, not exclusion of untrusted data. Widening a value to `unknown` before asserting it as a string defeats that type distinction; structural `CompiledRole` objects and `readonly` fields do not authenticate provenance or enforce runtime immutability.

   These are **verification limitations**, not demonstrated agent exploits: the stated adversary cannot alter the running runtime process.

   **Resolution:** narrow the assertion’s claim to what it checks. If dependency restrictions matter, inspect resolved imports recursively with the TypeScript parser. Establish provenance through the actual host-configured admission path, rather than arity or type rejection.

4. **packages/conformance/src/registry/roles.ts:153 — factually wrong — low — The symbolic-link scenario can return successfully without testing rejection.**

   The assertion catches every failure to create its symlink and returns. Permission failures, unsupported operations, and fixture defects therefore all produce successful completion without calling admission on a link. The compiler unit test similarly skips on any symlink-creation error.

   **Resolution:** require this scenario on a supported CI platform; propagate unexpected setup errors. Report unsupported execution explicitly rather than treating it as conformance success.

The following mechanisms look sound within the stated trust boundary:

- **Compiler byte handling:** `packages/compiler/src/compile.ts:107` rejects nonregular entries, checks the opened file’s identity, bounds reads, decodes UTF-8 fatally, preserves the BOM, and hashes the bytes actually read. This supports byte-exact role versions. It does not provide an atomic snapshot against concurrent in-place host edits, but that adversary is excluded here.
- **Admission and resume:** `packages/api/src/run.ts:404` checks required roles; `:707` reads pinned roles from the admission record and verifies their hashes. Missing roles throw or refuse rather than selecting a default prompt. An empty compiler result therefore does not admit a run.
- **Recording and grants:** `packages/api/src/line.ts:792` derives role attribution from the role supplied by the runtime, not model output. The review call uses the pinned reviewer role while retaining the task’s policy scope.
- **Rendering:** the driver explicitly constructs the agent definition from `description` and `prompt`, instead of spreading role properties into it. Markdown front matter cannot become a tools or model field through this rendering. Shell arguments are passed through `"$@"`, preventing role text from becoming shell syntax.

The framing is appropriate, with one distinction: **pinning a role’s bytes is different from proving that those bytes are the only role-like instructions the CLI loads**. The bundle supports the former substantially better than the latter. Forged Vault objects, malicious driver implementations, and runtime-process casts are outside the stated attacker’s authority; I would not report them as agent bypasses.