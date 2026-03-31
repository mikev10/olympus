---
description: Generate structured intent briefs as pre-elaboration inputs for /plan workflows and Mob Elaboration sessions. Use this skill when users want to create intent briefs, prepare inputs for /plan, document what needs to be built before starting AI-DLC, prepare for Mob Elaboration, create pre-elaboration documents, capture feature intent, or scope work items. Trigger on phrases like "create a brief", "intent brief", "prepare for /plan", "pre-elaborate", "what should we build", "capture intent", "scope this work", "prepare for elaboration", or when users want to document a feature or change request before starting a full planning workflow. Also trigger when users have a list of items they want to inventory, prioritize, and prepare for team review — even if they don't use the word "brief" explicitly.
---

# Intent Brief Generator

You help teams capture the "what" and "why" before diving into the "how." Intent briefs are lightweight, structured documents that serve as high-quality inputs to `/plan` workflows and Mob Elaboration sessions. They live in `.olympus/briefs/` as pre-workflow artifacts — created before any AI-DLC workflow exists.

## MANDATORY: Question Format

**CRITICAL**: Load and follow `resources/rules/common/question-format-guide.md` for ALL questions. You must NEVER ask questions directly in chat. ALL questions must be placed in dedicated question files using the multiple-choice format defined in the guide.

## Input

```
$ARGUMENTS
```

---

## Mode Detection

Determine which mode to run based on the input:

- **`--batch`** flag or input contains a list of items → **Batch Mode**
- Everything else → **Single Mode**

If the input already contains substantial context (e.g., the user pasted a feature description, a ticket, or a problem statement), extract what you can and pre-fill it — then only ask questions for the gaps via question files.

### Thin-Context Handling

When the input is vague or minimal (e.g., "we need password reset" with no further detail), don't generate a brief full of assumptions. Instead:

1. **Generate the brief anyway** — a brief with "Unknown" sections is better than no brief. Fill in what you can reasonably infer from the request itself.
2. **Mark unknowns explicitly** — for each unknown section, include the specific questions you would have asked. This turns the brief into a structured interview guide for the next conversation. Example: "Unknown — Who is requesting this? What is the business impact? Is there a deadline?"
3. **Invest in Notes for Elaboration** — when context is thin, this section becomes the most valuable part of the brief. List the open questions, risks, and decisions the elaboration team needs to resolve.

The goal is that even a thin-context brief is useful — it captures what is known, makes the unknowns visible, and gives the team a structured starting point for discussion.

---

## Single Mode

### Step 1: Extract Context from Input

Before creating questions, analyze the user's input to extract everything you already know. If the input contains substantial context (a feature description, ticket, problem statement), pre-fill what you can. This reduces the number of questions the user needs to answer.

Capture from input:
- Stakeholder names and their relationship to the request
- Implicit constraints ("we're on .NET 6" or "this is a legacy iFrame")
- Dependencies between this work and other known work
- Urgency signals ("Mario asked for this", "blocking 3 accounts")
- Project type signals (greenfield vs brownfield)

### Step 2: Create the Question File

Create a question file following the format in `resources/rules/common/question-format-guide.md`.

**File location:** `.olympus/briefs/{kebab-case-name}-questions.md`

Generate questions that map to the brief template sections. Skip questions where the input already provides a clear answer — pre-fill those into your context and note them at the top of the question file as "Pre-filled from input."

**Question bank** — include all that are relevant, skip what's already known:

1. **Intent** — "What best describes the core intent?" Frame options around: "We need to [what] so that [who] can [outcome], because today [pain point]." Push for specificity. `(select one)`

2. **Primary audience** — "Who is the primary audience for this work?" Options based on likely personas from the input. `(select one)`

3. **Secondary audiences** — "Who else is affected by or benefits from this work?" `(select all that apply)`

4. **Success criteria** — "What does success look like?" Directional outcomes, not precise metrics. Keep options outcome-focused, not implementation-focused. `(select all that apply)`

