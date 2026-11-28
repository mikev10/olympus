# Decisions: host refusal and script scan (amendment)

## Amendment: the host prints its own refusal, and the name scan reads scripts

After R35 merged (#130). Two of its open items, each the recommended answer,
confirmed by the maintainer on 2026-11-11: D-R35-08's compromise, and #131.

### A-HS-01: one exempt entry in the api terminal scan

- **Was:** `I9.api-never-touches-a-terminal` refused every stream write and
  exit in `api`, the host's entry included, so start-up threw its refusal and
  Node printed it, with two lines of its own header (D-R35-08).
- **Now:** `packages/api/src/host/main.ts` catches the refusal once and writes
  `factory-host: <the list>` to stderr and sets `process.exitCode = 1`, as the
  CLI's own entry does. The scan exempts exactly that file and exactly
  `process.stderr.write` and `process.exitCode` (by spelling and by binding).
  stdin, stdout, argv, `process.exit`, isTTY, `console`, and every terminal
  module stay refused there. The file must export nothing, so no module can
  call through it, and the scan fails if the file leaves the program, so the
  exemption cannot name nothing. Any other error keeps its stack.
- **Asserted:** `I9.packaged-host-runs` now also requires the refusal's first
  line to be `factory-host: not started;` and no `node:internal` header. It
  fails against the merged R35 entry (run). A `console.log` added to the entry
  fails the scan (run).
- **Reverse:** drop `HOST_ENTRY` and rethrow, as R35 merged.

### A-HS-02: the I10 scan reads scripts/ and the root config (#131)

- **Was:** the scan read each workspace package's source, `package.json`, and
  `tsconfig.json`. `scripts/` and the root configuration were unread.
- **Now:** every `.ts` file under `scripts/` (identifiers, strings, paths)
  and the root `package.json`, `tsconfig.base.json`, `tsconfig.build.json`,
  `tsconfig.tooling.json`, and `scripts/tsconfig.json`, with the same two
  exemptions. A root file the list names and the workspace lacks fails the
  scan, as does an empty `scripts/`.
- **Found by it:** 23 existing hits, all temp-file and temp-directory prefixes
  in the review runner and its tests (`olympus-codex-scratch-` and the like)
  and the release script's success line. Renamed to `factory-`; none is
  matched by anything else. The success line builds the CLI's name from its
  exact string.
- **Reverse:** drop the scripts and root loop from the assertion.

### A-HS-03: the host prints each failed attempt (reverses D-R36a-13)

- **Was:** the host's entry could write only its start-up refusal to stderr
  (A-HS-01). The service's one line per failed attempt (#149, D-R36a-06) went
  nowhere, because the host passed `createApiServer` no `log`.
- **Now:** `packages/api/src/host/main.ts` passes
  `log: (line) => process.stderr.write(...)`, prefixed `factory-host: `. The
  line is already flattened to one line by `attemptLine`, so a detail cannot
  forge a second line. The exemption's spelling list is unchanged: the same
  file, the same `process.stderr.write`. Only its stated purpose widens, in
  A-HS-01's file header and the scan's title. stderr is not a prompt, so the
  untrusted detail it carries stays data.
- **Asserted:** `I9.host-logs-failed-attempts` parses the entry and fails
  unless its `createApiServer` call has a `log` whose body calls
  `process.stderr.write`. It fails with the `log` property removed (run).
- **Reverse:** drop the `log` property and the assertion, and restore
  A-HS-01's wording.
