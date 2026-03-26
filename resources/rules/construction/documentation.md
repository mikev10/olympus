# Documentation Generation

**Purpose**: Generate human-readable documentation drafts from workflow artifacts

**MANDATORY**: This stage ALWAYS executes after Build and Test completes. It cannot be skipped regardless of depth, pathway, or trust level.

## Prerequisites

- Build and Test must be complete (all tests passing)
- All bolt specs must be available
- Intent, requirements, and stories artifacts must exist

## Agent Delegation Strategy

**MANDATORY**: Delegate documentation generation to `document-writer`. Do NOT write documentation directly.

**Execution mode**: Foreground sequential -- the orchestrator creates the doc-plan, then delegates writing to the agent.

**Delegation scope**:

- **Orchestrator retains**: Steps 1-3 (analyze docs impact, create doc-plan, present plan for approval)
- **Delegated to `document-writer`**: Steps 4-5 (generate documentation drafts based on approved plan)

**If an agent task fails**: Follow the Agent Task Failure Recovery procedure in `error-handling.md` -- retry the delegation, never silently do the work yourself.

---

## Step 1: Analyze Documentation Impact

Scan ALL bolt specs in `aidlc-docs/{workflowId}/construction/bolts/` and collect `docs_impact` values from frontmatter. Also analyze:

- The intent.md (problem statement, business context)
- The requirements.md (functional/non-functional requirements)
- Stories (if they exist) for user-facing behavior descriptions
- What files were created or modified during code generation

Determine which documentation types are needed:

| docs_impact value | Documentation type | Description |
|---|---|---|
| `readme` | README updates | New features, changed behavior, updated getting started |
| `user-guide` | Feature documentation | How to use the feature, with examples |
| `config-reference` | Configuration docs | New settings, options, environment variables |
| `cli-reference` | CLI documentation | New commands, flags, usage examples |
| `migration-guide` | Migration documentation | Breaking changes, upgrade steps, deprecations |
| `architecture` | Architecture documentation | System design changes, new components, data flow |
| `code-comments` | Inline documentation | Complex logic that needs explanation (handled during code gen, noted here) |

If no bolt specs exist (non-bolt workflow), infer documentation needs from:

- Requirements with user-facing features -> `user-guide`
- Requirements with configuration changes -> `config-reference`
- Requirements with breaking changes -> `migration-guide`
- New system components -> `architecture`

---

## Step 2: Detect Existing Documentation Structure

Read the workspace to understand where the project keeps its docs:

- Check for `docs/` directory
- Check for `README.md` in project root
- Check for wiki references, doc site configs (docusaurus, mkdocs, etc.)
- If brownfield: note existing doc structure for suggested placement
- If greenfield: suggest standard locations

---

## Step 3: Create Documentation Plan

Create `aidlc-docs/{workflowId}/construction/documentation/doc-plan.md`:

```markdown
---
workflow: "{workflowId}"
status: draft
created: "{ISO-8601}"
total_docs: {N}
---

# Documentation Plan

## Documentation Impact Summary

| Bolt | docs_impact | Documentation needed |
|------|-------------|---------------------|
| BOLT-001-slug | readme, user-guide | README update + feature guide |
| BOLT-002-slug | config-reference | Configuration doc update |
| BOLT-003-slug | none | No documentation needed |

## Detected Project Documentation Structure

- README: {path or "not found"}
- Docs directory: {path or "not found"}
- Doc framework: {docusaurus/mkdocs/none detected}

## Documentation Artifacts to Generate

### 1. {Doc type}: {title}

- **Source**: {which bolt specs, requirements, stories inform this}
- **Suggested placement**: {where in the user's project this should go}
- **Target audience**: {end user / developer / operator}

### 2. {Doc type}: {title}

...
```

### GATE: Await User Approval

Present the doc-plan to the user. They must approve before generation begins.
The user may:

- Remove doc types they don't need
- Change suggested placement paths
- Add doc types not detected

---

## Step 4: Generate Documentation Drafts

For each approved doc type, create a draft file in `aidlc-docs/{workflowId}/construction/documentation/`:

**Naming convention**: `{type}-{slug}.md` (e.g., `user-guide-authentication.md`, `readme-update.md`)

Each draft MUST include:

- A header noting it's a draft: `<!-- AIDLC Documentation Draft - Review before placing in project -->`
- Suggested placement path in the project
- Human-readable prose (NOT technical jargon)
- Examples and code snippets where appropriate
- Written for the target audience identified in the doc-plan

The `document-writer` agent generates these from:

- intent.md -> "why" context, problem being solved
- requirements.md -> feature details, constraints
- stories -> user personas and workflows
- bolt specs -> acceptance criteria, what changed
- The actual code files -> concrete implementation details

---

## Step 5: Present Completion

```markdown
---

## Documentation Generation Complete

{N} documentation drafts generated.

---

**REVIEW REQUIRED**

> Documentation drafts are at:
> `aidlc-docs/{workflowId}/construction/documentation/`
>
> Each draft includes a suggested placement path for your project.

**You may:**
- **Request Changes** -- Modify any documentation draft
- **Apply to Project** -- Place approved docs in your project
- **Approve and Continue** -- Approve documentation and proceed

---
```

---

## Step 6: MANDATORY: Update State Tracking

**MANDATORY**: Update BOTH state files in the SAME interaction:

1. Update `aidlc-docs/{workflowId}/aidlc-state.md`:
   - Mark Documentation Generation stage as complete
   - Update current status

2. Update `aidlc-docs/{workflowId}/checkpoint.json`:
   - Set `current_stage` to `"complete"`
   - Set `status` to `"complete"`
   - Record documentation artifacts generated

3. Log in `aidlc-docs/{workflowId}/audit.md`:

```markdown
## Documentation Generation Stage
**Timestamp**: [ISO timestamp]
**Documentation Status**: [Complete]
**Drafts Generated**: [N]
**Files Generated**:
- doc-plan.md
- {list of generated draft files}

---
```

- **Do NOT proceed to the next stage without completing this step**
