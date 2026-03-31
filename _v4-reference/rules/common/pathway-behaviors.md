# Pathway Behaviors

**Loading note**: The orchestrator loads this file at the start of each Construction unit and
injects the section matching `checkpoint.pathway_type` into the agent context. Only the
relevant section is injected — the agent sees its pathway section, not the full file.

---

## Bugfix Pathway

These rules are non-negotiable. Every bugfix unit must satisfy all items in the quality gate
before the unit is marked complete.

### Autonomous Diagnosis

Before writing any code change, the agent must:

1. Reproduce the defect with a failing test or a documented reproduction recipe
2. Identify the root cause — the specific code path, assumption, or edge case that causes
   the failure
3. Document the root cause in the `## Root Cause` section of the unit's `test-report.md`

Do not write a fix before completing the diagnosis. A fix that addresses only the symptom
will likely fail the quality gate.

### Root Cause Analysis Requirement

The `test-report.md` for a bugfix unit must contain a `## Root Cause` section with:
- File path and line number(s) of the defect
- A one-paragraph explanation of why the failure occurs
- Confirmation that the fix targets the root cause, not a workaround

### Missing Test Rule (Non-Negotiable)

Every bugfix unit MUST produce at least one new test that:
- Reproduces the original defect (fails before the fix, passes after)
- Is placed in the appropriate test file for the affected module
- Is named to clearly identify the defect it guards against

This rule cannot be overridden via `allowFailures`. The engine blocks unit completion if
`tests_total === 0` for any bugfix unit, regardless of options passed.

### Quality Gate Checklist

All items must be satisfied before the bugfix unit is marked complete:

- [ ] Root cause identified and documented in `test-report.md`
- [ ] Fix addresses the root cause (not just the symptom)
- [ ] All existing tests still pass (zero regressions)
- [ ] At least one new test reproduces the original defect
- [ ] New test passes with the fix applied

---

## Optimization Pathway

### Baseline Measurement

Before making any code changes:

1. Run the relevant benchmark or performance test
2. Record the baseline metric (e.g., execution time, memory usage, throughput) in the
   `## Baseline` section of the unit's `test-report.md`
3. Note the test command used and any environment conditions that could affect the result

Do not proceed with changes until the baseline is captured. A comparison without a baseline
is not a valid optimization result.

### Performance Comparison

After applying changes:

1. Run the same benchmark or performance test under the same conditions
2. Record the result in the `## Performance Comparison` section of `test-report.md`:
   - Baseline metric
   - Post-change metric
   - Delta (absolute and percentage)
3. Confirm the improvement meets the acceptance criteria defined in the unit spec

If performance has not improved, investigate before marking the unit complete.

### Rollback Plan

Document in `test-report.md` how to revert the optimization if it causes a regression in
production:
- Which files were changed
- The prior behavior that would need to be restored
- Any feature flags or config knobs that could disable the optimization without a deploy

---

## Standard / Enhancement / Greenfield Pathways

No additional behavioral constraints apply beyond the standard rules defined in:

- `resources/rules/construction/code-generation.md`
- `resources/rules/construction/test-generation.md`

Follow those rules as written. The orchestrator does not inject any additional context for
these pathways.
