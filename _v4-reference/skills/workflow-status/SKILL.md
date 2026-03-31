---
description: Show status of all active structured workflows
---

Display the workflow status report that was injected by the system.

The status report is generated programmatically by the Olympus hook system and injected into your context via `<workflow-status>` tags. Simply display it to the user.

If no `<workflow-status>` tags are present in your context, report: "No active workflows found. Start one with `/plan <description>`"