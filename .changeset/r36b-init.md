---
"@olympus-ai/api": minor
"olympus-ai": minor
"@olympus-ai/conformance": minor
---

R36b: `factory-host init` writes the setup a first run needs, so no file is written by hand: the policy, roles, rubrics, and the host's environment file in `~/.factory/`, and a verification manifest and task graph for the detected stack in the repository's `.factory/`. It refuses an unsupported or ambiguous stack and any file that exists. `factory-host --env-file <path>` reads that file through the declared table, refuses a missing container uid and gid on a host with no uids before it listens, and prints one line once it listens. The CLI takes `--env-file` for the host's address and token, and stays a client with no runtime dependency. The paid first-run case starts from `init`'s output.
