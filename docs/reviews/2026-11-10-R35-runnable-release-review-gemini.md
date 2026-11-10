# External review of R35, gemini, 2026-11-10

The review of R35, the runnable release and first-run docs, by the gemini family. Triage: `2026-11-10-R35-runnable-release-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview` (the manifest's `invocation.modelRequested`), offering no tools. `cleanRoom` is `null` because an API call loads no local configuration.
- **Cross-family agreement:** gemini-1, gemini-2, gemini-3, and gemini-4 were raised by codex too (codex-4, codex-8, codex-7, codex-2). gemini-5 was raised by gemini alone.
- **Date:** 2026-11-10
- **Bundle:** `2026-11-10-R35-runnable-release-review-bundle.txt`, SHA-256 `403fcc2bec86d0b5a3f6152f69901b57e6a9d2cf882d85f3a176d973f30a55a7`, base `49ae3fe` (`reviewed/R16`), head `31da607` (the R35 unit branch as shipped in PR #130). Every new file in full and every modified file as a function-context diff; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` excluded. Prompt: `2026-11-10-R35-runnable-release-review-prompt.txt`.
- **Prior context and lookups:** Says it had no prior context and performed no lookups. A self-report, not independently verifiable.
- **Coverage, and any gap:** Items 1, 2, 3, 4, and 6 answered (findings, plus readHostConfig and probeSymlinks named sound). Item 5 has no finding of its own. Item 7, whether the framing was right, is not answered.
- **Citations:** line numbers refer to positions in the bundle's new side, not the repository; treated as hints and located by construct.

---

BASE: 49ae3fe
HEAD: 31da607
tsconfig.build.json
110699b23c3d85f32c76c77f97af8f9a

I have no prior context about this project and performed no lookups during this review. 

The mechanisms for host startup configuration (`readHostConfig`) and the symlink check (`probeSymlinks`) are sound. The configuration parser fails closed and strictly bounds environment ingestion to a fixed table, accurately aggregating problems before refusing start-up. The symlink probe validates filesystem capabilities using a real, cleanly scoped trial rather than heuristics. 

However, several test assertions meant to protect core invariants are flawed and fail open, allowing their properties to be violated while still passing.

### Findings

**1. `packages/cli/test/version.test.ts:16`** — factually wrong — High
**Concrete bypass:** The regex `[\s\S]*?["']olympus-ai["']\s*:\s*major\b` matches any occurrence of the target string in the changeset file, including inside YAML comments (e.g., `# "olympus-ai": major`). An attacker or developer can bypass the requirement by adding a commented-out major bump. The test will pass, but the Changeset tool's real YAML parser will ignore the comment, preventing the major release while the test claims the condition is met.
**Resolution:** Use a YAML parser to read the frontmatter instead of a regex, or enforce line start anchors (e.g., `/^["']olympus-ai["']\s*:\s*major\b/m`).

**2. `packages/api/test/host-config.test.ts:31`** — factually wrong — Medium
**Concrete bypass:** The docs check uses a single `expect(row).toContain(v.required ? '| yes |' : '| no |')` assertion that fails to distinguish between the "Required" and "Secret" columns. Furthermore, it never asserts the documented state of `v.secret`. An attacker can manipulate the README to wrongly document a required, non-secret variable as `| no | yes |`; the check will find `| no |` in the second column and pass while the documentation lies about both properties.
**Resolution:** Split the markdown table row by `|` and explicitly check the values at the exact indices for the "Required" and "Secret" columns, asserting both `v.required` and `v.secret`.

**3. `packages/api/test/examples.test.ts:63`** — factually wrong — Medium
**Concrete bypass:** The examples test verifies the policy cap enforcement by passing an L2 request and asserting `expect(res.status).not.toBe(201)`. This is a tautological fail-open check: it passes for *any* refusal or error (e.g., a 404 for a missing file, a 422 for a malformed payload, or a 500 server crash). The test passes without actually verifying that the run was refused specifically because it exceeded the policy level.
**Resolution:** Assert against the exact refusal reason instead of a blanket status code (e.g., `expect(res.body.refusal.reason).toBe('level-not-allowed')`).

**4. `packages/conformance/src/registry/release.ts:98`** — a tradeoff I would have made differently — Low
**Concrete bypass:** The `assertPackagedHostRuns` release check claims that the host is "started from its installed bin." However, it skips the actual npm-generated binary wrappers located in `node_modules/.bin/factory-host` and instead directly invokes the `.js` file via Node (`process.execPath`, `hostBin`). This allows the test to pass even if package manager configuration (like `no-bin-links`) or filesystem restrictions fail to create functional bin symlinks, masking a broken user installation.
**Resolution:** Execute the wrapper script in `node_modules/.bin/factory-host` to holistically test the installation artifact that an end-user runs.

**5. `packages/api/test/readiness-route.test.ts:13`** — type safety escape hatch — Low
**Concrete bypass:** The use of `as unknown as ReadinessReport` subverts the TypeScript compiler. If the actual `ReadinessReport` contract diverges (e.g., fields become strictly required or types change), this mock object will silently remain valid. The test will continue to pass against stale structural assumptions, hiding integration rot.
**Resolution:** Construct a compliant mock object or use a strictly typed `Partial<ReadinessReport>` instead of relying on double-casting.