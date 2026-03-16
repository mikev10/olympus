# Question Format Guide

## MANDATORY: All Questions Must Use This Format

### Rule: Never Ask Questions in Chat
**CRITICAL**: You must NEVER ask questions directly in the chat. ALL questions must be placed in dedicated question files.

### Question File Format

#### File Naming Convention
- Use descriptive names: `{phase-name}-questions.md`
- Examples:
  - `classification-questions.md`
  - `requirements-analysis-questions.md`
  - `story-planning-questions.md`
  - `design-questions.md`

#### Question Structure
Every question must include meaningful options plus "Other" as the last option:

```markdown
## Question [Number]
[Clear, specific question text] (select one | select all that apply)

A) [First meaningful option]
B) [Second meaningful option]
[...additional options as needed...]
X) Other (please describe after [Answer]: tag below)

[Recommendation]: [Letter(s)] — [Brief reasoning for this recommendation]

[Answer]:
```

**CRITICAL**:
- "Other" is MANDATORY as the LAST option for every question
- Only include meaningful options - don't make up options to fill slots
- Use as many or as few options as make sense (minimum 2 + Other)

#### Selection Type Indicator
Every question MUST include a selection type in parentheses after the question text:
- `(select one)` — Only one answer is valid
- `(select all that apply)` — Multiple answers can be selected

**Guidelines for choosing selection type:**
- Use `(select one)` when options are mutually exclusive (e.g., "greenfield vs brownfield")
- Use `(select all that apply)` when multiple options can coexist (e.g., motivations, features, concerns)

#### AI Recommendation
Every question MUST include a `[Recommendation]:` tag after the options and before `[Answer]:`:
- Provide the recommended letter(s) followed by a dash and brief reasoning
- For multi-select questions, list all recommended letters separated by commas
- Base recommendations on industry best practices, common patterns, and context from the user's input
- Keep reasoning to 1-2 sentences
- The recommendation helps the user make informed decisions but does NOT replace their choice

### Complete Example

```markdown
# Requirements Clarification Questions

Please answer the following questions to help clarify the requirements.
For multi-select questions, provide comma-separated letters (e.g., A, B, E).

## Question 1
What authentication methods should be supported? (select all that apply)

A) Username and password
B) Social media login (Google, Facebook)
C) Single Sign-On (SSO)
D) Multi-factor authentication
E) Other (please describe after [Answer]: tag below)

[Recommendation]: A, D — Username/password is the baseline expectation, and MFA is increasingly required for production applications.

[Answer]:

## Question 2
Will this be a web or mobile application? (select one)

A) Web application
B) Mobile application
C) Both web and mobile
D) Other (please describe after [Answer]: tag below)

[Recommendation]: A — Starting with web reduces initial complexity; mobile can be added later.

[Answer]:

## Question 3
Is this a new project or existing codebase? (select one)

A) New project (greenfield)
B) Existing codebase (brownfield)
C) Other (please describe after [Answer]: tag below)

[Recommendation]: No recommendation — this is a factual question about your current state.

[Answer]:
```

### User Response Format
Users will answer by filling in the letter choice after [Answer]: tag.
For `(select all that apply)` questions, users provide comma-separated letters:

```markdown
## Question 1 (select one)
[Answer]: C

## Question 2 (select all that apply)
[Answer]: A, B, E

## Question 3 (select all that apply — with context)
[Answer]: A, D — We need password auth as baseline plus MFA for admin users
```

Users may also add context after their letter choices. This is encouraged and should be preserved.

### Reading User Responses
After user confirms completion:
1. Read the question file
2. Extract answers after [Answer]: tags
3. Validate all questions are answered
4. Proceed with analysis based on responses

### Multiple Choice Guidelines

#### Option Count
- Minimum: 2 meaningful options + "Other" (A, B, C)
- Typical: 3-4 meaningful options + "Other" (A, B, C, D, E)
- Maximum: 5 meaningful options + "Other" (A, B, C, D, E, F)
- **CRITICAL**: Don't make up options just to fill slots - only include meaningful choices

#### Option Quality
- For `(select one)`: Make options mutually exclusive
- For `(select all that apply)`: Options may overlap or coexist
- Cover the most common scenarios
- Only include meaningful, realistic options
- **ALWAYS include "Other" as the LAST option** (MANDATORY)
- Be specific and clear
- **Don't make up options to fill A, B, C, D slots**

