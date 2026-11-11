---
"@olympus-ai/core": minor
"@olympus-ai/adapters": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
"@olympus-ai/benchmark": patch
---

R34: dependencies installed by the runtime from the lockfile. Policy gains `installRegistries` (A-R34-01); adapters declare `DependencyInstaller` for npm and pnpm (A-R34-02); evidence and the base record carry an `InstallRecord`. Before the base run and before any check of a task, the runtime installs the tree's lockfile in a sandbox of its own, with egress to the granted registries alone and no lifecycle scripts, and the checks run over that install with no egress. A lockfile without hashes, several, an unsupported one, a manifest with none, or no registry granted is refused, naming the cause.
