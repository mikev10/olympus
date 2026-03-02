import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { UnitStageRunner } from '../../../features/workflow-engine/construction/unit-stage-runner.js';
import { createManifest } from '../../../features/workflow-engine/manifest.js';

const TEST_DIR = path.join(process.cwd(), '.test-usr-integration');
const WORKFLOW_ID = 'test-workflow';

const INTENT_CONTENT = `---
id: intent-test-workflow
title: "Test Feature"
status: pending
estimated_effort: 4
---

# Intent: Test Feature

## Goal
Implement the test feature with full coverage.

## Acceptance Criteria
- [ ] Feature is complete
- [ ] Tests pass
`;

const NFR_CONTENT = `# Non-Functional Requirements

## Performance
Response time under 200ms for all API calls.

## Security
All endpoints require authentication.

## Scalability
System must handle 10k concurrent users.
`;

const UNIT_001_SPEC = `---
id: UNIT-001
title: "Core Module"
parent_intent: INTENT-001
status: pending
estimated_effort: 4
---

# Unit: Core Module

## Goal
Implement the core module logic.

## Scope & Responsibility
Handles all core processing for the feature.

## Acceptance Criteria
- [ ] Core processing works correctly
- [ ] Error handling is robust
`;

const UNIT_002_SPEC = `---
id: UNIT-002
title: "API Layer"
parent_intent: INTENT-001
status: pending
estimated_effort: 2
---

# Unit: API Layer

## Goal
Expose the core module via REST API.

## Scope & Responsibility
Handles HTTP request/response lifecycle.

## Acceptance Criteria
- [ ] All endpoints respond correctly
`;

async function setupWorkflowDirs(): Promise<void> {
  const inceptionDir = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'inception');
  await fs.ensureDir(inceptionDir);
  await fs.writeFile(path.join(inceptionDir, 'intent.md'), INTENT_CONTENT, 'utf-8');
  await fs.writeFile(path.join(inceptionDir, 'nfr.md'), NFR_CONTENT, 'utf-8');
}

async function setupUnit(unitId: string, spec: string): Promise<void> {
  const unitDir = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', unitId);
  await fs.ensureDir(unitDir);
  await fs.writeFile(path.join(unitDir, 'spec.md'), spec, 'utf-8');
}

