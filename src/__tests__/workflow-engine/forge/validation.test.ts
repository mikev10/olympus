import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  validateUnits,
  validateDesignArtifacts,
  validateBolt,
  validateForgePhase,
} from '../../../features/workflow-engine/forge/validation.js';

describe('Forge Validation', () => {
  const testDir = join(process.cwd(), '.test-validation');
  const unitsDir = join(testDir, 'units');
  const intentDir = join(testDir, 'inception');
  const designDir = join(testDir, 'design');
  const boltsDir = join(testDir, 'bolts');

  beforeEach(() => {
    // Clean up before each test
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('validateUnits', () => {
    const validIntentContent = `---
id: INTENT-001
title: Setup Database
status: pending
estimated_effort: 8
dependencies: []
---

# Task: Setup Database
`;

    const validUnitContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-001
status: pending
estimated_effort: 4
---

## Goal

Create database tables and indexes

## Acceptance Criteria

- [ ] Database tables created
- [ ] Indexes created

## Implementation Notes

Use migration framework for database schema creation.
`;

    it('should return passed=false if units directory does not exist', async () => {
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('Units directory not found');
      expect(result.timestamp).toBeDefined();
    });

    it('should return passed=false if no unit files found', async () => {
      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('No unit files found in units directory');
    });

    it('should return passed=false if intents directory does not exist', async () => {
      mkdirSync(unitsDir, { recursive: true });
      writeFileSync(join(unitsDir, 'UNIT-001.md'), validUnitContent);

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('Intents directory not found');
    });

    it('should return passed=true for valid unit files', async () => {
      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      writeFileSync(join(unitsDir, 'UNIT-001.md'), validUnitContent);

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('should return passed=false if unit missing frontmatter', async () => {
      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const noFrontmatterContent = `
## Goal

Create database tables
`;
      writeFileSync(join(unitsDir, 'UNIT-001.md'), noFrontmatterContent);

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('UNIT-001: Missing frontmatter');
    });

    it('should return passed=false if unit missing required frontmatter field', async () => {
      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const missingFieldContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-001
status: pending
---

## Goal

Create database tables

## Acceptance Criteria

- [ ] Tables created

## Implementation Notes

Use migrations
`;
      writeFileSync(join(unitsDir, 'UNIT-001.md'), missingFieldContent);

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues[0]).toContain('UNIT-001: Missing frontmatter fields: estimated_effort');
    });

    it('should return passed=false if parent_intent references nonexistent intent', async () => {
      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const invalidParentContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-999
status: pending
estimated_effort: 4
---

## Goal

Create database tables

## Acceptance Criteria

- [ ] Tables created

## Implementation Notes

Use migrations
`;
      writeFileSync(join(unitsDir, 'UNIT-001.md'), invalidParentContent);

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues[0]).toContain('UNIT-001: References non-existent parent intent: INTENT-999');
    });

    it('should return passed=false if effort estimate invalid', async () => {
      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const invalidEffortContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-001
status: pending
estimated_effort: 3
---

## Goal

Create database tables

## Acceptance Criteria

- [ ] Tables created

## Implementation Notes

Use migrations
`;
      writeFileSync(join(unitsDir, 'UNIT-001.md'), invalidEffortContent);

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues[0]).toContain('UNIT-001: Invalid effort estimate 3 (must be 1, 2, 4, 8, or 16)');
    });

    it('should return passed=false if unit missing required section', async () => {
      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const missingSectionContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-001
status: pending
estimated_effort: 4
---

## Goal

Create database tables

## Acceptance Criteria

- [ ] Tables created
`;
      writeFileSync(join(unitsDir, 'UNIT-001.md'), missingSectionContent);

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues[0]).toContain('UNIT-001: Missing sections: Implementation Notes');
    });

    it('should return passed=false if acceptance criteria has no bullet points', async () => {
      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const noCriteriaContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-001
status: pending
estimated_effort: 4
---

## Goal

Create database tables

## Acceptance Criteria

No bullet points here

## Implementation Notes

Use migrations
`;
      writeFileSync(join(unitsDir, 'UNIT-001.md'), noCriteriaContent);

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues[0]).toContain('UNIT-001: No acceptance criteria found');
    });

    it('should return passed=false if intent has no unit children', async () => {
      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      writeFileSync(join(intentDir, 'INTENT-002.md'), validIntentContent.replace('INTENT-001', 'INTENT-002'));
      writeFileSync(join(unitsDir, 'UNIT-001.md'), validUnitContent);

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('Intent INTENT-002 has no unit children');
    });

    it('should calculate coverage percentage correctly', async () => {
      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      // One valid unit
      writeFileSync(join(unitsDir, 'UNIT-001.md'), validUnitContent);

      // One invalid unit (missing frontmatter)
      writeFileSync(join(unitsDir, 'UNIT-002.md'), '## Goal\nSome content');

      const result = await validateUnits(unitsDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(50); // 1 out of 2 units valid
    });
  });

  describe('validateDesignArtifacts', () => {
    const validInterfaces = {
      'IFACE-001': {
        id: 'IFACE-001',
        unit_id: 'UNIT-001',
        name: 'DatabaseInterface',
        inputs: [
          {
            name: 'query',
            type: 'string',
            required: true,
            description: 'SQL query',
          },
        ],
        outputs: [
          {
            name: 'result',
            type: 'any',
            required: true,
            description: 'Query result',
          },
        ],
        dependencies: [],
        description: 'Database interface',
      },
    };

    const validComponents = {
      'COMP-001': {
        id: 'COMP-001',
        unit_id: 'UNIT-001',
        name: 'DatabaseComponent',
        responsibilities: ['Execute queries'],
        interfaces: ['IFACE-001'],
        data_stores: [],
        description: 'Database component',
      },
    };

    const validDataFlows = [
      {
        id: 'DFD-001',
        unit_id: 'UNIT-001',
        from: 'COMP-001',
        to: 'COMP-001',
        description: 'Data flow',
      },
    ];

    it('should return passed=false if design directory does not exist', async () => {
      const result = await validateDesignArtifacts(designDir);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('Design directory not found');
    });

    it('should return passed=true for valid design artifacts', async () => {
      mkdirSync(designDir, { recursive: true });
      writeFileSync(join(designDir, 'interfaces.json'), JSON.stringify(validInterfaces, null, 2));
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));
      writeFileSync(join(designDir, 'data-flow.json'), JSON.stringify(validDataFlows, null, 2));

      const result = await validateDesignArtifacts(designDir);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('should return passed=false if interfaces.json missing', async () => {
      mkdirSync(designDir, { recursive: true });
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));
      writeFileSync(join(designDir, 'data-flow.json'), JSON.stringify(validDataFlows, null, 2));

      const result = await validateDesignArtifacts(designDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('interfaces.json not found');
    });

    it('should return passed=false if components.json missing', async () => {
      mkdirSync(designDir, { recursive: true });
      writeFileSync(join(designDir, 'interfaces.json'), JSON.stringify(validInterfaces, null, 2));
      writeFileSync(join(designDir, 'data-flow.json'), JSON.stringify(validDataFlows, null, 2));

      const result = await validateDesignArtifacts(designDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('components.json not found');
    });

    it('should return passed=false if data-flow.json missing', async () => {
      mkdirSync(designDir, { recursive: true });
      writeFileSync(join(designDir, 'interfaces.json'), JSON.stringify(validInterfaces, null, 2));
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));

      const result = await validateDesignArtifacts(designDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('data-flow.json not found');
    });

    it('should return passed=false if interfaces.json is invalid JSON', async () => {
      mkdirSync(designDir, { recursive: true });
      writeFileSync(join(designDir, 'interfaces.json'), 'invalid json {');
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));
      writeFileSync(join(designDir, 'data-flow.json'), JSON.stringify(validDataFlows, null, 2));

      const result = await validateDesignArtifacts(designDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('interfaces.json is not valid JSON');
    });

    it('should calculate coverage percentage correctly', async () => {
      mkdirSync(designDir, { recursive: true });
      writeFileSync(join(designDir, 'interfaces.json'), JSON.stringify(validInterfaces, null, 2));
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));
      // Missing data-flow.json

      const result = await validateDesignArtifacts(designDir);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(67); // 2 out of 3 artifacts valid
    });
  });

  describe('validateBolt', () => {
    const validBoltContent = `---
id: BOLT-001
title: Create migration script
parent_unit: UNIT-001
status: pending
estimated_effort: 2
---

## Goal

Create database migration script

## Implementation Steps

- Create SQL migration file
- Add table definitions

## Acceptance Criteria

- [ ] Migration script runs successfully
- [ ] Tables created correctly
`;

    it('should return passed=false if bolt file does not exist', async () => {
      const boltPath = join(boltsDir, 'BOLT-001.md');
      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('Bolt file not found');
    });

    it('should return passed=true for valid bolt file', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      writeFileSync(boltPath, validBoltContent);

      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('should return passed=false if missing frontmatter', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      writeFileSync(boltPath, '## Goal\nCreate migration script');

      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('Missing frontmatter');
    });

    it('should return passed=false if missing required frontmatter fields', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      const missingFieldContent = `---
id: BOLT-001
title: Create migration script
parent_unit: UNIT-001
---

## Goal

Create migration script
`;
      writeFileSync(boltPath, missingFieldContent);

      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues[0]).toContain('Missing frontmatter fields:');
      expect(result.blocking_issues[0]).toContain('status');
      expect(result.blocking_issues[0]).toContain('estimated_effort');
    });

    it('should return passed=false if parent_unit not in UNIT-NNN format', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      const invalidParentContent = `---
id: BOLT-001
title: Create migration script
parent_unit: UNIT-1
status: pending
estimated_effort: 2
---

## Goal

Create migration script

## Implementation Steps

- Create file

## Acceptance Criteria

- [ ] File created
`;
      writeFileSync(boltPath, invalidParentContent);

      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('Invalid parent_unit format: UNIT-1 (expected UNIT-NNN)');
    });

    it('should return passed=false if effort estimate invalid', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      const invalidEffortContent = `---
id: BOLT-001
title: Create migration script
parent_unit: UNIT-001
status: pending
estimated_effort: 5
---

## Goal

Create migration script

## Implementation Steps

- Create file

## Acceptance Criteria

- [ ] File created
`;
      writeFileSync(boltPath, invalidEffortContent);

      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('Invalid effort estimate 5 (must be 1, 2, 4, 8, or 16)');
    });

    it('should return passed=false if missing required sections', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      const missingSectionsContent = `---
id: BOLT-001
title: Create migration script
parent_unit: UNIT-001
status: pending
estimated_effort: 2
---

## Goal

Create migration script
`;
      writeFileSync(boltPath, missingSectionsContent);

      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues[0]).toContain('Missing sections:');
      expect(result.blocking_issues[0]).toContain('Implementation Steps');
      expect(result.blocking_issues[0]).toContain('Acceptance Criteria');
    });

    it('should return passed=false if no implementation steps', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      const noStepsContent = `---
id: BOLT-001
title: Create migration script
parent_unit: UNIT-001
status: pending
estimated_effort: 2
---

## Goal

Create migration script

## Implementation Steps

No bullet points here

## Acceptance Criteria

- [ ] File created
`;
      writeFileSync(boltPath, noStepsContent);

      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('No implementation steps found');
    });

    it('should return passed=false if no acceptance criteria', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      const noCriteriaContent = `---
id: BOLT-001
title: Create migration script
parent_unit: UNIT-001
status: pending
estimated_effort: 2
---

## Goal

Create migration script

## Implementation Steps

- Create file

## Acceptance Criteria

No bullet points here
`;
      writeFileSync(boltPath, noCriteriaContent);

      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('No acceptance criteria found');
    });

    it('should calculate coverage percentage correctly for partial validation', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      // Valid frontmatter fields, valid parent_unit, valid effort, but missing sections
      const partialContent = `---
id: BOLT-001
title: Create migration script
parent_unit: UNIT-001
status: pending
estimated_effort: 2
---

## Goal

Create migration script
`;
      writeFileSync(boltPath, partialContent);

      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(false);
      // 3 checks pass (frontmatter fields, parent_unit format, effort estimate)
      // 4 checks fail (required sections, implementation steps, acceptance criteria, overall)
      expect(result.coverage_percentage).toBeLessThan(100);
      expect(result.coverage_percentage).toBeGreaterThan(0);
    });
  });

  describe('validateForgePhase', () => {
    const validIntentContent = `---
id: INTENT-001
title: Setup Database
status: pending
estimated_effort: 8
dependencies: []
---

# Task: Setup Database
`;

    const validUnitContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-001
status: pending
estimated_effort: 4
---

## Goal

Create database tables

## Acceptance Criteria

- [ ] Tables created

## Implementation Notes

Use migrations
`;

    const validBoltContent = `---
id: BOLT-001
title: Create migration script
parent_unit: UNIT-001
status: pending
estimated_effort: 2
---

## Goal

Create migration script

## Implementation Steps

- Create file

## Acceptance Criteria

- [ ] File created
`;

    const validInterfaces = {
      'IFACE-001': {
        id: 'IFACE-001',
        unit_id: 'UNIT-001',
        name: 'DatabaseInterface',
        inputs: [{ name: 'query', type: 'string', required: true, description: 'SQL query' }],
        outputs: [{ name: 'result', type: 'any', required: true, description: 'Query result' }],
        dependencies: [],
        description: 'Database interface',
      },
    };

    const validComponents = {
      'COMP-001': {
        id: 'COMP-001',
        unit_id: 'UNIT-001',
        name: 'DatabaseComponent',
        responsibilities: ['Execute queries'],
        interfaces: ['IFACE-001'],
        data_stores: [],
        description: 'Database component',
      },
    };

    const validDataFlows = [
      {
        id: 'DFD-001',
        unit_id: 'UNIT-001',
        from: 'COMP-001',
        to: 'COMP-001',
        description: 'Data flow',
      },
    ];

    it('should return passed=false if construction directory does not exist', async () => {
      const projectPath = testDir;
      const workflowId = 'test-workflow';

      const result = await validateForgePhase(projectPath, workflowId);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('Construction directory not found');
    });

    it('should return passed=true for complete valid construction structure', async () => {
      const projectPath = testDir;
      const workflowId = 'test-workflow';
      const workflowDir = join(projectPath, 'aidlc-docs');
      const constructionDir = join(workflowDir, 'construction');
      const unitsDir = join(constructionDir, 'units');
      const designDir = join(constructionDir, 'design');
      const boltsDir = join(constructionDir, 'bolts');
      const intentDir = join(workflowDir, 'inception');

      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(designDir, { recursive: true });
      mkdirSync(boltsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });

      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      writeFileSync(join(unitsDir, 'UNIT-001.md'), validUnitContent);
      writeFileSync(join(boltsDir, 'BOLT-001.md'), validBoltContent);
      writeFileSync(join(designDir, 'interfaces.json'), JSON.stringify(validInterfaces, null, 2));
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));
      writeFileSync(join(designDir, 'data-flow.json'), JSON.stringify(validDataFlows, null, 2));

      const result = await validateForgePhase(projectPath, workflowId);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('should aggregate blocking issues from sub-validations', async () => {
      const projectPath = testDir;
      const workflowId = 'test-workflow';
      const workflowDir = join(projectPath, 'aidlc-docs');
      const constructionDir = join(workflowDir, 'construction');
      const unitsDir = join(constructionDir, 'units');
      const designDir = join(constructionDir, 'design');
      const boltsDir = join(constructionDir, 'bolts');
      const intentDir = join(workflowDir, 'inception');

      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(designDir, { recursive: true });
      mkdirSync(boltsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });

      // Create invalid unit (missing frontmatter)
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      writeFileSync(join(unitsDir, 'UNIT-001.md'), '## Goal\nInvalid unit');

      // Create invalid design artifact (missing interfaces.json)
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));
      writeFileSync(join(designDir, 'data-flow.json'), JSON.stringify(validDataFlows, null, 2));

      // Create invalid bolt (missing frontmatter)
      writeFileSync(join(boltsDir, 'BOLT-001.md'), '## Goal\nInvalid bolt');

      const result = await validateForgePhase(projectPath, workflowId);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues.length).toBeGreaterThan(0);
      expect(result.blocking_issues.some(issue => issue.includes('[Units]'))).toBe(true);
      expect(result.blocking_issues.some(issue => issue.includes('[Design]'))).toBe(true);
      expect(result.blocking_issues.some(issue => issue.includes('[BOLT-001.md]'))).toBe(true);
    });

    it('should calculate aggregate coverage correctly', async () => {
      const projectPath = testDir;
      const workflowId = 'test-workflow';
      const workflowDir = join(projectPath, 'aidlc-docs');
      const constructionDir = join(workflowDir, 'construction');
      const unitsDir = join(constructionDir, 'units');
      const designDir = join(constructionDir, 'design');
      const boltsDir = join(constructionDir, 'bolts');
      const intentDir = join(workflowDir, 'inception');

      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(designDir, { recursive: true });
      mkdirSync(boltsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });

      // Valid units (100% coverage)
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      writeFileSync(join(unitsDir, 'UNIT-001.md'), validUnitContent);

      // Partial design artifacts (67% coverage - 2 out of 3)
      writeFileSync(join(designDir, 'interfaces.json'), JSON.stringify(validInterfaces, null, 2));
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));

      // Valid bolts (100% coverage)
      writeFileSync(join(boltsDir, 'BOLT-001.md'), validBoltContent);

      const result = await validateForgePhase(projectPath, workflowId);

      expect(result.passed).toBe(false); // Not passed due to missing data-flow.json
      // Aggregate coverage: (100 + 67 + 100) / 3 = 89
      expect(result.coverage_percentage).toBeGreaterThan(80);
      expect(result.coverage_percentage).toBeLessThan(95);
    });
  });
});
