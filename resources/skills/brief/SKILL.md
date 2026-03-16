---
description: Generate structured intent briefs as pre-elaboration inputs for /plan workflows and Mob Elaboration sessions. Use this skill when users want to create intent briefs, prepare inputs for /plan, document what needs to be built before starting AI-DLC, prepare for Mob Elaboration, create pre-elaboration documents, capture feature intent, or scope work items. Trigger on phrases like "create a brief", "intent brief", "prepare for /plan", "pre-elaborate", "what should we build", "capture intent", "scope this work", "prepare for elaboration", or when users want to document a feature or change request before starting a full planning workflow. Also trigger when users have a list of items they want to inventory, prioritize, and prepare for team review — even if they don't use the word "brief" explicitly.
---

# Intent Brief Generator

You help teams capture the "what" and "why" before diving into the "how." Intent briefs are lightweight, structured documents that serve as high-quality inputs to `/plan` workflows and Mob Elaboration sessions. They live in `.olympus/briefs/` as pre-workflow artifacts — created before any AI-DLC workflow exists.

## Input

```
$ARGUMENTS
```

---

## Mode Detection

Determine which mode to run based on the input:

- **`--batch`** flag or input contains a list of items → **Batch Mode**
- Everything else → **Single Mode**

If the input already contains substantial context (e.g., the user pasted a feature description, a ticket, or a problem statement), extract what you can from it and confirm rather than re-asking. The goal is a conversation, not a questionnaire.

### Thin-Context Handling

When the input is vague or minimal (e.g., "we need password reset" with no further detail), don't generate a brief full of assumptions. Instead:

1. **Generate the brief anyway** — a brief with "Unknown" sections is better than no brief. Fill in what you can reasonably infer from the request itself.
2. **Mark unknowns explicitly** — for each unknown section, include the specific questions you would have asked. This turns the brief into a structured interview guide for the next conversation. Example: "Unknown — Who is requesting this? What is the business impact? Is there a deadline?"
3. **Invest in Notes for Elaboration** — when context is thin, this section becomes the most valuable part of the brief. List the open questions, risks, and decisions the elaboration team needs to resolve.

The goal is that even a thin-context brief is useful — it captures what is known, makes the unknowns visible, and gives the team a structured starting point for discussion.

---

## Single Mode

### The Interview

Have a natural conversation to understand the user's intent. You're trying to fill in these sections, but don't march through them like a checklist — let the conversation flow and ask follow-ups where it matters most.

**Core questions (ask these):**

1. **What needs to change?** — The problem or opportunity. What's broken, missing, or possible? Get specific enough that someone unfamiliar with the context could understand.

2. **Why does it matter?** — Who's asking for this, what's the business impact, and why now? This is what separates a brief from a sticky note. If the user mentions a stakeholder request, capture the name and context.

3. **What does "done" look like?** — The desired outcome, described in terms of what should be true when this work is complete. Keep it outcome-focused ("customers can self-serve password resets") not implementation-focused ("add a /reset-password endpoint").

**Contextual questions (ask as needed — skip what's obvious or irrelevant):**

4. **What's in scope and what's not?** — Boundaries prevent scope creep during elaboration. Especially useful when a problem could be interpreted broadly.

5. **Known constraints?** — Technical limitations, deadlines, dependencies on other work, team availability. Anything the elaboration team should know upfront.

6. **Priority relative to other work?** — Where does this sit? Is it urgent, important-but-not-urgent, or nice-to-have? If other briefs exist, how does this one rank?

7. **Any references?** — Tickets, designs, prior art, related features, stakeholder emails. Links and pointers that give the elaboration team a head start.

**Things to listen for and capture even if not explicitly asked:**
- Stakeholder names and their relationship to the request
- Implicit constraints ("we're on .NET 6" or "this is a legacy iFrame")
- Dependencies between this work and other known work
- Urgency signals ("Mario asked for this", "blocking 3 accounts")

### Generating the Brief

Once you have enough context, generate the brief. Don't wait for perfect information — a brief with a few "Unknown" sections is better than no brief.

Create the directory if needed, then write the brief:

**File location:** `.olympus/briefs/{kebab-case-name}.md`

**Template:**

```markdown
# Intent Brief: [Name]

**Date:** [ISO date]
**Author:** [who created it — ask if not obvious, default to "Unknown" if not provided]
**Status:** Draft

## Problem

[Clear problem statement — what's wrong or what opportunity exists. 2-4 sentences that someone unfamiliar with the context could understand.]

## Business Motivation

[Who wants this, why it matters, business impact. Include stakeholder names if known. Capture urgency signals.]

## Desired Outcome

[What "done" looks like — outcome-focused, not implementation-focused. Describe the end state, not the steps to get there.]

## Scope

### In Scope
- [Specific items this work covers]

### Out of Scope
- [What this work explicitly does NOT cover — prevents scope creep during elaboration]

## Known Constraints

- [Technical, timeline, dependency, or team constraints]
- [Include anything that would surprise the elaboration team if they didn't know it upfront]

## References

- [Links to tickets, designs, prior art, stakeholder communications]

## Notes for Elaboration

[Anything the team should discuss during Mob Elaboration — open questions, risks you can see, areas where the team's expertise is needed to make decisions. This section is where you flag things the brief can't answer alone.]
```

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

Don't run the full 7-question interview for each item — that would take forever with a large list. Instead:

1. **Ask shared context questions once** — things that apply to all items (e.g., "Who's the stakeholder for all of these?", "What's the common motivation?", "Are there shared constraints?")

2. **For each item, ask only what's unique** — the problem statement and any item-specific context. If items are similar (e.g., "update iFrame for billing page" and "update iFrame for schedule page"), you can template the brief structure and ask about differences.

3. **Infer where possible** — if the user says "Mario requested the first 5", you don't need to ask about stakeholder for each of those 5.

### Step 3: Prioritize

Help the user sequence the items. Ask about:

- **Business value** — Which items deliver the most impact?
- **Urgency** — Are any time-sensitive or blocking other work?
- **Dependencies** — Do any items need to be done before others?
- **Stakeholder priority** — Has anyone already indicated an order?

If the user already has a priority order, confirm it rather than re-deriving it.

**Partial priority ordering:** When some items have an explicit priority (e.g., "Mario requested the first 3") but others don't, preserve the explicit ordering for those items and sequence the remaining items using dependency analysis and risk assessment. Explain your reasoning for the inferred positions — the user should understand why item 4 comes before item 5.

### Step 4: Generate All Briefs

Write each brief to `.olympus/briefs/{kebab-case-name}.md` using the same template as single mode. Include the priority position in each brief's metadata.

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
