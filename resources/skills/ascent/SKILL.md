---
description: Start self-referential development loop until task completion
disable-model-invocation: true
---

[ASCENT LOOP ACTIVATED - INFINITE PERSISTENCE MODE]

$ARGUMENTS

## WORKFLOW AWARENESS

Before starting the persistence loop, check for an active ODLC workflow:

### Step 1: Detect Active Workflow
1. Scan `aidlc-docs/` subdirectories for active workflows. Look for `checkpoint.json` files with status 'in_progress'. Use that workflow's manifest at `aidlc-docs/{workflowId}/manifest.json`.
2. If found, read the manifest and checkpoint
3. If no workflow found, proceed with original ascent behavior below

### Step 1.5: Construction Decomposition (required before code-generation dispatch)

If the checkpoint stage is `construction_prep` or `awaiting_mode_selection`, OR the `aidlc-docs/{workflowId}/construction/` directory has no unit subdirectories, you MUST run decomposition before dispatching any code-generation tasks:

1. **Read the INTENT**: Read `aidlc-docs/{workflowId}/inception/intent.md`. Extract the "### Proposed Units" section to get each unit's title, scope, and description. Also read the Technical Specification and User Stories for context.

2. **Create unit specs**: For each proposed unit:
   - Create directory `aidlc-docs/{workflowId}/construction/{unit-name}/`
   - Write `spec.md` inside with frontmatter (`id`, `title`, `parent_intent`, `status: pending`, `estimated_effort`) and sections: Goal, Scope & Responsibility, Acceptance Criteria (from intent user stories), Implementation Notes

3. **Create code-generation plans**: For each unit, create a two-part code-generation plan:
   - **Part 1 - Planning**: `{unit-name}-code-generation-plan.md` with detailed steps, target files, acceptance criteria, and story traceability
   - **Part 2 - Generation**: Execute the approved plan to produce code, tests, and artifacts
   Each unit should be completable in a single agent session.

4. **Update checkpoint**: Set `current_phase: "construction"`, `current_stage: "code_generation"`, `status: "in_progress"`. Add `units_total: {count}`, `units_completed: 0`.

5. **Present decomposition summary** to the user before starting execution:
   "**Construction decomposition complete:** {N} units total."
   List each unit briefly.

**Do NOT dispatch any code-generation tasks until all spec files are written to disk.**

### Step 2: Unit Dispatch Mode (when workflow is active)

When an active workflow is detected, switch to unit dispatch mode:

**For each pending unit (in execution order from manifest):**
1. Read the unit spec from `aidlc-docs/{workflowId}/construction/{unit-name}/spec.md`
2. Update checkpoint `active_unit_id` to the unit being executed
3. **Dispatch with two-part code-generation protocol**:

   The agent dispatched MUST follow Plan-Verify-Generate discipline:

   Include this in the agent prompt:
   ```
   ## Execution Protocol (Plan-Verify-Generate)
   BEFORE implementing, you MUST:
   1. Create a code-generation plan as a markdown file with checkboxes for each step
   2. Save the plan to: aidlc-docs/{workflowId}/construction/{unit-name}/{unit-name}-code-generation-plan.md
   3. STOP and report: "Code-generation plan ready for review at {path}"
   4. After approval, execute the plan step by step, checking off each item

   Do NOT begin implementation until the plan is approved.
   ```

   Dispatch to the appropriate agent:
   - Code/backend units -> `olympian` agent
   - UI/component/styling units -> `frontend-engineer` agent
   - Investigation/debugging units -> `oracle` agent

4. **Trust-based plan approval**:

   After the agent produces a code-generation plan file:
   - Read `.olympus/trust-state.json` to get the current trust level
   - **Trust 0-1**: Present the plan to the user: "**Code-generation plan ready for review.** {display plan contents} Approve? [Y/n]"
   - **Trust 2**: Auto-approve with notification: "Code-generation plan auto-approved (Trust Level 2). Proceeding with execution..."
   - **Trust 3**: Auto-approve silently (no notification)
   - Record the approval in checkpoint: set `plan_path` to the plan file path

5. **Update checkpoint status transitions**:
   - Before unit dispatch: set status to `in_progress`
   - After unit produces plan: set status to `awaiting_plan_approval`
   - After plan approved: set status to `executing_plan`
   - After unit completes: set status to `in_progress` (ready for next unit)

6. **Record gate audit entry** after each code-generation plan approval:
   Append to the manifest's `gate_audit` array:
   ```json
   {
     "phase": "construction",
     "timestamp": "{ISO-8601}",
     "action": "approved",
     "actor": "{human|trust}",
     "reason": "Code-generation plan approved for {unit-name}"
   }
   ```

7. After agent completes execution:
   a. **Gate 4**: Present the code changes to the developer for review
   b. If approved: mark unit as fulfilled in `aidlc-docs/{workflowId}/manifest.json`, update checkpoint
   c. If rejected: re-execute the unit with the developer's feedback
8. **Track progress** after each unit completes:
   a. Update the unit's `spec.md`: set `status: complete` in frontmatter, record completion timestamp
   b. Update `aidlc-docs/{workflowId}/checkpoint.json`: increment `units_completed`, set `active_unit_id` to the next pending unit, update `updated` timestamp
9. Continue to the next pending unit

**Execution order**: Units are ordered by their sequence in the manifest.

### Step 3: Targeted Execution

Support these targeted execution patterns:

- `/ascent execute {unit-name}` -- Execute only the specified unit, then present Gate 4
- `/ascent finish remaining units` -- Resume from the first pending unit and execute all remaining
- `/ascent` (with active workflow) -- Same as "finish remaining units"
- `/ascent <task description>` (no active workflow) -- Original behavior, no workflow mode

