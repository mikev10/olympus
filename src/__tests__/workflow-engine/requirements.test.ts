import { describe, it, expect } from 'vitest';
import {
  buildStakeholderMap,
  classifyConstraints,
  buildRequirementsTrace,
  getTraceabilitySummary,
} from '../../features/workflow-engine/requirements.js';

// Test Fixtures
const INTENT_WITH_STAKEHOLDERS = `---
risk_tier: medium
---

# Feature: Dashboard

## Stakeholders

- **Product Owner** (high interest, high influence): Responsible for feature prioritization
- **End Users** (high interest, low influence): Primary consumers of the dashboard
- **QA Team** (medium interest, medium influence): Ensures quality standards

## Problem Statement

Need a dashboard.

## Business Context

Our users need better visibility into their data.

## Constraints

- Must integrate with existing API
- Budget: $10K maximum
- Compliance: GDPR data handling required

## Success Metrics

- Dashboard loads in < 2s
`;

const INTENT_WITHOUT_STAKEHOLDERS = `---
risk_tier: low
---

# Feature: Internal Logging

## Problem Statement

Need logging for internal debugging.

## Business Context

Internal tool for the team, used by customers occasionally.

## Constraints

- Must integrate with existing database schema
- Budget: $5K

## Success Metrics

- Logs captured successfully
`;

const INTENT_WITH_COMPLIANCE = `---
risk_tier: high
---

# Feature: Data Export

## Problem Statement

Need data export.

## Business Context

Users need to export their data.

## Constraints

- Must meet GDPR compliance requirements
- Budget: $20K
- Regulatory approval required

## Success Metrics

- Exports work correctly
`;

const PRD_CONTENT = `---
type: prd
---

# PRD: Dashboard

## User Stories

### US-001: View Dashboard
As a user, I want to view my dashboard. Must integrate with existing API.

### US-002: Filter Data
As a user, I want to filter dashboard data.

### US-003: Export Report
As a user, I want to export reports. Budget consideration for third-party service.

## Requirement Coverage

All INTENT constraints are addressed.
`;

const SPEC_CONTENT = `---
type: spec
---

# SPEC: Dashboard

## Components

### Dashboard Component
Implements US-001 and US-002 for main dashboard view.

### Export Module
Implements US-003 for report generation.

### API Integration Layer
Connects to backend services.

## Requirement Coverage

All PRD stories covered.
`;

const INTENT_CONTENT_1 = `# INTENT-001: Build Dashboard UI
Implements SPEC-C-001 dashboard component.
estimated_effort: 8
`;

const INTENT_CONTENT_2 = `# INTENT-002: Build Export Feature
Implements SPEC-C-002 export module.
estimated_effort: 4
`;

describe('buildStakeholderMap', () => {
  it('parses explicit stakeholders from Stakeholders section (3 stakeholders)', () => {
    const result = buildStakeholderMap(INTENT_WITH_STAKEHOLDERS);

    expect(result.stakeholders).toHaveLength(3);
    expect(result.stakeholders.map(s => s.name)).toContain('Product Owner');
    expect(result.stakeholders.map(s => s.name)).toContain('End Users');
    expect(result.stakeholders.map(s => s.name)).toContain('QA Team');
  });

  it('parsed stakeholders have correct interest/influence levels', () => {
    const result = buildStakeholderMap(INTENT_WITH_STAKEHOLDERS);

    const productOwner = result.stakeholders.find(s => s.name === 'Product Owner');
    expect(productOwner?.interest).toBe('high');
    expect(productOwner?.influence).toBe('high');

    const endUsers = result.stakeholders.find(s => s.name === 'End Users');
    expect(endUsers?.interest).toBe('high');
    expect(endUsers?.influence).toBe('low');

    const qaTeam = result.stakeholders.find(s => s.name === 'QA Team');
    expect(qaTeam?.interest).toBe('medium');
    expect(qaTeam?.influence).toBe('medium');
  });

  it('parsed stakeholders have concerns', () => {
    const result = buildStakeholderMap(INTENT_WITH_STAKEHOLDERS);

    const productOwner = result.stakeholders.find(s => s.name === 'Product Owner');
    expect(productOwner?.concerns).toContain('Responsible for feature prioritization');
  });

  it('without Stakeholders section: includes "Development Team" by default', () => {
    const result = buildStakeholderMap(INTENT_WITHOUT_STAKEHOLDERS);

    expect(result.stakeholders.some(s => s.name === 'Development Team')).toBe(true);
  });

  it('without Stakeholders section: includes "End Users" when Business Context mentions "customers" or "users"', () => {
    const result = buildStakeholderMap(INTENT_WITHOUT_STAKEHOLDERS);

    expect(result.stakeholders.some(s => s.name === 'End Users')).toBe(true);
  });

  it('without Stakeholders section: includes "Compliance Team" when Constraints mentions "compliance"', () => {
    const result = buildStakeholderMap(INTENT_WITH_COMPLIANCE);

    expect(result.stakeholders.some(s => s.name === 'Compliance Team')).toBe(true);
  });

  it('without Stakeholders section: includes "Finance" when Constraints mentions "budget"', () => {
    const result = buildStakeholderMap(INTENT_WITHOUT_STAKEHOLDERS);

    expect(result.stakeholders.some(s => s.name === 'Finance')).toBe(true);
  });

  it('returns created_at timestamp', () => {
    const result = buildStakeholderMap(INTENT_WITH_STAKEHOLDERS);

    expect(result.created_at).toBeDefined();
    expect(typeof result.created_at).toBe('string');
    expect(new Date(result.created_at).getTime()).toBeGreaterThan(0);
  });

  it('empty content returns default Development Team only', () => {
    const result = buildStakeholderMap('');

    expect(result.stakeholders).toHaveLength(1);
    expect(result.stakeholders[0].name).toBe('Development Team');
  });

  it('handles content with frontmatter correctly', () => {
    const result = buildStakeholderMap(INTENT_WITH_STAKEHOLDERS);

    // Should parse stakeholders despite frontmatter
    expect(result.stakeholders).toHaveLength(3);
  });
});

