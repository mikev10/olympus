/**
 * Tests for IDEA artifact validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { validateIdea } from '../../features/workflow-engine/validation.js';

const TEST_DIR = join(process.cwd(), '.tmp-test-validation');

// Test fixture: Valid IDEA artifact
const VALID_IDEA = `---
risk_tier: low
status: draft
---

# Feature: User Authentication

## Problem Statement

Users currently cannot securely access their accounts. We need a robust authentication system that supports multiple login methods and provides secure session management.

## Business Context

Our platform is expanding to handle sensitive user data. Regulatory requirements (GDPR, SOC2) mandate strong authentication controls. Competitors offer 2FA and social login, which we currently lack.

Market research shows 45% of users abandon registration if the process is too complex. We need a balance between security and usability.

## Success Metrics

- Reduce account takeover incidents by 80% within 6 months
- Achieve 90%+ successful login rate (minimize friction)
- Support 3+ authentication methods (password, Google, GitHub)
- Meet SOC2 compliance requirements for access control

## Constraints

- Must integrate with existing user database schema
- Cannot break current session management for active users
- Must support mobile and web clients
- Budget: 2 engineer-months, $15K for third-party services
- Compliance: Must meet GDPR data retention requirements

## Solution Approach

Implement OAuth 2.0 based authentication with support for:
1. Traditional email/password with bcrypt hashing
2. Social login (Google, GitHub) via OAuth providers
3. Optional 2FA using TOTP (Time-based One-Time Password)
4. JWT-based session tokens with refresh mechanism
`;

// Test fixture: Missing problem statement
const MISSING_PROBLEM = `---
risk_tier: medium
---

# Feature: Data Export

## Business Context

Users need to export their data for compliance reasons.

## Success Metrics

- Support CSV and JSON formats
- Process exports within 5 minutes

## Constraints

- Must handle large datasets efficiently
- Privacy regulations require audit logging

## Solution Approach

Build async export pipeline with queue processing.
`;

// Test fixture: Only 1 success metric
const ONE_METRIC = `---
risk_tier: low
---

# Feature: Dark Mode

## Problem Statement

Users have requested a dark theme for better nighttime usage.

## Business Context

Accessibility and user preference are key differentiators.

## Success Metrics

- 30% of users enable dark mode within first month

## Constraints

- Must maintain WCAG AA contrast ratios
- All components must support theme switching

## Solution Approach

CSS custom properties with theme toggle component.
`;

// Test fixture: Missing risk tier
const NO_RISK_TIER = `# Feature: Analytics Dashboard

## Problem Statement

Need real-time analytics for user behavior tracking.

## Business Context

Data-driven decisions require visibility into user actions.

## Success Metrics

- Display metrics with <2 second latency
- Support 10+ custom metric types
- 90% uptime SLA

## Constraints

- Must handle 1M+ events per day
- Privacy-compliant data collection

## Solution Approach

Event streaming pipeline with real-time aggregation.
`;

// Test fixture: Missing constraints
const NO_CONSTRAINTS = `---
risk_tier: high
---

# Feature: Payment Processing

## Problem Statement

Need to accept credit card payments from customers.

## Business Context

Revenue generation requires payment infrastructure.

## Success Metrics

- Support Visa, Mastercard, Amex
- Process payments with 99.9% success rate

## Solution Approach

Integrate with Stripe payment gateway.
`;

// Test fixture: Empty business context
const EMPTY_BUSINESS_CONTEXT = `---
risk_tier: medium
---

# Feature: Email Notifications

## Problem Statement

Users miss important updates without notifications.

## Business Context

## Success Metrics

- Deliver notifications within 1 minute
- 60% open rate for transactional emails

## Constraints

- Must support email and SMS channels
- Comply with CAN-SPAM regulations

## Solution Approach

Event-driven notification system with queuing.
`;

// Test fixture: Missing solution approach section
const MISSING_SECTION = `---
risk_tier: low
---

# Feature: Search

## Problem Statement

Users cannot find content efficiently in the app.

## Business Context

Search is critical for content discovery and user engagement.

## Success Metrics

- Search results in <500ms
- 70% of searches return relevant results

## Constraints

- Must index 100K+ documents
- Support fuzzy matching and filters
`;

describe('validateIdea', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
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

  it('should fail when business context is empty', async () => {
    const filePath = join(TEST_DIR, 'empty-context.md');
    writeFileSync(filePath, EMPTY_BUSINESS_CONTEXT, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('Business context section is empty');
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

  it('should fail when constraints section is missing', async () => {
    const filePath = join(TEST_DIR, 'no-constraints.md');
    writeFileSync(filePath, NO_CONSTRAINTS, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(false);
    expect(result.blocking_issues).toContain('Constraints section missing');
    expect(result.blocking_issues).toContain('Missing required section: Constraints');
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
    expect(result.blocking_issues).toContain('Missing required section: Solution Approach');
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
    expect(result.blocking_issues).toContain('Business context section is empty');
    expect(result.blocking_issues).toContain('Only 1 success metric found, need at least 2');
    expect(result.blocking_issues).toContain('Constraints section missing');
  });

  it('should handle artifacts with no frontmatter', async () => {
    const filePath = join(TEST_DIR, 'no-frontmatter.md');
    const noFrontmatter = `# Feature: No Frontmatter

## Problem Statement

Testing without frontmatter.

## Business Context

Some context.

## Success Metrics

- Metric 1
- Metric 2

## Constraints

Some constraints.

## Solution Approach

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

## Business Context

Some context here.

## Success Metrics

- Metric with dash
* Metric with asterisk
+ Metric with plus

## Constraints

- Constraint 1
* Constraint 2

## Solution Approach

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

## Business Context

  Context with whitespace.

## Success Metrics

  - Metric 1 with spaces
  - Metric 2 with spaces

## Constraints

  - Constraint with spaces

## Solution Approach

  Solution with spaces.
`;
    writeFileSync(filePath, whitespaceContent, 'utf-8');

    const result = await validateIdea(filePath);

    expect(result.passed).toBe(true);
    expect(result.coverage_percentage).toBe(100);
  });
});
