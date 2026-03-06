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

1. List all directories under `aidlc-docs/`
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
| user-stories | inception/intent.md, inception/requirements.md, inception/requirements-questions.md |
| workflow-planning | All above + inception/stories.md, inception/personas.md |
| application-design | All above + inception/plans/workflow-routing.md |
| units-generation | All above + inception/application-design/ artifacts |

### Construction Phase Artifacts

Load ALL inception artifacts PLUS:
- `inception/unit-of-work.md` (unit decomposition)
- For the active unit: `construction/{unit-name}/functional-design.md`, `nfr-requirements.md`, `nfr-design.md`, `infrastructure-design.md`, `code-generation.md`
- All completed units' artifacts

### Read `aidlc-state.md`

Always read `aidlc-docs/{workflow_id}/aidlc-state.md` to get the human-readable progress summary.

After loading, provide a brief summary: "Loaded N artifacts from previous stages: [list artifact names]."

---

## Step 4: Determine Resume Point

### 4a. Inception Phase with `inception_stages`

If `current_phase === 'inception'` and `inception_stages` exists:

1. Find the first stage in order that has status `not_started` or `in_progress`:
   - workspace-detection
   - reverse-engineering (brownfield only)
   - requirements-analysis
   - user-stories
   - workflow-planning
   - application-design
   - units-generation

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
| user-stories | `~/.claude/olympus/rules/inception/user-stories.md` |
| workflow-planning | `~/.claude/olympus/rules/inception/workflow-planning.md` |
| application-design | `~/.claude/olympus/rules/inception/application-design.md` |
| units-generation | `~/.claude/olympus/rules/inception/units-generation.md` |
| functional-design | `~/.claude/olympus/rules/construction/functional-design.md` |
| nfr-requirements | `~/.claude/olympus/rules/construction/nfr-requirements.md` |
| nfr-design | `~/.claude/olympus/rules/construction/nfr-design.md` |
| infrastructure-design | `~/.claude/olympus/rules/construction/infrastructure-design.md` |
| code-generation | `~/.claude/olympus/rules/construction/code-generation.md` |

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
| reverse-engineering | `explore-medium` |
| requirements-analysis | `prometheus` |
| application-design | `oracle` |
| units-generation | `olympian` |
| functional-design | `oracle-medium` |
| code-generation | `olympian` or `olympian-high` |
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
