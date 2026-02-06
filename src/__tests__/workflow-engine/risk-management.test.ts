import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  extractRisks,
  createRiskRegister,
  loadRiskRegister,
  saveRiskRegister,
  addRisk,
  updateRisk,
  removeRisk,
  getRiskSummary,
  getRiskPriorityScore,
  getNextRiskId,
  formatRiskReport,
} from '../../features/workflow-engine/risk-management.js';

const TEST_DIR = join(process.cwd(), '.test-risk-management');

const FORMAT1_IDEA = `---
risk_tier: medium
---

# Feature: API Migration

## Problem Statement

Need to migrate API.

## Risk Assessment

- Database migration may cause downtime (high likelihood, high impact) - Mitigation: Run during maintenance window
- Third-party API may change (medium likelihood, low impact) - Mitigation: Abstract behind adapter
- Performance degradation under load (low likelihood, medium impact) - Mitigation: Load testing before deployment
`;

const FORMAT2_IDEA = `---
risk_tier: high
---

# Feature: Payment System

## Problem Statement

Need payment system.

## Risk Assessment

### RISK-001: Payment Processing Failure
- Likelihood: high
- Impact: high
- Mitigation: Implement retry with exponential backoff
- Owner: Payments Team
- Status: open

### RISK-002: Data Breach
- Likelihood: low
- Impact: high
- Mitigation: Encrypt all PII at rest and in transit
- Owner: Security Team
- Status: mitigated
`;

const NO_RISK_IDEA = `---
risk_tier: low
---

# Feature: Add Button

## Problem Statement

Need a button.

## Constraints

- Must be blue
`;

const PARTIAL_FORMAT1_IDEA = `---
risk_tier: medium
---

# Feature: Something

## Risk Assessment

- Database migration may cause issues
- Network timeout during sync
`;

describe('extractRisks', () => {
  it('Format 1: extracts risks with correct likelihood/impact from inline format', () => {
    const risks = extractRisks(FORMAT1_IDEA);

    expect(risks).toHaveLength(3);
    expect(risks[0].likelihood).toBe('high');
    expect(risks[0].impact).toBe('high');
    expect(risks[1].likelihood).toBe('medium');
    expect(risks[1].impact).toBe('low');
    expect(risks[2].likelihood).toBe('low');
    expect(risks[2].impact).toBe('medium');
  });

  it('Format 1: extracts mitigation text', () => {
    const risks = extractRisks(FORMAT1_IDEA);

    expect(risks[0].mitigation).toBe('Run during maintenance window');
    expect(risks[1].mitigation).toBe('Abstract behind adapter');
    expect(risks[2].mitigation).toBe('Load testing before deployment');
  });

  it('Format 1: auto-assigns RISK-NNN IDs sequentially', () => {
    const risks = extractRisks(FORMAT1_IDEA);

    expect(risks[0].id).toBe('RISK-001');
    expect(risks[1].id).toBe('RISK-002');
    expect(risks[2].id).toBe('RISK-003');
  });

  it('Format 1: defaults to open status and Unassigned owner', () => {
    const risks = extractRisks(FORMAT1_IDEA);

    expect(risks[0].status).toBe('open');
    expect(risks[0].owner).toBe('Unassigned');
    expect(risks[1].status).toBe('open');
    expect(risks[1].owner).toBe('Unassigned');
  });

  it('Format 2: extracts structured risks with all fields', () => {
    const risks = extractRisks(FORMAT2_IDEA);

    expect(risks).toHaveLength(2);
    expect(risks[0].description).toBe('Payment Processing Failure');
    expect(risks[0].likelihood).toBe('high');
    expect(risks[0].impact).toBe('high');
    expect(risks[0].mitigation).toBe('Implement retry with exponential backoff');
    expect(risks[1].description).toBe('Data Breach');
  });

  it('Format 2: preserves RISK-NNN IDs from headings', () => {
    const risks = extractRisks(FORMAT2_IDEA);

    expect(risks[0].id).toBe('RISK-001');
    expect(risks[1].id).toBe('RISK-002');
  });

  it('Format 2: parses status field correctly', () => {
    const risks = extractRisks(FORMAT2_IDEA);

    expect(risks[0].status).toBe('open');
    expect(risks[1].status).toBe('mitigated');
  });

  it('Format 2: parses owner field correctly', () => {
    const risks = extractRisks(FORMAT2_IDEA);

    expect(risks[0].owner).toBe('Payments Team');
    expect(risks[1].owner).toBe('Security Team');
  });

  it('No Risk section: returns empty array', () => {
    const risks = extractRisks(NO_RISK_IDEA);

    expect(risks).toEqual([]);
  });

  it('Partial format (no likelihood/impact in parens): defaults to medium/medium', () => {
    const risks = extractRisks(PARTIAL_FORMAT1_IDEA);

    expect(risks).toHaveLength(2);
    expect(risks[0].likelihood).toBe('medium');
    expect(risks[0].impact).toBe('medium');
    expect(risks[1].likelihood).toBe('medium');
    expect(risks[1].impact).toBe('medium');
  });

  it('Partial format (no mitigation): defaults to "Not yet defined"', () => {
    const risks = extractRisks(PARTIAL_FORMAT1_IDEA);

    expect(risks[0].mitigation).toBe('Not yet defined');
    expect(risks[1].mitigation).toBe('Not yet defined');
  });
});

