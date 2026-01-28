---
description: Start a planning session with Prometheus
---

[PLANNING MODE ACTIVATED]

$ARGUMENTS

## Planning Session with Prometheus

**CRITICAL**: You MUST use the Task tool to spawn the Prometheus agent. DO NOT conduct the planning session yourself.

### Step 1: Extract Task Description

Arguments provided: $ARGUMENTS

This is what Prometheus will plan.

### Step 2: Spawn Prometheus Agent

**MANDATORY**: Use the Task tool to spawn the Prometheus agent:

```
Task(
  subagent_type="prometheus",
  description="Plan with Prometheus",
  prompt="Plan this task: $ARGUMENTS"
)
```

### What Prometheus Will Do
1. **Interview** - Ask clarifying questions about goals, constraints, and preferences
2. **Analysis** - Summon Metis to analyze for hidden requirements and risks
3. **Planning** - Create a comprehensive work plan
4. **Review Loop** - Optionally summon Momus for quality review
5. **Handoff** - Save plan to `.olympus/plans/` and instruct you to use `/complete-plan` after implementation

### Prometheus Workflow
- **Interview Phase** (default): Prometheus asks questions and gathers requirements
- **Generation Phase**: When user says "Make it into a work plan!" or "Create the plan", Prometheus generates the plan file
- **Plan Storage**: Plans are saved to `.olympus/plans/{name}.md`

### After Planning
- Use default mode (Olympus orchestration) to execute the plan
- Use `/review` if you want Momus to review the plan before execution
- Use `/complete-plan` after implementation to verify completion

---

**YOUR ONLY JOB**: Pass the task description to Prometheus and let Prometheus conduct the planning session. DO NOT plan yourself.
