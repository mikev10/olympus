---
description: Resume an active AIDLC workflow from checkpoint
disable-model-invocation: true
---

# Workflow Continuity - Resume Active AIDLC Workflow

You are resuming an existing AI-DLC (AIDLC) workflow. Your job is to restore full context from the checkpoint and prior artifacts, then continue execution from exactly where it left off - with all behavioral rules active.

## Input

```
$ARGUMENTS
```

---

## Step 1: Locate the Checkpoint

### 1a. If $ARGUMENTS contains a path

If the input above is a file path (contains `/` or `\` or ends in `.json`), treat it as the checkpoint path. Read that file directly.

### 1b. If $ARGUMENTS is empty or not a path

Auto-detect by scanning `aidlc-docs/` subdirectories:

1. List all directories under `aidlc-docs/` (excluding `completed/`, which contains archived workflows)
2. For each, check if `checkpoint.json` exists
3. Read each checkpoint and filter to those with `status` NOT equal to `complete` or `archived`
4. If exactly one active workflow found: use it
5. If multiple active workflows found: present a numbered list and ask the user to choose:
   ```
   Multiple active workflows found:
   1. {feature_name} - {current_phase}/{current_inception_stage || current_stage} (last updated: {updated_at})
   2. {feature_name} - {current_phase}/{current_inception_stage || current_stage} (last updated: {updated_at})

   Which workflow would you like to resume? Enter the number.
   ```
6. If no active workflows found: display "No active workflows found. Start one with `/plan <description>`." and stop.

### 1c. Read the checkpoint

Parse the checkpoint.json. Extract these fields:
- `workflow_id`
- `feature_name`
- `current_phase` (discovery | inception | construction | operations)
- `current_stage` (intent | unit | code-generation | complete)
- `status`
- `pathway_type` (greenfield | brownfield-enhancement | brownfield-refactor | bugfix | optimization)
- `inception_stages` (if present - maps inception stage names to their state)
- `current_inception_stage` (if present)
- `resume_context` (if present)
- `updated_at`
- `construction_units` (if present)

---

## Step 2: Load AIDLC Behavioral Rules (MANDATORY)

**CRITICAL**: You MUST read and internalize ALL of these rule files before proceeding. These rules govern how you interact with the user throughout the workflow. Do NOT skip this step.

Read these files now:

1. `~/.claude/olympus/rules/common/session-continuity.md` - Session resume templates and artifact loading rules
2. `~/.claude/olympus/rules/common/question-format-guide.md` - ALL questions go in .md files with [Answer]: tags, NEVER inline
3. `~/.claude/olympus/rules/common/content-validation.md` - Mermaid/ASCII validation, markdown standards
4. `~/.claude/olympus/rules/common/process-overview.md` - Three-phase lifecycle overview

These rules are NON-NEGOTIABLE. Key constraints:
- **Questions**: NEVER ask questions in chat. ALL questions go in dedicated .md files with multiple-choice format and [Answer]: tags.
- **Approval gates**: NEVER auto-advance past a stage. Always present completion message and wait for explicit user approval.
- **Audit logging**: Append EVERY interaction to `aidlc-docs/{workflow_id}/audit.md` with ISO-8601 timestamps. NEVER overwrite audit.md.
- **Dual state tracking**: Update BOTH `checkpoint.json` AND `aidlc-state.md` on every stage transition.
- **Checkpoint persistence**: Save checkpoint after each stage completion.

---

## Step 3: Load Previous Stage Artifacts

Follow the artifact loading rules from `session-continuity.md`. Based on the current stage, load ALL relevant prior artifacts:

### Inception Phase Artifacts (load progressively)

| If resuming at... | Load these artifacts from `aidlc-docs/{workflow_id}/` |
|---|---|
| workspace-detection | (none needed) |
| reverse-engineering | inception/intent.md (if exists) |
| requirements-analysis | inception/intent.md, reverse-engineering artifacts (if brownfield) |
| workflow-planning | inception/intent.md, inception/requirements/requirements.md, inception/requirements/requirements-analysis-questions.md |
| units-generation | All above + inception/plans/workflow-routing.md |
| user-stories | All above + inception/units/unit-of-work.md, inception/units/{UNIT-NNN-slug}/unit-brief.md (per-unit briefs) |
| bolt-planning | All above + inception/units/{UNIT-NNN-slug}/stories/ (per-unit story files) or inception/user-stories/stories.md (fallback), inception/user-stories/personas.md, inception/units/unit-of-work-story-map.md, construction/{UNIT-NNN}/bolts/ spec.md files (if any exist) |

### Construction Phase Artifacts

Load ALL inception artifacts PLUS:
- `inception/units/unit-of-work.md` (unit decomposition)
- For the active unit: `construction/UNIT-NNN-name/functional-design.md`, `nfr-requirements.md`, `nfr-design.md`, `infrastructure-design.md`, `code-generation.md` (e.g., `construction/UNIT-001-foundation/functional-design.md`)
- All completed units' artifacts

### Read `aidlc-state.md`

Always read `aidlc-docs/{workflow_id}/aidlc-state.md` to get the human-readable progress summary.

After loading, provide a brief summary: "Loaded N artifacts from previous stages: [list artifact names]."

### 3b. MANDATORY: Create In-Session Task List

**CRITICAL**: After loading artifacts, you MUST create an in-session task list (using TodoWrite/TaskCreate) with all pipeline stages as items. This provides real-time visual progress tracking in the terminal.

**For Inception Phase resumption**, create tasks for:

- Workspace Detection (Step 5)
- Reverse Engineering (Step 6)
- Requirements Analysis (Step 7)
- Workflow Planning (Step 8)
- Units Generation (Step 9)
- User Stories (Step 10)
- Bolt Planning (Step 11)
- Inception Complete — Final Audit and Mode Choice (Step 12)

**For Construction Phase resumption**, create tasks for:

- Each remaining unit of work (by name/ID)
- Build and Test
- Documentation
- Construction Complete

**Rules**:
- Mark already-completed stages as **completed** immediately when creating the list
- Mark the current resumption stage as **in_progress**
- Mark remaining stages as **pending**
- Update task status in real-time as you progress through stages
- This is IN ADDITION TO the file-based tracking (`aidlc-state.md`, `checkpoint.json`) — both must be updated

---

## Step 4: Determine Resume Point

### 4a. Inception Phase with `inception_stages`

If `current_phase === 'inception'` and `inception_stages` exists:

1. Find the first stage in order that has status `not_started` or `in_progress`:
   - workspace-detection
   - reverse-engineering (brownfield only)
   - requirements-analysis
   - workflow-planning
   - units-generation
   - user-stories
   - bolt-planning

2. If a stage is `in_progress` with `questions_file` set: resume Q&A for that stage (do NOT regenerate the questions file - read the existing one and check for unanswered [Answer]: tags).

3. If a stage is `in_progress` without `questions_file`: resume execution of that stage.

### 4b. Inception Phase without `inception_stages` (legacy)

If `current_phase === 'inception'` but no `inception_stages`:
- If `current_stage === 'intent'`: treat as early inception, resume at requirements-analysis
- Otherwise: resume at the `current_stage`

### 4c. Construction Phase

If `current_phase === 'construction'`:
- Check `construction_units` for the active unit
- Determine which design stage is `in_progress` or `not_started`
- Resume from that point
- If a `construction_units` entry has `stages['test-generation'].status === 'in_progress'` or `test_generation_status === 'in_progress'`, resume at test-generation for that unit
- Note: test-generation runs after code-generation for each unit; check `test_generation_status` in the unit progress
- **Mid-bolt resume**: If the checkpoint has `active_bolt_id` set (non-null), a bolt execution was interrupted. Resume from `active_bolt_stage` for that bolt. Determine the parent unit from the bolt's `parent_unit` field in `construction_bolts`, then load the bolt spec at `construction/{parent_unit_id}/bolts/{active_bolt_id}/spec.md` and continue execution from the interrupted stage (`elaboration`, `code_generation`, `build_and_test`, or `review`). Do not re-run completed bolt stages.

### 4d. Other Phases

For discovery or operations: resume at the `current_stage`.

---

## Step 5: Load Stage-Specific Rule File

Based on the resume point determined in Step 4, read the corresponding rule file:

| Stage | Rule file to load |
|---|---|
| workspace-detection | `~/.claude/olympus/rules/inception/workspace-detection.md` |
| reverse-engineering | `~/.claude/olympus/rules/inception/reverse-engineering.md` |
| requirements-analysis | `~/.claude/olympus/rules/inception/requirements-analysis.md` |
| workflow-planning | `~/.claude/olympus/rules/inception/workflow-planning.md` |
| units-generation | `~/.claude/olympus/rules/inception/units-generation.md` |
| user-stories | `~/.claude/olympus/rules/inception/user-stories.md` |
| bolt-planning | `~/.claude/olympus/rules/inception/bolt-planning.md` |
| functional-design | `~/.claude/olympus/rules/construction/functional-design.md` |
| nfr-requirements | `~/.claude/olympus/rules/construction/nfr-requirements.md` |
| nfr-design | `~/.claude/olympus/rules/construction/nfr-design.md` |
| infrastructure-design | `~/.claude/olympus/rules/construction/infrastructure-design.md` |
| code-generation | `~/.claude/olympus/rules/construction/code-generation.md` |
| test-generation | `~/.claude/olympus/rules/construction/test-generation.md` |

---

## Step 6: Present Welcome Back Prompt

Display this to the user:

```
**Welcome back! You have an existing AI-DLC workflow in progress.**

Based on your checkpoint, here's your current status:
- **Project**: {feature_name}
- **Workflow ID**: {workflow_id}
- **Current Phase**: {current_phase}
- **Current Stage**: {resume_stage_name}
- **Pathway**: {pathway_type}
- **Last Updated**: {updated_at}

**Artifacts loaded**: {count} files from previous stages

**What would you like to do?**

A) Continue where you left off ({resume_stage_description})
B) Review a previous stage before continuing

