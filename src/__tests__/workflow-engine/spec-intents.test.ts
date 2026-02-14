/**
 * Tests for Master Plan Linking
 *
 * NOTE: Legacy SPEC/INTENTS validation tests have been removed as part of the ODLC V3 migration.
 * Functions validateSpec, validateTasks, generateDependencyGraph, validateDependencyGraph, and
 * getExecutionOrder were removed. The V3 system uses ForgeExecutor for decomposition.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  linkMasterPlan,
} from '../../features/workflow-engine/index.js';

const TEST_DIR = join(tmpdir(), `spec-intents-test-${Date.now()}`);

/**
 * LEGACY TESTS REMOVED
 *
 * The following test suites have been removed as part of the ODLC V3 migration:
 *
 * - SPEC Stage Validation (validateSpec) - Function removed, replaced by validateIntent
 * - INTENTS Stage Validation (validateTasks) - Function removed, no replacement
 * - Dependency Graph (generateDependencyGraph, validateDependencyGraph, getExecutionOrder) - Functions removed
 *
 * These functions were part of the legacy ODLC workflow system. The V3 system handles
 * decomposition and validation through the ForgeExecutor and new validation system.
 */

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

      expect(content).toContain('[Idea Document](aidlc-docs/inception/idea.md)');
      expect(content).toContain('[Intent Document](aidlc-docs/inception/intent.md)');
      expect(content).toContain('[Workflow Checkpoint](aidlc-docs/checkpoint.json)');
      expect(content).toContain('aidlc-docs/inception/idea.md');
      expect(content).toContain('aidlc-docs/construction/');
      expect(content).toContain('aidlc-docs/operations/deploy-guide.md');
      expect(content).toContain('aidlc-docs/checkpoint.json');
      expect(content).toContain('aidlc-docs/manifest.json');
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
      expect(updatedContent).toContain('[Idea Document]');
      expect(updatedContent).toContain('[Intent Document]');

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
      expect(updatedContent).toContain('[Idea Document]');
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
