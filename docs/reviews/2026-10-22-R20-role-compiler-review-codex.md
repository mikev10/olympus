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