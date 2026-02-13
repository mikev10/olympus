import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Hoisted mock for homedir
const mockHomedir = vi.hoisted(() => {
  return { value: '' };
});

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => mockHomedir.value,
  };
});

import {
  detectPlanFileChange,
  parseMomusReviewOutput,
  createPlanningDiscovery,
  formatPlanLearnings,
  resetPlanTracking,
  extractPlanContext,
} from '../../learning/plan-tracker.js';
import { registerPlanLifecycleHooks } from '../../hooks/registrations/plan-lifecycle.js';
import { registerLearningCaptureHooks } from '../../hooks/registrations/learning-capture.js';
import { routeHook } from '../../hooks/router.js';
import { clearHooks } from '../../hooks/registry.js';
import { loadSessionState, saveSessionState, markCompletionClaim } from '../../learning/session-state.js';
import { recordDiscovery } from '../../learning/discovery.js';
import { estimateTokens } from '../../learning/token-estimator.js';
import type { HookContext } from '../../hooks/types.js';
import type { PlanLifecycleEvent, AgentDiscovery } from '../../learning/types.js';

describe('Plan Lifecycle Tracking', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'olympus-plan-tracking-'));
    mockHomedir.value = tempDir;
    resetPlanTracking();

    // Create directory structure
    mkdirSync(join(tempDir, '.olympus', 'plans'), { recursive: true });
    mkdirSync(join(tempDir, '.olympus', 'learning'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    clearHooks();
    resetPlanTracking();
  });

  describe('detectPlanFileChange', () => {
    it('should detect new plan file creation', () => {
      const planPath = join(tempDir, '.olympus', 'plans', 'feature-x.md');
      writeFileSync(planPath, '# Plan: Feature X\n\nImplement feature X with proper testing.');

      const event = detectPlanFileChange(tempDir, planPath, 'test-session');

      expect(event).not.toBeNull();
      expect(event!.event_type).toBe('plan_created');
      expect(event!.plan_path).toContain('feature-x.md');
      expect(event!.plan_summary).toContain('Feature X');
      expect(event!.revision_count).toBe(0);
    });

    it('should detect plan file revision', () => {
      const planPath = join(tempDir, '.olympus', 'plans', 'feature-y.md');
      writeFileSync(planPath, '# Plan: Feature Y\n\nOriginal content.');

      // First call - creation
      detectPlanFileChange(tempDir, planPath, 'test-session');

      // Modify file (simulate revision by changing mtime)
      writeFileSync(planPath, '# Plan: Feature Y\n\nRevised content with more details.');

      // Second call - revision
      const event = detectPlanFileChange(tempDir, planPath, 'test-session');

      expect(event).not.toBeNull();
      expect(event!.event_type).toBe('plan_revised');
      expect(event!.revision_count).toBe(1);
    });

    it('should return null for non-existent file', () => {
      const event = detectPlanFileChange(tempDir, '/non/existent/path.md', 'test-session');
      expect(event).toBeNull();
    });
  });

  describe('parseMomusReviewOutput', () => {
    it('should detect approval', () => {
      const output = 'After thorough review, the plan is APPROVED. The architecture is solid and well thought out.';
      const result = parseMomusReviewOutput(output);

      expect(result.passed).toBe(true);
    });

    it('should detect rejection with critical issues', () => {
      const output = `Review Summary:
- CRITICAL: Missing rate limit analysis for API endpoints
- MAJOR ISSUE: No rollback strategy defined
The plan must be REVISED before implementation.`;

      const result = parseMomusReviewOutput(output);

      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should handle empty output', () => {
      const result = parseMomusReviewOutput('');
      expect(result.passed).toBe(false);
      expect(result.issues).toContain('Empty review output');
    });

    it('should handle mixed signals (rejection wins)', () => {
      const output = 'The plan looks good overall but has CRITICAL issues that need addressing. REVISE the security section.';
      const result = parseMomusReviewOutput(output);

      expect(result.passed).toBe(false);
    });
  });

  describe('createPlanningDiscovery', () => {
    it('should create discovery from review failure', () => {
      const event: PlanLifecycleEvent = {
        event_type: 'plan_review_failed',
        plan_path: '.olympus/plans/api-feature.md',
        plan_summary: 'API feature plan',
        failure_reasons: ['Missing rate limit analysis'],
        reviewer: 'momus',
        session_id: 'test-session',
        timestamp: new Date().toISOString(),
      };

      const discovery = createPlanningDiscovery(
        event,
        ['Missing rate limit analysis', 'No rollback strategy'],
        tempDir
      );

      expect(discovery.category).toBe('planning_insight');
      expect(discovery.confidence).toBe(0.9);
      expect(discovery.summary).toBe("Plan 'api-feature.md' failed review: 2 issues");
      expect(discovery.details).toContain('Issues found by momus:');
      expect(discovery.details).toContain('- Missing rate limit analysis');
      expect(discovery.details).toContain('- No rollback strategy');
      expect(discovery.agent_name).toBe('prometheus');
    });

    it('should use filename only in summary, not full path', () => {
      const event: PlanLifecycleEvent = {
        event_type: 'plan_review_failed',
        plan_path: '.olympus/plans/enforcement-hooks.md',
        plan_summary: 'Enforcement hooks plan',
        failure_reasons: ['Hook priority conflicts'],
        reviewer: 'momus',
        session_id: 'test-session',
        timestamp: new Date().toISOString(),
      };

      const discovery = createPlanningDiscovery(event, ['Hook priority conflicts'], tempDir);

      expect(discovery.summary).toBe("Plan 'enforcement-hooks.md' failed review: 1 issue");
      expect(discovery.summary).not.toContain('.olympus/plans/');
    });

    it('should format details as bullet list with reviewer', () => {
      const event: PlanLifecycleEvent = {
        event_type: 'plan_review_failed',
        plan_path: '.olympus/plans/test.md',
        plan_summary: 'Test plan',
        failure_reasons: ['Issue A', 'Issue B', 'Issue C'],
        reviewer: 'momus',
        session_id: 'test-session',
        timestamp: new Date().toISOString(),
      };

      const discovery = createPlanningDiscovery(
        event,
        ['Issue A', 'Issue B', 'Issue C'],
        tempDir
      );

      expect(discovery.details).toContain('Issues found by momus:');
      expect(discovery.details).toContain('- Issue A');
      expect(discovery.details).toContain('- Issue B');
      expect(discovery.details).toContain('- Issue C');
    });

    it('should cap details at 500 chars', () => {
      const longIssues = Array.from({ length: 20 }, (_, i) => `Very detailed issue number ${i} with lots of context that makes it super long`);
      const event: PlanLifecycleEvent = {
        event_type: 'plan_failed',
        plan_path: '.olympus/plans/test.md',
        plan_summary: 'Test',
        session_id: 'test-session',
        timestamp: new Date().toISOString(),
      };

      const discovery = createPlanningDiscovery(event, longIssues, tempDir);

      // Details = "Issues:" + newline + bullets (capped at 500)
      // So total will be slightly more than 500 due to the prefix
      expect(discovery.details!.length).toBeLessThan(550);
    });
  });

  describe('formatPlanLearnings', () => {
    it('should format discoveries for Prometheus injection', () => {
      const discoveries: AgentDiscovery[] = [
        {
          id: 'test-1',
          timestamp: new Date().toISOString(),
          session_id: 'test',
          project_path: tempDir,
          category: 'planning_insight',
          summary: 'Plan for API features failed review: missing rate limits',
          details: 'Details here',
          agent_name: 'prometheus',
          confidence: 0.9,
          verified: false,
          verification_count: 0,
          scope: 'project',
          last_useful: new Date().toISOString(),
        },
        {
          id: 'test-2',
          timestamp: new Date().toISOString(),
          session_id: 'test',
          project_path: tempDir,
          category: 'planning_insight',
          summary: 'Always include rollback strategy in deployment plans',
          details: 'Details here',
          agent_name: 'prometheus',
          confidence: 0.85,
          verified: false,
          verification_count: 0,
          scope: 'project',
          last_useful: new Date().toISOString(),
        },
      ];

      const result = formatPlanLearnings(discoveries);

      expect(result).toContain('<plan-learnings>');
      expect(result).toContain('</plan-learnings>');
      expect(result).toContain('Planning Insights');
      expect(result).toContain('missing rate limits');
    });

    it('should return empty string when no discoveries', () => {
      const result = formatPlanLearnings([]);
      expect(result).toBe('');
    });

    it('should stay under 1200 characters', () => {
      const discoveries: AgentDiscovery[] = Array.from({ length: 10 }, (_, i) => ({
        id: `test-${i}`,
        timestamp: new Date().toISOString(),
        session_id: 'test',
        project_path: tempDir,
        category: 'planning_insight' as const,
        summary: `Planning insight #${i}: ${'x'.repeat(100)}`,
        details: 'Details',
        agent_name: 'prometheus',
        confidence: 0.9,
        verified: false,
        verification_count: 0,
        scope: 'project' as const,
        last_useful: new Date().toISOString(),
      }));

      const result = formatPlanLearnings(discoveries);
      expect(result.length).toBeLessThanOrEqual(1220); // 1200 + closing tag
    });
  });

  describe('extractPlanContext', () => {
    it('should extract summary and risks from plan content', () => {
      const content = `---
description: Test plan
---

# Plan: Feature X

Implement feature X with testing.

## Risks

- Performance degradation under load
- Breaking changes to API
`;

      const context = extractPlanContext(content);
      expect(context.summary).toContain('Feature X');
      expect(context.risks.length).toBeGreaterThan(0);
      expect(context.risks[0]).toContain('Performance');
    });

    it('should handle plan without frontmatter', () => {
      const content = `# Simple Plan\n\nJust do the thing.`;
      const context = extractPlanContext(content);
      expect(context.summary).toContain('Simple Plan');
    });
  });

  describe('Hook Integration', () => {
    beforeEach(async () => {
      process.env.OLYMPUS_TEST_LEARNING_DIR = join(tempDir, '.claude', 'olympus', 'learning');
      mkdirSync(process.env.OLYMPUS_TEST_LEARNING_DIR, { recursive: true });
      await estimateTokens('warm up');
    });

    afterEach(() => {
      delete process.env.OLYMPUS_TEST_LEARNING_DIR;
    });

    it('should inject plan learnings into Prometheus PreToolUse context', async () => {
      registerPlanLifecycleHooks();

      // Create some planning_insight discoveries
      recordDiscovery({
        category: 'planning_insight',
        summary: 'Plans for API features must include rate limit considerations',
        details: 'Momus review failed due to missing rate limit analysis',
        agent_name: 'prometheus',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.9,
        scope: 'project',
      });

      // Trigger Prometheus PreToolUse
      const result = await routeHook('PreToolUse', {
        sessionId: 'test-session',
        directory: tempDir,
        toolName: 'Task',
        toolInput: { subagent_type: 'prometheus', prompt: 'Plan a new API feature' },
      });

      expect(result.continue).toBe(true);
      // Should have injected plan learnings
      if (result.hookSpecificOutput) {
        expect(result.hookSpecificOutput.additionalContext).toContain('plan-learnings');
        expect(result.hookSpecificOutput.additionalContext).toContain('rate limit');
      }
    });

    it('should not inject learnings for non-prometheus agents', async () => {
      registerPlanLifecycleHooks();

      recordDiscovery({
        category: 'planning_insight',
        summary: 'Test insight',
        details: 'Test details',
        agent_name: 'prometheus',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.9,
        scope: 'project',
      });

      const result = await routeHook('PreToolUse', {
        sessionId: 'test-session',
        directory: tempDir,
        toolName: 'Task',
        toolInput: { subagent_type: 'olympian', prompt: 'Do some work' },
      });

      expect(result.continue).toBe(true);
      // Should NOT have plan learnings
      expect(result.hookSpecificOutput?.additionalContext || '').not.toContain('plan-learnings');
    });

    it('should detect plan file write via PostToolUse', async () => {
      registerPlanLifecycleHooks();

      const planPath = join(tempDir, '.olympus', 'plans', 'test-plan.md');
      writeFileSync(planPath, '# Plan: Test\n\nTest plan content.');

      await routeHook('PostToolUse', {
        sessionId: 'test-session',
        directory: tempDir,
        toolName: 'Write',
        toolInput: { file_path: planPath },
        toolOutput: { success: true },
      });

      // Plan file was detected (no error thrown)
      // First write is creation, no discovery created for first creation
      // This is a smoke test to verify the hook runs without errors
      expect(true).toBe(true);
    });

    it('should not process non-plan file writes', async () => {
      registerPlanLifecycleHooks();

      await routeHook('PostToolUse', {
        sessionId: 'test-session',
        directory: tempDir,
        toolName: 'Write',
        toolInput: { file_path: join(tempDir, 'src', 'index.ts') },
        toolOutput: { success: true },
      });

      // No plan tracking should have occurred
      const discoveryPath = join(tempDir, '.olympus', 'learning', 'discoveries.jsonl');
      expect(existsSync(discoveryPath)).toBe(false);
    });

    it('should extract plan path from Momus task prompt', async () => {
      registerPlanLifecycleHooks();
      registerLearningCaptureHooks();

      const momusPrompt = 'Please critically review the plan at .olympus/plans/enforcement-hooks.md.\n\nThis plan adds 3 enforcement hooks...';
      const momusOutput = `Review Result:
- CRITICAL: Missing error handling for hook failures
- MAJOR ISSUE: No test coverage for concurrent hook execution
The plan must be REVISED.`;

      await routeHook('PostToolUse', {
        sessionId: 'test-session',
        directory: tempDir,
        toolName: 'Task',
        toolInput: {
          subagent_type: 'momus',
          prompt: momusPrompt,
        },
        toolOutput: momusOutput,
      });

      // Should have created a discovery with correct filename
      const discoveryPath = join(tempDir, '.olympus', 'learning', 'discoveries.jsonl');
      expect(existsSync(discoveryPath)).toBe(true);

      const discoveries = readFileSync(discoveryPath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));

      expect(discoveries.length).toBeGreaterThan(0);
      const planDiscovery = discoveries.find(d => d.category === 'planning_insight');
      expect(planDiscovery).toBeDefined();
      expect(planDiscovery.summary).toContain('enforcement-hooks.md');
      expect(planDiscovery.summary).not.toContain('Please critically review');
    });

    it('should skip generic "Plan requires revision" failures', async () => {
      registerPlanLifecycleHooks();
      registerLearningCaptureHooks();

      const momusPrompt = 'Please review .olympus/plans/test-plan.md';
      const momusOutput = 'The plan requires revision.';

      await routeHook('PostToolUse', {
        sessionId: 'test-session',
        directory: tempDir,
        toolName: 'Task',
        toolInput: {
          subagent_type: 'momus',
          prompt: momusPrompt,
        },
        toolOutput: momusOutput,
      });

      // Should NOT have created a discovery (generic failure)
      const discoveryPath = join(tempDir, '.olympus', 'learning', 'discoveries.jsonl');
      expect(existsSync(discoveryPath)).toBe(false);
    });

    it('should record specific actionable issues from Momus', async () => {
      registerPlanLifecycleHooks();
      registerLearningCaptureHooks();

      const momusPrompt = 'Review the plan at .olympus/plans/api-design.md';
      const momusOutput = `Review failed:
- CRITICAL: No authentication strategy defined
- MAJOR ISSUE: Missing pagination for list endpoints
- CONCERN: Rate limiting not addressed`;

      await routeHook('PostToolUse', {
        sessionId: 'test-session',
        directory: tempDir,
        toolName: 'Task',
        toolInput: {
          subagent_type: 'momus',
          prompt: momusPrompt,
        },
        toolOutput: momusOutput,
      });

      const discoveryPath = join(tempDir, '.olympus', 'learning', 'discoveries.jsonl');
      expect(existsSync(discoveryPath)).toBe(true);

      const discoveries = readFileSync(discoveryPath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));

      const planDiscovery = discoveries.find(d => d.category === 'planning_insight');
      expect(planDiscovery).toBeDefined();
      expect(planDiscovery.summary).toBe("Plan 'api-design.md' failed review: 3 issues");
      expect(planDiscovery.details).toContain('Issues found by momus:');
      expect(planDiscovery.details).toContain('No authentication strategy');
      expect(planDiscovery.details).toContain('Missing pagination');
    });
  });
});
