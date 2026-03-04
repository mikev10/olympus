import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
  parseStaticModelResponse,
  parseDynamicModelResponse,
} from '../../features/workflow-engine/brownfield-analysis.js';
import {
  loadWorkflowRouting,
  isPhaseIncluded,
} from '../../features/workflow-engine/workflow-routing.js';

const testDir = join(process.cwd(), '.test-skill-templates');

beforeEach(() => {
  fs.ensureDirSync(testDir);
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('Format compatibility (round-trip tests)', () => {
  it('sample Static Model parses via parseStaticModelResponse', () => {
    const sampleStaticModel = `## Modules

| Name | Path | Responsibility | Public Interface |
|------|------|----------------|------------------|
| auth | src/auth.ts | Authentication | login(), logout() |
| db | src/db.ts | Database access | query(), connect() |

## Dependency Graph

- auth -> db

## Data Models

| Name | Fields | Location |
|------|--------|----------|
| User | id, name, email | src/models/user.ts |

## Configuration Summary

Uses environment variables for database connection.
`;

    const result = parseStaticModelResponse(sampleStaticModel);
    expect(result.modules).toHaveLength(2);
    expect(result.modules[0].name).toBe('auth');
    expect(result.dependencyGraph).toHaveLength(1);
    expect(result.dataModels).toHaveLength(1);
  });

  it('sample Dynamic Model parses via parseDynamicModelResponse', () => {
    const sampleDynamicModel = `## Use Cases

### User Login
User authenticates with credentials
1. User submits login form
2. Server validates credentials
3. Token is returned

## Event Patterns

| Event | Publisher | Subscribers |
|-------|-----------|-------------|
| auth.login | auth-service | session-service |

## State Management

Redux store with auth slice.

## Error Handling

Global error boundary catches unhandled exceptions.
`;

    const result = parseDynamicModelResponse(sampleDynamicModel);
    expect(result.useCases).toHaveLength(1);
    expect(result.useCases[0].name).toBe('User Login');
    expect(result.useCases[0].steps).toHaveLength(3);
  });

  it('sample L1 Plan round-trips through loadWorkflowRouting and isPhaseIncluded', () => {
    const workflowId = 'test-wf';
    const planDir = join(testDir, 'aidlc-docs', workflowId, 'inception', 'plans');
    fs.ensureDirSync(planDir);

    const planContent = `# Workflow Routing

**Pathway:** brownfield-enhancement
**Risk Assessment:** MEDIUM
**Risk Tier:** 2
**Estimated Code Generations:** 3
**Estimated Depth:** standard
**Generated:** 2026-01-15T00:00:00.000Z
**Approved:** Pending

## Phase Overview

| Phase | Included | Rationale |
|-------|----------|-----------|
| discovery | yes | Brownfield project needs analysis |
| inception | yes | Standard inception |
| construction | yes | Implementation needed |
| operations | no | Not in scope |

## Stage Details

| # | Phase | Stage | Included | Rationale |
|---|-------|-------|----------|-----------|
| 1 | discovery | brownfield-scan | yes | Analyze existing code |
| 2 | inception | intent | yes | Gather requirements |
| 3 | construction | bolt-execution | yes | Build features |
| 4 | operations | deployment | no | Deferred |
`;

    fs.writeFileSync(join(planDir, 'workflow-routing.md'), planContent, 'utf-8');

    const plan = loadWorkflowRouting(testDir, workflowId);
    expect(plan).not.toBeNull();
    expect(plan!.pathway).toBe('brownfield-enhancement');
    expect(plan!.risk_assessment).toBe('MEDIUM');
    expect(isPhaseIncluded(plan!, 'discovery')).toBe(true);
    expect(isPhaseIncluded(plan!, 'operations')).toBe(false);
  });
});