describe('createRiskRegister', () => {
  it('Creates register with given risks', () => {
    const risks = extractRisks(FORMAT1_IDEA);
    const register = createRiskRegister(risks);

    expect(register.risks).toEqual(risks);
  });

  it('Sets created_at and updated_at to ISO timestamp strings', () => {
    const before = new Date().toISOString();
    const register = createRiskRegister([]);
    const after = new Date().toISOString();

    // Verify they are valid ISO strings
    expect(() => new Date(register.created_at)).not.toThrow();
    expect(() => new Date(register.updated_at)).not.toThrow();

    // Verify they're in reasonable range (ISO strings sort lexicographically)
    expect(register.created_at >= before).toBe(true);
    expect(register.created_at <= after).toBe(true);
    expect(register.updated_at >= before).toBe(true);
    expect(register.updated_at <= after).toBe(true);
  });

  it('Empty risks array is valid', () => {
    const register = createRiskRegister([]);

    expect(register.risks).toEqual([]);
    expect(register.created_at).toBeDefined();
    expect(register.updated_at).toBeDefined();
  });
});

describe('loadRiskRegister', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('Loads valid JSON risk register', () => {
    const risks = extractRisks(FORMAT1_IDEA);
    const register = createRiskRegister(risks);
    const registerPath = join(TEST_DIR, 'risk-register.json');

    saveRiskRegister(registerPath, register);
    const loaded = loadRiskRegister(registerPath);

    expect(loaded).toBeDefined();
    expect(loaded?.risks).toEqual(risks);
  });

  it('Returns null for non-existent file', () => {
    const registerPath = join(TEST_DIR, 'nonexistent.json');
    const loaded = loadRiskRegister(registerPath);

    expect(loaded).toBeNull();
  });

  it('Returns null for invalid JSON', () => {
    const registerPath = join(TEST_DIR, 'invalid.json');
    const fs = require('fs');
    fs.writeFileSync(registerPath, 'not valid json {]');

    const loaded = loadRiskRegister(registerPath);

    expect(loaded).toBeNull();
  });

  it('Returns null for JSON without risks array', () => {
    const registerPath = join(TEST_DIR, 'no-risks.json');
    const fs = require('fs');
    fs.writeFileSync(registerPath, JSON.stringify({ foo: 'bar' }));

    const loaded = loadRiskRegister(registerPath);

    expect(loaded).toBeNull();
  });
});

