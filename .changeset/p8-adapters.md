---
"@olympus-ai/adapters": minor
"@olympus-ai/conformance": minor
---

P8: the TypeScript adapters. `AdapterSet` for vitest (3, 4) and jest (29, 30),
built for a repository by `buildAdapterSet`.

- **Test framework.** Suites are enumerated the way each framework enumerates
  them, with discovery rules copied from that major's published source, and
  without running anything the repository contains: a config is parsed and its
  literal settings read, and a setting that only running the config could
  resolve is refused rather than enumerated with the defaults. Assertions are
  parsed to operator and arguments, compared across versions of a file into
  `weakened`, `removed`, and `toleranceWidened`, and skip markers are reported
  by chain and test name.
- **Coverage.** Changed-line coverage over the istanbul JSON report a sandboxed
  check wrote. A changed source file the report does not mention is uncovered,
  and a missing or malformed report is refused rather than read as a number.
- **Manifest.** Every config file added, removed, or modified between two
  trees, by content.
- **Behavioral.** CLI scenarios, run inside the sandbox through the provider
  and judged on the host. HTTP is P11 and browser is R3; `unavailableControls()`
  names both, and names mutation (M3), so no set clears L3 at M1.
- **L3.** `adapterAdmission` refuses L3 for a set that lacks any control,
  naming each, derived from its slots rather than trusted from its report.

Nothing is followed through a symbolic link, and no adapter loads a module by
a computed name or imports anything that runs code; the registry asserts the
second as `I1.adapters-execute-nothing-on-the-host`.

The ledger: `I5.unsupported-stack-is-loud` is paid; `I1.adapters-execute-nothing-on-the-host`,
`I2.unmet-expectation-fails-the-gate`, and `I2.check-result-declares-expectation`
are live; `I5.adapter-refusal-enforced-at-admission` is pending, owed to P6.
I5's baseline stays at 6.
