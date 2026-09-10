---
"@olympus-ai/vault": minor
"@olympus-ai/conformance": minor
---

P1: `LocalVault`, the Vault contract over the local filesystem.

Content-addressed files rather than a database. An evidence bundle, a lock
manifest, and a violation are written once and never edited, so the bytes on
disk are exactly the bytes that were hashed: `sha256sum` over an object file
reproduces the hash in its name, with no Olympus and no schema in the trust
path. That verifiability is the audit claim, not a compromise on the way to
one.

- **Locks** accrete. Each `lock` writes a new generation carrying every earlier
  entry, so the spec locked at `spec` is still verified after `test-design`
  locks the acceptance tests. An already-locked path is refused rather than
  re-hashed: re-locking is how a tamper would launder itself.
- **Verification** resolves real paths, so a locked file swapped for a link out
  of the tree reports `actual: 'escaped'` beside `'missing'` for a deletion,
  rather than hashing whatever it now points at.
- **Run state** commits through an exclusive create (`wx`) of a version-named
  file. That single filesystem operation is the whole concurrency control:
  nothing reads a version in order to decide whether to write, and there is no
  `current` pointer whose second, non-atomic step could wedge a run.
- **Two roots**, store and artifacts, and the constructor refuses a nested
  pair: a store inside the tree an agent writes is a Vault an agent can reach.

Pays down `I3.lock-verification-detects-change` and
`I3.lock-preserves-earlier-entries`, lowering the I3 pending baseline from 3 to
1, and adds two assertions the unit's conformance line requires:
`I5.stale-commit-is-refused-under-contention`, which contends from eight
separate processes on one `ifVersion` and requires exactly one winner, and
`I1.vault-implementation-exposes-only-named-operations`, which enumerates the
prototype because a TypeScript `private` method is public at run time.

`StubVault` is unchanged and still wired into the skeleton; replacing stubs is
the integration unit's job.
