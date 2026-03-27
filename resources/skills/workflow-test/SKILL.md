---
description: End-to-end structured workflow test - exercises every stage from INTENT through BUILD, then cleans up
---

$ARGUMENTS

## Task: Run Workflow End-to-End Test

You are running an end-to-end test of the Olympus structured workflow engine.

### Complete Pipeline

```
INCEPTION (7 stages) → CONSTRUCTION (per-unit design + bolts) → OPERATIONS
```

### What This Does

1. Creates a test workflow `smoke-test-hello-world` in `aidlc-docs/`
2. Walks through inception stages (workspace-detection, requirements-analysis, etc.) and construction
3. Creates minimal test artifacts at each stage in the correct directory structure
4. Updates checkpoint.json after each stage to verify state transitions
5. Verifies all 13 artifacts are created in the correct locations
6. **Deletes the entire test workflow** when done — mandatory cleanup

### Quick Protocol

1. **Setup**: Delete leftover `aidlc-docs/smoke-test-hello-world/`, create fresh directory structure
2. **Create checkpoint.json** with schema v2.0.0, initial state: inception/intent
3. **Inception phase**: Write intent.md -> prd.md -> spec.md -> unit specs (update checkpoint after each)
4. **Construction phase**: Write unit specs -> design docs (interfaces.md, data-flow.md, components.md) -> BUILD stage creates code-generation plans (update checkpoint after each)
5. **BUILD verification**: Read final checkpoint, verify all stages complete, count all 13 artifacts
6. **Cleanup**: Delete `aidlc-docs/smoke-test-hello-world/` entirely, verify deletion
7. **Report**: Print PASS/FAIL table for each of the 6 stages

### Arguments
- No args: Full test (all 6 stages)
- `inception`: Inception phase only (7 inception stages)
- `construction`: Construction phase only (per-unit design + bolt execution)
- `cleanup`: Delete leftover test artifacts

### Rules
- ALL files go in `aidlc-docs/smoke-test-hello-world/` only
- NEVER modify source code (`src/`, `dist/`, etc.)
- ALWAYS clean up — if cleanup fails, report as FAILURE
- Report results to stdout, do not create report files
- Use workflow ID `smoke-test-hello-world` exactly

For full test protocol details, see `.claude/skills/workflow-test/skill.md`
