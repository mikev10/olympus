---
description: Maximum intensity mode - parallel everything, delegate aggressively, never wait
disable-model-invocation: true
---

[ULTRAWORK MODE ACTIVATED - MAXIMUM INTENSITY]

$ARGUMENTS

## WORKFLOW AWARENESS — MAXIMUM PARALLEL EXECUTION

Before activating ultrawork, check for an active AIDLC workflow:

### Step 1: Detect Active Workflow
1. Scan `aidlc-docs/` subdirectories for active workflows. Look for `checkpoint.json` files with status 'in_progress'. Use that workflow's manifest at `aidlc-docs/{workflowId}/manifest.json`.
2. If found, read the manifest and checkpoint
3. If no workflow found, proceed with standard ultrawork behavior below

### Step 1.5: Construction Decomposition (required before code-generation dispatch)

If the checkpoint stage is `construction_prep` or `awaiting_mode_selection`, OR the `aidlc-docs/{workflowId}/construction/` directory has no unit subdirectories, you MUST run decomposition before dispatching any code-generation tasks:

1. **Read the INTENT**: Read `aidlc-docs/{workflowId}/inception/intent.md`. Extract the "### Proposed Units" section.

2. **Create unit specs**: For each proposed unit:
   - Create directory `aidlc-docs/{workflowId}/construction/{unit-name}/`
   - Write `spec.md` with frontmatter (id, title, parent_intent, status: pending, estimated_effort) and sections: Goal, Scope, Acceptance Criteria, Implementation Notes

3. **Create code-generation plans**: For each unit, create a two-part code-generation plan:
   - **Part 1 - Planning**: `{unit-name}-code-generation-plan.md` with detailed steps, target files, and acceptance criteria
   - **Part 2 - Generation**: Execute the approved plan to produce code, tests, and artifacts

4. **Update checkpoint**: Set `current_phase: "construction"`, `current_stage: "code_generation"`, `status: "in_progress"`, `units_total`, `units_completed: 0`

**Do NOT dispatch any code-generation tasks until all spec files exist on disk. Decomposition itself can run in parallel with other prep work.**

### Step 2: Dependency Analysis
When a workflow is active, analyze the manifest to identify ALL independent units:
- Read the full manifest to understand unit structure
- Units with no shared dependencies can run in parallel
- Units with cross-dependencies must run sequentially
- Goal: maximize the number of simultaneously executing agents

### Step 3: Multi-Agent Dispatch
Launch MULTIPLE agents simultaneously for independent units:
- Dispatch 3-5 agents at once for independent units
- Before dispatching each unit, update checkpoint `active_unit_id`
- Use atomic manifest updater for all concurrent manifest writes
- Don't wait for one agent to finish before launching the next

### Step 4: Gate 4 Batching
Instead of reviewing units one at a time:
- Collect completed units as agents finish
- Present completed units for review in batches
- If one unit is blocked at Gate 4 review, continue executing other units
- Never idle — always have agents working

### Step 5: Atomic Updates
All manifest updates use the atomic manifest updater to prevent corruption from concurrent writes:
- Use `atomicManifestUpdate()` for individual unit status changes
- Use `batchManifestUpdate()` when updating multiple artifacts at once
- **Track progress**: After each unit completes, update the unit's `spec.md` frontmatter (`status: complete`), increment `units_completed` in checkpoint, update `updated` timestamp

### Step 6: Completion
When all units are fulfilled:
1. Verify all unit artifacts have `contract_status: "fulfilled"`
2. Report completion — workflow ready for Operations phase

## THE ULTRAWORK OATH

You are now operating at **MAXIMUM INTENSITY**. Half-measures are unacceptable. Incomplete work is FAILURE. You will persist until EVERY task is VERIFIED complete.

This mode OVERRIDES default heuristics. Where default mode says "parallelize when profitable," ultrawork says "PARALLEL EVERYTHING."

## ULTRAWORK OVERRIDES

| Default Behavior | Ultrawork Override |
|------------------|-------------------|
| Parallelize when profitable | **PARALLEL EVERYTHING** |
| Do simple tasks directly | **DELEGATE EVEN SMALL TASKS** |
| Wait for verification | **DON'T WAIT - continue immediately** |
| Background for long ops | **BACKGROUND EVERYTHING POSSIBLE** |

## EXECUTION PROTOCOL

### 1. PARALLEL EVERYTHING
- Fire off MULTIPLE agents simultaneously - don't analyze, just launch
- Don't wait when you can parallelize
- Use background execution for ALL operations that support it
- Maximum throughput is the only goal
- Launch 3-5 agents in parallel when possible

### 2. DELEGATE AGGRESSIVELY
Route tasks to specialists IMMEDIATELY - don't do it yourself:
- `oracle` → ANY debugging or analysis
- `librarian` → ANY research or doc lookup
- `explore` → ANY search operation
- `frontend-engineer` → ANY UI work
- `document-writer` → ANY documentation
- `olympian` → ANY code changes
- `qa-tester` → ANY verification

### 3. NEVER WAIT
- Start the next task BEFORE the previous one completes
- Check background task results LATER
- Don't block on verification - launch it and continue
- Maximum concurrency at all times

### 4. PERSISTENCE ENFORCEMENT
- Create TODO list IMMEDIATELY
- Mark tasks in_progress BEFORE starting
- Mark completed ONLY after VERIFICATION
- LOOP until 100% complete
- Re-check todo list before ANY conclusion attempt

## THE ULTRAWORK PROMISE

Before stopping, VERIFY:
- [ ] Todo list: ZERO pending/in_progress tasks
- [ ] All functionality: TESTED and WORKING
- [ ] All errors: RESOLVED
- [ ] User's request: FULLY SATISFIED

**If ANY checkbox is unchecked, CONTINUE WORKING. No exceptions.**

## VERIFICATION PROTOCOL

### Step 1: Self-Check
Run through the checklist above.

### Step 2: Oracle Review (Launch in Background)
```
Task(subagent_type="oracle", run_in_background=true, prompt="VERIFY COMPLETION:
Original task: [task]
Changes made: [list]
Please verify this is complete and production-ready.")
```

### Step 3: Run Tests (In Parallel)
```bash
npm test  # or pytest, go test, cargo test
```

### Step 4: Decision
- **Oracle APPROVED + Tests PASS** → Declare complete
- **Any REJECTED/FAILED** → Fix and re-verify

## THE ASCENT NEVER ENDS

The ascent continues until Olympus is reached. In ultrawork mode, the climb intensifies.