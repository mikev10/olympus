---
"@olympus-ai/sandbox": minor
"@olympus-ai/adapters": patch
"@olympus-ai/driver-claude-code": patch
---

A-P6-04: `SandboxSpec` gains a required `user: { uid, gid }`, the user a
container's commands run as. `LocalDockerProvider` passes `--user` and, on a
Linux host, refuses a rw workspace that user cannot write, with the new
refusal layer `user`, rather than mounting it and letting the task fail
quietly. A malformed uid or gid is refused the same way. `StubSandboxProvider`
declares that it ignores the user. The driver's test harness names the image's
`node` user. Pays `I5.workspace-is-writable-by-the-task`.
