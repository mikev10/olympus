I hold no prior context about this project, and I performed no external lookups.

BASE: bd03b6f
HEAD: 174bf3a
packages/vault/src/types.ts
a83cd161fa6cb4d37145f5d606f4c11a

### Findings

packages/api/src/observe.ts:168 - fails open - high - An exception (e.g., a transient Vault I/O error or rate limit) during the sequential `vault.recordObservation` loop inside `observePlan` causes a partial write of the plan's signals. On the next scheduled history walk, `already.some((e) => e.record.signal.kind === 'plan-signal')` detects the first successfully written signal, immediately returns `'recorded'`, and completely skips evaluating and recording the remaining checks and the rollback condition. The walk then proceeds to close the observation window as if it were fully observed, allowing a change with failing/missing checks to bypass observation and have its window closed as clean. - Resolve by ensuring the number of existing `plan-signal` records matches the total number of planned checks before returning `'recorded'`, or write all signals and the rollback condition in a single atomic transaction.

packages/api/src/drafting.ts:512 - tautological checks / bypass - high - The adversarial model drafting the tests and the observation plan has full control over the `works` array. It can deliberately name a tautological or trivial check (e.g., a basic code formatter, a static analysis linter, or a CLA check) that is guaranteed to pass regardless of the actual code under test. Because the runtime blindly trusts the CI check names drafted by the model, it will observe this trivial check as `working`, recording the merged change as healthy even if the actual behavioral tests failed or were never run by the named check. - Resolve by requiring the model to map the named CI checks to the specific drafted acceptance tests and validating this mapping, or by having the runtime independently extract and enforce the relevant check names without relying on model input.