---
"@olympus-ai/vault": minor
"@olympus-ai/core": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
"olympus-ai": minor
---

I1b: `integrate` merges. `packages/api` gains `GitHubIntegrator`, a graph
slot the builder attests like the other real components: `integrate`'s work
pushes the run's accepted change as one commit over `baseCommit` through the
GitHub REST API and opens its pull request, and once a human approves the
exit the runtime merges it, before the grant is spent (D-I1b-01). The commit
is built from the verified tree after every file `baseCommit` tracks is
compared with the base snapshot, and the base branch must not have moved
(D-I1b-03); any failure halts the run (D-I1b-04). A graph with no integrator
carries no run above L1, and admission refuses a policy whose egress names a
host the remote is reached on (D-I1b-05). The host holds the token from
`FACTORY_GIT_REPOSITORY`, `FACTORY_GIT_BASE_BRANCH`, and `FACTORY_GIT_TOKEN`.

The Vault gains `recordIntegration` and `readIntegration`, and `VaultRefKind`
gains `integration` (A-I1b-01). The per-run report, `runReport`, is served at
`GET /runs/:id/report` and printed by `olympus-ai report <run id>`
(D-I1b-07). `@olympus-ai/conformance` exports an in-process GitHub server,
`FakeGitHub`, at `./fake-github`.
