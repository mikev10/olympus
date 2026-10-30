---
"@olympus-ai/conformance": minor
"@olympus-ai/driver-claude-code": minor
"@olympus-ai/driver-openai-compatible": patch
---

R23: workspace skills and instruction discovery. The Claude Code driver's `I3.workspace-instructions-not-loaded` now also plants a skill under `.claude/skills` and `.agents/skills`. It runs once with no tools and once with `Skill` granted, and requires neither skill in the reply or in the session's own skill list. A control reruns the driver's `Skill` invocation without `--setting-sources ''` and must see the `.claude/skills` plant. `SessionInit` gains `skills`, read from the CLI's `init` line. The OpenAI-compatible driver gains `I3.openai-compatible-workspace-instructions-not-loaded`: a workspace holding every planted file leaves the requests it sends byte-identical. The registry names one workspace-instruction assertion per driver, and `I3.every-driver-has-a-workspace-instruction-assertion` refuses a driver package without one.