describe('UnitStageRunner Integration', () => {
  beforeEach(async () => {
    await fs.ensureDir(TEST_DIR);
    await setupWorkflowDirs();
    createManifest(WORKFLOW_ID, 'Test Feature', TEST_DIR);
  });

  afterEach(async () => {
    await fs.remove(TEST_DIR);
  });

  describe('MEDIUM depth', () => {
    it('creates exactly 2 artifacts in UNIT-001 directory', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);

      const unitDir = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-001');
      const files = (await fs.readdir(unitDir)).filter(f => f.endsWith('.md') && f !== 'spec.md');
      expect(files).toHaveLength(2);
    });

    it('creates functional-design.md with frontmatter', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);

      const artifactPath = path.join(
        TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-001', 'functional-design.md'
      );
      expect(await fs.pathExists(artifactPath)).toBe(true);

      const content = await fs.readFile(artifactPath, 'utf-8');
      expect(content).toMatch(/^---/);
      expect(content).toContain('id: UNIT-001-functional-design');
      expect(content).toContain('parent_unit: UNIT-001');
      expect(content).toContain('stage: functional-design');
    });

    it('creates nfr-requirements.md with frontmatter', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);

      const artifactPath = path.join(
        TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-001', 'nfr-requirements.md'
      );
      expect(await fs.pathExists(artifactPath)).toBe(true);

      const content = await fs.readFile(artifactPath, 'utf-8');
      expect(content).toMatch(/^---/);
      expect(content).toContain('id: UNIT-001-nfr-requirements');
      expect(content).toContain('parent_unit: UNIT-001');
    });

    it('does NOT create nfr-design.md or infrastructure-design.md', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);

      const unitDir = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-001');
      expect(await fs.pathExists(path.join(unitDir, 'nfr-design.md'))).toBe(false);
      expect(await fs.pathExists(path.join(unitDir, 'infrastructure-design.md'))).toBe(false);
    });

    it('writes UNIT-001 entries to audit.md', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);

      const auditPath = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'audit.md');
      expect(await fs.pathExists(auditPath)).toBe(true);

      const auditContent = await fs.readFile(auditPath, 'utf-8');
      expect(auditContent).toContain('UNIT-001');
      expect(auditContent).toContain('functional-design');
      expect(auditContent).toContain('nfr-requirements');
    });
  });

  describe('DEEP depth', () => {
    it('creates exactly 4 artifacts in UNIT-001 directory', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'DEEP', INTENT_CONTENT, NFR_CONTENT);

      const unitDir = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-001');
      const files = (await fs.readdir(unitDir)).filter(f => f.endsWith('.md') && f !== 'spec.md');
      expect(files).toHaveLength(4);
    });

    it('creates all 4 design artifacts with correct frontmatter', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'DEEP', INTENT_CONTENT, NFR_CONTENT);

      const unitDir = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-001');

      const expectedArtifacts = [
        { file: 'functional-design.md', idSuffix: 'functional-design', stage: 'functional-design' },
        { file: 'nfr-requirements.md', idSuffix: 'nfr-requirements', stage: undefined },
        { file: 'nfr-design.md', idSuffix: 'nfr-design', stage: 'nfr-design' },
        { file: 'infrastructure-design.md', idSuffix: 'infrastructure-design', stage: 'infrastructure-design' },
      ];

      for (const { file, idSuffix } of expectedArtifacts) {
        const artifactPath = path.join(unitDir, file);
        expect(await fs.pathExists(artifactPath)).toBe(true);

        const content = await fs.readFile(artifactPath, 'utf-8');
        expect(content).toMatch(/^---/);
        expect(content).toContain(`UNIT-001-${idSuffix}`);
      }
    });

    it('writes all 4 stage entries to audit.md', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'DEEP', INTENT_CONTENT, NFR_CONTENT);

      const auditPath = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'audit.md');
      const auditContent = await fs.readFile(auditPath, 'utf-8');

      expect(auditContent).toContain('functional-design');
      expect(auditContent).toContain('nfr-requirements');
      expect(auditContent).toContain('nfr-design');
      expect(auditContent).toContain('infrastructure-design');
    });
  });

  describe('SHALLOW depth', () => {
    it('creates NO artifact files in UNIT-001 directory', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'SHALLOW', INTENT_CONTENT);

      const unitDir = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-001');
      const files = (await fs.readdir(unitDir)).filter(f => f.endsWith('.md') && f !== 'spec.md');
      expect(files).toHaveLength(0);
    });

    it('does not create or modify audit.md', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'SHALLOW', INTENT_CONTENT);

      const auditPath = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'audit.md');
      expect(await fs.pathExists(auditPath)).toBe(false);
    });

    it('returns progress with all stages marked skipped', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      const progress = await runner.executeForUnit('UNIT-001', 'SHALLOW', INTENT_CONTENT);

      expect(progress.unitId).toBe('UNIT-001');
      const statuses = Object.values(progress.stages).map(s => s.status);
      expect(statuses.every(s => s === 'skipped')).toBe(true);
    });
  });

  describe('Per-unit directory paths', () => {
    it('places UNIT-001 artifacts under construction/UNIT-001/', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      const progress = await runner.executeForUnit('UNIT-001', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);

      const expectedBase = path.join(
        TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-001'
      );

      const completedStages = Object.entries(progress.stages).filter(
        ([, s]) => s.status === 'completed' && s.artifact_path
      );

      for (const [, stage] of completedStages) {
        expect(stage.artifact_path!.startsWith(expectedBase)).toBe(true);
      }
    });

    it('does not place artifacts in any parent or sibling directory', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);

      const constructionDir = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction');
      const rootFiles = (await fs.readdir(constructionDir)).filter(f => f.endsWith('.md'));
      expect(rootFiles).toHaveLength(0);
    });
  });

  describe('Multiple units', () => {
    it('creates separate artifacts for UNIT-001 and UNIT-002', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);
      await setupUnit('UNIT-002', UNIT_002_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);
      await runner.executeForUnit('UNIT-002', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);

      const unit001Dir = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-001');
      const unit002Dir = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-002');

      expect(await fs.pathExists(path.join(unit001Dir, 'functional-design.md'))).toBe(true);
      expect(await fs.pathExists(path.join(unit001Dir, 'nfr-requirements.md'))).toBe(true);
      expect(await fs.pathExists(path.join(unit002Dir, 'functional-design.md'))).toBe(true);
      expect(await fs.pathExists(path.join(unit002Dir, 'nfr-requirements.md'))).toBe(true);
    });

    it('generates unit-specific IDs in each artifact frontmatter', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);
      await setupUnit('UNIT-002', UNIT_002_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);
      await runner.executeForUnit('UNIT-002', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);

      const unit001Design = await fs.readFile(
        path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-001', 'functional-design.md'),
        'utf-8'
      );
      const unit002Design = await fs.readFile(
        path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'UNIT-002', 'functional-design.md'),
        'utf-8'
      );

      expect(unit001Design).toContain('id: UNIT-001-functional-design');
      expect(unit001Design).toContain('parent_unit: UNIT-001');

      expect(unit002Design).toContain('id: UNIT-002-functional-design');
      expect(unit002Design).toContain('parent_unit: UNIT-002');
    });

    it('appends both units to audit.md', async () => {
      await setupUnit('UNIT-001', UNIT_001_SPEC);
      await setupUnit('UNIT-002', UNIT_002_SPEC);

      const runner = new UnitStageRunner(TEST_DIR, WORKFLOW_ID);
      await runner.executeForUnit('UNIT-001', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);
      await runner.executeForUnit('UNIT-002', 'MEDIUM', INTENT_CONTENT, NFR_CONTENT);

      const auditPath = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'audit.md');
      const auditContent = await fs.readFile(auditPath, 'utf-8');

      expect(auditContent).toContain('UNIT-001');
      expect(auditContent).toContain('UNIT-002');
    });
  });
});
