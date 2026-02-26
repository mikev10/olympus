/**
 * Tests for INTENT artifact validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { validateIntent, clearFileCache } from '../../features/workflow-engine/validation.js';

const TEST_DIR = join(process.cwd(), '.tmp-test-validation');

// Test fixtures for INTENT validation
const VALID_INTENT = `---
id: intent-test-workflow
title: "User Authentication"
parent: "intent-test-workflow"
status: draft
depth_score: 15
risk_tier: 2
---

# INTENT: User Authentication

## Business Requirements

### User Stories
- **US-001**: As a user, I want to log in so that I can access my account
  - Acceptance: User can log in with email and password
- **US-002**: As a user, I want to reset my password so that I can regain access
  - Acceptance: Password reset email is sent within 1 minute

### Business Rules
- **BR-001**: Reset links expire after 1 hour

## Technical Specification

### Architecture Overview
OAuth 2.0 based authentication with JWT tokens.

### API Design
POST /auth/login - Authenticate user

## Implementation Plan

### Proposed UNITs
- **UNIT-001**: Auth Service — Core authentication logic
- **UNIT-002**: Token Manager — JWT token lifecycle

### Cross-UNIT Dependencies
- UNIT-002 depends on UNIT-001's user validation
`;

describe('validateIntent', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    // Clear file cache before each test
    clearFileCache();
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    clearFileCache();
  });

  it('should pass validation for complete INTENT artifact', async () => {
    const filePath = join(TEST_DIR, 'valid-intent.md');
    writeFileSync(filePath, VALID_INTENT, 'utf-8');

    const result = await validateIntent(filePath);

    expect(result.passed).toBe(true);
    expect(result.coverage_percentage).toBe(100);
    expect(result.blocking_issues).toHaveLength(0);
    expect(result.timestamp).toBeDefined();
  });

  it('should fail when frontmatter is missing required fields', async () => {
    const filePath = join(TEST_DIR, 'missing-frontmatter.md');
    const missingFrontmatter = `---
id: intent-test
title: "Test"
---

# INTENT: Test

## Business Requirements

### User Stories
- **US-001**: Some story
  - Acceptance: Some acceptance

## Technical Specification

Some technical details.

## Implementation Plan

### Proposed UNITs
- **UNIT-001**: Some unit
`;
    writeFileSync(filePath, missingFrontmatter, 'utf-8');

    const result = await validateIntent(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('Frontmatter missing required field: parent');
    expect(result.blocking_issues).toContain('Frontmatter missing required field: status');
    expect(result.blocking_issues).toContain('Frontmatter missing required field: depth_score');
    expect(result.blocking_issues).toContain('Frontmatter missing required field: risk_tier');
  });

  it('should fail when Business Requirements section is missing', async () => {
    const filePath = join(TEST_DIR, 'no-business-reqs.md');
    const noBizReqs = `---
id: intent-test
title: "Test"
parent: "intent-test"
status: draft
depth_score: 10
risk_tier: 1
---

# INTENT: Test

## Technical Specification

Some technical details.

## Implementation Plan

### Proposed UNITs
- **UNIT-001**: Some unit
`;
    writeFileSync(filePath, noBizReqs, 'utf-8');

    const result = await validateIntent(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('Missing Business Requirements section');
  });

  it('should fail when no User Stories are present', async () => {
    const filePath = join(TEST_DIR, 'no-user-stories.md');
    const noUserStories = `---
id: intent-test
title: "Test"
parent: "intent-test"
status: draft
depth_score: 10
risk_tier: 1
---

# INTENT: Test

## Business Requirements

No user stories here, just text.

## Technical Specification

Some technical details.

## Implementation Plan

### Proposed UNITs
- **UNIT-001**: Some unit
`;
    writeFileSync(filePath, noUserStories, 'utf-8');

    const result = await validateIntent(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('No User Stories found (expected US-NNN pattern)');
  });

  it('should fail when User Story is missing Acceptance criterion', async () => {
    const filePath = join(TEST_DIR, 'no-acceptance.md');
    const noAcceptance = `---
id: intent-test
title: "Test"
parent: "intent-test"
status: draft
depth_score: 10
risk_tier: 1
---

# INTENT: Test

## Business Requirements

### User Stories
- **US-001**: As a user, I want to test
- **US-002**: As a user, I want to verify
  - Acceptance: This one has acceptance

## Technical Specification

Some technical details.

## Implementation Plan

### Proposed UNITs
- **UNIT-001**: Some unit
`;
    writeFileSync(filePath, noAcceptance, 'utf-8');

    const result = await validateIntent(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('User Story US-001 missing Acceptance criterion');
  });

  it('should fail when Technical Specification section is missing', async () => {
    const filePath = join(TEST_DIR, 'no-tech-spec.md');
    const noTechSpec = `---
id: intent-test
title: "Test"
parent: "intent-test"
status: draft
depth_score: 10
risk_tier: 1
---

# INTENT: Test

## Business Requirements

### User Stories
- **US-001**: As a user, I want to test
  - Acceptance: Test acceptance

## Implementation Plan

### Proposed UNITs
- **UNIT-001**: Some unit
`;
    writeFileSync(filePath, noTechSpec, 'utf-8');

    const result = await validateIntent(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('Technical Specification section missing or empty');
  });

  it('should fail when Implementation Plan section is missing', async () => {
    const filePath = join(TEST_DIR, 'no-impl-plan.md');
    const noImplPlan = `---
id: intent-test
title: "Test"
parent: "intent-test"
status: draft
depth_score: 10
risk_tier: 1
---

# INTENT: Test

## Business Requirements

### User Stories
- **US-001**: As a user, I want to test
  - Acceptance: Test acceptance

## Technical Specification

Some technical details.
`;
    writeFileSync(filePath, noImplPlan, 'utf-8');

    const result = await validateIntent(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('Implementation Plan section missing or empty');
  });

  it('should fail when no Proposed UNITs are present', async () => {
    const filePath = join(TEST_DIR, 'no-units.md');
    const noUnits = `---
id: intent-test
title: "Test"
parent: "intent-test"
status: draft
depth_score: 10
risk_tier: 1
---

# INTENT: Test

## Business Requirements

### User Stories
- **US-001**: As a user, I want to test
  - Acceptance: Test acceptance

## Technical Specification

Some technical details.

## Implementation Plan

Just some text, no UNITs.
`;
    writeFileSync(filePath, noUnits, 'utf-8');

    const result = await validateIntent(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('No Proposed UNITs found (expected UNIT-NNN pattern)');
  });

  it('should return error when artifact file does not exist', async () => {
    const filePath = join(TEST_DIR, 'nonexistent-intent.md');

    const result = await validateIntent(filePath);

    expect(result.passed).toBe(false);
    expect(result.coverage_percentage).toBe(0);
    expect(result.blocking_issues).toContain('Artifact file not found');
    expect(result.timestamp).toBeDefined();
  });

  it('should calculate coverage_percentage correctly', async () => {
    const filePath = join(TEST_DIR, 'partial-intent.md');
    // This has 4 passing criteria out of 6:
    // ✓ Criterion 1 (Frontmatter): All fields present - PASS (no blocking issues)
    // ✓ Criterion 2 (Business Requirements with User Stories): Section exists with US-001 - PASS
    // ✓ Criterion 3 (User Stories have Acceptance): US-001 has "Acceptance:" - PASS
    // ✓ Criterion 4 (Technical Specification): Section exists and has content - PASS
    // ✗ Criterion 5 (Implementation Plan): Section missing - FAIL
    // ✗ Criterion 6 (Proposed UNITs): No UNIT-NNN pattern found - FAIL
    const partialIntent = `---
id: intent-test
title: "Test"
parent: "intent-test"
status: draft
depth_score: 10
risk_tier: 1
---

# INTENT: Test

## Business Requirements

### User Stories
- **US-001**: As a user, I want to test
  - Acceptance: Test acceptance

## Technical Specification

Some technical specification content here.
`;
    writeFileSync(filePath, partialIntent, 'utf-8');

    const result = await validateIntent(filePath);

    expect(result.passed).toBe(false);
    // 4 passed out of 6 = 67%
    expect(result.coverage_percentage).toBe(67);
  });
});