5. **Scope signals (in scope)** — "Which capabilities are in scope?" High-level capabilities the user expects. `(select all that apply)`

6. **Scope boundaries (out of scope)** — "What is explicitly out of scope?" Critical for preventing AI over-scoping during Inception. `(select all that apply)`

7. **Technical constraints** — "What technical constraints apply?" Platform, framework, database, API limitations. `(select all that apply)`

8. **Business/organizational constraints** — "What business or organizational constraints apply?" Team capacity, deadlines, approval gates. `(select all that apply)`

9. **Compliance/security constraints** — "What compliance or security constraints apply?" Data handling, access control, regulatory requirements. `(select all that apply)`

10. **Project type** — "Is this a new project or existing codebase?" `(select one)`

11. **Existing system context** — For brownfield: "What describes the current system landscape?" System architecture, integration points, known tech debt. `(select all that apply)`

12. **Dependencies and risks** — "What could block this work?" `(select all that apply)`

13. **Non-functional requirements** — "Which NFRs are relevant?" Performance, availability, scalability, accessibility, observability. `(select all that apply)`

14. **Stakeholders for Mob Elaboration** — "Who needs to be in the Mob Elaboration room?" `(select all that apply)`

15. **Open pre-inception questions** — "Are there questions that must be answered BEFORE Mob Elaboration?" `(select all that apply)`

16. **Priority** — "How does this rank relative to other work?" `(select one)`

**Question generation guidelines:**
- Only include questions where the answer is NOT already clear from the input
- For questions you do include, craft meaningful options based on what you know about the context — don't use generic filler options
- Always include "Other" as the last option (MANDATORY per question-format-guide)
- Always include `[Recommendation]:` with reasoning before `[Answer]:`
- Always include selection type `(select one)` or `(select all that apply)`

### Step 3: Inform User and Wait

Tell the user the question file has been created, how many questions it contains, and where to find it. Wait for the user to confirm they've completed their answers ("done", "completed", "finished", or similar).

### Step 4: Read, Validate, and Analyze Answers

1. Read the question file
2. Extract answers after `[Answer]:` tags
3. Validate all questions are answered — if any are empty, ask the user to complete them
4. Check for contradictions and ambiguities per the question-format-guide
5. If contradictions found, create a clarification file at `.olympus/briefs/{kebab-case-name}-clarification-questions.md` and wait for resolution

### Step 5: Generate the Brief

Once all answers are validated and contradictions resolved, generate the brief.

Create the directory if needed, then write the brief:

**File location:** `.olympus/briefs/{kebab-case-name}.md`

**Template:** Read and use the template at `resources/skills/brief/templates/ai-dlc-intent-brief-template.md`. Fill in each section based on the user's answers and any context extracted in Step 1. For sections where you have no information:
- Replace placeholder text with "Unknown" followed by the specific questions that would need to be answered
- For tables, keep the header row and add a single row with "Unknown — [what needs to be determined]"
- Remove the instructional italics and example text, replacing them with actual content

**Metadata mapping:**
- **Author** → from answers or "Unknown"
- **Last Updated** → current ISO date
- **Status** → "Draft" (always for new briefs)
- **Project Type** → "Greenfield" or "Brownfield" based on answers

After writing, confirm the file path and offer:
- "Want to adjust anything before we finalize?"
- "Ready to create another brief, or is this the only one?"

---

## Batch Mode

Batch mode is for when the user has a list of work items they want to turn into briefs — like a set of pages to update, features to scope, or tickets to prepare for elaboration.

### Step 1: Accept the List

The user provides their list — pasted text, a file reference, or typed out. Accept any reasonable format. Your job is to parse it into discrete items.

Confirm the list back: "I see N items. Here's what I've got: [list]. Does this look right, or did I miss/misinterpret anything?"

### Step 2: Lightweight Interview

Don't run the full 16-question interview for each item — that would take forever with a large list. Instead, create a single consolidated question file.

**File location:** `.olympus/briefs/batch-questions.md`

Structure the question file in two parts:

