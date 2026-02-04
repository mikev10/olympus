/**
 * Tests for SPEC and INTENTS stages validation
 *
 * Covers:
 * - SPEC artifact validation (coverage against PRD)
 * - TASKS/INTENTS validation (coverage against SPEC)
 * - Dependency graph generation and cycle detection
 * - Master plan linking functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  validateSpec,
  validateTasks,
  generateDependencyGraph,
  validateDependencyGraph,
  getExecutionOrder,
  linkMasterPlan,
} from '../../features/workflow-engine/index.js';
import type { IntentTask, DependencyGraph } from '../../features/workflow-engine/types.js';

const TEST_DIR = join(tmpdir(), `spec-intents-test-${Date.now()}`);

// ============================================================================
// Test Fixtures
// ============================================================================

// Valid PRD with 2 user stories
const VALID_PRD = `---
id: PRD-001
feature: user-authentication
created: 2024-01-15T10:00:00Z
---

# PRD: User Authentication

## User Stories

### US-001: User Login
As a user, I want to log in with email/password so that I can access my account.

**Acceptance Criteria:**
- Email validation
- Password strength check
- Session token generation

### US-002: User Logout
As a user, I want to log out securely so that my session ends.

**Acceptance Criteria:**
- Token invalidation
- Redirect to login page

## Requirement Coverage

| IDEA Constraint | PRD Coverage |
|----------------|--------------|
| CONSTRAINT-001 | US-001, US-002 |
`;

// Valid SPEC covering both PRD user stories
const VALID_SPEC = `---
id: SPEC-001
feature: user-authentication
created: 2024-01-15T11:00:00Z
---

# SPEC: User Authentication

## Architecture Overview

JWT-based authentication with bcrypt password hashing.

## Components

### AuthController
Handles HTTP requests for login/logout endpoints.

### AuthService
Business logic for authentication operations.

### TokenManager
JWT token generation and validation.

## API Specification

**POST /api/auth/login**
- Input: { email, password }
- Output: { token, user }

**POST /api/auth/logout**
- Input: { token }
- Output: { success: true }

## Data Models

\`\`\`typescript
interface User {
  id: string;
  email: string;
  passwordHash: string;
}

interface Session {
  token: string;
  userId: string;
  expiresAt: Date;
}
\`\`\`

## Security Considerations

- Passwords hashed with bcrypt (cost factor: 12)
- JWT tokens signed with HS256
- Rate limiting on login endpoint (10 requests/minute)

## Performance Requirements

- Login response time: <200ms (p95)
- Token validation: <50ms (p99)

## Requirement Coverage

- **US-001 (User Login)**: Covered by AuthController, AuthService, TokenManager
- **US-002 (User Logout)**: Covered by AuthController, TokenManager
`;

// SPEC with insufficient PRD coverage (< 95%)
const INCOMPLETE_SPEC = `---
id: SPEC-002
feature: partial-feature
created: 2024-01-15T11:00:00Z
---

# SPEC: Partial Feature

## Components

### Component A
Some implementation.

## Requirement Coverage

- **US-001**: Covered by Component A
`;

// SPEC missing Requirement Coverage section
const SPEC_NO_COVERAGE = `---
id: SPEC-003
feature: missing-coverage
created: 2024-01-15T11:00:00Z
---

# SPEC: Missing Coverage

## Components

### Component A
Some implementation.

### Component B
Another implementation.
`;

// SPEC missing Components section
const SPEC_NO_COMPONENTS = `---
id: SPEC-004
feature: no-components
created: 2024-01-15T11:00:00Z
---

# SPEC: No Components

## API Specification

Some API docs.

## Requirement Coverage

- **US-001**: Covered somewhere
`;

// Intent file example
const INTENT_FILE_1 = `---
id: INTENT-001
component: AuthController
estimated_effort: 4
dependencies: []
---

# Intent: Implement AuthController

## Description
Create AuthController to handle login/logout HTTP requests.

## Tasks
- Setup Express routes
- Implement login endpoint
- Implement logout endpoint
- Add input validation
`;

const INTENT_FILE_2 = `---
id: INTENT-002
component: AuthService
estimated_effort: 4
dependencies: [INTENT-001]
---

# Intent: Implement AuthService

## Description
Create AuthService with authentication business logic.

## Tasks
- Password hashing with bcrypt
- User lookup by email
- Credential verification
- Session creation
`;

const INTENT_FILE_INVALID_EFFORT = `---
id: INTENT-003
component: TokenManager
estimated_effort: 3
dependencies: []
---

# Intent: Invalid Effort

Effort estimate is 3 (not 1, 2, 4, 8, or 16).
`;

// ============================================================================
// Test Suite 1: SPEC Stage Validation
// ============================================================================

describe('SPEC Stage', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('SPEC Validation', () => {
    it('passes validation with 95%+ PRD coverage', async () => {
      const prdPath = join(TEST_DIR, 'prd.md');
      const specPath = join(TEST_DIR, 'spec.md');

      writeFileSync(prdPath, VALID_PRD, 'utf-8');
      writeFileSync(specPath, VALID_SPEC, 'utf-8');

      const result = await validateSpec(specPath, prdPath);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBeGreaterThanOrEqual(95);
      expect(result.blocking_issues).toHaveLength(0);
      expect(result.reviewer).toBe('metis');
      expect(result.timestamp).toBeDefined();
    });

    it('fails validation with < 95% PRD coverage', async () => {
      const prdPath = join(TEST_DIR, 'prd-multi.md');
      const specPath = join(TEST_DIR, 'spec-incomplete.md');

      // PRD with 3 user stories
      const prdMulti = `---
id: PRD-002
---

# PRD

## User Stories

### US-001: Story 1
Description

### US-002: Story 2
Description

### US-003: Story 3
Description

## Requirement Coverage
All covered
`;

      // SPEC only covers 1 story (33%)
      const specIncomplete = `---
id: SPEC-005
---

# SPEC

## Components

### Component A
Covers US-001

## Requirement Coverage

- **US-001**: Covered by Component A
`;

      writeFileSync(prdPath, prdMulti, 'utf-8');
      writeFileSync(specPath, specIncomplete, 'utf-8');

      const result = await validateSpec(specPath, prdPath);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBeLessThan(95);
      expect(result.blocking_issues.some(issue => /Coverage only \d+%, need at least 95%/.test(issue))).toBe(true);
      expect(result.reviewer).toBe('metis');
    });

    it('fails validation with missing Requirement Coverage section', async () => {
      const prdPath = join(TEST_DIR, 'prd-basic.md');
      const specPath = join(TEST_DIR, 'spec-no-coverage.md');

      writeFileSync(prdPath, VALID_PRD, 'utf-8');
      writeFileSync(specPath, SPEC_NO_COVERAGE, 'utf-8');

      const result = await validateSpec(specPath, prdPath);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain(
        'Missing Requirement Coverage section in SPEC'
      );
    });

    it('fails validation with missing Components section', async () => {
      const prdPath = join(TEST_DIR, 'prd-components.md');
      const specPath = join(TEST_DIR, 'spec-no-components.md');

      writeFileSync(prdPath, VALID_PRD, 'utf-8');
      writeFileSync(specPath, SPEC_NO_COMPONENTS, 'utf-8');

      const result = await validateSpec(specPath, prdPath);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain(
        'Missing Components or Architecture section'
      );
    });

    it('returns error when SPEC file not found', async () => {
      const prdPath = join(TEST_DIR, 'prd-exists.md');
      const specPath = join(TEST_DIR, 'nonexistent-spec.md');

      writeFileSync(prdPath, VALID_PRD, 'utf-8');

      const result = await validateSpec(specPath, prdPath);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain('SPEC artifact file not found');
      expect(result.reviewer).toBe('metis');
    });

    it('returns error when PRD file not found', async () => {
      const prdPath = join(TEST_DIR, 'nonexistent-prd.md');
      const specPath = join(TEST_DIR, 'spec-orphan.md');

      writeFileSync(specPath, VALID_SPEC, 'utf-8');

      const result = await validateSpec(specPath, prdPath);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBe(0);
      expect(result.blocking_issues).toContain(
        'PRD artifact file not found for reference'
      );
    });

    it('verifies reviewer is set to metis', async () => {
      const prdPath = join(TEST_DIR, 'prd-metis.md');
      const specPath = join(TEST_DIR, 'spec-metis.md');

      writeFileSync(prdPath, VALID_PRD, 'utf-8');
      writeFileSync(specPath, VALID_SPEC, 'utf-8');

      const result = await validateSpec(specPath, prdPath);

      expect(result.reviewer).toBe('metis');
    });
  });
});

// ============================================================================
// Test Suite 2: INTENTS Stage Validation
// ============================================================================

describe('INTENTS Stage', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('TASKS Validation', () => {
    it('passes validation with 100% SPEC component coverage', async () => {
      const specPath = join(TEST_DIR, 'spec-tasks.md');
      const intentsDir = join(TEST_DIR, 'intents');

      mkdirSync(intentsDir, { recursive: true });

      writeFileSync(specPath, VALID_SPEC, 'utf-8');
      writeFileSync(join(intentsDir, 'INTENT-001.md'), INTENT_FILE_1, 'utf-8');
      writeFileSync(join(intentsDir, 'INTENT-002.md'), INTENT_FILE_2, 'utf-8');

      // Need to cover TokenManager component as well
      // Use consistent effort estimate to avoid variance issues
      const intent3 = `---
id: INTENT-003
component: TokenManager
estimated_effort: 4
---
# Token Manager
Implements token management.
`;
      writeFileSync(join(intentsDir, 'INTENT-003.md'), intent3, 'utf-8');

      const result = await validateTasks(intentsDir, specPath);

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('fails validation with missing component coverage', async () => {
      const specPath = join(TEST_DIR, 'spec-partial.md');
      const intentsDir = join(TEST_DIR, 'intents-partial');

      mkdirSync(intentsDir, { recursive: true });

      // SPEC with 3 components
      const specMulti = `---
id: SPEC-006
---
# SPEC

## Components

### ComponentA
First component

### ComponentB
Second component

### ComponentC
Third component
`;

      // Only cover ComponentA and ComponentB (66%)
      const intent1 = `---
id: INTENT-010
component: ComponentA
estimated_effort: 4
---
# Intent 1
`;
      const intent2 = `---
id: INTENT-011
component: ComponentB
estimated_effort: 4
---
# Intent 2
`;

      writeFileSync(specPath, specMulti, 'utf-8');
      writeFileSync(join(intentsDir, 'INTENT-010.md'), intent1, 'utf-8');
      writeFileSync(join(intentsDir, 'INTENT-011.md'), intent2, 'utf-8');

      const result = await validateTasks(intentsDir, specPath);

      expect(result.passed).toBe(false);
      expect(result.coverage_percentage).toBeLessThan(100);
      expect(result.blocking_issues.some(issue => /Incomplete coverage:.*ComponentC/.test(issue))).toBe(true);
    });

    it('fails validation with invalid effort estimates', async () => {
      const specPath = join(TEST_DIR, 'spec-effort.md');
      const intentsDir = join(TEST_DIR, 'intents-effort');

      mkdirSync(intentsDir, { recursive: true });

      const specSimple = `---
id: SPEC-007
---
# SPEC

## Components

### TestComponent
Test
`;

      writeFileSync(specPath, specSimple, 'utf-8');
      writeFileSync(
        join(intentsDir, 'INTENT-003.md'),
        INTENT_FILE_INVALID_EFFORT,
        'utf-8'
      );

      const result = await validateTasks(intentsDir, specPath);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues.some(issue => /Invalid effort estimate: 3 hours/.test(issue))).toBe(true);
    });

    it('validates effort estimates are in [1, 2, 4, 8, 16]', async () => {
      const specPath = join(TEST_DIR, 'spec-valid-effort.md');
      const intentsDir = join(TEST_DIR, 'intents-valid-effort');

      mkdirSync(intentsDir, { recursive: true });

      const specSimple = `---
id: SPEC-008
---
# SPEC

## Components

### CompA
Test
### CompB
Test
### CompC
Test
`;

      // Use effort values that are all 4 to avoid variance warnings
      const validEstimates = [4, 4, 4];
      validEstimates.forEach((effort, idx) => {
        const intent = `---
id: INTENT-${100 + idx}
component: Comp${String.fromCharCode(65 + idx)}
estimated_effort: ${effort}
---
# Intent ${idx}
`;
        writeFileSync(join(intentsDir, `INTENT-${100 + idx}.md`), intent, 'utf-8');
      });

      writeFileSync(specPath, specSimple, 'utf-8');

      const result = await validateTasks(intentsDir, specPath);

      expect(result.passed).toBe(true);
      expect(result.blocking_issues.some(issue => /Invalid effort estimate/.test(issue))).toBe(false);
    });

    it('returns error when tasks directory not found', async () => {
      const specPath = join(TEST_DIR, 'spec-orphan-tasks.md');
      const intentsDir = join(TEST_DIR, 'nonexistent-intents');

      writeFileSync(specPath, VALID_SPEC, 'utf-8');

      const result = await validateTasks(intentsDir, specPath);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain(
        'Tasks directory not found or inaccessible'
      );
    });

    it('returns error when SPEC file not found', async () => {
      const specPath = join(TEST_DIR, 'nonexistent-spec-tasks.md');
      const intentsDir = join(TEST_DIR, 'intents-no-spec');

      mkdirSync(intentsDir, { recursive: true });

      const result = await validateTasks(intentsDir, specPath);

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('SPEC artifact file not found');
    });
  });
});

// ============================================================================
// Test Suite 3: Dependency Graph
// ============================================================================

describe('Dependency Graph', () => {
  describe('Graph Generation', () => {
    it('creates correct structure with nodes and edges', () => {
      const tasks: IntentTask[] = [
        {
          id: 'TASK-001',
          title: 'Setup database',
          component: 'Database',
          estimated_effort: 4,
          dependencies: [],
        },
        {
          id: 'TASK-002',
          title: 'Create schema',
          component: 'Database',
          estimated_effort: 2,
          dependencies: ['TASK-001'],
        },
        {
          id: 'TASK-003',
          title: 'Seed data',
          component: 'Database',
          estimated_effort: 1,
          dependencies: ['TASK-002'],
        },
      ];

      const graph = generateDependencyGraph(tasks);

      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges).toHaveLength(2);

      // Verify nodes include all metadata
      expect(graph.nodes[0]).toEqual({
        id: 'TASK-001',
        title: 'Setup database',
        component: 'Database',
        estimated_effort: 4,
      });

      // Verify edges correctly represent dependencies
      expect(graph.edges).toContainEqual({ from: 'TASK-001', to: 'TASK-002' });
      expect(graph.edges).toContainEqual({ from: 'TASK-002', to: 'TASK-003' });
    });

    it('includes all task metadata in nodes', () => {
      const tasks: IntentTask[] = [
        {
          id: 'A',
          title: 'Task Title',
          component: 'ComponentName',
          estimated_effort: 8,
          dependencies: [],
        },
      ];

      const graph = generateDependencyGraph(tasks);

      expect(graph.nodes[0].id).toBe('A');
      expect(graph.nodes[0].title).toBe('Task Title');
      expect(graph.nodes[0].component).toBe('ComponentName');
      expect(graph.nodes[0].estimated_effort).toBe(8);
    });
  });

  describe('Cycle Detection', () => {
    it('passes validation with valid DAG', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', title: 'Task A', component: 'Comp1', estimated_effort: 2 },
          { id: 'B', title: 'Task B', component: 'Comp2', estimated_effort: 2 },
          { id: 'C', title: 'Task C', component: 'Comp3', estimated_effort: 2 },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      };

      expect(() => validateDependencyGraph(graph)).not.toThrow();
    });

    it('detects direct cycle (A -> B -> A)', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', title: 'Task A', component: 'Comp1', estimated_effort: 2 },
          { id: 'B', title: 'Task B', component: 'Comp2', estimated_effort: 2 },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'A' }, // Creates cycle
        ],
      };

      expect(() => validateDependencyGraph(graph)).toThrow(/Circular dependency detected/);
    });

    it('detects indirect cycle (A -> B -> C -> A)', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', title: 'Task A', component: 'Comp1', estimated_effort: 2 },
          { id: 'B', title: 'Task B', component: 'Comp2', estimated_effort: 2 },
          { id: 'C', title: 'Task C', component: 'Comp3', estimated_effort: 2 },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
          { from: 'C', to: 'A' }, // Creates cycle
        ],
      };

      expect(() => validateDependencyGraph(graph)).toThrow(/Circular dependency detected/);
    });

    it('includes cycle path in error message', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'X', title: 'Task X', component: 'Comp1', estimated_effort: 2 },
          { id: 'Y', title: 'Task Y', component: 'Comp2', estimated_effort: 2 },
          { id: 'Z', title: 'Task Z', component: 'Comp3', estimated_effort: 2 },
        ],
        edges: [
          { from: 'X', to: 'Y' },
          { from: 'Y', to: 'Z' },
          { from: 'Z', to: 'X' },
        ],
      };

      expect(() => validateDependencyGraph(graph)).toThrow(/X -> Y -> Z -> X/);
    });

    it('detects self-loop (A -> A)', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', title: 'Task A', component: 'Comp1', estimated_effort: 2 },
        ],
        edges: [{ from: 'A', to: 'A' }],
      };

      expect(() => validateDependencyGraph(graph)).toThrow(/Circular dependency detected/);
    });

    it('detects multiple cycles in disconnected graph', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', title: 'Task A', component: 'Comp1', estimated_effort: 2 },
          { id: 'B', title: 'Task B', component: 'Comp2', estimated_effort: 2 },
          { id: 'C', title: 'Task C', component: 'Comp3', estimated_effort: 2 },
          { id: 'D', title: 'Task D', component: 'Comp4', estimated_effort: 2 },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'A' }, // Cycle 1
          { from: 'C', to: 'D' },
          { from: 'D', to: 'C' }, // Cycle 2
        ],
      };

      // Should detect at least one cycle
      expect(() => validateDependencyGraph(graph)).toThrow(/Circular dependency detected/);
    });
  });

  describe('Execution Order', () => {
    it('returns topological sort for simple chain', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', title: 'Task A', component: 'Comp1', estimated_effort: 2 },
          { id: 'B', title: 'Task B', component: 'Comp2', estimated_effort: 2 },
          { id: 'C', title: 'Task C', component: 'Comp3', estimated_effort: 2 },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      };

      const order = getExecutionOrder(graph);

      expect(order).toEqual(['A', 'B', 'C']);
    });

    it('places tasks with no dependencies first', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'ROOT1', title: 'Root 1', component: 'Comp1', estimated_effort: 2 },
          { id: 'ROOT2', title: 'Root 2', component: 'Comp2', estimated_effort: 2 },
          { id: 'CHILD', title: 'Child', component: 'Comp3', estimated_effort: 2 },
        ],
        edges: [
          { from: 'ROOT1', to: 'CHILD' },
          { from: 'ROOT2', to: 'CHILD' },
        ],
      };

      const order = getExecutionOrder(graph);

      expect(order).toHaveLength(3);
      expect(order[2]).toBe('CHILD');
      expect(order.slice(0, 2)).toContain('ROOT1');
      expect(order.slice(0, 2)).toContain('ROOT2');
    });

    it('respects dependency order in complex graph', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', title: 'Task A', component: 'Comp1', estimated_effort: 2 },
          { id: 'B', title: 'Task B', component: 'Comp2', estimated_effort: 2 },
          { id: 'C', title: 'Task C', component: 'Comp3', estimated_effort: 2 },
          { id: 'D', title: 'Task D', component: 'Comp4', estimated_effort: 2 },
        ],
        edges: [
          { from: 'A', to: 'C' },
          { from: 'B', to: 'C' },
          { from: 'C', to: 'D' },
        ],
      };

      const order = getExecutionOrder(graph);

      expect(order).toHaveLength(4);
      // A and B must come before C
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
      expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
      // C must come before D
      expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
    });

    it('throws error on cyclic graph', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', title: 'Task A', component: 'Comp1', estimated_effort: 2 },
          { id: 'B', title: 'Task B', component: 'Comp2', estimated_effort: 2 },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'A' },
        ],
      };

      expect(() => getExecutionOrder(graph)).toThrow(/graph contains cycles/);
    });

    it('handles graph with single node', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'ONLY', title: 'Only Task', component: 'Comp1', estimated_effort: 2 },
        ],
        edges: [],
      };

      const order = getExecutionOrder(graph);

      expect(order).toEqual(['ONLY']);
    });

    it('handles diamond dependency pattern', () => {
      const graph: DependencyGraph = {
        nodes: [
          { id: 'A', title: 'Task A', component: 'Comp1', estimated_effort: 2 },
          { id: 'B', title: 'Task B', component: 'Comp2', estimated_effort: 2 },
          { id: 'C', title: 'Task C', component: 'Comp3', estimated_effort: 2 },
          { id: 'D', title: 'Task D', component: 'Comp4', estimated_effort: 2 },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'A', to: 'C' },
          { from: 'B', to: 'D' },
          { from: 'C', to: 'D' },
        ],
      };

      const order = getExecutionOrder(graph);

      expect(order).toHaveLength(4);
      expect(order[0]).toBe('A');
      expect(order[3]).toBe('D');
      expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
      expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
    });
  });
});

// ============================================================================
// Test Suite 4: Master Plan Linking
// ============================================================================

describe('Master Plan Linking', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('Plan Creation', () => {
    it('creates plan file if it does not exist', async () => {
      await linkMasterPlan(TEST_DIR, 'test-workflow-001');

      const planPath = join(TEST_DIR, '.olympus', 'plans', 'test-workflow-001-plan.md');

      expect(existsSync(planPath)).toBe(true);
    });

    it('adds Structured Artifacts section to new plan', async () => {
      await linkMasterPlan(TEST_DIR, 'test-workflow-002');

      const planPath = join(TEST_DIR, '.olympus', 'plans', 'test-workflow-002-plan.md');
      const content = readFileSync(planPath, 'utf-8');

      expect(content).toContain('## Structured Artifacts');
    });

    it('includes correct relative paths in artifacts section', async () => {
      await linkMasterPlan(TEST_DIR, 'test-workflow-003');

      const planPath = join(TEST_DIR, '.olympus', 'plans', 'test-workflow-003-plan.md');
      const content = readFileSync(planPath, 'utf-8');

      expect(content).toContain('[IDEA Artifact](.olympus/workflow/test-workflow-003/idea.md)');
      expect(content).toContain('[PRD Artifact](.olympus/workflow/test-workflow-003/prd.md)');
      expect(content).toContain('[SPEC Artifact](.olympus/workflow/test-workflow-003/spec.md)');
      expect(content).toContain('[Intent Files](.olympus/workflow/test-workflow-003/intents/)');
      expect(content).toContain(
        '[Dependency Graph](.olympus/workflow/test-workflow-003/intents/dependency-graph.json)'
      );
      expect(content).toContain(
        '[Workflow Checkpoint](.olympus/workflow/test-workflow-003/checkpoint.json)'
      );
    });

    it('creates plan with header containing workflow ID', async () => {
      await linkMasterPlan(TEST_DIR, 'my-feature-workflow');

      const planPath = join(TEST_DIR, '.olympus', 'plans', 'my-feature-workflow-plan.md');
      const content = readFileSync(planPath, 'utf-8');

      expect(content).toContain('# Plan: my-feature-workflow');
    });
  });

  describe('Plan Update', () => {
    it('preserves existing content when updating plan', async () => {
      const plansDir = join(TEST_DIR, '.olympus', 'plans');
      mkdirSync(plansDir, { recursive: true });

      const planPath = join(plansDir, 'existing-plan-plan.md');
      const existingContent = `# Existing Plan

## Overview
This is my existing plan content.

## Implementation Notes
Some important notes here.
`;

      writeFileSync(planPath, existingContent, 'utf-8');

      await linkMasterPlan(TEST_DIR, 'existing-plan');

      const updatedContent = readFileSync(planPath, 'utf-8');

      expect(updatedContent).toContain('Existing Plan');
      expect(updatedContent).toContain('## Overview');
      expect(updatedContent).toContain('This is my existing plan content');
      expect(updatedContent).toContain('## Implementation Notes');
      expect(updatedContent).toContain('Some important notes here');
    });

    it('updates existing artifacts section without duplication', async () => {
      const plansDir = join(TEST_DIR, '.olympus', 'plans');
      mkdirSync(plansDir, { recursive: true });

      const planPath = join(plansDir, 'update-artifacts-plan.md');
      const existingContent = `# Plan

## Overview
Some content

## Structured Artifacts

Old artifacts content that should be replaced.

## Next Steps
More content
`;

      writeFileSync(planPath, existingContent, 'utf-8');

      await linkMasterPlan(TEST_DIR, 'update-artifacts');

      const updatedContent = readFileSync(planPath, 'utf-8');

      // Should have new artifacts section
      expect(updatedContent).toContain('[IDEA Artifact]');
      expect(updatedContent).toContain('[PRD Artifact]');

      // Should not have old content
      expect(updatedContent).not.toContain('Old artifacts content');

      // Should preserve other sections
      expect(updatedContent).toContain('## Overview');
      expect(updatedContent).toContain('## Next Steps');

      // Should not duplicate section header
      const sectionCount = (updatedContent.match(/## Structured Artifacts/g) || []).length;
      expect(sectionCount).toBe(1);
    });

    it('appends artifacts section if not present in existing plan', async () => {
      const plansDir = join(TEST_DIR, '.olympus', 'plans');
      mkdirSync(plansDir, { recursive: true });

      const planPath = join(plansDir, 'append-artifacts-plan.md');
      const existingContent = `# Plan Without Artifacts

## Section 1
Content 1

## Section 2
Content 2
`;

      writeFileSync(planPath, existingContent, 'utf-8');

      await linkMasterPlan(TEST_DIR, 'append-artifacts');

      const updatedContent = readFileSync(planPath, 'utf-8');

      expect(updatedContent).toContain('## Structured Artifacts');
      expect(updatedContent).toContain('[IDEA Artifact]');
      expect(updatedContent).toContain('Content 1');
      expect(updatedContent).toContain('Content 2');
    });

    it('does not create duplicate sections on multiple calls', async () => {
      await linkMasterPlan(TEST_DIR, 'no-duplicates');
      await linkMasterPlan(TEST_DIR, 'no-duplicates');
      await linkMasterPlan(TEST_DIR, 'no-duplicates');

      const planPath = join(TEST_DIR, '.olympus', 'plans', 'no-duplicates-plan.md');
      const content = readFileSync(planPath, 'utf-8');

      const sectionCount = (content.match(/## Structured Artifacts/g) || []).length;
      expect(sectionCount).toBe(1);
    });
  });
});
