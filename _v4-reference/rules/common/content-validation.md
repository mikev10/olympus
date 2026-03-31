# Content Validation Rules

## MANDATORY: Content Validation Before File Creation

**CRITICAL**: All generated content MUST be validated before writing to files to prevent parsing errors.

## ASCII Diagram Standards

**CRITICAL**: Before creating ANY file with ASCII diagrams:

1. **LOAD** `common/ascii-diagram-standards.md`
2. **VALIDATE** each diagram:
   - Count characters per line (all lines MUST be same width)
   - Use ONLY: `+` `-` `|` `^` `v` `<` `>` and spaces
   - NO Unicode box-drawing characters
   - Spaces only (NO tabs)
3. **TEST** alignment by verifying box corners align vertically

**See `common/ascii-diagram-standards.md` for patterns and validation checklist.**

## Mermaid Diagram Validation

### Required Validation Steps
1. **Syntax Check**: Validate Mermaid syntax before file creation
2. **Character Escaping**: Ensure special characters are properly escaped
3. **Fallback Content**: Provide text alternative if Mermaid fails validation

### Mermaid Validation Rules
```markdown
## BEFORE creating any file with Mermaid diagrams:

1. Check for invalid characters in node IDs (use alphanumeric + underscore only)
2. Escape special characters in labels: " → \" and ' → \'
3. Validate flowchart syntax: node connections must be valid
4. Test diagram parsing with simple validation

## FALLBACK: If Mermaid validation fails, use text-based workflow representation
```

### Implementation Pattern
```markdown
## Workflow Visualization

### Mermaid Diagram (if syntax valid)
```mermaid
[validated diagram content]
```

### Text Alternative (always include)
```
Phase 1: INCEPTION
- Stage 1: Workspace Detection (COMPLETED)
- Stage 2: Requirements Analysis (COMPLETED)
[continue with text representation]
```

## Markdown Formatting Standards

**MANDATORY**: Load and follow `common/markdown-formatting.md` for the complete markdownlint rule set and project-specific overrides. That file is the authoritative reference for all markdown formatting requirements.

## General Content Validation

### Pre-Creation Validation Checklist
- [ ] Validate embedded code blocks (Mermaid, JSON, YAML)
- [ ] Check special character escaping
- [ ] Verify markdown syntax correctness
- [ ] Test content parsing compatibility
- [ ] Include fallback content for complex elements

### Error Prevention Rules
1. **Always validate before using tools/commands to write files**: Never write unvalidated content
2. **Escape special characters**: Particularly in diagrams and code blocks
3. **Provide alternatives**: Include text versions of visual content
4. **Test syntax**: Validate complex content structures

## Validation Failure Handling

### When Validation Fails
1. **Log the error**: Record what failed validation
2. **Use fallback content**: Switch to text-based alternative
3. **Continue workflow**: Don't block on content validation failures
4. **Inform user**: Mention simplified content was used due to parsing constraints

## Artifact Consistency Validation

### MANDATORY: Post-Generation Consistency Check

**CRITICAL**: After ANY agent generates inception or design artifacts, the orchestrator MUST validate the generated content against the requirements before presenting to the user.

### Decision Registry

For complex workflows (depth >= MEDIUM or 3+ units), create a `decisions.md` file in the inception directory listing all structural decisions as key-value pairs. Include this file's content in every agent delegation prompt during the workflow.

Required decision categories:

- **Folder structure**: Where artifacts live on disk (exact paths)
- **Naming conventions**: ID formats, prefix patterns, slug functions
- **Lifecycle states**: State machine transitions (exact state names)
- **Type definitions**: TypeScript types (Record vs Array, union members)
- **Alignment model**: Thresholds, blocking vs advisory behavior
- **Source of truth**: Which system owns which data

### Post-Generation Validation Steps

After an agent returns generated content:

1. **Path validation**: Grep generated content for folder paths — verify they match the decision registry
2. **Naming validation**: Grep for ID patterns — verify they use the agreed format (case, prefix, separator)
3. **State validation**: Grep for lifecycle state names — verify they match the agreed state machine
4. **Type validation**: Grep for type descriptions — verify Record vs Array, union members match requirements
5. **Cross-reference**: Compare key terms in generated content against the requirements.md FR/BR/NFR list

### Agent Prompt Requirements

When delegating artifact generation to any agent, the prompt MUST include:

1. A "Decision Constraints" section quoting verbatim from BRs/FRs for:
   - Folder structure (exact paths)
   - Naming conventions (exact format with examples)
   - Lifecycle states (exact state names)
   - Type definitions (exact TypeScript types)
2. The `decisions.md` file content (if it exists) as a reference block
3. An explicit instruction: "Do NOT deviate from these constraints. If uncertain, use the exact text from the constraints."

### Validation Failure Handling

If post-generation validation finds inconsistencies:

1. Fix the inconsistencies before presenting to the user
2. Log the violations found in audit.md
3. If the agent consistently produces wrong content, escalate the prompt with more explicit constraints
