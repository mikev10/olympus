---
description: Run a guardrail retrospective on the current AIDLC workflow
---

[GUARDRAIL RETRO - ADVISORY ANALYSIS ONLY]

$ARGUMENTS

## What This Does

The /retro command analyzes your AIDLC workflow's guardrail events (gate rejections, trust changes, cascade invalidations, CI failures) and generates advisory suggestions for improving future workflows.

**IMPORTANT: This is advisory only. No changes are ever auto-applied.**

## Steps

### Step 1: Locate Workflow Data
1. Scan `aidlc-docs/` subdirectories for workflow data. Look for `manifest.json` files.
2. If not found, report: "No workflow data found for retro analysis"
3. If found, proceed with analysis using `aidlc-docs/{workflowId}/manifest.json`

### Step 2: Gather Retro Data
Collect from the workflow manifest and trust state:
- **Gate rejections**: All rejected entries from `manifest.gate_audit`
- **Cascade events**: Artifacts that became stale or violated
- **Trust decreases**: Times trust level went down
- **CI failures**: Failure lines from validation reports

### Step 3: Analyze Patterns
Identify recurring issues:
- Group gate rejections by similar reason text
- Note trust level trajectory (improvements vs declines)
- Count cascade invalidation events
- Assign confidence: High (3+ occurrences), Medium (2), Low (1)

### Step 4: Generate Suggestions
Write `.olympus/retro/suggestions.md` with:
- Summary statistics (total gates, rejection rate, trust changes, CI failures)
- Identified patterns with evidence and confidence levels
- Advisory recommendations as a checklist

### Step 5: Display Summary
Show the user:
- Number of patterns found
- High-confidence patterns (if any)
- Path to full suggestions file
- Reminder that all suggestions are advisory only

## Key Rules
- **NEVER** auto-apply changes to any file based on retro analysis
- **NEVER** modify workflow artifacts, manifests, or trust state
- Works both during active workflows and after completion
- Generates suggestions for HUMAN review only
