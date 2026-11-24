# External review of R54, gemini, 2026-11-23

The review of R54: the benchmark's model tier run per model, the rule that
compares two runs, the paid workflow, and the committed results. The bundle
also carried the admission change A-R40-02, merged since the last reviewed
tag. Everything below the rule under this header is the reviewer's reply,
unedited. The triage is `2026-11-23-R54-deep-tier-benchmark-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no
  tools. `cleanRoom` is `null` because an API call loads no local
  configuration.
- **Cross-family agreement:** codex raised four of these five too. gemini-1
  is codex-1 (results not tied to a run). gemini-2 is codex-4 (the pull
  request's code runs with the key); its claim about the merge-unit skill was
  raised by gemini alone. gemini-3 is codex-5 (no comparison, no assertion).
  gemini-4 overlaps codex-2 and codex-3 (summaries trusted, items not
  compared). gemini-5 (the test rigs' readiness scan) was raised by gemini
  alone; codex looked at the same code and reported no bypass.
- **Date:** 2026-11-23
- **Bundle:** `2026-11-23-R54-deep-tier-benchmark-review-bundle.txt`, SHA-256
  `221f7416648bf8050a04dbf8628a0675ffb3c9e9ff87f390559c5ca6cfe89896`, base
  `03518f9` (`reviewed/R53`), head `4a3b15d` (the results and their
  comparison committed, before any review fix). It held every new file in
  full and every modified file as a function-context diff, 34 sections.
  Excluded: `docs/decisions.md`, `docs/reviews/`, `docs/plan/`,
  `pnpm-lock.yaml`. Prompt: `2026-11-23-R54-deep-tier-benchmark-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior context
  and performed no lookups. This is a self-report and cannot be verified
  independently.
- **Coverage, and any gap:** the reply numbers seven entries. Entries 1 to 5
  are findings, covering prompt items 1, 2, 3 and 5. Entry 6 answers item 6
  (sound mechanisms). Entry 7 answers item 7 (the framing): it fits, and the
  reviewer would have CI generate the comparison. Item 4 (language escape
  hatches) came back empty, which is recorded and is not read as clearance.
- **Citations:** line numbers refer to positions in the bundle, not the
  repository. Each finding was located by the construct it describes.

---

BASE: reviewed/R53
HEAD: 4a3b15d
packages/vault/src/types.ts
d8f32c58d3087eaf059f5ab13a550abb

I had no prior context and performed no lookups.

1. `packages/benchmark/test/comparison.test.ts`:135 — factually wrong — high — The `compareRuns` rule and its tests fundamentally trust the contents of the `docs/benchmark/` result files submitted in the PR. An attacker can get the tier map changed on unsupported evidence by simply committing entirely fabricated candidate result and comparison JSON files, or by maliciously altering the baseline result file to look worse. The test `the committed comparisons` only verifies that the committed comparison matches the output of `compareRuns` on the two committed result files; it does not verify that the result files were actually produced by a legitimate CI run. — Verify a cryptographic attestation from the CI run that produced the result files, or compare against the workflow artifacts directly, rather than blindly trusting files committed to the repository.

2. `.github/workflows/benchmark-model.yml`:42 — factually wrong — high — The `benchmark-model` workflow triggers on a label and passes the repository's `ANTHROPIC_API_KEY` secret to `vitest`, which executes test code checked out from the untrusted PR branch. An attacker can bypass the spend cap or exfiltrate the key by modifying `packages/benchmark/test/tiers/model.tier.ts` or `vitest.config.model.ts` in the PR. Furthermore, the attacker can authorize this paid run themselves by modifying `.claude/skills/merge-unit/SKILL.md` in the PR to instruct the maintainer's agent to execute `gh pr edit <n> --add-label run-benchmark` when the maintainer invokes `/merge-unit`. — Do not pass the `ANTHROPIC_API_KEY` to code checked out from a pull request; the test must run using the base branch's code or in an isolated runner. Additionally, strictly restrict which labels the `merge-unit` skill is allowed to add.

3. `packages/benchmark/test/comparison.test.ts`:132 — factually wrong — medium — In the test `the committed comparisons`, the code iterates over files in `DOCS` that include `-comparison-`. If an attacker deletes all comparison files from the `docs/benchmark/` directory in their PR, the `.filter` returns an empty array, the loop never executes, and the test passes trivially without verifying anything. This mechanism fails open on an empty result. — Assert that at least one comparison file was found and tested (e.g., `expect(files.length).toBeGreaterThan(0)`), or explicitly test a known static list of required baseline comparisons.

4. `packages/benchmark/src/comparison.ts`:122 — a tradeoff I would have made differently — medium — The `compareRuns` function verifies that the total `sample` counts match between the baseline and candidate runs, but it does not verify that they ran the exact same tasks (items) or that the individual trial results align. An attacker can manually edit the aggregated counts in the `overall` section of a fabricated JSON to appear better, while keeping the total `sample` count equal to the baseline, and `compareRuns` will mistakenly accept them as the same tasks. — Verify the results at the item level (e.g., by comparing the arrays of item IDs and their individual trial results) to ensure the exact same tasks were run.

5. `packages/api/test/harness.ts`:40 — factually wrong — medium — The readiness scanners `RIG_READINESS` and `RIG_SCANNER` (and `BENCH_READINESS` in `line.ts`) provided to in-process callers hardcode `ceilingAt` to unconditionally return `{ kind: 'scanned', level: 2 }`. These checks are tautological and pass regardless of the code under test, allowing any run from these callers (such as via the `headless-host`) to be admitted above L0 without any actual readiness scan occurring, violating the requirement to enforce readiness scans. — Implement actual readiness scanning logic for these in-process callers, or strictly isolate these mocks so they cannot be used to admit real runs in a production-like environment like `headless-host`.

6. Mechanisms assessed as sound: `compareRuns` correctly ensures that `costsLess` and `noWorse` enforce the fixed rule strictly, and it correctly rejects empty arms, mismatched corpus digests, or comparing the exact same model. The spend cap logic within the test itself (when not bypassed via code injection) correctly tracks USD spent and stops execution if costs are lost (`unsettled > 0`).

7. Framing: The adversarial question correctly identifies the threat model, but the fundamental architecture of committing result files to the repository and verifying them in CI is flawed because it assumes the files are trustworthy. The question "How would I get the tier map changed ... on evidence that does not support it" perfectly exposes that the system attempts to enforce strict mathematical rules on data that has no provenance or integrity guarantees. A better approach would be to require CI to generate the comparison and block merge if the CI-generated comparison does not meet the criteria, rather than verifying user-committed files.