[Answer]:
```

Wait for user response before proceeding.

---

## Step 7: Execute

### If user chose A (Continue)

1. Log the continuity prompt in `audit.md` with timestamp
2. Execute the current stage following the loaded rule file instructions
3. Follow ALL behavioral rules: question format, approval gates, dual state tracking, audit logging
4. Delegate to the appropriate Olympus agent per the delegation table:

| Stage | Agent |
|---|---|
| reverse-engineering | `explore-medium` + `multimodal-looker` (optional, for diagrams) |
| requirements-analysis | `metis` (optional blind spot analysis) |
| units-generation | `olympian` + `momus` (optional review gate) |
| user-stories | `oracle-medium` |
| functional-design | `oracle-medium` |
| nfr-requirements | `oracle-medium` + `librarian` (optional tech validation) |
| nfr-design | `oracle-medium` |
| infrastructure-design | `oracle-medium` |
| code-generation (backend) | `olympian` or `olympian-high` |
| code-generation (frontend) | `frontend-engineer` or `frontend-engineer-high` |
| test-generation | `qa-tester` |
| build-and-test | `qa-tester` |

### If user chose B (Review)

1. Ask which stage they want to review (present list of completed stages)
2. Display the artifacts from that stage
3. After review, return to the "Continue where you left off" option

---

## Behavioral Reminders (Active Throughout)

These rules from the common rule files remain active for the ENTIRE session:

1. **Question Format**: All questions in .md files, multiple choice with [Answer]: tags. NEVER ask questions in chat.
2. **Approval Gates**: After completing any stage, present the standardized completion message from that stage's rule file. Wait for explicit user approval before advancing.
3. **Audit Logging**: Append every user input and AI response to `aidlc-docs/{workflow_id}/audit.md` with ISO-8601 timestamps. Capture complete raw input, never summarize.
4. **Dual State Tracking**: Update both `checkpoint.json` and `aidlc-state.md` on every stage transition.
5. **Agent Delegation**: Delegate to Olympus agents per the delegation table in CLAUDE.md. Do NOT implement multi-file changes directly.
6. **Content Validation**: Validate Mermaid diagrams, ASCII art, and markdown before writing files.
7. **No Emergent Behavior**: Construction phases use standardized 2-option completion messages only.
