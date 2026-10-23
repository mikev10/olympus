---
"@olympus-ai/conformance": patch
"@olympus-ai/compiler": patch
"@olympus-ai/driver-claude-code": patch
---

Conformance fixes from the external review of R20 (D-R20-10 to D-R20-13). The role-pinning assertion now requires a resume to call the builder and checks what it received, and it admits a later run to check that run's record. The compiler-inputs assertion parses every compiler module for anything it loads and for `process`, and reads `compileRoles`'s declared parameters. The symlink scenario no longer passes when it cannot make its link. A new paid driver assertion, `I3.workspace-instructions-not-loaded`, plants a `CLAUDE.md`, a rules file, and an agent definition in the workspace, and fails if any of them reaches the session.

The Claude Code driver renders the role at the head of the appended system prompt instead of as the session's agent, so the CLI's own prompt stays and the stable prefix caches again (D-R20-14).
