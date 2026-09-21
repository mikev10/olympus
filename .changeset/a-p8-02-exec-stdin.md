---
"@olympus-ai/sandbox": minor
---

A-P8-02: `ExecOptions` gains `stdin`. The bytes are written to the command's
standard input, UTF-8, and the stream is closed; omitted, the command has no
standard input attached, as before. `LocalDockerProvider` passes
`--interactive` and writes to the `docker` process it spawns;
`StubSandboxProvider` writes to its local child. A command that exits without
reading its input still reports its own result, and any other failure to
deliver the bytes refuses the command rather than running it without them.
