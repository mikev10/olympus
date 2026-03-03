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

const installerPath = join(process.cwd(), 'src', 'installer', 'index.ts');
const testDir = join(process.cwd(), '.test-skill-templates');

let installerSource: string;

beforeEach(() => {
  installerSource = fs.readFileSync(installerPath, 'utf-8');
  fs.ensureDirSync(testDir);
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('/plan template content validation', () => {
  it('contains workspace-scan.json reference', () => {
    expect(installerSource).toContain('workspace-scan.json');
  });

  it('contains StaticModel format instructions', () => {
    expect(installerSource).toContain('STATIC_MODEL_FORMAT_INSTRUCTIONS');
  });

  it('contains DynamicModel format instructions', () => {
    expect(installerSource).toContain('DYNAMIC_MODEL_FORMAT_INSTRUCTIONS');
  });

  it('contains inception stages tracking', () => {
    expect(installerSource).toContain('inception_stages');
  });

  it('contains PRFAQ generation step gated by pathway type', () => {
    expect(installerSource).toContain('Generate PRFAQ');
    expect(installerSource).toContain('Optional PRFAQ');
  });

  it('contains ceremony mode check', () => {
    expect(installerSource).toContain('Ceremony Config');
    expect(installerSource).toContain('ceremony_mode');
  });

  it('checkpoint saves include inception stage fields', () => {
    expect(installerSource).toContain('workflow_routing_path');
    expect(installerSource).toContain('pathway_type');
    expect(installerSource).toContain('skip_reason');
  });

  it('uses post-Task-0 step numbering (no IDEA step)', () => {
    expect(installerSource).not.toContain('## Step 4: IDEA');
  });

  it('PRFAQ references intent.md summary', () => {
    expect(installerSource).toContain('intent.md summary');
  });
});

describe('/ascent template content validation', () => {
  it('contains plan-first execution protocol', () => {
    expect(installerSource).toContain('Plan-Verify-Generate');
  });

  it('contains trust-based auto-approval', () => {
    expect(installerSource).toContain('trust-state.json');
    expect(installerSource).toContain('auto-approved');
  });

  it('contains awaiting_bolt_plan_approval status', () => {
    expect(installerSource).toContain('awaiting_bolt_plan_approval');
  });

  it('contains executing_bolt_plan status', () => {
    expect(installerSource).toContain('executing_bolt_plan');
  });

  it('contains gate audit entry instructions', () => {
    const hasGateAudit = installerSource.includes('gate_audit');
    const hasBoltPlanApproved = installerSource.includes('BOLT plan approved');
    expect(hasGateAudit || hasBoltPlanApproved).toBe(true);
  });
});

describe('/review template content validation', () => {
  it('contains artifact type detection', () => {
    expect(installerSource).toContain('Artifact Type Detection');
  });

  it('contains per-artifact evaluation criteria', () => {
    expect(installerSource).toContain('Per-Artifact Evaluation Criteria');
  });

  it('contains intent-specific criteria', () => {
    expect(installerSource).toContain('Problem clarity');
  });

  it('contains INVEST criteria for user stories', () => {
    expect(installerSource).toContain('INVEST');
  });

  it('contains review file persistence', () => {
    expect(installerSource).toContain('artifact-name}-review.md');
  });

  it('falls back to plan review when no path', () => {
    expect(installerSource).toContain('.olympus/plans/');
  });
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
**Estimated Bolts:** 3
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
