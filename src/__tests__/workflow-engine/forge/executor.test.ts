/**
 * Tests for Forge Executor
 *
 * Validates the ForgeExecutor class which orchestrates the complete Forge phase:
 * - Stage agent mapping
 * - Full pipeline execution (units → design → build)
 * - Progress tracking
 * - Error handling
 * - Artifact creation and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { ForgeExecutor, FORGE_STAGE_AGENT_MAP } from '../../../features/workflow-engine/forge/executor.js';

describe('FORGE_STAGE_AGENT_MAP', () => {
  it('should map all stages to olympian agent', () => {
    expect(FORGE_STAGE_AGENT_MAP).toEqual({
      units: 'olympian',
      design: 'olympian',
      build: 'olympian',
    });
  });

  it('should have entries for all construction stages', () => {
    expect(FORGE_STAGE_AGENT_MAP).toHaveProperty('units');
    expect(FORGE_STAGE_AGENT_MAP).toHaveProperty('design');
    expect(FORGE_STAGE_AGENT_MAP).toHaveProperty('build');
  });
});

describe('ForgeExecutor', () => {
  const testDir = path.join(process.cwd(), '.test-executor');
  const workflowId = 'test-workflow';
  const projectPath = testDir;

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('execute()', () => {
    it('should fail if no intent directory', async () => {
      const executor = new ForgeExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('No intents found in Inception phase');
    });

    it('should fail if intent directory is empty', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', 'inception');
      await fs.ensureDir(intentDir);

      const executor = new ForgeExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('No intents found in Inception phase');
    });

    it('should succeed with valid intent and create all artifacts', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', 'inception');
      await fs.ensureDir(intentDir);

      // Create a valid INTENT file
      await fs.writeFile(
        path.join(intentDir, 'INTENT-001.md'),
        `---
id: INTENT-001
title: Setup Database Schema
status: pending
estimated_effort: 4
dependencies: []
---

# Task: Setup Database Schema

## Goal
Create database tables

## Component
Database Components

## Acceptance Criteria
- [ ] Database tables created

## Implementation Steps
1. Create migration script

## Technical Notes
Use migration framework
`
      );

      const executor = new ForgeExecutor(projectPath, workflowId);
      const result = await executor.execute();

      // Should pass overall
      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);
      expect(result.blocking_issues).toHaveLength(0);

      // Verify units directory and files were created
      const unitsDir = path.join(testDir, 'aidlc-docs', 'construction');
      expect(await fs.pathExists(unitsDir)).toBe(true);

      const unitFiles = await fs.readdir(unitsDir);
      const unitDirs = unitFiles.filter(f => f.startsWith('UNIT-'));
      expect(unitDirs.length).toBeGreaterThan(0);

      // Verify design directory and files were created
      const designDir = path.join(testDir, 'aidlc-docs', 'construction', 'design');
      expect(await fs.pathExists(designDir)).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'interfaces.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'data-flow.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'components.json'))).toBe(true);

      // Verify bolt files were created within unit directories
      const unit001Dir = path.join(testDir, 'aidlc-docs', 'construction', 'UNIT-001');
      expect(await fs.pathExists(unit001Dir)).toBe(true);

      const unit001Files = await fs.readdir(unit001Dir);
      const boltMarkdownFiles = unit001Files.filter(f => f.startsWith('BOLT-') && f.endsWith('.md'));
      expect(boltMarkdownFiles.length).toBeGreaterThan(0);
    });

    it('should create construction/units/ directory with UNIT-*.md files', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', 'inception');
      await fs.ensureDir(intentDir);

      await fs.writeFile(
        path.join(intentDir, 'INTENT-001.md'),
        `---
id: INTENT-001
title: User Authentication
status: pending
estimated_effort: 8
dependencies: []
---

# Task: User Authentication

## Goal
Implement user login and registration

## Component
Auth Components

## Acceptance Criteria
- [ ] Users can register
- [ ] Users can login

## Implementation Steps
1. Create auth routes
2. Add JWT tokens

## Technical Notes
Use bcrypt for password hashing
`
      );

      const executor = new ForgeExecutor(projectPath, workflowId);
      await executor.execute();

      const unitsDir = path.join(testDir, 'aidlc-docs', 'construction');
      expect(await fs.pathExists(unitsDir)).toBe(true);

      const unitFiles = await fs.readdir(unitsDir);
      const unitFile = unitFiles.find(f => f.startsWith('UNIT-') && f.endsWith('.md'));
      expect(unitFile).toBeDefined();

      // Verify file content
      const unitContent = await fs.readFile(path.join(unitsDir, unitFile!), 'utf-8');
      expect(unitContent).toMatch(/^---/);
      expect(unitContent).toContain('id: UNIT-');
      expect(unitContent).toContain('title: User Authentication');
      expect(unitContent).toContain('parent_intent: INTENT-001');
      expect(unitContent).toContain('status: pending');
      expect(unitContent).toContain('estimated_effort: 8');
    });

    it('should create construction/design/ directory with design artifacts', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', 'inception');
      await fs.ensureDir(intentDir);

      await fs.writeFile(
        path.join(intentDir, 'INTENT-001.md'),
        `---
id: INTENT-001
title: API Endpoints
status: pending
estimated_effort: 4
dependencies: []
---

# Task: API Endpoints

## Goal
Create REST API

## Component
API Components

## Acceptance Criteria
- [ ] Endpoints created

## Implementation Steps
1. Define routes

## Technical Notes
Use Express
`
      );

      const executor = new ForgeExecutor(projectPath, workflowId);
      await executor.execute();

      const designDir = path.join(testDir, 'aidlc-docs', 'construction', 'design');
      expect(await fs.pathExists(designDir)).toBe(true);

      // Check all design artifacts exist
      expect(await fs.pathExists(path.join(designDir, 'interfaces.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'data-flow.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'components.json'))).toBe(true);

      // Verify JSON is parseable
      const interfaces = JSON.parse(await fs.readFile(path.join(designDir, 'interfaces.json'), 'utf-8'));
      expect(interfaces).toBeDefined();

      const dataFlow = JSON.parse(await fs.readFile(path.join(designDir, 'data-flow.json'), 'utf-8'));
      expect(dataFlow).toBeDefined();

      const components = JSON.parse(await fs.readFile(path.join(designDir, 'components.json'), 'utf-8'));
      expect(components).toBeDefined();
    });

    it('should create construction/bolts/ directory with BOLT-*.md files', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', 'inception');
      await fs.ensureDir(intentDir);

      await fs.writeFile(
        path.join(intentDir, 'INTENT-001.md'),
        `---
id: INTENT-001
title: Database Migration
status: pending
estimated_effort: 2
dependencies: []
---

# Task: Database Migration

## Goal
Create migration system

## Component
Database Components

## Acceptance Criteria
- [ ] Migration system created

## Implementation Steps
1. Setup migration tool

## Technical Notes
Use Knex or Sequelize
`
      );

      const executor = new ForgeExecutor(projectPath, workflowId);
      await executor.execute();

      const unit001Dir = path.join(testDir, 'aidlc-docs', 'construction', 'UNIT-001');
      expect(await fs.pathExists(unit001Dir)).toBe(true);

      const boltFiles = await fs.readdir(unit001Dir);
      const boltFile = boltFiles.find(f => f.startsWith('BOLT-') && f.endsWith('.md'));
      expect(boltFile).toBeDefined();

      // Verify file content
      const boltContent = await fs.readFile(path.join(unit001Dir, boltFile!), 'utf-8');
      expect(boltContent).toMatch(/^---/);
      expect(boltContent).toContain('id: BOLT-');
      expect(boltContent).toContain('title: Database Migration');
      expect(boltContent).toContain('parent_unit: UNIT-001');
      expect(boltContent).toContain('status: pending');
      expect(boltContent).toContain('estimated_effort: 2');
    });

    it('should return ValidationResult with passed=true on success', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', 'inception');
      await fs.ensureDir(intentDir);

      await fs.writeFile(
        path.join(intentDir, 'INTENT-001.md'),
        `---
id: INTENT-001
title: Feature Implementation
status: pending
estimated_effort: 4
dependencies: []
---

# Task: Feature Implementation

## Goal
Implement new feature

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

      const executor = new ForgeExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result).toMatchObject({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        reviewer: 'forge-executor',
      });
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should return ValidationResult with passed=false if units validation fails', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', 'inception');
      const unitsDir = path.join(testDir, 'aidlc-docs', 'construction');
      await fs.ensureDir(intentDir);
      await fs.ensureDir(unitsDir);

      // Create an intent with an invalid effort estimate
      // This will cascade to create units with invalid effort, which will fail validation
      await fs.writeFile(
        path.join(intentDir, 'INTENT-001.md'),
        `---
id: INTENT-001
title: Test Intent
status: pending
estimated_effort: 999
dependencies: []
---

# Task: Test Intent

## Goal
Test

## Component
Test Components

## Acceptance Criteria
- [ ] Test complete

## Implementation Steps
1. Test

## Technical Notes
Testing
`
      );

      const executor = new ForgeExecutor(projectPath, workflowId);
      const result = await executor.execute();

      expect(result.passed).toBe(false);
      expect(result.blocking_issues.length).toBeGreaterThan(0);
    });
  });

  describe('getProgress()', () => {
    it('should return initial progress when first created', () => {
      const executor = new ForgeExecutor(projectPath, workflowId);
      const progress = executor.getProgress();

      expect(progress).toMatchObject({
        current_stage: 'units',
        units_total: 0,
        units_complete: 0,
        bolts_total: 0,
        bolts_complete: 0,
        design_complete: false,
        overall_percentage: 0,
      });
    });

    it('should return updated progress after units stage', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', 'inception');
      await fs.ensureDir(intentDir);

      await fs.writeFile(
        path.join(intentDir, 'INTENT-001.md'),
        `---
id: INTENT-001
title: Progress Test
status: pending
estimated_effort: 4
dependencies: []
---

# Task: Progress Test

## Goal
Test progress tracking

## Component
Test Components

## Acceptance Criteria
- [ ] Progress tracked

## Implementation Steps
1. Track progress

## Technical Notes
Monitor progress
`
      );

      const executor = new ForgeExecutor(projectPath, workflowId);
      await executor.execute();

      const progress = executor.getProgress();

      // After full execution, should be in build stage
      expect(progress.current_stage).toBe('build');
      expect(progress.units_total).toBeGreaterThan(0);
      expect(progress.bolts_total).toBeGreaterThan(0);
      expect(progress.design_complete).toBe(true);
      expect(progress.overall_percentage).toBeGreaterThan(0);
    });

    it('should show design_complete flag when in design or build stage', async () => {
      const intentDir = path.join(testDir, 'aidlc-docs', 'inception');
      await fs.ensureDir(intentDir);

      await fs.writeFile(
        path.join(intentDir, 'INTENT-001.md'),
        `---
id: INTENT-001
title: Design Flag Test
status: pending
estimated_effort: 4
dependencies: []
---

# Task: Design Flag Test

## Goal
Test design completion flag

## Component
Test Components

## Acceptance Criteria
- [ ] Flag tested

## Implementation Steps
1. Test flag

## Technical Notes
Check design_complete
`
      );

      const executor = new ForgeExecutor(projectPath, workflowId);

      // Check initial state
      let progress = executor.getProgress();
      expect(progress.design_complete).toBe(false);

      // Execute full pipeline
      await executor.execute();

      // Check after execution (should be in build stage)
      progress = executor.getProgress();
      expect(progress.design_complete).toBe(true);
    });
  });

  describe('Integration flow', () => {
    it('should complete full pipeline: create intents → execute → verify outputs', async () => {
      // Step 1: Create intent file
      const intentDir = path.join(testDir, 'aidlc-docs', 'inception');
      await fs.ensureDir(intentDir);

      await fs.writeFile(
        path.join(intentDir, 'INTENT-001.md'),
        `---
id: INTENT-001
title: User Authentication System
status: pending
estimated_effort: 8
dependencies: []
---

# Task: User Authentication System

## Goal
Implement complete user authentication with registration and login

## Component
Auth Components

## Acceptance Criteria
- [ ] Registration form created
- [ ] User data validated
- [ ] Account created in database
- [ ] Login endpoint functional
- [ ] JWT tokens issued
- [ ] Session management implemented

## Implementation Steps
1. Create registration endpoint
2. Add validation
3. Store user data
4. Create login endpoint
5. Verify credentials
6. Issue JWT token

## Technical Notes
Use bcrypt for password hashing, validate email format, JWT for sessions with 24h expiry
`
      );

      // Step 2: Execute construction
      const executor = new ForgeExecutor(projectPath, workflowId);
      const result = await executor.execute();

      // Step 3: Verify execution succeeded
      expect(result.passed).toBe(true);
      expect(result.coverage_percentage).toBe(100);

      // Step 4: Verify unit directories
      const constructionDir = path.join(testDir, 'aidlc-docs', 'construction');
      const constructionEntries = await fs.readdir(constructionDir);
      const unitDirs = constructionEntries.filter(f => f.startsWith('UNIT-') && !f.endsWith('.md'));
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
      const designDir = path.join(testDir, 'aidlc-docs', 'construction', 'design');
      expect(await fs.pathExists(path.join(designDir, 'interfaces.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'data-flow.json'))).toBe(true);
      expect(await fs.pathExists(path.join(designDir, 'components.json'))).toBe(true);

      // Step 6: Verify bolt files
      const unit001Dir = path.join(testDir, 'aidlc-docs', 'construction', 'UNIT-001');
      const boltFiles = await fs.readdir(unit001Dir);
      const boltMarkdownFiles = boltFiles.filter(f => f.startsWith('BOLT-') && f.endsWith('.md'));
      expect(boltMarkdownFiles.length).toBe(1);

      // Verify BOLT-001.md content
      const bolt1Content = await fs.readFile(path.join(unit001Dir, 'BOLT-001.md'), 'utf-8');
      expect(bolt1Content).toContain('id: BOLT-001');
      expect(bolt1Content).toContain('title: User Authentication System');
      expect(bolt1Content).toContain('parent_unit: UNIT-001');
      expect(bolt1Content).toContain('estimated_effort: 8');

      // Step 7: Verify progress tracking
      const progress = executor.getProgress();
      expect(progress.current_stage).toBe('build');
      expect(progress.units_total).toBe(1);
      expect(progress.bolts_total).toBe(1);
      expect(progress.design_complete).toBe(true);
      expect(progress.overall_percentage).toBeGreaterThan(0);
    });
  });
});
