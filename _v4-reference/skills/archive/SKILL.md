---
description: Archive completed AIDLC workflows to aidlc-docs/completed/
---

# Archive Completed Workflows

$ARGUMENTS

Archive completed AIDLC workflows by moving them from `aidlc-docs/{workflowId}/` to `aidlc-docs/completed/{workflowId}/`.

## Step 1: Scan for Workflows

List all directories under `aidlc-docs/` (excluding the `completed/` directory). For each directory that contains a `checkpoint.json`, read the checkpoint and classify:

- **Archivable**: `status` is `"complete"` AND the workflow is NOT already inside `aidlc-docs/completed/`
- **Active**: `status` is NOT `"complete"` and NOT `"archived"`
- **Already archived**: Located in `aidlc-docs/completed/` or has `archived_path` set

## Step 2: Parse Arguments

- **No arguments**: List all archivable workflows and ask the user which to archive (or offer `--all`)
- **`--all`**: Archive all archivable workflows without prompting
- **`<workflow-id>`**: Archive only the specified workflow (must be archivable)

If no archivable workflows are found, report: "No completed workflows to archive. Active workflows must reach completion before archiving."

## Step 3: Archive Each Selected Workflow

For each workflow to archive:

1. **Create target directory**: `aidlc-docs/completed/{workflowId}/`
2. **Read the checkpoint**: Load `aidlc-docs/{workflowId}/checkpoint.json`
3. **Stamp archival metadata** on the checkpoint:
   - Set `archived_at` to current ISO 8601 timestamp
   - Set `archived_path` to `aidlc-docs/completed/{workflowId}`
4. **Write the updated checkpoint** back to the source location
5. **Move the entire workflow directory** from `aidlc-docs/{workflowId}/` to `aidlc-docs/completed/{workflowId}/`
6. **Update master plan** (best-effort): If `.olympus/plans/{workflowId}-plan.md` exists, append a note:
   ```
   ---
   _This workflow was archived to `aidlc-docs/completed/{workflowId}/` on {archived_at}_
   ```
7. **Update CLAUDE.md** (best-effort): If the project `.claude/CLAUDE.md` references this workflow as the active workflow, remove or comment out that reference since it is no longer active.

## Step 4: Report Results

Display a summary table:

```
Archived workflows:
| Workflow | Feature | Archived To |
|----------|---------|-------------|
| {id}     | {name}  | aidlc-docs/completed/{id}/ |

{count} workflow(s) archived successfully.
```

If any archival failed, report the error but continue with remaining workflows.

## Edge Cases

- **Workflow not found**: Report "Workflow '{id}' not found in aidlc-docs/"
- **Workflow not complete**: Report "Workflow '{id}' has status '{status}' — only completed workflows can be archived"
- **Already archived**: Report "Workflow '{id}' is already archived at aidlc-docs/completed/{id}/"
- **Move failure on Windows**: If the move fails with EBUSY, suggest closing any open files in the workflow directory
