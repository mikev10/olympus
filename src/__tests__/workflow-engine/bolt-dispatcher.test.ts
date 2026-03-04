import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  dispatchCodeGeneration,
  selectAgentForCodeGeneration,
  extractSections,
  extractTargetFiles,
  buildCodeGenerationPrompt,
  buildCodePlanPath,
} from '../../features/workflow-engine/code-generation-executor.js';
import type { AgentPerformance } from '../../learning/types.js';

// Mock the efficiency module using vi.hoisted
const { mockGetAgentPerformance } = vi.hoisted(() => ({
  mockGetAgentPerformance: vi.fn(() => null),
}));
vi.mock('../../learning/efficiency.js', () => ({
  getAgentPerformanceForRouting: mockGetAgentPerformance,
}));

const TEST_DIR = join(process.cwd(), '.test-code-generation-executor');

describe('code-generation-executor', () => {
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
    const workflowId = 'workflow-001';
    const docsDir = join(TEST_DIR, 'aidlc-docs', workflowId);
    const inceptionDir = join(docsDir, 'inception');
    const constructionDir = join(docsDir, 'construction');
    const authServiceDir = join(constructionDir, 'auth-service');
    const uiModuleDir = join(constructionDir, 'ui-module');

    mkdirSync(authServiceDir, { recursive: true });
    mkdirSync(uiModuleDir, { recursive: true });
    mkdirSync(inceptionDir, { recursive: true });

    // Create intent.md
    writeFileSync(
      join(inceptionDir, 'intent.md'),
      `# INTENT: Test Feature

## Problem Statement
Users need a new feature to solve problem X.

## Success Metrics
- Metric 1: 90% success rate
- Metric 2: Response time < 100ms

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

    // Create auth-service spec
    writeFileSync(
      join(authServiceDir, 'spec.md'),
      `# Auth Service: Core Module

## Overview
This is the core module for the feature.

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

## Components
- Component A
- Component B
`
    );

    // Create ui-module spec
    writeFileSync(
      join(uiModuleDir, 'spec.md'),
      `# UI Module

## Overview
This is the UI module.

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

    // Create debug unit spec
    const debugServiceDir = join(constructionDir, 'debug-service');
    mkdirSync(debugServiceDir, { recursive: true });
    writeFileSync(
      join(debugServiceDir, 'spec.md'),
      `# Debug Service: Fix debug issue in ModuleA

## Overview
Debug and investigate the authentication failure.

## Target Files
- src/core/ModuleA.ts

## Implementation Steps
1. Investigate the bug
2. Fix the logic

## Acceptance Criteria
- Bug is resolved
`
    );

    return { docsDir, inceptionDir, constructionDir, authServiceDir, uiModuleDir, debugServiceDir };
  }

  describe('buildCodePlanPath', () => {
    it('returns correct path for a unit', () => {
      const result = buildCodePlanPath('/project', 'wf-001', 'auth-service');
      const expected = join('/project', 'aidlc-docs', 'wf-001', 'construction', 'auth-service', 'code-plan.md');
      expect(result).toBe(expected);
    });

    it('includes unitName in the path', () => {
      const result = buildCodePlanPath('/p', 'wf', 'api-gateway');
      expect(result).toContain('api-gateway');
      expect(result).toContain('code-plan.md');
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
    it('extracts target files from unit spec', () => {
      const spec = `# Auth Service

## Target Files
- src/components/ComponentA.ts
- src/components/ComponentA.test.ts

## Implementation Steps
1. Step 1
`;

      const result = extractTargetFiles(spec);

      expect(result).toEqual([
        'src/components/ComponentA.ts',
        'src/components/ComponentA.test.ts',
      ]);
    });

    it('returns empty array when no target files section', () => {
      const spec = `# Auth Service

## Implementation Steps
1. Step 1
`;

      const result = extractTargetFiles(spec);

      expect(result).toEqual([]);
    });

    it('handles ### level Target Files heading', () => {
      const spec = `# Auth Service

### Target Files
- src/file1.ts
- src/file2.ts
`;

      const result = extractTargetFiles(spec);

      expect(result).toEqual(['src/file1.ts', 'src/file2.ts']);
    });

    it('stops extracting at next section', () => {
      const spec = `# Auth Service

## Target Files
- src/file1.ts

## Next Section
- not/a/file.ts
`;

      const result = extractTargetFiles(spec);

      expect(result).toEqual(['src/file1.ts']);
    });
  });

  describe('selectAgentForCodeGeneration', () => {
    it('routes to frontend-engineer for UI work', () => {
      const unitSpec = `# UI Module

## Target Files
- src/components/Button.tsx
- src/components/Button.css
`;

      const result = selectAgentForCodeGeneration(unitSpec);

      expect(result).toBe('frontend-engineer');
    });

    it('routes to oracle for debug work', () => {
      const unitSpec = `# Debug Service: Fix bug in authentication

## Description
Debug and investigate the authentication failure.
`;

      const result = selectAgentForCodeGeneration(unitSpec);

      expect(result).toBe('oracle');
    });

    it('defaults to olympian for general work', () => {
      const unitSpec = `# Auth Service: Implement feature

## Target Files
- src/services/api.ts
`;

      const result = selectAgentForCodeGeneration(unitSpec);

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

      const unitSpec = `# Auth Service

## Target Files
- src/services/api.ts
`;

      const result = selectAgentForCodeGeneration(unitSpec);

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

      const unitSpec = `# Auth Service

## Target Files
- src/services/api.ts
`;

      const result = selectAgentForCodeGeneration(unitSpec);

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

      const unitSpec = `# Auth Service

## Target Files
- src/services/api.ts
`;

      const result = selectAgentForCodeGeneration(unitSpec);

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

      const unitSpec = `# UI Module

## Target Files
- src/ui/Button.tsx
`;

      const result = selectAgentForCodeGeneration(unitSpec);

      expect(result).toBe('frontend-engineer-low');
    });
  });

  describe('buildCodeGenerationPrompt', () => {
    it('constructs prompt with all context sections', () => {
      const intentProblemSummary = 'Problem: Users need feature X';
      const intentSummary = 'Technical: Use TypeScript';
      const unitSpec = 'Module: Core authentication module';

      const result = buildCodeGenerationPrompt(
        intentProblemSummary,
        intentSummary,
        unitSpec
      );

      expect(result).toContain('Problem: Users need feature X');
      expect(result).toContain('Technical: Use TypeScript');
      expect(result).toContain('Module: Core authentication module');
      expect(result).toContain('You are executing code generation');
      expect(result).toContain('Implementation Steps');
      expect(result).toContain('Acceptance Criteria');
    });
  });

  describe('dispatchCodeGeneration', () => {
    it('reads all required artifacts and constructs dispatch result', async () => {
      createTestFixtures();

      const result = await dispatchCodeGeneration(TEST_DIR, 'workflow-001', 'auth-service');

      expect(result.unitName).toBe('auth-service');
      expect(result.agentType).toBe('olympian');
      expect(result.context.unitSpec).toContain('Auth Service: Core Module');
      expect(result.context.intentSummary).toContain('Business Requirements');
      expect(result.context.intentSummary2).toContain('Problem Statement');
      expect(result.context.targetFiles).toEqual([
        'src/core/ModuleA.ts',
        'src/core/ModuleA.test.ts',
      ]);
    });

    it('prompt includes all context sections', async () => {
      createTestFixtures();

      const result = await dispatchCodeGeneration(TEST_DIR, 'workflow-001', 'auth-service');

      expect(result.prompt).toContain('Users need a new feature');
      expect(result.prompt).toContain('Feature must handle edge cases');
      expect(result.prompt).toContain('Core Module');
    });

    it('returns structured CodeGenerationDispatchResult', async () => {
      createTestFixtures();

      const result = await dispatchCodeGeneration(TEST_DIR, 'workflow-001', 'auth-service');

      expect(result).toHaveProperty('unitName');
      expect(result).toHaveProperty('agentType');
      expect(result).toHaveProperty('prompt');
      expect(result).toHaveProperty('context');
      expect(result.context).toHaveProperty('unitSpec');
      expect(result.context).toHaveProperty('intentSummary');
      expect(result.context).toHaveProperty('intentSummary2');
      expect(result.context).toHaveProperty('targetFiles');
    });

    it('handles missing optional artifacts gracefully', async () => {
      const workflowId = 'workflow-001';
      const docsDir = join(TEST_DIR, 'aidlc-docs', workflowId);
      const constructionDir = join(docsDir, 'construction');
      const minimalDir = join(constructionDir, 'minimal-unit');

      mkdirSync(minimalDir, { recursive: true });

      // Create a minimal unit spec without intent
      writeFileSync(
        join(minimalDir, 'spec.md'),
        `# Minimal Unit

## Target Files
- src/test.ts
`
      );

      const result = await dispatchCodeGeneration(TEST_DIR, 'workflow-001', 'minimal-unit');

      expect(result.unitName).toBe('minimal-unit');
      expect(result.context.intentSummary).toBe('');
      expect(result.context.intentSummary2).toBe('');
      expect(result.agentType).toBe('olympian');
    });

    it('routes to frontend-engineer for UI unit', async () => {
      createTestFixtures();

      const result = await dispatchCodeGeneration(TEST_DIR, 'workflow-001', 'ui-module');

      expect(result.unitName).toBe('ui-module');
      expect(result.agentType).toBe('frontend-engineer');
      expect(result.context.targetFiles).toContain('src/ui/Button.tsx');
    });

    it('routes to oracle for debug unit', async () => {
      createTestFixtures();

      const result = await dispatchCodeGeneration(TEST_DIR, 'workflow-001', 'debug-service');

      expect(result.agentType).toBe('oracle');
    });

    it('handles non-existent unit gracefully', async () => {
      createTestFixtures();

      const result = await dispatchCodeGeneration(TEST_DIR, 'workflow-001', 'nonexistent-unit');

      expect(result.unitName).toBe('nonexistent-unit');
      expect(result.context.unitSpec).toBe('');
    });
  });
});