#### Good Example:
```markdown
## Question 5
What database technology will be used? (select one)

A) Relational (PostgreSQL, MySQL)
B) NoSQL Document (MongoDB, DynamoDB)
C) NoSQL Key-Value (Redis, Memcached)
D) Graph Database (Neo4j, Neptune)
E) Other (please describe after [Answer]: tag below)

[Recommendation]: A — Relational databases are the most versatile default; PostgreSQL specifically offers strong JSON support if NoSQL-like flexibility is needed later.

[Answer]:
```

#### Bad Example (Avoid):
```markdown
## Question 5
What database will you use?

A) Yes
B) No
C) Maybe

[Answer]: 
```

### Workflow Integration

#### Step 1: Create Question File
```markdown
Create aidlc-docs/{phase-name}-questions.md with all questions
```

#### Step 2: Inform User
```
"I've created {phase-name}-questions.md with [X] questions.
Please answer each question by filling in the letter choice after the [Answer]: tag.
For multi-select questions, provide comma-separated letters (e.g., A, B, E). Each question includes an AI recommendation to help guide your decision.
If none of the options match your needs, choose the last option (Other) and describe your preference. Let me know when you're done."
```

#### Step 3: Wait for Confirmation
Wait for user to say "done", "completed", "finished", or similar.

#### Step 4: Read and Analyze
```
Read aidlc-docs/{phase-name}-questions.md
Extract all answers
Validate completeness
Proceed with analysis
```

### Error Handling

#### Missing Answers
If any [Answer]: tag is empty:
```
"I noticed Question [X] is not answered. Please provide an answer using one of the letter choices 
for all questions before proceeding."
```

#### Invalid Answers
If answer is not a valid letter choice:
```
"Question [X] has an invalid answer '[answer]'.
Please use only the letter choices provided in the question.
For multi-select questions, use comma-separated letters (e.g., A, B, E)."
```

#### Ambiguous Answers
If user provides explanation instead of letter:
```
"For Question [X], please provide the letter choice that best matches your answer. 
If none match, choose 'Other' and add your description after the [Answer]: tag."
```

### Contradiction and Ambiguity Detection

**MANDATORY**: After reading user responses, you MUST check for contradictions and ambiguities.

#### Detecting Contradictions
Look for logically inconsistent answers:
- Scope mismatch: "Bug fix" but "Entire codebase affected"
- Risk mismatch: "Low risk" but "Breaking changes"
- Timeline mismatch: "Quick fix" but "Multiple subsystems"
- Impact mismatch: "Single component" but "Significant architecture changes"

#### Detecting Ambiguities
Look for unclear or borderline responses:
- Answers that could fit multiple classifications
- Responses that lack specificity
- Conflicting indicators across multiple questions

#### Creating Clarification Questions
If contradictions or ambiguities detected:

1. **Create clarification file**: `{phase-name}-clarification-questions.md`
2. **Explain the issue**: Clearly state what contradiction/ambiguity was detected
3. **Ask targeted questions**: Use multiple choice format to resolve the issue
4. **Reference original questions**: Show which questions had conflicting answers

**Example**:
```markdown
# [Phase Name] Clarification Questions

I detected contradictions in your responses that need clarification:

## Contradiction 1: [Brief Description]
You indicated "[Answer A]" (Q[X]:[Letter]) but also "[Answer B]" (Q[Y]:[Letter]).
These responses are contradictory because [explanation].

### Clarification Question 1
[Specific question to resolve contradiction]

A) [Option that resolves toward first answer]
B) [Option that resolves toward second answer]
C) [Option that provides middle ground]
D) [Option that reframes the question]

[Answer]: 

## Ambiguity 1: [Brief Description]
Your response to Q[X] ("[Answer]") is ambiguous because [explanation].

### Clarification Question 2
[Specific question to clarify ambiguity]

A) [Clear option 1]
B) [Clear option 2]
C) [Clear option 3]
D) [Clear option 4]

[Answer]: 
```

#### Workflow for Clarifications

1. **Detect**: Analyze all responses for contradictions/ambiguities
2. **Create**: Generate clarification question file if issues found
3. **Inform**: Tell user about the issues and clarification file
4. **Wait**: Do not proceed until user provides clarifications
5. **Re-validate**: After clarifications, check again for consistency
6. **Proceed**: Only move forward when all contradictions are resolved

