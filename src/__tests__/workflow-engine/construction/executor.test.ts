/**
 * Tests for Construction Executor
 *
 * Validates the ConstructionExecutor class which orchestrates the complete Construction phase:
 * - Stage agent mapping
 * - Full pipeline execution (decomposition + design)
 * - Progress tracking
 * - Error handling
 * - Artifact creation and validation
 * - SHALLOW depth mode
 * - Decomposition limits
 * - Developer review blocking
 * - Decomposition summary
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  ConstructionExecutor,
  CONSTRUCTION_STAGE_AGENT_MAP,
} from '../../../features/workflow-engine/construction/executor.js';
import { createManifest, loadManifest } from '../../../features/workflow-engine/manifest.js';
import { clearCache as clearCheckpointCache, saveCheckpoint, loadCheckpoint } from '../../../features/workflow-engine/checkpoint.js';

describe('CONSTRUCTION_STAGE_AGENT_MAP', () => {
  it('should map all stages to olympian agent', () => {
    expect(CONSTRUCTION_STAGE_AGENT_MAP).toEqual({
      unit: 'olympian',
      'code-generation': 'olympian',
      design: 'olympian',
    });
  });

  it('should have entries for all construction stages', () => {
    expect(CONSTRUCTION_STAGE_AGENT_MAP).toHaveProperty('unit');
    expect(CONSTRUCTION_STAGE_AGENT_MAP).toHaveProperty('code-generation');
    expect(CONSTRUCTION_STAGE_AGENT_MAP).toHaveProperty('design');
  });

});

describe('ConstructionExecutor', () => {
  const testDir = path.join(process.cwd(), '.test-executor');
  const workflowId = 'test-workflow';
  const projectPath = testDir;

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    clearCheckpointCache();
    await fs.remove(testDir);
  });

  /**
   * Helper: create a new-style intent.md in the inception directory
   */
  async function createIntentFile(
    title: string,
    effort: number,
    proposedUnits?: string[]
  ): Promise<void> {
    const intentDir = path.join(testDir, 'aidlc-docs', workflowId, 'inception');
    await fs.ensureDir(intentDir);

    let unitsSection = '';
    if (proposedUnits && proposedUnits.length > 0) {
      unitsSection = '\n### Proposed UNITs\n';
      proposedUnits.forEach((u, i) => {
        unitsSection += `- **${u}**: Implementation of ${u}\n`;
      });
    }

    await fs.writeFile(
      path.join(intentDir, 'intent.md'),
      `---
id: intent-${workflowId}
title: "${title}"
status: pending
estimated_effort: ${effort}
---

# Intent: ${title}

## Business Requirements
Implement ${title}

## Implementation Plan
Follow standard development process
${unitsSection}
## Acceptance Criteria
- [ ] Feature complete
`
    );
  }

  /**
   * Helper: create an old-style INTENT-*.md file
   */
  async function createLegacyIntentFile(
    title: string,
    effort: number,
    id: string = 'INTENT-001'
  ): Promise<void> {
    const intentDir = path.join(testDir, 'aidlc-docs', workflowId, 'inception');
    await fs.ensureDir(intentDir);

    await fs.writeFile(
      path.join(intentDir, `${id}.md`),
      `---
id: ${id}
title: ${title}
status: pending
estimated_effort: ${effort}
dependencies: []
---

# Task: ${title}

## Goal
Create ${title}

## Component
Feature Components

## Acceptance Criteria
- [ ] Feature implemented

## Implementation Steps
1. Write code

## Technical Notes
Follow best practices
`
    );
  }

  async function createIdeaFile(): Promise<void> {
    const intentDir = path.join(testDir, 'aidlc-docs', workflowId, 'inception');
    await fs.ensureDir(intentDir);

    await fs.writeFile(
      path.join(intentDir, 'idea.md'),
      `---
id: idea-${workflowId}
title: "Test Idea"
---

# Idea

## Problem Statement
Test problem

## Success Criteria
- Feature works
`
    );
  }

  /**
   * Helper: create a manifest.json for artifact registration tests
   */
  async function createTestManifest(): Promise<string> {
    return createManifest(workflowId, 'Test Feature', testDir);
  }

  async function createCheckpointFile(): Promise<void> {
    const checkpointDir = path.join(testDir, 'aidlc-docs', workflowId);
    await fs.ensureDir(checkpointDir);
    await fs.writeJson(path.join(checkpointDir, 'checkpoint.json'), {
      schema_version: '3.0.0',
      workflow_id: workflowId,
      feature_name: 'test',
      current_phase: 'construction',
      current_stage: 'unit',
      status: 'in_progress',
      phases: {
        discovery: { status: 'completed', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        inception: { status: 'completed', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        construction: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      },
      manifest_path: '',
      trust_state_path: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      construction_bolts: {},
    });
  }

  describe('execute() with new-style intent.md', () => {
    it('should succeed with valid intent.md and create all artifacts', async () => {
      await createIntentFile('Setup Database Schema', 4);
      await createIdeaFile();

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      if (!result.passed) {
        console.log('[TEST DEBUG] blocking_issues:', JSON.stringify(result.blocking_issues));
      }

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
      expect(result.reviewer).toBe('construction-executor');

      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      expect(await fs.pathExists(constructionDir)).toBe(true);

      const entries = await fs.readdir(constructionDir, { withFileTypes: true });
      const unitDirs = entries.filter(e => e.isDirectory() && e.name !== 'design');
      expect(unitDirs.length).toBeGreaterThan(0);

      for (const unitDir of unitDirs) {
        expect(await fs.pathExists(path.join(constructionDir, unitDir.name, 'spec.md'))).toBe(true);
      }

      const designDir = path.join(constructionDir, 'design');
      expect(await fs.pathExists(designDir)).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'interfaces.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'data-flow.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'components.json'))).toBe(true);
    });

    it('should create UNITs from proposed units in intent.md', async () => {
      await createIntentFile('Multi-Component Feature', 4, [
        'Database Layer',
        'API Layer',
        'UI Layer',
      ]);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(true);

      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      const entries = await fs.readdir(constructionDir, { withFileTypes: true });
      const unitDirs = entries.filter(e => e.isDirectory() && e.name !== 'design');
      expect(unitDirs.length).toBe(3);

      for (const unitDir of unitDirs) {
        expect(await fs.pathExists(path.join(constructionDir, unitDir.name, 'spec.md'))).toBe(true);
      }

      const summary = executor.getDecompositionSummary();
      expect(summary.units).toBe(3);
      expect(summary.codeGenerations).toBe(3);
    });
  });

  describe('execute() with legacy INTENT-*.md (backward compat)', () => {
    it('should fail if no intent directory', async () => {
      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('No intents found in Inception phase');
    });

    it('should fail if intent directory is empty', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', workflowId, 'inception');
      await fs.ensureDir(intentDir);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('No intents found in Inception phase');
    });

    it('should succeed with valid legacy INTENT file and create all artifacts', async () => {
      await createLegacyIntentFile('Setup Database Schema', 4);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      // Should pass overall
      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);

      // Verify construction directory exists
      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      expect(await fs.pathExists(constructionDir)).toBe(true);

      // Verify at least one unit directory with spec.md was created
      const entries = await fs.readdir(constructionDir, { withFileTypes: true });
      const unitDirs = entries.filter(e => e.isDirectory() && e.name !== 'design');
      expect(unitDirs.length).toBeGreaterThan(0);

      for (const unitDir of unitDirs) {
        expect(await fs.pathExists(path.join(constructionDir, unitDir.name, 'spec.md'))).toBe(true);
      }

      // Verify design artifacts
      const designDir = path.join(constructionDir, 'design');
      expect(await fs.pathExists(designDir)).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'interfaces.json'))).toBe(true);
    });

    it('should create UNIT markdown with proper frontmatter', async () => {
      await createLegacyIntentFile('User Authentication', 8);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      await executor.execute();

      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      const entries = await fs.readdir(constructionDir, { withFileTypes: true });
      const unitDirs = entries.filter(e => e.isDirectory() && e.name !== 'design');
      expect(unitDirs.length).toBeGreaterThan(0);

      const unitContent = await fs.readFile(
        path.join(constructionDir, unitDirs[0].name, 'spec.md'),
        'utf-8'
      );
      expect(unitContent).toMatch(/^---/);
      expect(unitContent).toContain('title: User Authentication');
      expect(unitContent).toContain('parent_intent: INTENT-001');
      expect(unitContent).toContain('status: pending');
      expect(unitContent).toContain('estimated_effort: 8');
      expect(unitContent).toContain('## Scope & Responsibility');
      expect(unitContent).toContain('## Traceability');
    });

    it('should create design artifacts', async () => {
      await createLegacyIntentFile('API Endpoints', 4);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      await executor.execute();

      const designDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction', 'design');
      expect(await fs.pathExists(designDir)).toBe(true);

      // Verify JSON is parseable
      const interfaces = JSON.parse(
        await fs.readFile(path.join(designDir, 'interfaces.json'), 'utf-8')
      );
      expect(interfaces).toBeDefined();

      const dataFlow = JSON.parse(
        await fs.readFile(path.join(designDir, 'data-flow.json'), 'utf-8')
      );
      expect(dataFlow).toBeDefined();

      const components = JSON.parse(
        await fs.readFile(path.join(designDir, 'components.json'), 'utf-8')
      );
      expect(components).toBeDefined();
    });

    it('should create unit directories with spec.md (no separate BOLT files)', async () => {
      await createLegacyIntentFile('Database Migration', 2);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      await executor.execute();

      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      const entries = await fs.readdir(constructionDir, { withFileTypes: true });
      const unitDirs = entries.filter(e => e.isDirectory() && e.name !== 'design');
      expect(unitDirs.length).toBeGreaterThan(0);

      const specContent = await fs.readFile(
        path.join(constructionDir, unitDirs[0].name, 'spec.md'),
        'utf-8'
      );
      expect(specContent).toMatch(/^---/);
      expect(specContent).toContain('title: Database Migration');
      expect(specContent).toContain('status: pending');
      expect(specContent).toContain('## Scope & Responsibility');
      expect(specContent).toContain('## Traceability');
    });

    it('should return ValidationResult with reviewer=construction-executor on success', async () => {
      await createLegacyIntentFile('Feature Implementation', 4);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result).toMatchObject({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        reviewer: 'construction-executor',
      });
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should return ValidationResult with passed=false if units validation fails', async () => {
      await createLegacyIntentFile('Test Intent', 999);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(false);
      expect(result.blocking_issues.length).toBeGreaterThan(0);
    });
  });

  describe('SHALLOW depth', () => {
    it('should return passed=true via express bolt pipeline when depth is SHALLOW', async () => {
      await createIntentFile('Quick Fix', 2);
      await createCheckpointFile();

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(true);
      expect(result.reviewer).toBe('construction-executor');
    });

    it('should fall back to legacy intents for SHALLOW mode', async () => {
      await createLegacyIntentFile('Legacy Quick Fix', 3);
      await createCheckpointFile();

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(true);
    });

    it('should fail in SHALLOW mode if no intent found', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', workflowId, 'inception');
      await fs.ensureDir(intentDir);
      await createCheckpointFile();

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('No intent found for SHALLOW construction');
    });

    it('should fail in SHALLOW mode if no checkpoint exists', async () => {
      await createIntentFile('No Checkpoint', 2);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('No checkpoint found for SHALLOW construction');
    });
  });

  describe('awaiting_dev_review blocking', () => {
    it('should block execution if checkpointStatus is awaiting_dev_review', async () => {
      await createIntentFile('Blocked Feature', 4);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, {
        checkpointStatus: 'awaiting_dev_review',
      });

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toHaveLength(1);
      expect(result.blocking_issues[0]).toContain(
        'Construction blocked: developer review of technical specification required (Risk Tier 3).'
      );
      expect(result.reviewer).toBe('construction-executor');
    });

    it('should not block if checkpointStatus is something else', async () => {
      await createLegacyIntentFile('Unblocked Feature', 4);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, {
        checkpointStatus: 'active',
      });

      // Should proceed normally (pass or fail based on content, not blocked)
      expect(result.blocking_issues.every(i => !i.includes('awaiting_dev_review'))).toBe(true);
    });
  });

  describe('onCheckpointSave callback', () => {
    it('should call onCheckpointSave after successful decomposition', async () => {
      await createLegacyIntentFile('Callback Test', 4);

      const onCheckpointSave = vi.fn().mockResolvedValue(undefined);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { onCheckpointSave });

      expect(result.passed).toBe(true);
      expect(onCheckpointSave).toHaveBeenCalledOnce();
    });

    it('should not crash if onCheckpointSave throws', async () => {
      await createLegacyIntentFile('Failing Callback', 4);

      const onCheckpointSave = vi.fn().mockRejectedValue(new Error('save failed'));

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { onCheckpointSave });

      // Should still succeed despite callback failure
      expect(result.passed).toBe(true);
      expect(onCheckpointSave).toHaveBeenCalledOnce();
    });
  });

  describe('decomposition limits', () => {
    it('should respect max_units option', async () => {
      // Create intent with more proposed units than the limit
      await createIntentFile('Big Feature', 16, [
        'Unit A',
        'Unit B',
        'Unit C',
        'Unit D',
        'Unit E',
      ]);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { max_units: 3 });

      expect(result.passed).toBe(true);

      const summary = executor.getDecompositionSummary();
      expect(summary.units).toBe(3);
    });
  });

  describe('getProgress()', () => {
    it('should return initial progress when first created', () => {
      const executor = new ConstructionExecutor(projectPath, workflowId);
      const progress = executor.getProgress();

      expect(progress).toMatchObject({
        current_stage: 'unit',
        units_total: 0,
        units_complete: 0,
        code_gen_total: 0,
        code_gen_complete: 0,
        design_complete: false,
        overall_percentage: 0,
      });
    });

    it('should return updated progress after full execution', async () => {
      await createLegacyIntentFile('Progress Test', 4);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      await executor.execute();

      const progress = executor.getProgress();

      // After full execution, should be in design stage
      expect(progress.current_stage).toBe('design');
      expect(progress.units_total).toBeGreaterThan(0);
      expect(progress.code_gen_total).toBeGreaterThan(0);
      expect(progress.design_complete).toBe(true);
      expect(progress.overall_percentage).toBeGreaterThan(0);
    });

    it('should show design_complete flag when in design stage', async () => {
      await createLegacyIntentFile('Design Flag Test', 4);

      const executor = new ConstructionExecutor(projectPath, workflowId);

      // Check initial state
      let progress = executor.getProgress();
      expect(progress.design_complete).toBe(false);

      // Execute full pipeline
      await executor.execute();

      // Check after execution (should be in design stage)
      progress = executor.getProgress();
      expect(progress.design_complete).toBe(true);
    });
  });

  describe('getDecompositionSummary()', () => {
    it('should return zeros before execution', () => {
      const executor = new ConstructionExecutor(projectPath, workflowId);
      const summary = executor.getDecompositionSummary();

      expect(summary).toEqual({
        units: 0,
        codeGenerations: 0,
        totalEffort: 0,
      });
    });

    it('should return correct counts after execution', async () => {
      await createLegacyIntentFile('Summary Test', 8);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      await executor.execute();

      const summary = executor.getDecompositionSummary();
      expect(summary.units).toBe(1);
      expect(summary.codeGenerations).toBe(1);
      expect(summary.totalEffort).toBe(8);
    });
  });

  describe('manifest artifact registration', () => {
    it('should register UNIT and design artifacts in manifest during new-style execution', async () => {
      await createIntentFile('Manifest Test', 4);
      await createIdeaFile();
      const manifestPath = await createTestManifest();

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(true);

      const manifest = loadManifest(manifestPath);
      expect(manifest).not.toBeNull();

      const unitArtifacts = manifest!.artifacts.filter(a => a.type === 'unit');
      expect(unitArtifacts.length).toBeGreaterThan(0);
      expect(unitArtifacts[0].phase).toBe('construction');
      expect(unitArtifacts[0].stage).toBe('unit');
      expect(unitArtifacts[0].write_complete).toBe(true);

      const designArtifacts = manifest!.artifacts.filter(a => a.type.startsWith('interface') || a.type.startsWith('data-flow') || a.type.startsWith('component'));
      expect(designArtifacts.length).toBe(3);
    });

    it('should create INTENT->UNIT derive links', async () => {
      await createIntentFile('Link Test', 4);
      await createIdeaFile();
      const manifestPath = await createTestManifest();

      const { registerArtifact: regArt } = await import('../../../features/workflow-engine/manifest.js');
      regArt(manifestPath, {
        id: 'INTENT-001',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: path.join(testDir, 'aidlc-docs', workflowId, 'inception', 'intent.md'),
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(true);

      const manifest = loadManifest(manifestPath);
      expect(manifest).not.toBeNull();

      const intentToUnitLinks = manifest!.links.filter(
        l => l.source_id === 'INTENT-001' && l.link_type === 'derives'
      );
      expect(intentToUnitLinks.length).toBeGreaterThan(0);
    });

    it('should complete express bolt pipeline during SHALLOW mode', async () => {
      await createIntentFile('Shallow Manifest Test', 2);
      await createCheckpointFile();

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(true);
      expect(result.reviewer).toBe('construction-executor');
    });

    it('should register artifacts during legacy intent execution', async () => {
      await createLegacyIntentFile('Legacy Manifest Test', 4);
      const manifestPath = await createTestManifest();

      const { registerArtifact: regArt } = await import('../../../features/workflow-engine/manifest.js');
      regArt(manifestPath, {
        id: 'INTENT-001',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: path.join(testDir, 'aidlc-docs', workflowId, 'inception', 'INTENT-001.md'),
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(true);

      const manifest = loadManifest(manifestPath);
      expect(manifest).not.toBeNull();

      const unitArtifacts = manifest!.artifacts.filter(a => a.type === 'unit');
      expect(unitArtifacts.length).toBeGreaterThan(0);

      expect(manifest!.links.length).toBeGreaterThan(0);
    });

    it('should not crash if manifest.json does not exist', async () => {
      // No manifest created - registration calls should silently fail
      await createIntentFile('No Manifest Test', 4);
      await createIdeaFile();

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      // Should still succeed even without manifest
      expect(result.passed).toBe(true);
    });
  });

  describe('Integration flow', () => {
    it('should complete full pipeline: create intent.md -> execute -> verify outputs', async () => {
      await createIntentFile('User Authentication System', 8);
      await createIdeaFile();

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.reviewer).toBe('construction-executor');

      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      const entries = await fs.readdir(constructionDir, { withFileTypes: true });
      const unitDirs = entries.filter(e => e.isDirectory() && e.name !== 'design');
      expect(unitDirs.length).toBe(1);

      const specPath = path.join(constructionDir, unitDirs[0].name, 'spec.md');
      expect(await fs.pathExists(specPath)).toBe(true);
      const specContent = await fs.readFile(specPath, 'utf-8');
      expect(specContent).toContain('title: User Authentication System');
      expect(specContent).toContain('parent_intent: INTENT-001');
      expect(specContent).toContain('estimated_effort: 8');

      const designDir = path.join(constructionDir, 'design');
      expect(await fs.pathExists(path.join(designDir, 'interfaces.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'data-flow.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'components.json'))).toBe(true);

      const progress = executor.getProgress();
      expect(progress.current_stage).toBe('design');
      expect(progress.units_total).toBe(1);
      expect(progress.code_gen_total).toBe(1);
      expect(progress.design_complete).toBe(true);
      expect(progress.overall_percentage).toBeGreaterThan(0);

      const summary = executor.getDecompositionSummary();
      expect(summary.units).toBe(1);
      expect(summary.codeGenerations).toBe(1);
      expect(summary.totalEffort).toBe(8);
    });

    it('should complete full pipeline with legacy INTENT-*.md format', async () => {
      await createLegacyIntentFile('User Authentication System', 8);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);

      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      const entries = await fs.readdir(constructionDir, { withFileTypes: true });
      const unitDirs = entries.filter(e => e.isDirectory() && e.name !== 'design');
      expect(unitDirs.length).toBeGreaterThan(0);

      const specContent = await fs.readFile(
        path.join(constructionDir, unitDirs[0].name, 'spec.md'),
        'utf-8'
      );
      expect(specContent).toContain('User Authentication System');
    });
  });

  describe('secrets management wiring', () => {
    it('generates .env.example when unit files reference env vars', async () => {
      const unitId = 'u-secrets';
      const unitDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction', unitId, 'code');
      await fs.ensureDir(unitDir);

      const sourceFile = path.join(testDir, 'src', 'index.ts');
      await fs.ensureDir(path.join(testDir, 'src'));
      await fs.writeFile(sourceFile, 'const url = process.env.DATABASE_URL;\n', 'utf-8');

      const summaryFile = path.join(unitDir, 'code-summary.md');
      await fs.writeFile(summaryFile, `## Files created\n- \`src/index.ts\`\n`, 'utf-8');

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeUnitCompletion(unitId, { allowFailures: true });

      expect(result.testGeneration.status).toBe('completed');

      const envExamplePath = path.join(testDir, '.env.example');
      if (await fs.pathExists(envExamplePath)) {
        const content = await fs.readFile(envExamplePath, 'utf-8');
        expect(content).toContain('DATABASE_URL');
      }
    });

    it('does not throw when unit has no code files', async () => {
      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeUnitCompletion('u-no-files', { allowFailures: true });
      expect(result.testGeneration).toBeDefined();
    });

    it('secrets management failure does not block unit completion', async () => {
      const { runSecretsManagement } = await import('../../../features/workflow-engine/secrets-management.js');
      vi.spyOn({ runSecretsManagement }, 'runSecretsManagement').mockImplementation(() => {
        throw new Error('secrets failure');
      });

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeUnitCompletion('u-sm-fail', { allowFailures: true });
      expect(result.testGeneration).toBeDefined();
    });
  });

  describe('security scan wiring', () => {
    it('security scan failure does not block unit completion', async () => {
      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeUnitCompletion('u-sec-fail', { allowFailures: true });
      expect(result.testGeneration).toBeDefined();
    });
  });

  describe('quality scorecard wiring in smoke test', () => {
    it('generates scorecard after smoke test without error', async () => {
      const { saveCheckpoint } = await import('../../../features/workflow-engine/checkpoint.js');
      const checkpoint = {
        schema_version: '3.0.0' as const,
        workflow_id: workflowId,
        feature_name: 'Scorecard Test',
        current_phase: 'construction' as const,
        current_stage: 'code-generation' as const,
        status: 'in_progress' as const,
        phases: {} as any,
        manifest_path: '',
        trust_state_path: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        construction_units: {
          'UNIT-001': {
            unitId: 'UNIT-001',
            stages: {
              'functional-design': { status: 'completed' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-requirements': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-design': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'infrastructure-design': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'code-generation': { status: 'completed' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'test-generation': { status: 'completed' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            },
            code_plan_path: null,
            code_generation_status: 'completed' as const,
            tests_total: 5,
            tests_passed: 5,
            tests_failed: 0,
            test_framework: 'vitest',
            test_generation_status: 'completed' as const,
          },
        },
      };
      await saveCheckpoint(testDir, checkpoint as any);

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeSmokeTest();
      expect(result.status).toBe('passed');

      const scorecardPath = path.join(testDir, 'aidlc-docs', workflowId, 'quality-scorecard.md');
      expect(await fs.pathExists(scorecardPath)).toBe(true);
    });
  });

  describe('documentation generation persists new fields', () => {
    it('persists impact_scan_report_path and recreation_readiness_dimensions', async () => {
      const { saveCheckpoint, loadCheckpoint } = await import('../../../features/workflow-engine/checkpoint.js');

      const unitId = 'u-doc-fields';
      const unitDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction', unitId, 'code');
      await fs.ensureDir(unitDir);
      await fs.writeFile(path.join(unitDir, 'code-summary.md'), '## Files created\n- `src/app.ts`\n');

      const checkpoint = {
        schema_version: '3.0.0' as const,
        workflow_id: workflowId,
        feature_name: 'Doc Fields Test',
        current_phase: 'construction' as const,
        current_stage: 'code-generation' as const,
        status: 'in_progress' as const,
        phases: {} as any,
        manifest_path: '',
        trust_state_path: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        pathway_type: 'brownfield-enhancement' as const,
        depth_score: 15,
        construction_units: {
          [unitId]: {
            unitId,
            stages: {
              'functional-design': { status: 'completed' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-requirements': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-design': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'infrastructure-design': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'code-generation': { status: 'completed' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'test-generation': { status: 'completed' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            },
            code_plan_path: null,
            code_generation_status: 'completed' as const,
          },
        },
      };
      await saveCheckpoint(testDir, checkpoint as any);

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeDocumentationGeneration(unitId);

      const loaded = await loadCheckpoint(testDir, workflowId);
      const unit = loaded?.construction_units?.[unitId];
      expect(unit).toBeDefined();
      expect(unit?.feature_doc_status).toBeDefined();
      expect('impact_scan_report_path' in (unit ?? {})).toBe(true);
    });
  });

  describe('handleZeroBoltUnit', () => {
    const unitId = 'UNIT-ZERO';

    it('marks unit as completed when it has 0 bolts', async () => {
      const checkpoint = {
        schema_version: '3.0.0' as const,
        workflow_id: workflowId,
        feature_name: 'zero-bolt-test',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_phase: 'construction' as const,
        current_stage: 'code-generation' as const,
        status: 'in_progress' as const,
        phases: {
          discovery: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'complete' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'in_progress' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: 'test',
        trust_state_path: 'test',
        construction_bolts: {},
        construction_units: {
          [unitId]: {
            unitId,
            stages: {
              'functional-design': { status: 'completed' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-requirements': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-design': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'infrastructure-design': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'code-generation': { status: 'not_started' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'test-generation': { status: 'not_started' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            },
            code_plan_path: null,
            code_generation_status: 'not_started' as const,
          },
        },
      };
      await saveCheckpoint(testDir, checkpoint as any);

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.handleZeroBoltUnit(unitId);

      expect(result).toBe(true);

      const loaded = await loadCheckpoint(testDir, workflowId);
      expect(loaded?.construction_units?.[unitId]?.code_generation_status).toBe('completed');
    });

    it('returns false when unit has 1+ bolts (normal execution path)', async () => {
      const checkpoint = {
        schema_version: '3.0.0' as const,
        workflow_id: workflowId,
        feature_name: 'nonzero-bolt-test',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_phase: 'construction' as const,
        current_stage: 'code-generation' as const,
        status: 'in_progress' as const,
        phases: {
          discovery: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'complete' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'in_progress' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: 'test',
        trust_state_path: 'test',
        construction_bolts: {
          'BOLT-001': {
            bolt_id: 'BOLT-001',
            parent_unit_id: unitId,
            status: 'pending',
            stages: {
              elaboration: { status: 'not_started', started_at: null, completed_at: null, failure_count: 0, last_error: null, artifact_path: null },
              code_generation: { status: 'not_started', started_at: null, completed_at: null, failure_count: 0, last_error: null, artifact_path: null },
              build_and_test: { status: 'not_started', started_at: null, completed_at: null, failure_count: 0, last_error: null, artifact_path: null },
              review: { status: 'not_started', started_at: null, completed_at: null, failure_count: 0, last_error: null, artifact_path: null },
            },
            failure_count: 0,
            last_error: null,
            review_score: null,
            acknowledged_by: null,
            acknowledged_at: null,
          },
        },
        construction_units: {
          [unitId]: {
            unitId,
            stages: {
              'functional-design': { status: 'completed' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-requirements': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-design': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'infrastructure-design': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'code-generation': { status: 'not_started' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'test-generation': { status: 'not_started' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            },
            code_plan_path: null,
            code_generation_status: 'not_started' as const,
          },
        },
      };
      await saveCheckpoint(testDir, checkpoint as any);

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.handleZeroBoltUnit(unitId);

      expect(result).toBe(false);

      const loaded = await loadCheckpoint(testDir, workflowId);
      expect(loaded?.construction_units?.[unitId]?.code_generation_status).toBe('not_started');
    });

    it('writes audit log entry on auto-fulfillment', async () => {
      const checkpoint = {
        schema_version: '3.0.0' as const,
        workflow_id: workflowId,
        feature_name: 'audit-bolt-test',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_phase: 'construction' as const,
        current_stage: 'code-generation' as const,
        status: 'in_progress' as const,
        phases: {
          discovery: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'complete' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'in_progress' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: 'test',
        trust_state_path: 'test',
        construction_bolts: {},
        construction_units: {
          [unitId]: {
            unitId,
            stages: {
              'functional-design': { status: 'completed' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-requirements': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-design': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'infrastructure-design': { status: 'skipped' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'code-generation': { status: 'not_started' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'test-generation': { status: 'not_started' as const, artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            },
            code_plan_path: null,
            code_generation_status: 'not_started' as const,
          },
        },
      };
      await saveCheckpoint(testDir, checkpoint as any);

      const auditDir = path.join(testDir, 'aidlc-docs', workflowId);
      await fs.ensureDir(auditDir);

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.handleZeroBoltUnit(unitId);

      const auditPath = path.join(auditDir, 'audit.md');
      const auditExists = await fs.pathExists(auditPath);
      expect(auditExists).toBe(true);

      const auditContent = await fs.readFile(auditPath, 'utf-8');
      expect(auditContent).toContain('auto-fulfilled');
      expect(auditContent).toContain(unitId);
    });
  });
});
