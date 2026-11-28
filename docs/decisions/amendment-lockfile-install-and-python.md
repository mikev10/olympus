# Decisions: lockfile install and python (amendment)

## Amendment: lockfile install (R34) and Python adapters (R29)

R29 was started on `v2` at 5758c8a and stopped before any code. Its
dependencies have shipped (P8, R1, R18, each tagged `reviewed/*`), but its
entry names a deliverable no stack has, gives no acceptance criteria, and
names no gate paths, and what it needs includes a policy contract change. So
this is an amendment, confirmed before it is built. The maintainer chose all
three open questions on 2026-11-10, each the recommended answer.

### D-A-PY-01: what R29 found on `v2`

- **No stack has a lockfile install.** Every check, and the runner a suite
  check starts, runs over the base's own `node_modules` (D-R15-05,
  `packages/api/src/workspace.ts:230-241`); a suite check whose runner the
  base did not install is refused (`packages/api/src/verification.ts:100-113`).
  Issue #40 is open with no owning unit. The entry's "lockfile install (#40)"
  and "the same conformance kit the TypeScript set passes" cannot both hold.
- **Python cannot take dependencies from the base.** A virtualenv records the
  absolute path of the interpreter that made it and links to it, so one made
  on the host does not run in a check's Linux container. A Python check can
  only run over an install made where it runs.
- **Installing needs a grant policy cannot express.** Egress is a role's
  (`CapabilityScope.network`, `packages/core/src/policy/types.ts:20`), and a
  check is no role's: every check sandbox is `deny-all`
  (`packages/api/src/line.ts:19-32`). An install the runtime runs needs its
  own field.
- **The check image is Node.** `checkImage` defaults to the driver's
  `BASE_IMAGE`, a `node` image pinned by digest
  (`packages/api/src/host/compose.ts:245`,
  `packages/drivers/claude-code/src/image.ts:23`). No pytest is in it.
- **Readiness knows Node only.** Its lockfiles, install, build, suite, and
  coverage commands are Node's (`packages/readiness/src/scan.ts:92`,
  `:189-205`, `:390`, `:400-421`), so a Python repository is held at `L0`
  whatever its adapters are.
- **Parsing stays on the host and runs nothing.** Every adapter parses a
  config or a test file statically, and `I1.adapters-execute-nothing-on-the-host`
  (`packages/conformance/src/registry/adapters.ts:85`) forbids starting a
  process. Python's parse must therefore be done in TypeScript.
- **What already carries over:** the run's stack is an open `string`
  (`packages/vault/src/types.ts:671`), set from `set.stack`
  (`packages/api/src/run.ts:1192`); a lockfile change is a config change and
  so a protected path touched (`packages/api/src/tamper.ts:169`); the Semgrep
  scanner's rules are the manifest's, and Semgrep reads Python
  (`packages/adapters/src/security.ts:169-183`).

### D-A-PY-02: the install is its own unit, R34, ordered before R29

- **Chosen:** #40 becomes R34. The runtime installs from the head's lockfile
  in a sandbox of its own, with egress to the registries policy grants
  (A-R34-01, empty by default) and no lifecycle scripts, into a directory it
  owns; every check runs with no egress over the tree with that directory
  mounted read-only. R29 depends on R34 and declares Python's installer.
- **Why:** R29 needs the install, the install needs a policy contract
  change, and npm and pnpm need it as much as Python does (D-R15-05's known
  limit). One unit for one mechanism, used by every stack.
- **Rejected:** *R29 absorbs #40.* It still needs this amendment for the
  policy field, and the unit doubles. *Adapters only, with Python unable to
  pass `verify`.* That is the partial support R29's out-of-scope list rules
  out. *Installing in each check's sandbox,* as #40 first proposed: every
  check would then need egress while running repository code.
- **Reverse:** fold R34's entry into R29 and drop R34 from the table.

### D-A-PY-03: pytest only

- **Chosen:** R29's test adapter is pytest, selected when the project
  declares it, which covers unittest-style classes pytest collects. A
  repository that runs only the unittest runner gets `test: null`, naming it.
- **Why:** one runner whose collection rules can be copied from its source,
  as D-P8-05 did for vitest and jest; a second runner is a second set of
  rules to keep exact.
- **Reverse:** add a unittest adapter with its own discovery rules.

### D-A-PY-04: Python lockfiles: `uv.lock` and hashed requirements

- **Chosen:** `uv.lock`, installed with `uv sync --frozen`, and a
  `requirements.txt` whose every line carries a hash, installed with
  `pip install --require-hashes --no-deps`. Poetry, Pipenv, and unhashed
  requirements are refused, naming the file.
- **Why:** both formats pin every package by hash, which R34 requires of every
  install.
- **Reverse:** declare another installer in R34's table.

### D-A-PY-05: contract changes R29 and R34 build

- **A-R34-01:** policy gains the registries an install may reach, absent or
  empty by default (`packages/core/src/policy/types.ts`).
- **A-R34-02:** an installer declaration per stack beside `DependencyAuditor`
  (`packages/adapters/src/types.ts`), and the evidence bundle gains the
  lockfile diff and the installed tree's hash (`packages/vault/src/types.ts`).
- **A-R29-01:** `AdapterSet` names its dependency trees and its installer, so
  D-R15-05's rule and R34's install are keyed off the set rather than off
  `node_modules` (`packages/adapters/src/types.ts`).