1. **Shared context questions** — things that apply to all items (e.g., stakeholder, common motivation, shared constraints, project type, compliance requirements). Ask these once.

2. **Per-item questions** — for each item, ask only what's unique: the intent and any item-specific context. If items are similar (e.g., "update iFrame for billing page" and "update iFrame for schedule page"), template the question structure and ask about differences.

3. **Infer where possible** — if the user says "Mario requested the first 5", don't ask about stakeholder for each of those 5. Note inferences at the top of the file as "Pre-filled from input."

Follow the question-format-guide for all questions (multiple-choice, `[Recommendation]:`, `[Answer]:` tags, "Other" as last option). Inform the user, then wait for completion before proceeding.

### Step 3: Prioritize

Help the user sequence the items. Ask about:

- **Business value** — Which items deliver the most impact?
- **Urgency** — Are any time-sensitive or blocking other work?
- **Dependencies** — Do any items need to be done before others?
- **Stakeholder priority** — Has anyone already indicated an order?

If the user already has a priority order, confirm it rather than re-deriving it.

**Partial priority ordering:** When some items have an explicit priority (e.g., "Mario requested the first 3") but others don't, preserve the explicit ordering for those items and sequence the remaining items using dependency analysis and risk assessment. Explain your reasoning for the inferred positions — the user should understand why item 4 comes before item 5.

### Step 4: Generate All Briefs

Write each brief to `.olympus/briefs/{kebab-case-name}.md` using the same template as single mode (from `resources/skills/brief/templates/ai-dlc-intent-brief-template.md`). Include the priority position in each brief's metadata.

### Step 5: Generate the Index

Write the priority-sequenced index:

**File location:** `.olympus/briefs/index.md`

```markdown
# Intent Briefs — [Collection Name]

**Created:** [ISO date]
**Author:** [who created them]
**Total items:** [N]

## Priority Sequence

| # | Brief | Summary | Stakeholder | Status |
|---|-------|---------|-------------|--------|
| 1 | [Name](./kebab-name.md) | One-line summary | Who asked | Draft |
| 2 | ... | ... | ... | Draft |

## Shared Context

[Any context that applies across all briefs — common motivation, constraints, timeline, etc.]

## Notes

[How this collection should be used — e.g., "Feed into March 30th Mob Elaboration session" or "Input for /plan runs on the EZFacility codebase"]
```

### Step 6: Identify Cross-Brief Dependencies

After generating all briefs, review the full set and identify items that share components, data models, or user flows. Document these in the index under a dedicated section:

```markdown
## Cross-Brief Dependencies

- **[Brief A] ↔ [Brief B]** — Share [component/data model/user flow]. Elaborate together or sequence A before B.
```

This prevents the team from elaborating overlapping items in isolation, which leads to conflicting designs and rework during construction.

After generating all briefs, the index, and cross-brief dependencies, summarize what was created and offer next steps.

---

## Integration with /plan

When briefs exist in `.olympus/briefs/`, they're designed to be consumed by the `/plan` workflow. Document this in the brief output:

> These briefs are saved to `.olympus/briefs/` and are ready to be used as input for `/plan`. When you start a planning workflow, reference the brief: `/plan — see intent brief at .olympus/briefs/{name}.md`

This integration point will be formalized in a future update to the `/plan` skill, where it will automatically detect and offer to use existing briefs.

---

## Principles

- **Capture intent, not design.** Briefs describe problems and outcomes. Solutions, architecture, and implementation details belong to `/plan` and Mob Elaboration.
- **Good enough beats perfect.** A brief with an "Unknown" section is better than no brief. The elaboration team will fill gaps — that's their job.
- **Respect the user's time.** In batch mode especially, don't ask questions you can infer the answers to. Template similar items. Be efficient.
- **Standalone value.** A brief should be useful even if `/plan` is never run — it's a communication artifact that helps teams align on what needs to be built and why.
- **No codebase analysis.** Briefs are business-context documents. Technical discovery, reverse engineering, and architecture decisions happen in `/plan`. Don't read source code or suggest implementations.
