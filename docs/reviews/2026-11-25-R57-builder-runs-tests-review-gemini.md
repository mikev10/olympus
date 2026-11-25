BASE: c53f09a
HEAD: 194f06a
packages/conformance/src/registry/install.ts
a3984956e75f57a64a5fcd4130fa34ff

I have no prior context about this project and performed no external lookups.

### 6. Assessment of Mechanisms (Sound)

I assess the mechanisms as **sound** against the adversarial goals. The invariants are strongly protected by the architectural order of operations and strict filtering, ensuring an attacker cannot get a change passed without human review or manipulate the check environment:

1. **Making a check run over something you wrote in a dependency tree:** 
   This is impossible because `verify` completely drops the task's dependency-tree writes from the checked tree. `ownDiff(start, work)` captures all modifications made by the builder, but `own.filter((entry) => !inDependencyTree(entry.path))` actively strips out any modifications under `node_modules`. Consequently, when the verified `tree` is materialized (`await materialize(...)`), it exclusively uses the base's unmodified version of `node_modules`. Finally, `installInto` replaces that base dependency tree with a fresh installation from the registry. The builder's malicious writes are entirely evaporated before the check runs.

2. **Hiding a dependency-tree write behind the cache exemption:**
   While an attacker *can* write malicious code to `node_modules/.vite/malicious.js` and successfully avoid having it recorded in the human-reviewed escalation list (`notCarried`), this does not constitute a bypass. Because it resides in a dependency tree, the write is stripped from the `own` diff (as described above). It is never copied to the verified tree, never executed during checks, and never merged into the final repository. The cache exemption hides the write from the escalation record, but the system safely discards the write altogether.

3. **Reaching anything the grant does not cover:**
   The `Bash` tool is granted solely to the builder role. The builder executes exclusively at `build` in an isolated sandbox with `network: { egress: none }`. The agent cannot exfiltrate data, download unapproved tools, or execute commands during the `verify` phase (where checks are run by the runtime, not the agent).

### Findings

**packages/api/src/line.ts:1544** — a tradeoff I would have made differently — low — `installForBuild` silently returning `undefined` when `installed.ok` is false and `installed.at !== 'provision'` means the builder agent is handed a workspace with no dependencies installed if the base's `package.json` was broken or couldn't be resolved offline. The agent will attempt to run `vitest run` as instructed, fail with missing modules, and burn through its iteration budget trying to fix an unresolvable environment, before ultimately failing closed at `verify`. While the comments note this is an intentional design choice (D-R57-03: `verify` judges the same refusal), it wastes the agent's budget on an impossible task. — **What would resolve it:** Return a `StationRefusal` or `spendRetry` immediately if `installed.ok` is false during `build`, failing the run early instead of proceeding to a doomed agent invocation.