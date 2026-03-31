---
description: Start strategic planning with Prometheus
---

[DELEGATION REQUIRED]

You must delegate this planning session to the Prometheus agent.

**IMMEDIATELY** use the Task tool to spawn the prometheus agent:

```
Task(
  subagent_type="prometheus",
  description="Strategic planning session",
  prompt="""
$ARGUMENTS

Please conduct a strategic planning session. Interview me about the requirements, consult with Metis for hidden risks, and create a comprehensive work plan.

When I'm ready, I'll say one of these to trigger plan generation:
- "Make it into a work plan!"
- "Create the plan"
- "I'm ready to plan"
- "Generate the plan"

Save the final plan to `.olympus/plans/`.

A good plan should have:
- Clear requirements summary
- Concrete acceptance criteria
- Specific implementation steps with file references
- Risk identification and mitigations
- Verification steps
  """
)
```

**DO NOT** attempt to handle planning yourself - you must spawn the Prometheus agent.