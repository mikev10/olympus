BASE: c53f09a  
HEAD: 194f06a  
packages/conformance/src/registry/install.ts  
a3984956e75f57a64a5fcd4130fa34ff

I have no prior project context and performed no lookups. This review uses only the supplied bundle; I did not execute tests.

1. **packages/api/src/workspace.ts:337 — factually wrong — medium — A final diff cannot record every dependency-tree write.**  
   With Bash, the builder can save an installed package’s bytes, replace its implementation, run commands against the replacement, then restore the original bytes before returning. `ownDiff(start, work)` sees no remaining content difference, so `notCarriedEntries` receives no path to record or escalate. This works outside `.vite`.

   This defeats the stated **every-write audit property**, although it does not itself contaminate the fresh verification install. Resolve it with write monitoring outside the builder’s control, or explicitly narrow the property to dependency-tree changes remaining when the task finishes. **Confidence: high for restored content; the bundle does not show a separate write journal.**

2. **packages/api/src/line.ts:1587 — factually wrong — medium — Non-provision install failures allow build to continue.**  
   When `installInto` returns `ok: false` with an `at` other than `'provision'`, `installForBuild` returns `undefined`. The caller consequently copies the tree and invokes the builder despite the refused or failed preparation.

   This contradicts the stated requirement that a refused install is a refusal, never something that lets the run continue. It is **not a demonstrated verification-pass bypass**: the displayed verification code independently installs dependencies and records ordinary checks as unstarted when that install fails. Resolve it by propagating every unsuccessful build install as a refusal, or explicitly define this preparation as optional and narrow the invariant accordingly. **Confidence: high.**

The following mechanisms appear sound within the supplied code and trust assumptions:

- **Cache filtering:** `packages/api/src/workspace.ts:333` applies `dependencyEntry` before the exemption. Thus `node_modules/extra/node_modules/.vite/x.json` remains recorded under `node_modules/extra`; it cannot exploit the suffix match. `packages/adapters/src/trees.ts:35` matches the exact case-sensitive cache entry with a path-component boundary. I found no concrete non-cache entry that this composition incorrectly exempts.
- **Verification separation:** `verify` excludes dependency-tree entries before composing the verified tree and calls `installInto` independently. The builder’s local test result does not become verification evidence. Complete assurance still depends on the omitted filesystem traversal, materialization, and installer implementations.
- **Installation order:** the build install precedes withholding and copying, so both comparison trees receive the install and withholding occurs before the builder receives its tree.
- **TypeScript boundaries:** the shown casts and type predicates do not provide a builder-controlled route into the trusted runtime process. Treating a malicious driver or runtime-side cast as the attack would violate the stated threat model.

I found no demonstrated tautological check among the added assertions. Their coverage is narrower than their descriptions: the cache assertion checks `notCarried`, but not `bundle.diff`; the init assertion checks policy values and instruction text, but does not exercise Bash network isolation. These tests alone cannot establish those additional properties. The relevant enforcement implementations are absent, so I cannot substantiate a Bash capability escape or certify that boundary.

The adversarial framing is appropriate, provided it distinguishes **remaining changes from historical writes**, and **builder preparation failure from verification acceptance**. Those distinctions determine whether the two issues above violate the intended contract or require a more precise contract.