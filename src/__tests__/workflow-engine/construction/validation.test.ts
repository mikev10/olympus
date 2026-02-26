import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  validateUnits,
  validateDesignArtifacts,
  validateBolt,
  validateConstructionPhase,
} from '../../../features/workflow-engine/construction/validation.js';

describe('Construction Validation', () => {
  const testDir = join(process.cwd(), '.test-validation');
  const constructionDir = join(testDir, 'construction');
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

    // OLD template format (backward compat)
    const validUnitContentOld = `---
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

    // NEW template format
    const validUnitContentNew = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-001
status: draft
estimated_effort: 4
created: 2024-01-15T00:00:00.000Z
---

# UNIT-001: Setup Database Schema

## Scope & Responsibility
Implementation unit for Setup Database Schema

## Interface Contracts

### Inputs
- Database configuration

### Outputs
- Database schema

### API Surface
Database migration API

## Dependencies
- **Internal**: None
- **External**: None

## Target Files
- [ ] src/db/schema.ts

## Acceptance Criteria
- [ ] Database tables created
- [ ] Indexes created

## Proposed BOLTs
- **BOLT-001**: Create database migration script

## Traceability
- Parent INTENT: INTENT-001 (inception/intent.md)
- Root INTENT: intent-test (inception/intent.md)
`;

    it('should return passed=false if construction directory does not exist', async () => {
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('Units directory not found');
      expect(result.timestamp).toBeDefined();
    });

    it('should return passed=false if no unit files found', async () => {
      mkdirSync(constructionDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('No unit files found in units directory');
    });

    it('should return passed=false if intents directory does not exist', async () => {
      // Create UNIT-001/spec.md (new style)
      const unitDir = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir, { recursive: true });
      writeFileSync(join(unitDir, 'spec.md'), validUnitContentNew);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('Intents directory not found');
    });

    it('should return passed=true for valid unit files with NEW template (UNIT-NNN/spec.md)', async () => {
      const unitDir = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      writeFileSync(join(unitDir, 'spec.md'), validUnitContentNew);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('should return passed=true for valid unit files with OLD template (top-level UNIT-NNN.md)', async () => {
      mkdirSync(constructionDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      writeFileSync(join(constructionDir, 'UNIT-001.md'), validUnitContentOld);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('should prefer UNIT-NNN/spec.md over top-level UNIT-NNN.md', async () => {
      const unitDir = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      // Both new-style and old-style exist
      writeFileSync(join(unitDir, 'spec.md'), validUnitContentNew);
      writeFileSync(join(constructionDir, 'UNIT-001.md'), validUnitContentOld);

      const result = await validateUnits(constructionDir, intentDir);

      // Should validate only once (new style takes precedence)
      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('should return passed=false if unit missing frontmatter', async () => {
      const unitDir = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const noFrontmatterContent = `
## Goal

Create database tables
`;
      writeFileSync(join(unitDir, 'spec.md'), noFrontmatterContent);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('UNIT-001: Missing frontmatter');
    });

    it('should return passed=false if unit missing required frontmatter field', async () => {
      const unitDir = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const missingFieldContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-001
status: pending
---

## Scope & Responsibility
Implementation unit

## Interface Contracts

### Inputs
- Config

### Outputs
- Schema

### API Surface
API

## Dependencies
None

## Acceptance Criteria
- [ ] Tables created

## Proposed BOLTs
- **BOLT-001**: Create migration
`;
      writeFileSync(join(unitDir, 'spec.md'), missingFieldContent);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues[0]).toContain('UNIT-001: Missing frontmatter fields: estimated_effort');
    });

    it('should return passed=false if parent_intent references nonexistent intent', async () => {
      const unitDir = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const invalidParentContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-999
status: pending
estimated_effort: 4
---

## Scope & Responsibility
Implementation unit

## Interface Contracts

### Inputs
- Config

### Outputs
- Schema

### API Surface
API

## Dependencies
None

## Acceptance Criteria
- [ ] Tables created

## Proposed BOLTs
- **BOLT-001**: Create migration
`;
      writeFileSync(join(unitDir, 'spec.md'), invalidParentContent);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues[0]).toContain('UNIT-001: References non-existent parent intent: INTENT-999');
    });

    it('should accept parent_intent with intent- prefix format', async () => {
      const unitDir = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const intentPrefixContent = validUnitContentNew.replace('parent_intent: INTENT-001', 'parent_intent: intent-test-workflow');
      writeFileSync(join(unitDir, 'spec.md'), intentPrefixContent);

      const result = await validateUnits(constructionDir, intentDir);

      // Should not fail on parent_intent validation (intent- prefix is accepted)
      // But will fail on "Intent INTENT-001 has no unit children" since the unit references intent-test-workflow
      const parentIntentIssues = result.blocking_issues.filter(i => i.includes('References non-existent parent intent'));
      expect(parentIntentIssues).toHaveLength(0);
    });

    it('should return passed=false if effort estimate invalid', async () => {
      const unitDir = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const invalidEffortContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-001
status: pending
estimated_effort: 3
---

## Scope & Responsibility
Implementation unit

## Interface Contracts

### Inputs
- Config

### Outputs
- Schema

### API Surface
API

## Dependencies
None

## Acceptance Criteria
- [ ] Tables created

## Proposed BOLTs
- **BOLT-001**: Create migration
`;
      writeFileSync(join(unitDir, 'spec.md'), invalidEffortContent);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues[0]).toContain('UNIT-001: Invalid effort estimate 3 (must be 1, 2, 4, 8, or 16)');
    });

    it('should return passed=false if unit missing required sections (neither new nor old)', async () => {
      const unitDir = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir, { recursive: true });
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
      writeFileSync(join(unitDir, 'spec.md'), missingSectionContent);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(false);
      // Should report missing NEW template sections since it doesn't have all old ones either
      expect(result.blocking_issues[0]).toContain('UNIT-001: Missing sections:');
      expect(result.blocking_issues[0]).toContain('Scope & Responsibility');
    });

    it('should return passed=false if acceptance criteria has no bullet points', async () => {
      const unitDir = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      const noCriteriaContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-001
status: pending
estimated_effort: 4
---

## Scope & Responsibility
Implementation unit

## Interface Contracts

### Inputs
- Config

### Outputs
- Schema

### API Surface
API

## Dependencies
None

## Acceptance Criteria

No bullet points here

## Proposed BOLTs
- **BOLT-001**: Create migration
`;
      writeFileSync(join(unitDir, 'spec.md'), noCriteriaContent);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues[0]).toContain('UNIT-001: No acceptance criteria found');
    });

    it('should return passed=false if intent has no unit children', async () => {
      const unitDir = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      writeFileSync(join(intentDir, 'INTENT-002.md'), validIntentContent.replace('INTENT-001', 'INTENT-002'));
      writeFileSync(join(unitDir, 'spec.md'), validUnitContentNew);

      const result = await validateUnits(constructionDir, intentDir);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('Intent INTENT-002 has no unit children');
    });

    it('should calculate coverage percentage correctly', async () => {
      mkdirSync(intentDir, { recursive: true });
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);

      // One valid unit (new style)
      const unitDir1 = join(constructionDir, 'UNIT-001');
      mkdirSync(unitDir1, { recursive: true });
      writeFileSync(join(unitDir1, 'spec.md'), validUnitContentNew);

      // One invalid unit (old style, missing frontmatter)
      writeFileSync(join(constructionDir, 'UNIT-002.md'), '## Goal\nSome content');

      const result = await validateUnits(constructionDir, intentDir);

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
    // OLD template format (backward compat)
    const validBoltContentOld = `---
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

    // NEW template format
    const validBoltContentNew = `---
id: BOLT-001
title: Create migration script
parent_unit: UNIT-001
status: draft
estimated_effort: 2
created: 2024-01-15T00:00:00.000Z
---

# BOLT-001: Create migration script

## Domain Design
Business context for database migration

## Logical Design
Technical approach using migration framework

## Target Files
- [ ] src/db/migration.ts

## Implementation Steps
- Create SQL migration file
- Add table definitions

## Acceptance Criteria
- [ ] Migration script runs successfully
- [ ] Tables created correctly

## Audit Trail
- Created: 2024-01-15
- Status: draft
- Executed by: pending
- Gate 4 result: pending
`;

    it('should return passed=false if bolt file does not exist', async () => {
      const boltPath = join(boltsDir, 'BOLT-001.md');
      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('Bolt file not found');
    });

    it('should return passed=true for valid bolt file with OLD template', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      writeFileSync(boltPath, validBoltContentOld);

      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('should return passed=true for valid bolt file with NEW template', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      writeFileSync(boltPath, validBoltContentNew);

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

    it('should accept parent_unit: none for SHALLOW mode bolts', async () => {
      mkdirSync(boltsDir, { recursive: true });
      const boltPath = join(boltsDir, 'BOLT-001.md');
      const shallowBoltContent = `---
id: BOLT-001
title: Create migration script
parent_unit: none
status: draft
estimated_effort: 2
---

## Domain Design
Business context for database migration

## Logical Design
Technical approach using migration framework

## Target Files
- [ ] src/db/migration.ts

## Implementation Steps
- Create SQL migration file
- Add table definitions

## Acceptance Criteria
- [ ] Migration script runs successfully
- [ ] Tables created correctly
`;
      writeFileSync(boltPath, shallowBoltContent);

      const result = await validateBolt(boltPath);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
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

    it('should return passed=false if missing required sections from both templates', async () => {
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
      // Should report missing NEW template sections
      expect(result.blocking_issues[0]).toContain('Domain Design');
      expect(result.blocking_issues[0]).toContain('Logical Design');
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

  describe('validateConstructionPhase', () => {
    const validIntentContent = `---
id: INTENT-001
title: Setup Database
status: pending
estimated_effort: 8
dependencies: []
---

# Task: Setup Database
`;

    // NEW template format for units
    const validUnitContent = `---
id: UNIT-001
title: Setup Database Schema
parent_intent: INTENT-001
status: draft
estimated_effort: 4
created: 2024-01-15T00:00:00.000Z
---

# UNIT-001: Setup Database Schema

## Scope & Responsibility
Implementation unit for Setup Database Schema

## Interface Contracts

### Inputs
- Database configuration

### Outputs
- Database schema

### API Surface
Database migration API

## Dependencies
- **Internal**: None
- **External**: None

## Acceptance Criteria
- [ ] Tables created

## Proposed BOLTs
- **BOLT-001**: Create migration
`;

    // NEW template format for bolts
    const validBoltContent = `---
id: BOLT-001
title: Create migration script
parent_unit: UNIT-001
status: draft
estimated_effort: 2
created: 2024-01-15T00:00:00.000Z
---

# BOLT-001: Create migration script

## Domain Design
Business context for database migration

## Logical Design
Technical approach using migration framework

## Target Files
- [ ] src/db/migration.ts

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

      const result = await validateConstructionPhase(projectPath, workflowId);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('Construction directory not found');
    });

    it('should return passed=true for complete valid construction structure (new layout)', async () => {
      const projectPath = testDir;
      const workflowId = 'test-workflow';
      const workflowDir = join(projectPath, 'aidlc-docs', workflowId);
      const constructionDir = join(workflowDir, 'construction');
      const unitDir = join(constructionDir, 'UNIT-001');
      const designDir = join(constructionDir, 'design');
      const intentDir = join(workflowDir, 'inception');

      mkdirSync(unitDir, { recursive: true });
      mkdirSync(designDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });

      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      writeFileSync(join(unitDir, 'spec.md'), validUnitContent);
      writeFileSync(join(unitDir, 'BOLT-001.md'), validBoltContent);
      writeFileSync(join(designDir, 'interfaces.json'), JSON.stringify(validInterfaces, null, 2));
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));
      writeFileSync(join(designDir, 'data-flow.json'), JSON.stringify(validDataFlows, null, 2));

      const result = await validateConstructionPhase(projectPath, workflowId);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('should return passed=true for legacy construction structure (units/ and bolts/ dirs)', async () => {
      const projectPath = testDir;
      const workflowId = 'test-workflow';
      const workflowDir = join(projectPath, 'aidlc-docs', workflowId);
      const constructionDir = join(workflowDir, 'construction');
      const unitsDir = join(constructionDir, 'units');
      const designDir = join(constructionDir, 'design');
      const boltsDir = join(constructionDir, 'bolts');
      const intentDir = join(workflowDir, 'inception');

      // OLD template content for backward compat
      const oldUnitContent = `---
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

      const oldBoltContent = `---
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

      mkdirSync(unitsDir, { recursive: true });
      mkdirSync(designDir, { recursive: true });
      mkdirSync(boltsDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });

      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      // Legacy: units in units/ subdir (validateUnits is called on constructionDir,
      // and it discovers UNIT-NNN.md top-level files within that dir)
      // But constructionDir is construction/, so UNIT-001.md needs to be there or in units/ subdir
      // Actually, for legacy support in validateConstructionPhase, if intentsDir exists
      // it calls validateUnits(constructionDir, intentsDir) - so we need UNIT-001.md
      // at the top level of constructionDir or in a UNIT-001/spec.md subdir
      writeFileSync(join(constructionDir, 'UNIT-001.md'), oldUnitContent);
      writeFileSync(join(boltsDir, 'BOLT-001.md'), oldBoltContent);
      writeFileSync(join(designDir, 'interfaces.json'), JSON.stringify(validInterfaces, null, 2));
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));
      writeFileSync(join(designDir, 'data-flow.json'), JSON.stringify(validDataFlows, null, 2));

      const result = await validateConstructionPhase(projectPath, workflowId);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('should aggregate blocking issues from sub-validations', async () => {
      const projectPath = testDir;
      const workflowId = 'test-workflow';
      const workflowDir = join(projectPath, 'aidlc-docs', workflowId);
      const constructionDir = join(workflowDir, 'construction');
      const unitDir = join(constructionDir, 'UNIT-001');
      const designDir = join(constructionDir, 'design');
      const intentDir = join(workflowDir, 'inception');

      mkdirSync(unitDir, { recursive: true });
      mkdirSync(designDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });

      // Create invalid unit (missing frontmatter)
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      writeFileSync(join(unitDir, 'spec.md'), '## Goal\nInvalid unit');

      // Create invalid design artifact (missing interfaces.json)
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));
      writeFileSync(join(designDir, 'data-flow.json'), JSON.stringify(validDataFlows, null, 2));

      // Create invalid bolt (missing frontmatter)
      writeFileSync(join(unitDir, 'BOLT-001.md'), '## Goal\nInvalid bolt');

      const result = await validateConstructionPhase(projectPath, workflowId);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues.length).toBeGreaterThan(0);
      expect(result.blocking_issues.some(issue => issue.includes('[Units]'))).toBe(true);
      expect(result.blocking_issues.some(issue => issue.includes('[Design]'))).toBe(true);
      expect(result.blocking_issues.some(issue => issue.includes('[BOLT-001.md]'))).toBe(true);
    });

    it('should calculate aggregate coverage correctly', async () => {
      const projectPath = testDir;
      const workflowId = 'test-workflow';
      const workflowDir = join(projectPath, 'aidlc-docs', workflowId);
      const constructionDir = join(workflowDir, 'construction');
      const unitDir = join(constructionDir, 'UNIT-001');
      const designDir = join(constructionDir, 'design');
      const intentDir = join(workflowDir, 'inception');

      mkdirSync(unitDir, { recursive: true });
      mkdirSync(designDir, { recursive: true });
      mkdirSync(intentDir, { recursive: true });

      // Valid units (100% coverage)
      writeFileSync(join(intentDir, 'INTENT-001.md'), validIntentContent);
      writeFileSync(join(unitDir, 'spec.md'), validUnitContent);

      // Partial design artifacts (67% coverage - 2 out of 3)
      writeFileSync(join(designDir, 'interfaces.json'), JSON.stringify(validInterfaces, null, 2));
      writeFileSync(join(designDir, 'components.json'), JSON.stringify(validComponents, null, 2));

      // Valid bolts (100% coverage)
      writeFileSync(join(unitDir, 'BOLT-001.md'), validBoltContent);

      const result = await validateConstructionPhase(projectPath, workflowId);

      expect(result.passed).toBe(false); // Not passed due to missing data-flow.json
      // Aggregate coverage: (100 + 67 + 100) / 3 = 89
      expect(result.coverage_percentage).toBeGreaterThan(80);
      expect(result.coverage_percentage).toBeLessThan(95);
    });
  });
});