#### Example User Message
```
"I detected 2 contradictions in your responses:

1. Bug fix scope vs. codebase impact (Q1 vs Q2)
2. Low risk vs. breaking changes (Q7 vs Q4)

I've created classification-clarification-questions.md with 2 questions to resolve these.
Please answer these clarifying questions before I can proceed with classification."
```

### Best Practices

1. **Be Specific**: Questions should be clear and unambiguous
2. **Be Comprehensive**: Cover all necessary information
3. **Be Concise**: Keep questions focused on one topic
4. **Be Practical**: Options should be realistic and actionable
5. **Be Consistent**: Use same format throughout all question files

### Phase-Specific Examples

#### Example: select one (2 meaningful options)
```markdown
## Question 1
Is this a new project or existing codebase? (select one)

A) New project (greenfield)
B) Existing codebase (brownfield)
C) Other (please describe after [Answer]: tag below)

[Recommendation]: No recommendation — this is a factual question about your current state.

[Answer]:
```

#### Example: select one (3 meaningful options)
```markdown
## Question 2
What is the deployment target? (select one)

A) Cloud (AWS, Azure, GCP)
B) On-premises servers
C) Hybrid (both cloud and on-premises)
D) Other (please describe after [Answer]: tag below)

[Recommendation]: A — Cloud deployments offer the fastest path to production with managed scaling and infrastructure.

[Answer]:
```

#### Example: select all that apply (4 meaningful options)
```markdown
## Question 3
What are your primary concerns for this project? (select all that apply)

A) Performance and scalability
B) Security and compliance
C) Developer experience and maintainability
D) Cost optimization
E) Other (please describe after [Answer]: tag below)

[Recommendation]: A, B, C — These three concerns form the foundation of a production-quality system. Cost optimization is important but shouldn't drive architectural decisions early on.

[Answer]:
```

## Post-Answer Consolidation

### MANDATORY: Update Plan After Answers Are Collected

**CRITICAL**: After collecting and analyzing user answers, you MUST consolidate the finalized decisions back into the plan or deliverable file BEFORE requesting approval. The user approves the PLAN FILE, not a chat summary.

### Consolidation Rules

1. **Questions and plans are ALWAYS separate files** — questions go in dedicated `{stage}-questions.md` files. Do NOT embed questions in plan files, deliverable files, or any other artifact.
2. **After answers are analyzed**, update the plan file with a "Finalized Approach" section that synthesizes the user's decisions into clear, actionable directives.
3. **The plan file must be self-contained** — someone reading only the plan file should understand the complete approach without needing to cross-reference the questions file.
4. **Present the updated plan file for approval** — never summarize decisions only in chat. The artifact is the source of truth.

### Consolidation Workflow

1. Collect answers in the dedicated questions file
2. Analyze answers for contradictions/ambiguities (resolve if found)
3. **Write finalized decisions into the plan file** (new section or update existing sections)
4. Present the **updated plan file path** for user approval
5. Wait for explicit approval before proceeding

### What NOT to Do

- Do NOT present a plan summary in chat while the plan file still contains raw unanswered questions
- Do NOT ask the user to approve a file that hasn't been updated with their decisions
- Do NOT embed questions inside plan files — always use separate dedicated question files

## Summary

**Remember**:
- ✅ Always create question files
- ✅ Always use multiple choice format
- ✅ **Always include "Other" as the LAST option (MANDATORY)**
- ✅ **Always include `(select one)` or `(select all that apply)` after the question text**
- ✅ **Always include `[Recommendation]:` with reasoning before `[Answer]:`**
- ✅ Only include meaningful options - don't make up options to fill slots
- ✅ Always use [Answer]: tags
- ✅ Accept comma-separated letters for multi-select answers (e.g., A, B, E)
- ✅ Always wait for user completion
- ✅ Always validate responses for contradictions
- ✅ Always create clarification files if needed
- ✅ Always resolve contradictions before proceeding
- ❌ Never ask questions in chat
- ❌ Never make up options just to have A, B, C, D
- ❌ Never proceed without answers
- ❌ Never proceed with unresolved contradictions
- ❌ Never make assumptions about ambiguous responses
- ❌ Never omit the selection type indicator or AI recommendation