describe('saveRiskRegister', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('Saves register to disk', () => {
    const risks = extractRisks(FORMAT1_IDEA);
    const register = createRiskRegister(risks);
    const registerPath = join(TEST_DIR, 'risk-register.json');

    saveRiskRegister(registerPath, register);

    expect(existsSync(registerPath)).toBe(true);
  });

  it('Creates parent directories if needed', () => {
    const risks = extractRisks(FORMAT1_IDEA);
    const register = createRiskRegister(risks);
    const registerPath = join(TEST_DIR, 'nested', 'dir', 'risk-register.json');

    saveRiskRegister(registerPath, register);

    expect(existsSync(registerPath)).toBe(true);
  });

  it('Updates updated_at timestamp', () => {
    const risks = extractRisks(FORMAT1_IDEA);
    const register = createRiskRegister(risks);
    const originalUpdatedAt = register.updated_at;
    const registerPath = join(TEST_DIR, 'risk-register.json');

    // Small delay to ensure timestamp difference
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    return delay(10).then(() => {
      saveRiskRegister(registerPath, register);
      const loaded = loadRiskRegister(registerPath);

      // Compare ISO strings properly
      expect(loaded?.updated_at).toBeDefined();
      expect(new Date(loaded!.updated_at).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
    });
  });

  it('Saved file is valid JSON', () => {
    const risks = extractRisks(FORMAT1_IDEA);
    const register = createRiskRegister(risks);
    const registerPath = join(TEST_DIR, 'risk-register.json');

    saveRiskRegister(registerPath, register);

    const content = readFileSync(registerPath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('Saved file can be loaded back', () => {
    const risks = extractRisks(FORMAT1_IDEA);
    const register = createRiskRegister(risks);
    const registerPath = join(TEST_DIR, 'risk-register.json');

    saveRiskRegister(registerPath, register);
    const loaded = loadRiskRegister(registerPath);

    expect(loaded).toBeDefined();
    expect(loaded?.risks.length).toBe(register.risks.length);
  });
});

describe('addRisk', () => {
  it('Adds risk with auto-assigned ID (RISK-001 for empty register)', () => {
    const register = createRiskRegister([]);
    const newRisk = {
      description: 'New Risk',
      likelihood: 'medium' as const,
      impact: 'high' as const,
      mitigation: 'Test mitigation',
      owner: 'Test Owner',
      status: 'open' as const,
    };

    const updated = addRisk(register, newRisk);

    expect(updated.risks).toHaveLength(1);
    expect(updated.risks[0].id).toBe('RISK-001');
  });

  it('Increments ID from existing risks (RISK-003 after RISK-001, RISK-002)', () => {
    const risks = extractRisks(FORMAT2_IDEA); // Has RISK-001, RISK-002
    const register = createRiskRegister(risks);
    const newRisk = {
      description: 'New Risk',
      likelihood: 'medium' as const,
      impact: 'high' as const,
      mitigation: 'Test mitigation',
      owner: 'Test Owner',
      status: 'open' as const,
    };

    const updated = addRisk(register, newRisk);

    expect(updated.risks).toHaveLength(3);
    expect(updated.risks[2].id).toBe('RISK-003');
  });

  it('Returns new register (immutable - original unchanged)', () => {
    const register = createRiskRegister([]);
    const newRisk = {
      description: 'New Risk',
      likelihood: 'medium' as const,
      impact: 'high' as const,
      mitigation: 'Test mitigation',
      owner: 'Test Owner',
      status: 'open' as const,
    };

    const updated = addRisk(register, newRisk);

    expect(updated).not.toBe(register);
    expect(register.risks).toHaveLength(0);
  });

  it('New risk appears in returned register', () => {
    const register = createRiskRegister([]);
    const newRisk = {
      description: 'New Risk',
      likelihood: 'medium' as const,
      impact: 'high' as const,
      mitigation: 'Test mitigation',
      owner: 'Test Owner',
      status: 'open' as const,
    };

    const updated = addRisk(register, newRisk);

    expect(updated.risks[0].description).toBe('New Risk');
    expect(updated.risks[0].likelihood).toBe('medium');
    expect(updated.risks[0].impact).toBe('high');
  });
});

describe('updateRisk', () => {
  it('Updates risk fields by ID', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);

    const updated = updateRisk(register, 'RISK-001', {
      status: 'mitigated' as const,
      mitigation: 'New mitigation strategy',
    });

    const risk = updated.risks.find(r => r.id === 'RISK-001');
    expect(risk?.status).toBe('mitigated');
    expect(risk?.mitigation).toBe('New mitigation strategy');
  });

  it('Returns unchanged register if ID not found', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);

    const updated = updateRisk(register, 'RISK-999', { status: 'mitigated' as const });

    expect(updated).toEqual(register);
  });

  it('Preserves other fields when partially updating', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);
    const originalRisk = register.risks.find(r => r.id === 'RISK-001');

    const updated = updateRisk(register, 'RISK-001', {
      status: 'mitigated' as const,
    });

    const risk = updated.risks.find(r => r.id === 'RISK-001');
    expect(risk?.description).toBe(originalRisk?.description);
    expect(risk?.likelihood).toBe(originalRisk?.likelihood);
    expect(risk?.impact).toBe(originalRisk?.impact);
    expect(risk?.mitigation).toBe(originalRisk?.mitigation);
    expect(risk?.owner).toBe(originalRisk?.owner);
    expect(risk?.status).toBe('mitigated');
  });

  it('Returns new register (immutable)', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);

    const updated = updateRisk(register, 'RISK-001', { status: 'mitigated' as const });

    expect(updated).not.toBe(register);
  });

  it('Original register is not mutated', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);
    const originalStatus = register.risks.find(r => r.id === 'RISK-001')?.status;

    updateRisk(register, 'RISK-001', { status: 'mitigated' as const });

    expect(register.risks.find(r => r.id === 'RISK-001')?.status).toBe(originalStatus);
  });
});

