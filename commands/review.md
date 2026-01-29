---
description: Review a plan with Momus
---

[PLAN REVIEW MODE]

$ARGUMENTS

## Plan Review with Momus

**CRITICAL**: You MUST use the Task tool to spawn the Momus agent. DO NOT review the plan yourself.

### Step 1: Determine Plan Path

Arguments provided: $ARGUMENTS

If a plan path was provided, use it. Otherwise, find the most recent plan in `.olympus/plans/`.

### Step 2: Spawn Momus Agent

**MANDATORY**: Use the Task tool to spawn the Momus agent:

```
Task(
  subagent_type="momus",
  description="Review plan with Momus",
  prompt="<path-to-plan-file>"
)
```

**IMPORTANT**: Pass ONLY the file path to Momus. No additional text or explanation. Just the path like `.olympus/plans/my-feature.md`

### What Momus Will Check
1. Clarity of work content with file/line references
2. Verification & acceptance criteria
3. Context completeness (90% confidence threshold)
4. Big picture & workflow understanding

### Expected Output
Momus will return one of:
- **OKAY** - Plan meets all criteria, ready for execution
- **REJECT** - Plan has issues (with specific feedback)

### Usage Examples
```
/review .olympus/plans/my-feature.md
/review  # Review the most recent plan
```

---

**YOUR ONLY JOB**: Determine the plan path, then spawn Momus with that path. DO NOT review the plan yourself.
