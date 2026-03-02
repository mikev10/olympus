import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { updateExecutionPlanCheckbox } from '../../../features/workflow-engine/inception/execution-plan-updater.js';

const TEST_DIR = path.join(process.cwd(), '.test-epu-construction');
const WORKFLOW_ID = 'test-workflow';

const EXECUTION_PLAN_CONTENT = `# Execution Plan

## Inception
- [x] Workspace Detection
- [x] Requirements Analysis

## Construction
- [ ] Domain Design
- [ ] Functional Design
- [ ] NFR Requirements
- [ ] NFR Design
- [ ] Infrastructure Design
`;

async function createExecutionPlan(content = EXECUTION_PLAN_CONTENT): Promise<string> {
  const planDir = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'inception', 'plans');
  await fs.ensureDir(planDir);
  const planPath = path.join(planDir, 'execution-plan.md');
  await fs.writeFile(planPath, content, 'utf-8');
  return planPath;
}

describe('updateExecutionPlanCheckbox — construction stages', () => {
  beforeEach(async () => {
    await fs.ensureDir(TEST_DIR);
  });

  afterEach(async () => {
    await fs.remove(TEST_DIR);
  });

  it('checks the Functional Design checkbox on completion', async () => {
    const planPath = await createExecutionPlan();

    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'functional-design', 'completed');

    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('- [x] Functional Design');
    expect(content).toContain('- [ ] NFR Requirements');
    expect(content).toContain('- [ ] Domain Design');
  });

  it('checks the NFR Requirements checkbox on completion', async () => {
    const planPath = await createExecutionPlan();

    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'nfr-requirements', 'completed');

    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('- [x] NFR Requirements');
    expect(content).toContain('- [ ] Functional Design');
  });

  it('checks the NFR Design checkbox on completion', async () => {
    const planPath = await createExecutionPlan();

    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'nfr-design', 'completed');

    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('- [x] NFR Design');
    expect(content).toContain('- [ ] Functional Design');
  });

  it('checks the Infrastructure Design checkbox on completion', async () => {
    const planPath = await createExecutionPlan();

    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'infrastructure-design', 'completed');

    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('- [x] Infrastructure Design');
    expect(content).toContain('- [ ] Functional Design');
  });

  it('checks the Domain Design checkbox on completion', async () => {
    const planPath = await createExecutionPlan();

    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'domain-design', 'completed');

    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('- [x] Domain Design');
    expect(content).toContain('- [ ] Functional Design');
  });

  it('is idempotent — calling twice does not double-check the item', async () => {
    const planPath = await createExecutionPlan();

    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'functional-design', 'completed');
    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'functional-design', 'completed');

    const content = await fs.readFile(planPath, 'utf-8');
    const matches = content.match(/- \[x\] Functional Design/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('marks a stage as skipped with *(skipped)* suffix', async () => {
    const planPath = await createExecutionPlan();

    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'nfr-design', 'skipped');

    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('- [x] NFR Design *(skipped)*');
  });

  it('marks infrastructure-design as skipped correctly', async () => {
    const planPath = await createExecutionPlan();

    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'infrastructure-design', 'skipped');

    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('- [x] Infrastructure Design *(skipped)*');
  });

  it('does not modify already-checked items', async () => {
    const planPath = await createExecutionPlan();
    const originalContent = await fs.readFile(planPath, 'utf-8');

    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'workspace-detection', 'completed');

    const newContent = await fs.readFile(planPath, 'utf-8');
    expect(newContent).toBe(originalContent);
  });

  it('does nothing when execution-plan.md does not exist', async () => {
    await expect(
      updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'functional-design', 'completed')
    ).resolves.toBeUndefined();
  });

  it('checks all construction stages independently without cross-contamination', async () => {
    const planPath = await createExecutionPlan();

    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'domain-design', 'completed');
    await updateExecutionPlanCheckbox(TEST_DIR, WORKFLOW_ID, 'nfr-requirements', 'skipped');

    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('- [x] Domain Design');
    expect(content).toContain('- [x] NFR Requirements *(skipped)*');
    expect(content).toContain('- [ ] Functional Design');
    expect(content).toContain('- [ ] NFR Design');
    expect(content).toContain('- [ ] Infrastructure Design');
  });
});
