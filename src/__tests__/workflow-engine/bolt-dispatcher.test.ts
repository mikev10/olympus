import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  dispatchBolt,
  selectAgentForBolt,
  findBoltFile,
  extractSections,
  extractTargetFiles,
  buildBoltPrompt,
} from '../../features/workflow-engine/bolt-dispatcher.js';
import type { AgentPerformance } from '../../learning/types.js';

// Mock the efficiency module using vi.hoisted
const { mockGetAgentPerformance } = vi.hoisted(() => ({
  mockGetAgentPerformance: vi.fn(() => null),
}));
vi.mock('../../learning/efficiency.js', () => ({
  getAgentPerformanceForRouting: mockGetAgentPerformance,
}));

const TEST_DIR = join(process.cwd(), '.test-bolt-dispatcher');

describe('bolt-dispatcher', () => {
  beforeEach(() => {
    // Clean up before each test
    if (rmSync) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mockGetAgentPerformance.mockReturnValue(null);
  });

  afterEach(() => {
    // Clean up after each test
    if (rmSync) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  function createTestFixtures() {
    const docsDir = join(TEST_DIR, 'aidlc-docs');
    const inceptionDir = join(docsDir, 'inception');
    const constructionDir = join(docsDir, 'construction');
    const unit001Dir = join(constructionDir, 'UNIT-001');
    const unit002Dir = join(constructionDir, 'UNIT-002');

    mkdirSync(unit001Dir, { recursive: true });
    mkdirSync(unit002Dir, { recursive: true });
    mkdirSync(inceptionDir, { recursive: true });

    // Create idea.md
    writeFileSync(
      join(inceptionDir, 'idea.md'),
      `# IDEA: Test Feature

## Problem Statement
Users need a new feature to solve problem X.

## Success Metrics
- Metric 1: 90% success rate
- Metric 2: Response time < 100ms

## Other Section
Some other content.
`
    );

    // Create intent.md
    writeFileSync(
      join(inceptionDir, 'intent.md'),
      `# INTENT: Test Feature

## Business Requirements
- REQ-001: Feature must handle edge cases
- REQ-002: Feature must be accessible

## Technical Specification
- Use TypeScript
- Follow existing patterns

## Architecture
High-level design goes here.
`
    );

    // Create UNIT-001 spec
    writeFileSync(
      join(unit001Dir, 'spec.md'),
      `# UNIT-001: Core Module

## Overview
This is the core module for the feature.

## Components
- Component A
- Component B
`
    );

    // Create BOLT-001
    writeFileSync(
      join(unit001Dir, 'BOLT-001.md'),
      `# BOLT-001: Implement Core Module A

## Target Files
- src/core/ModuleA.ts
- src/core/ModuleA.test.ts

## Implementation Steps
1. Create ModuleA class
2. Add validation logic

## Test Requirements
- Unit tests for validation

## Acceptance Criteria
- All tests pass
- Code coverage > 80%
`
    );

    // Create BOLT-002
    writeFileSync(
      join(unit001Dir, 'BOLT-002.md'),
      `# BOLT-002: Fix debug issue in ModuleA

## Target Files
- src/core/ModuleA.ts

## Implementation Steps
1. Investigate the bug
2. Fix the logic

## Acceptance Criteria
- Bug is resolved
`
    );

    // Create UNIT-002 spec
    writeFileSync(
      join(unit002Dir, 'spec.md'),
      `# UNIT-002: UI Module

## Overview
This is the UI module.
`
    );

    // Create BOLT-003 in UNIT-002
    writeFileSync(
      join(unit002Dir, 'BOLT-003.md'),
      `# BOLT-003: Create UI Component

## Target Files
- src/ui/Button.tsx
- src/ui/Button.css

## Implementation Steps
1. Create Button component
2. Add styling

## Acceptance Criteria
- Component renders correctly
`
    );

    return { docsDir, inceptionDir, constructionDir, unit001Dir, unit002Dir };
  }

  describe('findBoltFile', () => {
    it('finds BOLT file in correct UNIT directory', () => {
      const { constructionDir } = createTestFixtures();
      const result = findBoltFile(constructionDir, 'BOLT-001');

      expect(result.parentUnit).toBe('UNIT-001');
      expect(result.boltSpec).toContain('BOLT-001: Implement Core Module A');
    });

    it('finds BOLT file across different UNITs', () => {
      const { constructionDir } = createTestFixtures();
      const result = findBoltFile(constructionDir, 'BOLT-003');

      expect(result.parentUnit).toBe('UNIT-002');
      expect(result.boltSpec).toContain('BOLT-003: Create UI Component');
    });

    it('throws error for non-existent BOLT', () => {
      const { constructionDir } = createTestFixtures();

      expect(() => findBoltFile(constructionDir, 'BOLT-999')).toThrow(
        'BOLT BOLT-999 not found'
      );
    });

    it('throws error when construction directory does not exist', () => {
      const nonExistentDir = join(TEST_DIR, 'does-not-exist');

      expect(() => findBoltFile(nonExistentDir, 'BOLT-001')).toThrow(
        'Construction directory not found'
      );
    });
  });

  describe('extractSections', () => {
    it('extracts specified sections from markdown content', () => {
      const content = `# Document

## Problem Statement
This is the problem.

## Solution
This is the solution.

## Success Metrics
Metric 1 and Metric 2.

## Other Section
Other content.
`;

      const result = extractSections(content, [
        'Problem Statement',
        'Success Metrics',
      ]);

      expect(result).toContain('This is the problem');
      expect(result).toContain('Metric 1 and Metric 2');
      expect(result).not.toContain('This is the solution');
      expect(result).not.toContain('Other content');
    });

    it('handles ### level headings', () => {
      const content = `# Document

### Problem Statement
This is the problem.

### Success Metrics
These are the metrics.
`;

      const result = extractSections(content, ['Problem Statement']);

      expect(result).toContain('This is the problem');
    });

    it('returns full content when sections not found', () => {
      const content = `# Document

## Some Section
Some content.
`;

      const result = extractSections(content, ['Nonexistent Section']);

      expect(result).toBe(content);
    });

    it('returns empty string for empty content', () => {
      const result = extractSections('', ['Problem Statement']);

      expect(result).toBe('');
    });

    it('stops at next heading of same level', () => {
      const content = `# Document

## Problem Statement
Line 1
Line 2

## Next Section
Should not be included.
`;

      const result = extractSections(content, ['Problem Statement']);

      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
      expect(result).not.toContain('Should not be included');
    });
  });

  describe('extractTargetFiles', () => {
    it('extracts target files from BOLT spec', () => {
      const boltSpec = `# BOLT-001

## Target Files
- src/components/ComponentA.ts
- src/components/ComponentA.test.ts

## Implementation Steps
1. Step 1
`;

      const result = extractTargetFiles(boltSpec);

      expect(result).toEqual([
        'src/components/ComponentA.ts',
        'src/components/ComponentA.test.ts',
      ]);
    });

    it('returns empty array when no target files section', () => {
      const boltSpec = `# BOLT-001

## Implementation Steps
1. Step 1
`;

      const result = extractTargetFiles(boltSpec);

      expect(result).toEqual([]);
    });

    it('handles ### level Target Files heading', () => {
      const boltSpec = `# BOLT-001

### Target Files
- src/file1.ts
- src/file2.ts
`;

      const result = extractTargetFiles(boltSpec);

      expect(result).toEqual(['src/file1.ts', 'src/file2.ts']);
    });

    it('stops extracting at next section', () => {
      const boltSpec = `# BOLT-001

## Target Files
- src/file1.ts

## Next Section
- not/a/file.ts
`;

      const result = extractTargetFiles(boltSpec);

      expect(result).toEqual(['src/file1.ts']);
    });
  });

  describe('selectAgentForBolt', () => {
    it('routes to frontend-engineer for UI work', () => {
      const boltSpec = `# BOLT-001

## Target Files
- src/components/Button.tsx
- src/components/Button.css
`;

      const result = selectAgentForBolt(boltSpec);

      expect(result).toBe('frontend-engineer');
    });

    it('routes to oracle for debug work', () => {
      const boltSpec = `# BOLT-001: Fix bug in authentication

## Description
Debug and investigate the authentication failure.
`;

      const result = selectAgentForBolt(boltSpec);

      expect(result).toBe('oracle');
    });

    it('defaults to olympian for general work', () => {
      const boltSpec = `# BOLT-001: Implement feature

## Target Files
- src/services/api.ts
`;

      const result = selectAgentForBolt(boltSpec);

      expect(result).toBe('olympian');
    });

    it('prefers lower-tier agent when efficiency data supports it', () => {
      mockGetAgentPerformance.mockImplementation((agentName: string) => {
        if (agentName === 'olympian-low') {
          return {
            success_rate: 0.85,
            total_invocations: 20,
          } as AgentPerformance;
        }
        return null;
      });

      const boltSpec = `# BOLT-001

## Target Files
- src/services/api.ts
`;

      const result = selectAgentForBolt(boltSpec);

      expect(result).toBe('olympian-low');
    });

    it('does not use lower-tier agent if success rate too low', () => {
      mockGetAgentPerformance.mockImplementation((agentName: string) => {
        if (agentName === 'olympian-low') {
          return {
            success_rate: 0.6,
            total_invocations: 20,
          } as AgentPerformance;
        }
        return null;
      });

      const boltSpec = `# BOLT-001

## Target Files
- src/services/api.ts
`;

      const result = selectAgentForBolt(boltSpec);

      expect(result).toBe('olympian');
    });

    it('does not use lower-tier agent if insufficient invocations', () => {
      mockGetAgentPerformance.mockImplementation((agentName: string) => {
        if (agentName === 'olympian-low') {
          return {
            success_rate: 0.9,
            total_invocations: 5,
          } as AgentPerformance;
        }
        return null;
      });

      const boltSpec = `# BOLT-001

## Target Files
- src/services/api.ts
`;

      const result = selectAgentForBolt(boltSpec);

      expect(result).toBe('olympian');
    });

    it('routes to correct specialized lower-tier agent for UI work', () => {
      mockGetAgentPerformance.mockImplementation((agentName: string) => {
        if (agentName === 'frontend-engineer-low') {
          return {
            success_rate: 0.85,
            total_invocations: 15,
          } as AgentPerformance;
        }
        return null;
      });

      const boltSpec = `# BOLT-001

## Target Files
- src/ui/Button.tsx
`;

      const result = selectAgentForBolt(boltSpec);

      expect(result).toBe('frontend-engineer-low');
    });
  });

  describe('buildBoltPrompt', () => {
    it('constructs prompt with all context sections', () => {
      const ideaSummary = 'Problem: Users need feature X';
      const intentSummary = 'Technical: Use TypeScript';
      const unitSpec = 'Module: Core authentication module';
      const boltSpec = 'BOLT-001: Implement login';

      const result = buildBoltPrompt(
        ideaSummary,
        intentSummary,
        unitSpec,
        boltSpec
      );

      expect(result).toContain('Problem: Users need feature X');
      expect(result).toContain('Technical: Use TypeScript');
      expect(result).toContain('Module: Core authentication module');
      expect(result).toContain('BOLT-001: Implement login');
      expect(result).toContain('You are executing a coding task');
      expect(result).toContain('Implementation Steps');
      expect(result).toContain('Acceptance Criteria');
    });
  });

  describe('dispatchBolt', () => {
    it('reads all required artifacts and constructs dispatch result', async () => {
      createTestFixtures();

      const result = await dispatchBolt(TEST_DIR, 'workflow-001', 'BOLT-001');

      expect(result.boltId).toBe('BOLT-001');
      expect(result.agentType).toBe('olympian');
      expect(result.context.boltSpec).toContain('BOLT-001: Implement Core Module A');
      expect(result.context.unitSpec).toContain('UNIT-001: Core Module');
      expect(result.context.intentSummary).toContain('Business Requirements');
      expect(result.context.ideaSummary).toContain('Problem Statement');
      expect(result.context.targetFiles).toEqual([
        'src/core/ModuleA.ts',
        'src/core/ModuleA.test.ts',
      ]);
    });

    it('prompt includes all context sections', async () => {
      createTestFixtures();

      const result = await dispatchBolt(TEST_DIR, 'workflow-001', 'BOLT-001');

      expect(result.prompt).toContain('Users need a new feature');
      expect(result.prompt).toContain('Feature must handle edge cases');
      expect(result.prompt).toContain('Core Module');
      expect(result.prompt).toContain('BOLT-001: Implement Core Module A');
    });

    it('returns structured BoltDispatchResult', async () => {
      createTestFixtures();

      const result = await dispatchBolt(TEST_DIR, 'workflow-001', 'BOLT-001');

      expect(result).toHaveProperty('boltId');
      expect(result).toHaveProperty('agentType');
      expect(result).toHaveProperty('prompt');
      expect(result).toHaveProperty('context');
      expect(result.context).toHaveProperty('boltSpec');
      expect(result.context).toHaveProperty('unitSpec');
      expect(result.context).toHaveProperty('intentSummary');
      expect(result.context).toHaveProperty('ideaSummary');
      expect(result.context).toHaveProperty('targetFiles');
    });

    it('handles missing optional artifacts gracefully', async () => {
      const docsDir = join(TEST_DIR, 'aidlc-docs');
      const constructionDir = join(docsDir, 'construction');
      const unit999Dir = join(constructionDir, 'UNIT-999');

      mkdirSync(unit999Dir, { recursive: true });

      // Create a minimal BOLT without unit spec, intent, or idea
      writeFileSync(
        join(unit999Dir, 'BOLT-999.md'),
        `# BOLT-999: Minimal test

## Target Files
- src/test.ts
`
      );

      const result = await dispatchBolt(TEST_DIR, 'workflow-001', 'BOLT-999');

      expect(result.boltId).toBe('BOLT-999');
      expect(result.context.unitSpec).toBe(''); // Unit spec is missing
      expect(result.context.intentSummary).toBe(''); // Intent is missing
      expect(result.context.ideaSummary).toBe(''); // Idea is missing
      expect(result.agentType).toBe('olympian');
    });

    it('finds BOLT from different UNIT correctly', async () => {
      createTestFixtures();

      const result = await dispatchBolt(TEST_DIR, 'workflow-001', 'BOLT-003');

      expect(result.boltId).toBe('BOLT-003');
      expect(result.agentType).toBe('frontend-engineer'); // UI work
      expect(result.context.boltSpec).toContain('BOLT-003: Create UI Component');
      expect(result.context.unitSpec).toContain('UNIT-002: UI Module');
      expect(result.context.targetFiles).toContain('src/ui/Button.tsx');
    });

    it('routes to oracle for debug work', async () => {
      createTestFixtures();

      const result = await dispatchBolt(TEST_DIR, 'workflow-001', 'BOLT-002');

      expect(result.agentType).toBe('oracle');
      expect(result.context.boltSpec).toContain('Fix debug issue');
    });

    it('throws error for non-existent BOLT', async () => {
      createTestFixtures();

      await expect(
        dispatchBolt(TEST_DIR, 'workflow-001', 'BOLT-999')
      ).rejects.toThrow('BOLT BOLT-999 not found');
    });
  });
});
