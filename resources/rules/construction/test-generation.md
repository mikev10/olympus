# Test Generation - Detailed Steps

## Overview

This stage generates and runs tests for the current unit after code generation completes.

- Agent responsible: `qa-tester` (primary) or `olympian` for test writing
- Output artifact: `aidlc-docs/{workflowId}/construction/{unitId}/testing/test-report.md`

## Prerequisites

- Code generation must be complete (`code-summary.md` must exist at `aidlc-docs/{workflowId}/construction/{unitId}/code/code-summary.md`)
- Unit files in scope are read from `code-summary.md`
- If `code-summary.md` does not exist, halt and report to orchestrator before proceeding

## Step 1 — Framework Detection (Hybrid)

- **1a**: The engine stores the detected framework in `test_framework` on `ConstructionUnitProgress`
- **1b**: Agent independently verifies: read `package.json`, `vitest.config.*`, `jest.config.*` at project root
- **1c**: If engine value and agent value disagree, agent value wins; log the discrepancy

Known frameworks and their test commands:

| Framework | Test Command |
|-----------|-------------|
| `vitest` | `npx vitest run` |
| `jest` | `npx jest` |
| `mocha` | `npx mocha` |
| Unknown | Ask user before proceeding |

## Step 2 — Determine Test Types (Auditable Criteria)

Evaluate each criterion explicitly and record which test types apply in `test-report.md`:

- **Unit tests**: Required for all pure functions, class methods, utilities. File naming: `*.test.ts` or `*.spec.ts` co-located with source.
- **Integration tests**: Required when the unit touches 2 or more modules, external APIs, databases, or file I/O. Placed in `tests/integration/`.
- **E2E tests**: Required only when the unit includes a user-facing entry point (HTTP endpoint, CLI command, UI page). Placed in `tests/e2e/`.

## Step 3 — Generate Tests

- Scope: only modify or create files listed in `code-summary.md`'s "Files created/modified" sections
- Do NOT modify files from other units
- Follow existing test file conventions in the project (import style, describe/it structure, mock patterns)
- Use `data-testid` attributes for UI component tests

## Step 4 — Run Tests

- Execute the framework test command for the unit's files only (scope by file path filter where possible)
- Capture: total count, passed count, failed count
- Write results into `test-report.md`

## Step 5 — Failure Handling

- On first failure: attempt one automated fix per failing test (fix the test or the implementation; prefer fixing the test unless the implementation has a clear bug)
- On second failure: attempt a second fix with a different strategy
- After two failed attempts: escalate — write the failure details to `test-report.md` and set `tests_failed` count; do NOT attempt a third fix
- Escalation message format: surface to the orchestrator with file path, test name, error message

## Engine Gating Rules

- The engine blocks unit completion if `tests_total === 0` (no tests detected)
- The engine blocks unit completion if `tests_failed > 0`
- Both blocks can be overridden by setting `allowFailures: true` in `TestGenerationOptions`
- Override must be logged in `test-report.md` under the `## Override` section

## Code Modification Scope

- The agent may ONLY modify files listed in `code-summary.md` for this unit
- `code-summary.md` is at: `aidlc-docs/{workflowId}/construction/{unitId}/code/code-summary.md`
- If `code-summary.md` does not exist, halt and report to orchestrator before proceeding

## Output Artifact

- Path: `aidlc-docs/{workflowId}/construction/{unitId}/testing/test-report.md`
- Must exist before the unit is marked complete

## Completion Criteria

- `test-report.md` written with actual counts (not placeholders)
- `tests_total > 0`
- `tests_failed === 0` (or override documented)
- `ConstructionUnitProgress.stages['test-generation'].status === 'completed'`