describe('classifyConstraints', () => {
  it('classifies technical constraints (integrate, API, database, schema)', () => {
    const result = classifyConstraints(INTENT_WITHOUT_STAKEHOLDERS);

    const technicalConstraints = result.constraints.filter(c => c.category === 'technical');
    expect(technicalConstraints.length).toBeGreaterThan(0);
    expect(technicalConstraints.some(c => c.text.toLowerCase().includes('database'))).toBe(true);
  });

  it('classifies timeline constraints (deadline, sprint, weeks, months)', () => {
    const contentWithTimeline = `
## Constraints

- Must be completed within 2 weeks
- Sprint deadline on Friday
    `;
    const result = classifyConstraints(contentWithTimeline);

    const timelineConstraints = result.constraints.filter(c => c.category === 'timeline');
    expect(timelineConstraints.length).toBeGreaterThan(0);
  });

  it('classifies budget constraints (budget, $, cost)', () => {
    const result = classifyConstraints(INTENT_WITHOUT_STAKEHOLDERS);

    const budgetConstraints = result.constraints.filter(c => c.category === 'budget');
    expect(budgetConstraints.length).toBeGreaterThan(0);
    expect(budgetConstraints.some(c => c.text.includes('$5K'))).toBe(true);
  });

  it('classifies resource constraints (team, engineer)', () => {
    const contentWithResource = `
## Constraints

- Only 2 engineers available
- Limited team capacity
    `;
    const result = classifyConstraints(contentWithResource);

    const resourceConstraints = result.constraints.filter(c => c.category === 'resource');
    expect(resourceConstraints.length).toBeGreaterThan(0);
  });

  it('classifies regulatory constraints (GDPR, compliance, regulatory)', () => {
    const result = classifyConstraints(INTENT_WITH_COMPLIANCE);

    const regulatoryConstraints = result.constraints.filter(c => c.category === 'regulatory');
    expect(regulatoryConstraints.length).toBeGreaterThan(0);
    expect(regulatoryConstraints.some(c => c.text.includes('GDPR'))).toBe(true);
  });

  it('classifies policy constraints (policy, standard, guideline)', () => {
    const contentWithPolicy = `
## Constraints

- Must follow company coding standards
- Policy requires code review
    `;
    const result = classifyConstraints(contentWithPolicy);

    const policyConstraints = result.constraints.filter(c => c.category === 'policy');
    expect(policyConstraints.length).toBeGreaterThan(0);
  });

  it('determines hard severity (must, required, mandatory, cannot)', () => {
    const result = classifyConstraints(INTENT_WITH_STAKEHOLDERS);

    const hardConstraints = result.constraints.filter(c => c.severity === 'hard');
    expect(hardConstraints.length).toBeGreaterThan(0);
    expect(hardConstraints.some(c => c.text.toLowerCase().includes('must'))).toBe(true);
  });

  it('determines soft severity (default for everything else)', () => {
    const contentWithSoft = `
## Constraints

- Should use TypeScript
- Preferably include tests
    `;
    const result = classifyConstraints(contentWithSoft);

    const softConstraints = result.constraints.filter(c => c.severity === 'soft');
    expect(softConstraints.length).toBeGreaterThan(0);
  });

  it('returns correct summary counts per category', () => {
    const result = classifyConstraints(INTENT_WITH_STAKEHOLDERS);

    expect(result.summary).toBeDefined();
    expect(result.summary.technical).toBeDefined();
    expect(result.summary.budget).toBeDefined();
    expect(result.summary.regulatory).toBeDefined();

    const totalInSummary = Object.values(result.summary).reduce((a, b) => a + b, 0);
    expect(totalInSummary).toBe(result.constraints.length);
  });

  it('empty constraints section returns empty array', () => {
    const result = classifyConstraints('# Feature\n\nNo constraints here.');

    expect(result.constraints).toEqual([]);
    expect(Object.values(result.summary).every(v => v === 0)).toBe(true);
  });

  it('returns created_at timestamp', () => {
    const result = classifyConstraints(INTENT_WITH_STAKEHOLDERS);

    expect(result.created_at).toBeDefined();
    expect(typeof result.created_at).toBe('string');
    expect(new Date(result.created_at).getTime()).toBeGreaterThan(0);
  });
});

