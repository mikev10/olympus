BASE: 03518f9
HEAD: a320a01
packages/vault/src/types.ts
8fb8eb939017393c762e433152d61f66

I had no prior context about this project and performed no lookups.

### 1. Tautological check for runs at their ceiling
`packages/conformance/src/registry/admission-readiness.ts:160` — tautological — low

The test explicitly claims to check that a run exactly at its readiness ceiling is admitted:
```typescript
if (admissionRefusal(at(record.readiness)) !== undefined) throw new Error('I5: a record at its ceiling was refused');
```
However, the rig creates an L1 request (`requestedLevel: 1`) and a readiness scan ceiling of L2 (`RIG_READINESS` returns `level: 2`). Therefore, `record.readiness.level` is 2, while `requestedLevel` is 1. 

The function under test evaluates `level > readiness.level` (`1 > 2`), which is trivially false, returning `undefined`. If the implementation contained a bug that wrongly rejected runs exactly *at* their ceiling by checking `level >= readiness.level`, this test would evaluate `1 >= 2` and still pass. Because the test feeds the function a run *below* its ceiling, it passes regardless of whether the boundary logic (`>` vs `>=`) is correct.

**To resolve:** Modify the test to construct a record where the requested level equals the readiness level (e.g., `at({ ...record.readiness, level: 1 })` combined with `requestedLevel: 1`, or test against an L2 requested run).

### Assessment of Mechanisms
The framing and question are correct. I assess the core admission logic implemented in `admissionRefusal` and `readinessAt` as **sound**:
1. **Fail Closed / Default Deny:** Legacy records (`readiness === undefined`) or missing scans (`req.readiness === null`) correctly fall through to `readiness-unscanned` for any requested level above L0, ensuring no run executes autonomously without a bound. 
2. **Prioritization of checks:** Evaluating `controls-unavailable` before the readiness checks (for L3) guarantees that missing controls are correctly named and reported before the run is rejected for missing a scan, preventing the readiness check from eclipsing missing adapter capabilities as explicitly intended.
3. **Immutability of L0:** Runs requested at L0 immediately record `level-zero` and are safely admitted without a scan, maintaining the property that a scan only lowers levels and L0 is always valid. Resume operations correctly replay this off the Vault's recorded integer rather than untrusted client inputs.