describe('removeRisk', () => {
  it('Removes risk by ID', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);

    const updated = removeRisk(register, 'RISK-001');

    expect(updated.risks).toHaveLength(1);
    expect(updated.risks.find(r => r.id === 'RISK-001')).toBeUndefined();
  });

  it('Returns unchanged register if ID not found', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);

    const updated = removeRisk(register, 'RISK-999');

    expect(updated).toEqual(register);
  });

  it('Returns new register (immutable)', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);

    const updated = removeRisk(register, 'RISK-001');

    expect(updated).not.toBe(register);
  });

  it('Original register not mutated', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);
    const originalLength = register.risks.length;

    removeRisk(register, 'RISK-001');

    expect(register.risks.length).toBe(originalLength);
  });
});

describe('getRiskPriorityScore', () => {
  it('high/high = 9', () => {
    const risk = {
      id: 'RISK-001',
      description: 'test',
      likelihood: 'high' as const,
      impact: 'high' as const,
      mitigation: '',
      owner: '',
      status: 'open' as const
    };
    const score = getRiskPriorityScore(risk);
    expect(score).toBe(9);
  });

  it('high/medium = 6', () => {
    const risk = {
      id: 'RISK-001',
      description: 'test',
      likelihood: 'high' as const,
      impact: 'medium' as const,
      mitigation: '',
      owner: '',
      status: 'open' as const
    };
    const score = getRiskPriorityScore(risk);
    expect(score).toBe(6);
  });

  it('medium/medium = 4', () => {
    const risk = {
      id: 'RISK-001',
      description: 'test',
      likelihood: 'medium' as const,
      impact: 'medium' as const,
      mitigation: '',
      owner: '',
      status: 'open' as const
    };
    const score = getRiskPriorityScore(risk);
    expect(score).toBe(4);
  });

  it('low/low = 1', () => {
    const risk = {
      id: 'RISK-001',
      description: 'test',
      likelihood: 'low' as const,
      impact: 'low' as const,
      mitigation: '',
      owner: '',
      status: 'open' as const
    };
    const score = getRiskPriorityScore(risk);
    expect(score).toBe(1);
  });

  it('high/low = 3', () => {
    const risk = {
      id: 'RISK-001',
      description: 'test',
      likelihood: 'high' as const,
      impact: 'low' as const,
      mitigation: '',
      owner: '',
      status: 'open' as const
    };
    const score = getRiskPriorityScore(risk);
    expect(score).toBe(3);
  });

  it('low/high = 3', () => {
    const risk = {
      id: 'RISK-001',
      description: 'test',
      likelihood: 'low' as const,
      impact: 'high' as const,
      mitigation: '',
      owner: '',
      status: 'open' as const
    };
    const score = getRiskPriorityScore(risk);
    expect(score).toBe(3);
  });
});

