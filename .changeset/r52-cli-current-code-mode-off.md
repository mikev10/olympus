---
'@olympus-ai/driver-claude-code': patch
---

The driver's image pins Claude Code 2.1.330, up from 2.1.310. That picks up
the permission-boundary fixes in 2.1.321 and 2.1.325 and the CLI's support
for newer models. Every session the driver starts sets
`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=0`, so Code Mode stays off: it is a route
to the tools that no grant names. A `0` in the environment holds against a
`1` in any settings file.
