# V5 Prompt Strategy

> Copy-paste prompts for each phase of `v5-rules-templates-plan.md`.
> Keep prompts simple — the plan and architecture doc are the source of truth.
> Compatible skills: `/olympus`, `/ultrawork`, `/ascent`
> Do NOT use: `/plan`, `/continue` (these trigger the old AIDLC pipeline)

---

## Phase 0: Setup

```
Read v5-rules-templates-plan.md, specifically Approach and Phase 0.

Execute the setup steps:
1. Rename resources/ to _v4-reference/
2. Create the clean directory structure for resources/rules/ and resources/templates/
3. Verify _v4-reference/ has all original files preserved

Do not proceed beyond Phase 0.
```

---

## Phase 1: Common Rules

```
Read v5-rules-templates-plan.md Approach AND Phase 1 AND aidlc-v5-architecture.md in full.

We are starting Phase 1: Common Rules. Create the in-session task list for
all Phase 1 tasks.

Work through each task ONE AT A TIME. After writing each file, present it
for my review. Do not proceed to the next task until I approve.

For each file:
- Read the corresponding v4 file from _v4-reference/ first
- Write the new version based on the v5 architecture
- Reference only v5 terminology and structure

Start with the first task: core-workflow.md
```

---

## Phase 2: Inception Rules

```
Read v5-rules-templates-plan.md (Phase 2) and aidlc-v5-architecture.md in full.

We are starting Phase 2: Inception Rules. Create the in-session task list
for all Phase 2 tasks.

Work through each task ONE AT A TIME. After writing each file, present it
for my review. Do not proceed to the next task until I approve.

For each file:
- Read the corresponding v4 file from _v4-reference/ first
- Read the relevant common rules from resources/rules/common/ (already approved)
- Write the new version based on the v5 architecture
- Include the stage checkpoint (who reviews, what they check)

Start with the first task: inception/workspace-detection.md
```

---

## Phase 3: Inception Templates

```
Read v5-rules-templates-plan.md (Phase 3) and aidlc-v5-architecture.md in full.

We are starting Phase 3: Inception Templates. Create the in-session task
list for all Phase 3 tasks.

Work through each task ONE AT A TIME. After writing each file, present it
for my review. Do not proceed to the next task until I approve.

For each template:
- Read the corresponding v4 template from _v4-reference/ first
- Read the approved inception rule that references this template
- Ensure YAML frontmatter matches the architecture doc's common frontmatter pattern
- Use {placeholder} syntax for variable values
- Include HTML comments explaining each section's purpose

Start with the first task: inception/intent-template.md
```

---

## Phase 4: Construction Rules

```
Read v5-rules-templates-plan.md (Phase 4) and aidlc-v5-architecture.md in full.

We are starting Phase 4: Construction Rules. Create the in-session task
list for all Phase 4 tasks.

Work through each task ONE AT A TIME. After writing each file, present it
for my review. Do not proceed to the next task until I approve.

For each file:
- Read the corresponding v4 file from _v4-reference/ first (if one exists)
- Read the relevant common rules from resources/rules/common/ (already approved)
- Write the new version based on the v5 architecture
- Include the stage checkpoint (who reviews, what they check)
- For the orchestrator (unit-design.md), reference individual rules by filename

Start with the first task: construction/unit-design.md (orchestrator)
```

---

## Phase 5: Construction Templates

```
Read v5-rules-templates-plan.md (Phase 5) and aidlc-v5-architecture.md in full.

We are starting Phase 5: Construction Templates. Create the in-session task
list for all Phase 5 tasks.

Work through each task ONE AT A TIME. After writing each file, present it
for my review. Do not proceed to the next task until I approve.

For each template:
- Read the corresponding v4 template from _v4-reference/ first
- Read the approved construction rule that references this template
- Ensure YAML frontmatter matches the architecture doc's common frontmatter pattern
- Use {placeholder} syntax for variable values
- Include HTML comments explaining each section's purpose
- For bolt-spec-template.md, handle both outlined and refined states

Start with the first task: construction/functional-design-template.md
```

---

## Phase 6: Cross-Validation

```
Read v5-rules-templates-plan.md (Phase 6) and aidlc-v5-architecture.md in full.

We are starting Phase 6: Cross-Validation. Create the in-session task list
for all Phase 6 tasks.

Work through each check ONE AT A TIME. Present findings for my review
before proceeding. Do NOT auto-fix issues — report them and wait for my
direction.

Start with the first check: Folder structure walk.
```

---

## Recommended Skills Per Phase

| Phase | Skill | Why |
|-------|-------|-----|
| **Phase 0: Setup** | None | Just file renames and mkdir — no orchestration needed |
| **Phase 1: Common Rules** | `/ascent` | 12+ files, sequential approval. Persistence keeps momentum between tasks. |
| **Phase 2: Inception Rules** | `/ascent` | 7 files, same pattern. |
| **Phase 3: Inception Templates** | `/ascent` | 10 files, sequential. |
| **Phase 4: Construction Rules** | `/ascent` | 10 files, most complex phase. Persistence is critical. |
| **Phase 5: Construction Templates** | `/ascent` | 5 files, straightforward. |
| **Phase 6: Cross-Validation** | `/ascent /ultrawork` | Multiple independent checks — ultrawork parallelizes verification, ascent ensures all checks complete. |

**Why not `/olympus`?** It adds agent delegation rules useful for code tasks, but for writing markdown rule files the main model working directly with your per-task approval is the right fit.

**How to use:** Prefix the phase prompt with the skill command:

```
/ascent
[paste phase prompt here]
```

For Phase 6:
```
/ascent /ultrawork
[paste phase prompt here]
```

---

## Session Continuity

If a session ends mid-phase, use this prompt to resume:

```
Read v5-rules-templates-plan.md and aidlc-v5-architecture.md in full.

We are resuming Phase [N]: [Phase Name]. Check the in-session task list
to see which tasks are completed and which are pending.

Continue with the next pending task. Same rules apply: one task at a time,
present for review, wait for approval.
```