describe('getRiskSummary', () => {
  it('Counts by status correctly', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);
    const summary = getRiskSummary(register);

    expect(summary.by_status.open).toBe(1);
    expect(summary.by_status.mitigated).toBe(1);
  });

  it('Counts by likelihood correctly', () => {
    const risks = extractRisks(FORMAT1_IDEA);
    const register = createRiskRegister(risks);
    const summary = getRiskSummary(register);

    expect(summary.by_likelihood.high).toBe(1);
    expect(summary.by_likelihood.medium).toBe(1);
    expect(summary.by_likelihood.low).toBe(1);
  });

  it('Counts by impact correctly', () => {
    const risks = extractRisks(FORMAT1_IDEA);
    const register = createRiskRegister(risks);
    const summary = getRiskSummary(register);

    expect(summary.by_impact.high).toBe(1);
    expect(summary.by_impact.medium).toBe(1);
    expect(summary.by_impact.low).toBe(1);
  });

  it('Identifies high_priority (high likelihood AND high impact)', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);
    const summary = getRiskSummary(register);

    expect(summary.high_priority.length).toBe(1);
    expect(summary.high_priority[0].id).toBe('RISK-001');
  });

  it('Empty register returns zero counts and empty high_priority', () => {
    const register = createRiskRegister([]);
    const summary = getRiskSummary(register);

    expect(summary.total).toBe(0);
    expect(summary.by_status.open).toBe(0);
    expect(summary.by_likelihood.high).toBe(0);
    expect(summary.by_impact.high).toBe(0);
    expect(summary.high_priority).toEqual([]);
  });

  it('Returns correct total count', () => {
    const risks = extractRisks(FORMAT1_IDEA);
    const register = createRiskRegister(risks);
    const summary = getRiskSummary(register);

    expect(summary.total).toBe(3);
  });
});

describe('getNextRiskId', () => {
  it('Returns RISK-001 for empty register', () => {
    const register = createRiskRegister([]);
    const nextId = getNextRiskId(register);

    expect(nextId).toBe('RISK-001');
  });

  it('Returns RISK-004 when highest is RISK-003', () => {
    const risks = extractRisks(FORMAT1_IDEA); // Has RISK-001, RISK-002, RISK-003
    const register = createRiskRegister(risks);
    const nextId = getNextRiskId(register);

    expect(nextId).toBe('RISK-004');
  });

  it('Handles non-sequential IDs (RISK-001, RISK-005 → RISK-006)', () => {
    const register = createRiskRegister([
      {
        id: 'RISK-001',
        description: 'Risk 1',
        likelihood: 'low' as const,
        impact: 'low' as const,
        mitigation: 'Test',
        owner: 'Test',
        status: 'open' as const,
      },
      {
        id: 'RISK-005',
        description: 'Risk 5',
        likelihood: 'low' as const,
        impact: 'low' as const,
        mitigation: 'Test',
        owner: 'Test',
        status: 'open' as const,
      },
    ]);
    const nextId = getNextRiskId(register);

    expect(nextId).toBe('RISK-006');
  });

  it('Returns zero-padded ID', () => {
    const register = createRiskRegister([]);
    const nextId = getNextRiskId(register);

    expect(nextId).toMatch(/^RISK-\d{3}$/);
  });
});

describe('formatRiskReport', () => {
  it('Header includes total count', () => {
    const risks = extractRisks(FORMAT1_IDEA);
    const register = createRiskRegister(risks);
    const report = formatRiskReport(register);

    expect(report).toContain('3');
    expect(report).toContain('Risk');
  });

  it('Groups risks by status', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);
    const report = formatRiskReport(register);

    expect(report).toContain('Open');
    expect(report).toContain('Mitigated');
  });

  it('Shows likelihood and impact in uppercase', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);
    const report = formatRiskReport(register);

    expect(report).toContain('HIGH');
  });

  it('Shows mitigation and owner', () => {
    const risks = extractRisks(FORMAT2_IDEA);
    const register = createRiskRegister(risks);
    const report = formatRiskReport(register);

    expect(report).toContain('Implement retry with exponential backoff');
    expect(report).toContain('Payments Team');
  });

  it('Empty register shows header with 0 count', () => {
    const register = createRiskRegister([]);
    const report = formatRiskReport(register);

    expect(report).toContain('0');
    expect(report).toContain('Risk');
  });

  it('Sorted by priority within each status group', () => {
    const register = createRiskRegister([
      {
        id: 'RISK-001',
        description: 'Low priority',
        likelihood: 'low' as const,
        impact: 'low' as const,
        mitigation: 'Test',
        owner: 'Test',
        status: 'open' as const,
      },
      {
        id: 'RISK-002',
        description: 'High priority',
        likelihood: 'high' as const,
        impact: 'high' as const,
        mitigation: 'Test',
        owner: 'Test',
        status: 'open' as const,
      },
    ]);
    const report = formatRiskReport(register);

    // High priority should appear before low priority
    const highIndex = report.indexOf('High priority');
    const lowIndex = report.indexOf('Low priority');
    expect(highIndex).toBeLessThan(lowIndex);
  });
});
