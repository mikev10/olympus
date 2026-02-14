/**
 * Tests for IDEA and INTENT artifact validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { validateIdea, validateIntent, clearFileCache } from '../../features/workflow-engine/validation.js';

const TEST_DIR = join(process.cwd(), '.tmp-test-validation');

// Test fixture: Valid IDEA artifact
const VALID_IDEA = `---
risk_tier: low
status: draft
---

# Feature: User Authentication

## Problem Statement

Users currently cannot securely access their accounts. We need a robust authentication system that supports multiple login methods and provides secure session management.

## User Personas

Our platform is expanding to handle sensitive user data. Regulatory requirements (GDPR, SOC2) mandate strong authentication controls. Competitors offer 2FA and social login, which we currently lack.

Market research shows 45% of users abandon registration if the process is too complex. We need a balance between security and usability.

## Success Metrics

- Reduce account takeover incidents by 80% within 6 months
- Achieve 90%+ successful login rate (minimize friction)
- Support 3+ authentication methods (password, Google, GitHub)
- Meet SOC2 compliance requirements for access control

## Business Constraints

- Must integrate with existing user database schema
- Cannot break current session management for active users
- Must support mobile and web clients
- Budget: 2 engineer-months, $15K for third-party services
- Compliance: Must meet GDPR data retention requirements

## Out of Scope

- Enterprise SSO integration (deferred to Phase 2)
- Biometric authentication (not supported on web platform)
- Password strength meter UI (handled by browser)
`;

// Test fixture: Missing problem statement
const MISSING_PROBLEM = `---
risk_tier: medium
---

# Feature: Data Export

## User Personas

Users need to export their data for compliance reasons.

## Success Metrics

- Support CSV and JSON formats
- Process exports within 5 minutes

## Business Constraints

- Must handle large datasets efficiently
- Privacy regulations require audit logging

## Out of Scope

Build async export pipeline with queue processing.
`;

// Test fixture: Only 1 success metric
const ONE_METRIC = `---
risk_tier: low
---

# Feature: Dark Mode

## Problem Statement

Users have requested a dark theme for better nighttime usage.

## User Personas

Accessibility and user preference are key differentiators.

## Success Metrics

- 30% of users enable dark mode within first month

## Business Constraints

- Must maintain WCAG AA contrast ratios
- All components must support theme switching

## Out of Scope

CSS custom properties with theme toggle component.
`;

// Test fixture: Missing risk tier
const NO_RISK_TIER = `# Feature: Analytics Dashboard

## Problem Statement

Need real-time analytics for user behavior tracking.

## User Personas

Data-driven decisions require visibility into user actions.

## Success Metrics

- Display metrics with <2 second latency
- Support 10+ custom metric types
- 90% uptime SLA

## Business Constraints

- Must handle 1M+ events per day
- Privacy-compliant data collection

## Out of Scope

Event streaming pipeline with real-time aggregation.
`;

// Test fixture: Missing constraints
const NO_CONSTRAINTS = `---
risk_tier: high
---

# Feature: Payment Processing

## Problem Statement

Need to accept credit card payments from customers.

## User Personas

Revenue generation requires payment infrastructure.

## Success Metrics

- Support Visa, Mastercard, Amex
- Process payments with 99.9% success rate

## Out of Scope

Integrate with Stripe payment gateway.
`;

// Test fixture: Empty business context
const EMPTY_BUSINESS_CONTEXT = `---
risk_tier: medium
---

# Feature: Email Notifications

## Problem Statement

Users miss important updates without notifications.

## User Personas

## Success Metrics

- Deliver notifications within 1 minute
- 60% open rate for transactional emails

## Business Constraints

- Must support email and SMS channels
- Comply with CAN-SPAM regulations

## Out of Scope

Event-driven notification system with queuing.
`;

// Test fixture: Missing solution approach section
const MISSING_SECTION = `---
risk_tier: low
---

# Feature: Search

## Problem Statement

Users cannot find content efficiently in the app.

## User Personas

Search is critical for content discovery and user engagement.

## Success Metrics

- Search results in <500ms
- 70% of searches return relevant results

## Business Constraints

- Must index 100K+ documents
- Support fuzzy matching and filters
`;

describe('validateIdea', () => {
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

  it('should pass validation for complete IDEA artifact', async () => {
    const filePath = join(TEST_DIR, 'valid-idea.md');
    writeFileSync(filePath, VALID_IDEA, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(true);
    expect(result.coverage_percentage).toBe(100);
    expect(result.blocking_issues).toHaveLength(0);
    expect(result.timestamp).toBeDefined();
  });

  it('should fail when problem statement is missing', async () => {
    const filePath = join(TEST_DIR, 'missing-problem.md');
    writeFileSync(filePath, MISSING_PROBLEM, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('Missing problem statement section');
    expect(result.coverage_percentage).toBeLessThan(100);
  });

  it('should fail when user personas section is empty', async () => {
    const filePath = join(TEST_DIR, 'empty-context.md');
    writeFileSync(filePath, EMPTY_BUSINESS_CONTEXT, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('User Personas section is empty');
  });

  it('should fail when only 1 success metric is present', async () => {
    const filePath = join(TEST_DIR, 'one-metric.md');
    writeFileSync(filePath, ONE_METRIC, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain(
      'Only 1 success metric found, need at least 2'
    );
  });

  it('should fail when business constraints section is missing', async () => {
    const filePath = join(TEST_DIR, 'no-constraints.md');
    writeFileSync(filePath, NO_CONSTRAINTS, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('Business Constraints section missing');
    expect(result.blocking_issues).toContain('Missing required section: Business Constraints');
  });

  it('should fail when risk_tier is not specified in frontmatter', async () => {
    const filePath = join(TEST_DIR, 'no-risk-tier.md');
    writeFileSync(filePath, NO_RISK_TIER, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('Risk tier not specified in frontmatter');
  });

  it('should fail when required section is missing', async () => {
    const filePath = join(TEST_DIR, 'missing-section.md');
    writeFileSync(filePath, MISSING_SECTION, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('Missing required section: Out of Scope');
  });

  it('should return error when artifact file does not exist', async () => {
    const filePath = join(TEST_DIR, 'nonexistent.md');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    expect(result.coverage_percentage).toBe(0);
    expect(result.blocking_issues).toContain('Artifact file not found');
    expect(result.timestamp).toBeDefined();
  });

  it('should calculate coverage_percentage correctly', async () => {
    const filePath = join(TEST_DIR, 'partial.md');
    // This has 4 passing criteria out of 6:
    // ✓ Problem statement present
    // ✓ Business context present
    // ✓ At least 2 success metrics
    // ✗ Constraints missing (counts as 2 failures: empty check + section check)
    // ✓ Risk tier present
    writeFileSync(filePath, NO_CONSTRAINTS, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    // 4 passed out of 6 = 67%
    expect(result.coverage_percentage).toBe(67);
  });

  it('should list all blocking issues when multiple criteria fail', async () => {
    const filePath = join(TEST_DIR, 'multiple-failures.md');
    const multipleIssues = `# Feature: Incomplete

## Problem Statement

Some problem.

## Success Metrics

- Only one metric
`;
    writeFileSync(filePath, multipleIssues, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues.length).toBeGreaterThan(3);
    expect(result.blocking_issues).toContain('Risk tier not specified in frontmatter');
    expect(result.blocking_issues).toContain('User Personas section is empty');
    expect(result.blocking_issues).toContain('Only 1 success metric found, need at least 2');
    expect(result.blocking_issues).toContain('Business Constraints section missing');
  });

  it('should handle artifacts with no frontmatter', async () => {
    const filePath = join(TEST_DIR, 'no-frontmatter.md');
    const noFrontmatter = `# Feature: No Frontmatter

## Problem Statement

Testing without frontmatter.

## User Personas

Some context.

## Success Metrics

- Metric 1
- Metric 2

## Business Constraints

Some constraints.

## Out of Scope

Some solution.
`;
    writeFileSync(filePath, noFrontmatter, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('Risk tier not specified in frontmatter');
  });

  it('should count different bullet point styles', async () => {
    const filePath = join(TEST_DIR, 'bullet-styles.md');
    const mixedBullets = `---
risk_tier: low
---

# Feature: Mixed Bullets

## Problem Statement

Testing bullet point counting.

## User Personas

Some context here.

## Success Metrics

- Metric with dash
* Metric with asterisk
+ Metric with plus

## Business Constraints

- Constraint 1
* Constraint 2

## Out of Scope

Implementation details.
`;
    writeFileSync(filePath, mixedBullets, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(true);
    expect(result.coverage_percentage).toBe(100);
  });

  it('should handle sections with extra whitespace', async () => {
    const filePath = join(TEST_DIR, 'whitespace.md');
    const whitespaceContent = `---
risk_tier: medium
---

# Feature: Whitespace Test

## Problem Statement

  Problem with extra spaces.

## User Personas

  Context with whitespace.

## Success Metrics

  - Metric 1 with spaces
  - Metric 2 with spaces

## Business Constraints

  - Constraint with spaces

## Out of Scope

  Solution with spaces.
`;
    writeFileSync(filePath, whitespaceContent, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(true);
    expect(result.coverage_percentage).toBe(100);
  });
});

// Test fixtures for INTENT validation
const VALID_INTENT = `---
id: intent-test-workflow
title: "User Authentication"
parent: "idea-test-workflow"
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
parent: "idea-test"
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
parent: "idea-test"
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
parent: "idea-test"
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
parent: "idea-test"
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
parent: "idea-test"
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
parent: "idea-test"
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
parent: "idea-test"
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