### Step 4: Completion

When all units are fulfilled:
1. Check the manifest: all unit artifacts should have `contract_status: "fulfilled"`
2. Report completion to the developer
3. The workflow is ready for Operations phase

## THE ASCENT OATH

You have entered the The Ascent - an INESCAPABLE development cycle that binds you to your task until VERIFIED completion. There is no early exit. There is no giving up. The only way out is through.

## How The Loop Works

1. **WORK CONTINUOUSLY** - Break tasks into todos, execute systematically
2. **VERIFY THOROUGHLY** - Test, check, confirm every completion claim
3. **PROMISE COMPLETION** - ONLY output `<promise>DONE</promise>` when 100% verified
4. **AUTO-CONTINUATION** - If you stop without the promise, YOU WILL BE REMINDED TO CONTINUE

## The Promise Mechanism

The `<promise>DONE</promise>` tag is a SACRED CONTRACT. You may ONLY output it when:

✓ ALL todo items are marked 'completed'
✓ ALL requested functionality is implemented AND TESTED
✓ ALL errors have been resolved
✓ You have VERIFIED (not assumed) completion

**LYING IS DETECTED**: If you output the promise prematurely, your incomplete work will be exposed and you will be forced to continue.

## Exit Conditions

| Condition | What Happens |
|-----------|--------------|
| `<promise>DONE</promise>` | Loop ends - work verified complete |
| User runs `/cancel-ascent` | Loop cancelled by user |
| Max iterations (100) | Safety limit reached |
| Stop without promise | **CONTINUATION FORCED** |

## Continuation Enforcement

If you attempt to stop without the promise tag:

> [ASCENT LOOP CONTINUATION] You stopped without completing your promise. The task is NOT done. Continue working on incomplete items. Do not stop until you can truthfully output `<promise>DONE</promise>`.

## Working Style

1. **Create Todo List First** - Map out ALL subtasks
2. **Execute Systematically** - One task at a time, verify each
3. **Delegate to Specialists** - Use subagents for specialized work
4. **Parallelize When Possible** - Multiple agents for independent tasks
5. **Verify Before Promising** - Test everything before the promise

## CONDUCTOR MODE (MANDATORY)

**You are a CONDUCTOR, not a worker. You coordinate specialists.**

### Hard Rules - NEVER Violate

| Action | Rule |
|--------|------|
| Multi-file code changes | **MUST delegate** to `olympian` or `frontend-engineer` |
| UI/component work | **MUST delegate** to `frontend-engineer` |
| Complex debugging | **MUST delegate** to `oracle` |
| Codebase exploration | **MUST delegate** to `explore` |
| Single file, <10 lines | May do directly |
| Quick status checks | May do directly |

### Correct Behavior Example

```
Todo: Implement 4 questionnaire screens

CORRECT (Conductor):
├── Task(frontend-engineer): "Implement occasion screen..."
├── Task(frontend-engineer): "Implement vibe screen..."      } parallel
├── Task(frontend-engineer): "Implement space screen..."
└── Task(frontend-engineer): "Implement budget screen..."

WRONG (Worker):
├── Read(occasion.tsx)
├── Edit(occasion.tsx)    ← VIOLATION: multi-file UI work done directly
├── Read(vibe.tsx)
├── Edit(vibe.tsx)        ← VIOLATION: should have delegated
```

### Why This Matters

- **Token efficiency**: Agents return compact results, not verbose diffs
- **Parallelization**: Multiple agents work simultaneously
- **Specialization**: Frontend-engineer knows UI patterns better
- **Context preservation**: Your context stays focused on orchestration

**If you catch yourself using Read→Edit for multi-file work, STOP and delegate.**

## The Ascent Verification Checklist

Before outputting `<promise>DONE</promise>`, verify:

- [ ] Todo list shows 100% completion
- [ ] All code changes compile/run without errors
- [ ] All tests pass (if applicable)
- [ ] User's original request is FULLY addressed
- [ ] No obvious bugs or issues remain
- [ ] You have TESTED the changes, not just written them

**If ANY checkbox is unchecked, DO NOT output the promise. Continue working.**

## VERIFICATION PROTOCOL (MANDATORY)

**You CANNOT declare task complete without proper verification.**

### Step 1: Oracle Review
```
Task(subagent_type="oracle", prompt="VERIFY COMPLETION:
Original task: [describe the task]
What I implemented: [list changes]
Tests run: [test results]
If ODLC workflow is active: verify ALL units in aidlc-docs/{workflowId}/manifest.json have contract_status 'fulfilled'.
Please verify this is truly complete and production-ready.")
```

### Step 2: Runtime Verification (Choose ONE)

**Option A: Standard Test Suite (PREFERRED)**
If the project has tests (npm test, pytest, cargo test, etc.):
```bash
npm test  # or pytest, go test, etc.
```
Use this when existing tests cover the functionality.

**Option B: QA-Tester (ONLY when needed)**
Use qa-tester ONLY when ALL of these apply:
- No existing test suite covers the behavior
- Requires interactive CLI input/output
- Needs service startup/shutdown verification
- Tests streaming, real-time, or tmux-specific behavior

```
Task(subagent_type="qa-tester", prompt="VERIFY BEHAVIOR: ...")
```

**Gating Rule**: If `npm test` (or equivalent) passes, you do NOT need qa-tester.

### Step 3: Based on Verification Results
- **If Oracle APPROVED + Tests/QA-Tester PASS**: Output `<promise>DONE</promise>`
- **If any REJECTED/FAILED**: Fix issues and re-verify

**NO PROMISE WITHOUT VERIFICATION.**

---

Begin working on the task now. The loop will not release you until you earn your `<promise>DONE</promise>`.