describe('buildRequirementsTrace', () => {
  it('INTENT-only (no PRD/SPEC/intents) returns empty links and no coverage keys', () => {
    const result = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, null, null, null);

    expect(result.links).toEqual([]);
    expect(Object.keys(result.coverage).length).toBe(0);
  });

  it('INTENT + PRD: creates "derives" links from constraints to user stories', () => {
    const result = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, PRD_CONTENT, null, null);

    const derivesLinks = result.links.filter(link => link.link_type === 'derives');
    expect(derivesLinks.length).toBeGreaterThan(0);
  });

  it('INTENT + PRD: calculates intent->prd coverage percentage', () => {
    const result = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, PRD_CONTENT, null, null);

    expect(result.coverage['intent->prd']).toBeGreaterThan(0);
    expect(result.coverage['intent->prd']).toBeLessThanOrEqual(100);
  });

  it('INTENT + PRD + SPEC: creates "implements" links from stories to components', () => {
    const result = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, PRD_CONTENT, SPEC_CONTENT, null);

    const implementsLinks = result.links.filter(link => link.link_type === 'implements');
    expect(implementsLinks.length).toBeGreaterThan(0);
  });

  it('INTENT + PRD + SPEC: calculates prd->spec coverage percentage', () => {
    const result = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, PRD_CONTENT, SPEC_CONTENT, null);

    expect(result.coverage['prd->spec']).toBeGreaterThan(0);
    expect(result.coverage['prd->spec']).toBeLessThanOrEqual(100);
  });

  it('full trace (all 4 stages): creates all link types', () => {
    const result = buildRequirementsTrace(
      INTENT_WITH_STAKEHOLDERS,
      PRD_CONTENT,
      SPEC_CONTENT,
      [INTENT_CONTENT_1, INTENT_CONTENT_2]
    );

    const linkTypes = new Set(result.links.map(link => link.link_type));
    expect(linkTypes.has('derives')).toBe(true);
    expect(linkTypes.has('implements')).toBe(true);
  });

  it('full trace: calculates spec->intents coverage', () => {
    const result = buildRequirementsTrace(
      INTENT_WITH_STAKEHOLDERS,
      PRD_CONTENT,
      SPEC_CONTENT,
      [INTENT_CONTENT_1, INTENT_CONTENT_2]
    );

    expect(result.coverage['spec->intents']).toBeGreaterThan(0);
    expect(result.coverage['spec->intents']).toBeLessThanOrEqual(100);
  });

  it('coverage is 0 when no links found', () => {
    const emptyPRD = `---
type: prd
---

# PRD: Empty

No user stories here.
`;
    const result = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, emptyPRD, null, null);

    expect(result.coverage['intent->prd']).toBe(0);
  });

  it('returns created_at timestamp', () => {
    const result = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, null, null, null);

    expect(result.created_at).toBeDefined();
    expect(typeof result.created_at).toBe('string');
    expect(new Date(result.created_at).getTime()).toBeGreaterThan(0);
  });

  it('handles null PRD/SPEC/intents gracefully', () => {
    const result = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, null, null, null);

    expect(result.links).toEqual([]);
    expect(Object.keys(result.coverage).length).toBe(0);
  });
});

describe('getTraceabilitySummary', () => {
  it('returns "Requirements Traceability:" header', () => {
    const trace = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, null, null, null);
    const summary = getTraceabilitySummary(trace);

    expect(summary).toContain('Requirements Traceability:');
  });

  it('shows INTENT → PRD coverage when present', () => {
    const trace = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, PRD_CONTENT, null, null);
    const summary = getTraceabilitySummary(trace);

    expect(summary).toContain('INTENT → PRD:');
    expect(summary).toMatch(/\d+%/); // Should contain a percentage
  });

  it('shows PRD → SPEC coverage when present', () => {
    const trace = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, PRD_CONTENT, SPEC_CONTENT, null);
    const summary = getTraceabilitySummary(trace);

    expect(summary).toContain('PRD → SPEC:');
  });

  it('shows SPEC → INTENTS coverage when present', () => {
    const trace = buildRequirementsTrace(
      INTENT_WITH_STAKEHOLDERS,
      PRD_CONTENT,
      SPEC_CONTENT,
      [INTENT_CONTENT_1, INTENT_CONTENT_2]
    );
    const summary = getTraceabilitySummary(trace);

    expect(summary).toContain('SPEC → INTENTS:');
  });

  it('handles empty trace (only header shown)', () => {
    const trace = buildRequirementsTrace(INTENT_WITH_STAKEHOLDERS, null, null, null);
    const summary = getTraceabilitySummary(trace);

    expect(summary).toContain('Requirements Traceability:');
    expect(summary).not.toContain('INTENT → PRD:');
    expect(summary).not.toContain('PRD → SPEC:');
    expect(summary).not.toContain('SPEC → INTENTS:');
  });
});
