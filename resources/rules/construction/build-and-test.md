# Build and Test

**Purpose**: Build all units and execute comprehensive testing strategy

## Prerequisites
- Code Generation must be complete for all units
- All code artifacts must be generated
- Project is ready for build and testing

## Agent Delegation Strategy

**MANDATORY**: Delegate test execution to `qa-tester`. Do NOT run test suites directly.

**Execution mode**: Foreground sequential — the orchestrator generates instruction documents first, then delegates actual test execution to the agent.

**Delegation scope**:
- **Orchestrator retains**: Steps 1-7 (analyze testing requirements, generate build instructions, generate unit/integration/performance/additional test instructions, generate test summary) and Steps 8-10 (state update, results presentation, audit logging). The orchestrator creates all instruction documentation.
- **Delegated to `qa-tester`**: After instruction documents are generated (post-Step 7), delegate actual test execution to `qa-tester`. The agent uses the generated instruction files as input to build the project and run all test suites (unit, integration, performance, etc.). The agent reports pass/fail results for each test category.

**If an agent task fails**: Follow the Agent Task Failure Recovery procedure in `error-handling.md` — retry the delegation, never silently do the work yourself.

**After agent completes**: The orchestrator incorporates the agent's test results into the build-and-test-summary.md, presents the results to the user (Step 9), and manages the approval gate.

## Orchestrator Verification Requirements

After `qa-tester` reports results, the orchestrator MUST independently verify — never trust agent self-reports alone:

- **Build Verification**: Run the build command yourself (e.g., `npm run build`, `mvn clean install`) and confirm exit code 0.
- **Test Verification**: Run the test suite yourself and confirm all tests pass. Compare your results against the agent's report.
- **Failure Loop**: If failures are found, delegate fixes to the appropriate agent (`olympian` for code fixes, `oracle` or `oracle-medium` for root cause analysis), then re-verify independently.
- **No Early Exit**: Do not declare Build & Test complete until ALL test categories pass your independent verification.
- **Evidence-Based Reporting**: When presenting results to the user (Step 9), include the actual command output you observed, not just the agent's summary.

---

## Step 1: Analyze Testing Requirements

Analyze the project to determine appropriate testing strategy:
- **Unit tests**: Already generated per unit during code generation
- **Integration tests**: Test interactions between units/services
- **Performance tests**: Load, stress, and scalability testing
- **End-to-end tests**: Complete user workflows
- **Contract tests**: API contract validation between services
- **Security tests**: Vulnerability scanning, penetration testing

---

## Step 2: Generate Build Instructions

Create `aidlc-docs/construction/build-and-test/build-instructions.md`:

```markdown
# Build Instructions

## Prerequisites
- **Build Tool**: [Tool name and version]
- **Dependencies**: [List all required dependencies]
- **Environment Variables**: [List required env vars]
- **System Requirements**: [OS, memory, disk space]

## Build Steps

### 1. Install Dependencies
\`\`\`bash
[Command to install dependencies]
# Example: npm install, mvn dependency:resolve, pip install -r requirements.txt
\`\`\`

### 2. Configure Environment
\`\`\`bash
[Commands to set up environment]
# Example: export variables, configure credentials
\`\`\`

### 3. Build All Units
\`\`\`bash
[Command to build all units]
# Example: mvn clean install, npm run build, brazil-build
\`\`\`

### 4. Verify Build Success
- **Expected Output**: [Describe successful build output]
- **Build Artifacts**: [List generated artifacts and locations]
- **Common Warnings**: [Note any acceptable warnings]

## Troubleshooting

### Build Fails with Dependency Errors
- **Cause**: [Common causes]
- **Solution**: [Step-by-step fix]

### Build Fails with Compilation Errors
- **Cause**: [Common causes]
- **Solution**: [Step-by-step fix]
```

---

## Step 3: Generate Unit Test Execution Instructions

Create `aidlc-docs/construction/build-and-test/unit-test-instructions.md`:

```markdown
# Unit Test Execution

## Run Unit Tests

### 1. Execute All Unit Tests
\`\`\`bash
[Command to run all unit tests]
# Example: mvn test, npm test, pytest tests/unit
\`\`\`

### 2. Review Test Results
- **Expected**: [X] tests pass, 0 failures
- **Test Coverage**: [Expected coverage percentage]
- **Test Report Location**: [Path to test reports]

### 3. Fix Failing Tests
If tests fail:
1. Review test output in [location]
2. Identify failing test cases
3. Fix code issues
4. Rerun tests until all pass
```

---

## Step 4: Generate Integration Test Instructions

Create `aidlc-docs/construction/build-and-test/integration-test-instructions.md`:

```markdown
# Integration Test Instructions

## Purpose
Test interactions between units/services to ensure they work together correctly.

## Test Scenarios

### Scenario 1: [Unit A] → [Unit B] Integration
- **Description**: [What is being tested]
- **Setup**: [Required test environment setup]
- **Test Steps**: [Step-by-step test execution]
- **Expected Results**: [What should happen]
- **Cleanup**: [How to clean up after test]

### Scenario 2: [Unit B] → [Unit C] Integration
[Similar structure]

## Setup Integration Test Environment

### 1. Start Required Services
\`\`\`bash
[Commands to start services]
# Example: docker-compose up, start test database
\`\`\`

### 2. Configure Service Endpoints
\`\`\`bash
[Commands to configure endpoints]
# Example: export API_URL=http://localhost:8080
\`\`\`

## Run Integration Tests

### 1. Execute Integration Test Suite
\`\`\`bash
[Command to run integration tests]
# Example: mvn integration-test, npm run test:integration
\`\`\`

### 2. Verify Service Interactions
- **Test Scenarios**: [List key integration test scenarios]
- **Expected Results**: [Describe expected outcomes]
- **Logs Location**: [Where to check logs]

### 3. Cleanup
\`\`\`bash
[Commands to clean up test environment]
# Example: docker-compose down, stop test services
\`\`\`
```

---

## Step 5: Generate Performance Test Instructions (If Applicable)

Create `aidlc-docs/construction/build-and-test/performance-test-instructions.md`:

```markdown
# Performance Test Instructions

## Purpose
Validate system performance under load to ensure it meets requirements.

## Performance Requirements
- **Response Time**: < [X]ms for [Y]% of requests
- **Throughput**: [X] requests/second
- **Concurrent Users**: Support [X] concurrent users
- **Error Rate**: < [X]%

## Setup Performance Test Environment

### 1. Prepare Test Environment
\`\`\`bash
[Commands to set up performance testing]
# Example: scale services, configure load balancers
\`\`\`

### 2. Configure Test Parameters
- **Test Duration**: [X] minutes
- **Ramp-up Time**: [X] seconds
- **Virtual Users**: [X] users

## Run Performance Tests

### 1. Execute Load Tests
\`\`\`bash
[Command to run load tests]
# Example: jmeter -n -t test.jmx, k6 run script.js
\`\`\`

### 2. Execute Stress Tests
\`\`\`bash
[Command to run stress tests]
# Example: gradually increase load until failure
\`\`\`

### 3. Analyze Performance Results
- **Response Time**: [Actual vs Expected]
- **Throughput**: [Actual vs Expected]
- **Error Rate**: [Actual vs Expected]
- **Bottlenecks**: [Identified bottlenecks]
- **Results Location**: [Path to performance reports]

## Performance Optimization

If performance doesn't meet requirements:
1. Identify bottlenecks from test results
2. Optimize code/queries/configurations
3. Rerun tests to validate improvements
```

---

## Step 6: Generate Additional Test Instructions (As Needed)

Based on project requirements, generate additional test instruction files:

### Contract Tests (For Microservices)
Create `aidlc-docs/construction/build-and-test/contract-test-instructions.md`:
- API contract validation between services
- Consumer-driven contract testing
- Schema validation

### Security Tests
Create `aidlc-docs/construction/build-and-test/security-test-instructions.md`:
- Vulnerability scanning
- Dependency security checks
- Authentication/authorization testing
- Input validation testing

### End-to-End Tests
Create `aidlc-docs/construction/build-and-test/e2e-test-instructions.md`:
- Complete user workflow testing
- Cross-service scenarios
- UI testing (if applicable)

---

## Step 6b: Run Smoke Tests

Run the full test suite (or a targeted subset for bugfix pathway) and generate a structured
test report that aggregates results across all units.

**Scope parameter** — determined by `pathway_type`:

| Scope | Pathway | What runs |
|-------|---------|-----------|
| `full` | standard, comprehensive, brownfield-enhancement, brownfield-refactor | Entire test suite |
| `targeted` | bugfix | Only tests for changed units (scoped by file path filter) |
| `summary` | minimal, optimization | Smoke pass — quick sanity check only |

**Delegation**: Delegate test execution to `qa-tester` using the same pattern established
in the Agent Delegation Strategy section. The orchestrator generates the scope instruction
first, then delegates; after the agent reports, the orchestrator runs the test command
independently to verify (see Orchestrator Verification Requirements above).

**Output artifact**: `aidlc-docs/{workflow-id}/construction/build-and-test/test-report.md`

Aggregate per-unit test reports from `aidlc-docs/{workflow-id}/construction/{unit}/testing/test-report.md`
into the build-level report using this schema:

```markdown
# Test Report — Build and Test

## Summary

| Metric | Value |
|--------|-------|
| total_tests | [X] |
| passed | [X] |
| failed | [X] |
| skipped | [X] |

## Per-Unit Breakdown

| Unit | Total | Passed | Failed | Skipped | Status |
|------|-------|--------|--------|---------|--------|
| [unit-id] | [X] | [X] | [X] | [X] | Pass/Fail |

## Failure Details

[For each failing test: unit, test name, file path, error message]

## Remediation Guidance

[Populated only when failures exist — links to the failing unit's test-report.md]
\`\`\`

**Critical failure gate**: If `tests_failed > 0` and `allowFailures` is not set:
- Block workflow progression
- Surface the failing unit's `test-report.md` path in the Remediation Guidance section
- Do NOT proceed to Step 7 until all failures are resolved or `allowFailures` is explicitly
  confirmed by the user

---

## Step 7: Generate Test Summary

Create `aidlc-docs/construction/build-and-test/build-and-test-summary.md`:

```markdown
# Build and Test Summary

## Build Status
- **Build Tool**: [Tool name]
- **Build Status**: [Success/Failed]
- **Build Artifacts**: [List artifacts]
- **Build Time**: [Duration]

## Test Execution Summary

### Unit Tests
- **Total Tests**: [X]
- **Passed**: [X]
- **Failed**: [X]
- **Coverage**: [X]%
- **Status**: [Pass/Fail]

### Integration Tests
- **Test Scenarios**: [X]
- **Passed**: [X]
- **Failed**: [X]
- **Status**: [Pass/Fail]

### Performance Tests
- **Response Time**: [Actual] (Target: [Expected])
- **Throughput**: [Actual] (Target: [Expected])
- **Error Rate**: [Actual] (Target: [Expected])
- **Status**: [Pass/Fail]

### Additional Tests
- **Contract Tests**: [Pass/Fail/N/A]
- **Security Tests**: [Pass/Fail/N/A]
- **E2E Tests**: [Pass/Fail/N/A]

## Overall Status
- **Build**: [Success/Failed]
- **All Tests**: [Pass/Fail]
- **Ready for Operations**: [Yes/No]

## Next Steps
[If all pass]: Ready to proceed to Documentation Generation stage
[If failures]: Address failing tests and rebuild
```

---

## Step 8: MANDATORY: Update State Tracking

**MANDATORY**: Update BOTH state files in the SAME interaction:
1. Update `aidlc-docs/{workflow-id}/aidlc-state.md`:
   - Mark Build and Test stage as complete
   - Update current status
2. Update `aidlc-docs/{workflow-id}/checkpoint.json` — transition to documentation stage:

```json
{
  "current_stage": "documentation",
  "status": "in_progress",
  "active_unit_id": null,
  "units_completed": N
}
```

  - `current_stage` MUST be `"documentation"` (not `"complete"` — Documentation Generation follows)
  - `status` MUST be `"in_progress"`
  - Verify `units_completed` equals `units_total`
  - Verify all units in `construction_units` have `"code_generation_status": "completed"`
- **Do NOT proceed to the next stage without completing this step**

---

## Step 9: Present Results to User

Present comprehensive message:

```
"🔨 Build and Test Complete!

**Build Status**: [Success/Failed]

**Test Results**:
✅ Unit Tests: [X] passed
✅ Integration Tests: [X] scenarios passed
✅ Performance Tests: [Status]
✅ Additional Tests: [Status]

**Generated Files**:
1. ✅ build-instructions.md
2. ✅ unit-test-instructions.md
3. ✅ integration-test-instructions.md
4. ✅ performance-test-instructions.md (if applicable)
5. ✅ [additional test files as needed]
6. ✅ build-and-test-summary.md

Review the summary in aidlc-docs/construction/build-and-test/build-and-test-summary.md

**Ready to proceed to Documentation Generation?""
```

---

## Step 10: Log Interaction

**MANDATORY**: Log the phase completion in `aidlc-docs/audit.md`:

```markdown
## Build and Test Stage
**Timestamp**: [ISO timestamp]
**Build Status**: [Success/Failed]
**Test Status**: [Pass/Fail]
**Files Generated**:
- build-instructions.md
- unit-test-instructions.md
- integration-test-instructions.md
- performance-test-instructions.md
- build-and-test-summary.md

---
```

---

## Mandatory Next Stage: Documentation Generation

After Build and Test is approved, the workflow MUST proceed to Documentation Generation.
Load `~/.claude/olympus/rules/construction/documentation.md` and execute.
This stage is MANDATORY and cannot be skipped regardless of depth, pathway, or trust level.
