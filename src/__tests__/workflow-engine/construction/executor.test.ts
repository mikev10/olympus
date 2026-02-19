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

describe('CONSTRUCTION_STAGE_AGENT_MAP', () => {
  it('should map all stages to olympian agent', () => {
    expect(CONSTRUCTION_STAGE_AGENT_MAP).toEqual({
      unit: 'olympian',
      bolt: 'olympian',
      design: 'olympian',
    });
  });

  it('should have entries for all construction stages', () => {
    expect(CONSTRUCTION_STAGE_AGENT_MAP).toHaveProperty('unit');
    expect(CONSTRUCTION_STAGE_AGENT_MAP).toHaveProperty('bolt');
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

  /**
   * Helper: create idea.md for dual validation
   */
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

## Success Metrics
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

  describe('execute() with new-style intent.md', () => {
    it('should succeed with valid intent.md and create all artifacts', async () => {
      await createIntentFile('Setup Database Schema', 4);
      await createIdeaFile();

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      // Debug: show blocking issues if any
      if (!result.passed) {
        console.log('[TEST DEBUG] blocking_issues:', JSON.stringify(result.blocking_issues));
      }

      // Should pass overall
      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);
      expect(result.reviewer).toBe('construction-executor');

      // Verify construction directory
      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      expect(await fs.pathExists(constructionDir)).toBe(true);

      // Verify UNIT directory was created
      const unit001Dir = path.join(constructionDir, 'UNIT-001');
      expect(await fs.pathExists(unit001Dir)).toBe(true);

      // Verify spec.md in UNIT dir
      expect(await fs.pathExists(path.join(unit001Dir, 'spec.md'))).toBe(true);

      // Verify bolt files in UNIT dir
      const unit001Files = await fs.readdir(unit001Dir);
      const boltFiles = unit001Files.filter(f => f.startsWith('BOLT-') && f.endsWith('.md'));
      expect(boltFiles.length).toBeGreaterThan(0);

      // Verify design artifacts
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

      // Should have 3 unit directories
      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      for (const unitId of ['UNIT-001', 'UNIT-002', 'UNIT-003']) {
        const unitDir = path.join(constructionDir, unitId);
        expect(await fs.pathExists(unitDir)).toBe(true);
        expect(await fs.pathExists(path.join(unitDir, 'spec.md'))).toBe(true);
      }

      // Verify decomposition summary
      const summary = executor.getDecompositionSummary();
      expect(summary.units).toBe(3);
      expect(summary.bolts).toBe(3);
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

      // Verify units directory and files were created
      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      expect(await fs.pathExists(constructionDir)).toBe(true);

      const entries = await fs.readdir(constructionDir);
      const unitDirs = entries.filter(f => f.startsWith('UNIT-') && !f.endsWith('.md'));
      expect(unitDirs.length).toBeGreaterThan(0);

      // Verify design artifacts
      const designDir = path.join(constructionDir, 'design');
      expect(await fs.pathExists(designDir)).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'interfaces.json'))).toBe(true);

      // Verify bolt files in unit dir
      const unit001Dir = path.join(constructionDir, 'UNIT-001');
      expect(await fs.pathExists(unit001Dir)).toBe(true);
      const boltFiles = (await fs.readdir(unit001Dir)).filter(
        f => f.startsWith('BOLT-') && f.endsWith('.md')
      );
      expect(boltFiles.length).toBeGreaterThan(0);
    });

    it('should create UNIT markdown with proper frontmatter', async () => {
      await createLegacyIntentFile('User Authentication', 8);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      await executor.execute();

      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      const unitFiles = (await fs.readdir(constructionDir)).filter(
        f => f.startsWith('UNIT-') && f.endsWith('.md')
      );
      expect(unitFiles.length).toBeGreaterThan(0);

      const unitContent = await fs.readFile(path.join(constructionDir, unitFiles[0]), 'utf-8');
      expect(unitContent).toMatch(/^---/);
      expect(unitContent).toContain('id: UNIT-');
      expect(unitContent).toContain('title: User Authentication');
      expect(unitContent).toContain('parent_intent: INTENT-001');
      expect(unitContent).toContain('status: pending');
      expect(unitContent).toContain('estimated_effort: 8');
      // New template sections
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

    it('should create BOLT files inside per-unit directories', async () => {
      await createLegacyIntentFile('Database Migration', 2);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      await executor.execute();

      const unit001Dir = path.join(testDir, 'aidlc-docs', workflowId, 'construction', 'UNIT-001');
      expect(await fs.pathExists(unit001Dir)).toBe(true);

      const boltFiles = (await fs.readdir(unit001Dir)).filter(
        f => f.startsWith('BOLT-') && f.endsWith('.md')
      );
      expect(boltFiles.length).toBeGreaterThan(0);

      // Verify BOLT file content
      const boltContent = await fs.readFile(path.join(unit001Dir, boltFiles[0]), 'utf-8');
      expect(boltContent).toMatch(/^---/);
      expect(boltContent).toContain('id: BOLT-');
      expect(boltContent).toContain('title: Database Migration');
      expect(boltContent).toContain('parent_unit: UNIT-001');
      expect(boltContent).toContain('status: pending');
      // New template sections
      expect(boltContent).toContain('## Domain Design');
      expect(boltContent).toContain('## Audit Trail');
      expect(boltContent).toContain('## Traceability');
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
    it('should create a single BOLT without UNITs when depth is SHALLOW', async () => {
      await createIntentFile('Quick Fix', 2);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(true);
      expect(result.reviewer).toBe('construction-executor');

      // Should have BOLT-001.md directly in construction dir
      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      expect(await fs.pathExists(path.join(constructionDir, 'BOLT-001.md'))).toBe(true);

      // Should NOT have UNIT directories
      const entries = await fs.readdir(constructionDir);
      const unitDirs = entries.filter(f => f.startsWith('UNIT-'));
      expect(unitDirs).toHaveLength(0);

      // Should NOT have design directory
      expect(await fs.pathExists(path.join(constructionDir, 'design'))).toBe(false);
    });

    it('should fall back to legacy intents for SHALLOW mode', async () => {
      await createLegacyIntentFile('Legacy Quick Fix', 3);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(true);

      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      const boltContent = await fs.readFile(
        path.join(constructionDir, 'BOLT-001.md'),
        'utf-8'
      );
      expect(boltContent).toContain('Legacy Quick Fix');
    });

    it('should fail in SHALLOW mode if no intent found', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', workflowId, 'inception');
      await fs.ensureDir(intentDir);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('No intent found for SHALLOW construction');
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
        bolts_total: 0,
        bolts_complete: 0,
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
      expect(progress.bolts_total).toBeGreaterThan(0);
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
        bolts: 0,
        totalEffort: 0,
      });
    });

    it('should return correct counts after execution', async () => {
      await createLegacyIntentFile('Summary Test', 8);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      await executor.execute();

      const summary = executor.getDecompositionSummary();
      expect(summary.units).toBe(1);
      expect(summary.bolts).toBe(1);
      expect(summary.totalEffort).toBe(8);
    });
  });

  describe('manifest artifact registration', () => {
    it('should register UNIT and BOLT artifacts in manifest during new-style execution', async () => {
      await createIntentFile('Manifest Test', 4);
      await createIdeaFile();
      const manifestPath = await createTestManifest();

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(true);

      // Load manifest and check artifacts
      const manifest = loadManifest(manifestPath);
      expect(manifest).not.toBeNull();

      // Should have registered UNIT artifact(s)
      const unitArtifacts = manifest!.artifacts.filter(a => a.type === 'unit');
      expect(unitArtifacts.length).toBeGreaterThan(0);
      expect(unitArtifacts[0].phase).toBe('construction');
      expect(unitArtifacts[0].stage).toBe('unit');
      expect(unitArtifacts[0].write_complete).toBe(true);

      // Should have registered BOLT artifact(s)
      const boltArtifacts = manifest!.artifacts.filter(a => a.type === 'bolt');
      expect(boltArtifacts.length).toBeGreaterThan(0);
      expect(boltArtifacts[0].phase).toBe('construction');
      expect(boltArtifacts[0].stage).toBe('bolt');

      // Should have registered design artifacts
      const designArtifacts = manifest!.artifacts.filter(a => a.type.startsWith('interface') || a.type.startsWith('data-flow') || a.type.startsWith('component'));
      expect(designArtifacts.length).toBe(3);
    });

    it('should create parent-child links between INTENT->UNIT and UNIT->BOLT', async () => {
      await createIntentFile('Link Test', 4);
      await createIdeaFile();
      const manifestPath = await createTestManifest();

      // Register the INTENT artifact first so linkArtifacts can find it
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

      // Should have INTENT->UNIT derive link
      const intentToUnitLinks = manifest!.links.filter(
        l => l.source_id === 'INTENT-001' && l.link_type === 'derives'
      );
      expect(intentToUnitLinks.length).toBeGreaterThan(0);

      // Should have UNIT->BOLT derive link
      const unitToBoltLinks = manifest!.links.filter(
        l => l.source_id.startsWith('UNIT-') && l.link_type === 'derives'
      );
      expect(unitToBoltLinks.length).toBeGreaterThan(0);
    });

    it('should register BOLT in manifest during SHALLOW mode', async () => {
      await createIntentFile('Shallow Manifest Test', 2);
      const manifestPath = await createTestManifest();

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(true);

      const manifest = loadManifest(manifestPath);
      expect(manifest).not.toBeNull();

      // Should have registered BOLT-001
      const boltArtifacts = manifest!.artifacts.filter(a => a.id === 'BOLT-001');
      expect(boltArtifacts.length).toBe(1);
      expect(boltArtifacts[0].phase).toBe('construction');
      expect(boltArtifacts[0].stage).toBe('bolt');
    });

    it('should register artifacts during legacy intent execution', async () => {
      await createLegacyIntentFile('Legacy Manifest Test', 4);
      const manifestPath = await createTestManifest();

      // Register the INTENT artifact so links can be created
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

      // Should have unit and bolt artifacts
      const unitArtifacts = manifest!.artifacts.filter(a => a.type === 'unit');
      expect(unitArtifacts.length).toBeGreaterThan(0);

      const boltArtifacts = manifest!.artifacts.filter(a => a.type === 'bolt');
      expect(boltArtifacts.length).toBeGreaterThan(0);

      // Should have links
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
      // Step 1: Create intent file (new-style)
      await createIntentFile('User Authentication System', 8);
      await createIdeaFile();

      // Step 2: Execute construction
      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      // Step 3: Verify execution succeeded
      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.reviewer).toBe('construction-executor');

      // Step 4: Verify unit directories
      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      const constructionEntries = await fs.readdir(constructionDir);
      const unitDirs = constructionEntries.filter(
        f => f.startsWith('UNIT-') && !f.endsWith('.md')
      );
      expect(unitDirs.length).toBe(1);

      // Verify UNIT-001/spec.md content
      const unit1SpecPath = path.join(constructionDir, 'UNIT-001', 'spec.md');
      expect(await fs.pathExists(unit1SpecPath)).toBe(true);
      const unit1Content = await fs.readFile(unit1SpecPath, 'utf-8');
      expect(unit1Content).toContain('id: UNIT-001');
      expect(unit1Content).toContain('title: User Authentication System');
      expect(unit1Content).toContain('parent_intent: INTENT-001');
      expect(unit1Content).toContain('estimated_effort: 8');

      // Step 5: Verify design artifacts
      const designDir = path.join(constructionDir, 'design');
      expect(await fs.pathExists(path.join(designDir, 'interfaces.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'data-flow.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'components.json'))).toBe(true);

      // Step 6: Verify bolt files
      const unit001Dir = path.join(constructionDir, 'UNIT-001');
      const boltFiles = (await fs.readdir(unit001Dir)).filter(
        f => f.startsWith('BOLT-') && f.endsWith('.md')
      );
      expect(boltFiles.length).toBe(1);

      // Verify BOLT-001.md content
      const bolt1Content = await fs.readFile(path.join(unit001Dir, 'BOLT-001.md'), 'utf-8');
      expect(bolt1Content).toContain('id: BOLT-001');
      expect(bolt1Content).toContain('title: User Authentication System');
      expect(bolt1Content).toContain('parent_unit: UNIT-001');

      // Step 7: Verify progress tracking
      const progress = executor.getProgress();
      expect(progress.current_stage).toBe('design');
      expect(progress.units_total).toBe(1);
      expect(progress.bolts_total).toBe(1);
      expect(progress.design_complete).toBe(true);
      expect(progress.overall_percentage).toBeGreaterThan(0);

      // Step 8: Verify decomposition summary
      const summary = executor.getDecompositionSummary();
      expect(summary.units).toBe(1);
      expect(summary.bolts).toBe(1);
      expect(summary.totalEffort).toBe(8);
    });

    it('should complete full pipeline with legacy INTENT-*.md format', async () => {
      await createLegacyIntentFile('User Authentication System', 8);

      const executor = new ConstructionExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);

      const constructionDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      const unit001Dir = path.join(constructionDir, 'UNIT-001');
      expect(await fs.pathExists(unit001Dir)).toBe(true);

      // Verify UNIT spec
      const specContent = await fs.readFile(path.join(unit001Dir, 'spec.md'), 'utf-8');
      expect(specContent).toContain('UNIT-001');
      expect(specContent).toContain('User Authentication System');

      // Verify bolt
      const boltFiles = (await fs.readdir(unit001Dir)).filter(
        f => f.startsWith('BOLT-') && f.endsWith('.md')
      );
      expect(boltFiles.length).toBe(1);
    });
  });
});
