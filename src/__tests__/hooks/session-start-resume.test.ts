import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearHooks, getHooksForEvent } from '../../hooks/registry.js';
import { registerSessionStartHooks } from '../../hooks/registrations/session-start.js';
import type { HookContext } from '../../hooks/types.js';

const testDir = '/test-session-start-resume';

// Mock dependencies
vi.mock('../../hooks/ultrawork-state/index.js', () => ({
  readUltraworkState: vi.fn(() => null),
}));

vi.mock('../../hooks/todo-continuation/index.js', () => ({
  checkIncompleteTodos: vi.fn(() => Promise.resolve({ count: 0 })),
}));

vi.mock('../../learning/hooks/learned-context.js', () => ({
  generateLearnedContext: vi.fn(() => ''),
  formatDiscoveries: vi.fn(() => ''),
}));

vi.mock('../../learning/discovery.js', () => ({
  getDiscoveriesForInjection: vi.fn(() => []),
  markDiscoveryUseful: vi.fn(),
}));

vi.mock('../../learning/session-state.js', () => ({
  loadSessionState: vi.fn(() => ({})),
  saveSessionState: vi.fn(),
  initializeTokenBudget: vi.fn(),
}));

vi.mock('../../features/workflow-engine/resume-detector.js', () => ({
  detectResumableWorkflows: vi.fn(),
}));

vi.mock('../../features/workflow-engine/workflow-bridge.js', () => ({
  generateWorkflowSummary: vi.fn(),
  generateBoltExecutionPlan: vi.fn(),
}));

vi.mock('../../features/workflow-engine/trust.js', () => ({
  loadTrustState: vi.fn(() => ({ current_level: 0 })),
}));

import { detectResumableWorkflows } from '../../features/workflow-engine/resume-detector.js';
import { generateWorkflowSummary, generateBoltExecutionPlan } from '../../features/workflow-engine/workflow-bridge.js';
import { loadTrustState } from '../../features/workflow-engine/trust.js';

describe('session-start resume detection hook', () => {
  beforeEach(() => {
    clearHooks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearHooks();
  });

  it('should inject workflow context when active workflow found', async () => {
    const mockWorkflow = {
      workflowId: 'wf-001',
      featureName: 'Test Feature',
      currentPhase: 'construction' as const,
      currentStage: 'bolt' as const,
      progress: { completed: 2, total: 5 },
      lastActivity: '2024-01-15T10:00:00Z',
      isLegacy: false,
      status: 'in_progress',
    };

    vi.mocked(detectResumableWorkflows).mockResolvedValue([mockWorkflow]);
    vi.mocked(generateWorkflowSummary).mockResolvedValue('## Workflow Summary\n...');
    vi.mocked(loadTrustState).mockReturnValue({ current_level: 2 } as any);

    registerSessionStartHooks();

    const hooks = getHooksForEvent('SessionStart');
    const resumeHook = hooks.find((h: any) => h.name === 'workflowResumeDetection');

    expect(resumeHook).toBeDefined();

    const ctx: HookContext = {
      event: 'SessionStart',
      directory: testDir,
      sessionId: 'test-session',
    };

    const result = await resumeHook!.handler(ctx);

    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toContain('Test Feature');
    expect(result.hookSpecificOutput?.additionalContext).toContain('construction');
    expect(result.hookSpecificOutput?.additionalContext).toContain('2/5 BOLTs complete');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Trust Level: 2');
    expect(result.hookSpecificOutput?.additionalContext).toContain('## Workflow Summary');
  });

  it('should not inject context when no workflows found', async () => {
    vi.mocked(detectResumableWorkflows).mockResolvedValue([]);

    registerSessionStartHooks();

    const hooks = getHooksForEvent('SessionStart');
    const resumeHook = hooks.find((h: any) => h.name === 'workflowResumeDetection');

    const ctx: HookContext = {
      event: 'SessionStart',
      directory: testDir,
      sessionId: 'test-session',
    };

    const result = await resumeHook!.handler(ctx);

    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should show migration hint for legacy workflows', async () => {
    const mockWorkflow = {
      workflowId: 'legacy-wf',
      featureName: 'Legacy Feature',
      currentPhase: 'inception' as const,
      currentStage: 'intent' as const,
      progress: { completed: 0, total: 0 },
      lastActivity: '2024-01-10T10:00:00Z',
      isLegacy: true,
      status: 'in_progress',
    };

    vi.mocked(detectResumableWorkflows).mockResolvedValue([mockWorkflow]);
    vi.mocked(loadTrustState).mockReturnValue({ current_level: 0 } as any);

    registerSessionStartHooks();

    const hooks = getHooksForEvent('SessionStart');
    const resumeHook = hooks.find((h: any) => h.name === 'workflowResumeDetection');

    const ctx: HookContext = {
      event: 'SessionStart',
      directory: testDir,
      sessionId: 'test-session',
    };

    const result = await resumeHook!.handler(ctx);

    expect(result.hookSpecificOutput?.additionalContext).toContain('Found legacy workflow');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Legacy Feature');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Run /plan to archive and start fresh');
  });

  it('should show mode selection prompt for awaiting_mode_selection', async () => {
    const mockWorkflow = {
      workflowId: 'wf-001',
      featureName: 'Test Feature',
      currentPhase: 'inception' as const,
      currentStage: 'intent' as const,
      progress: { completed: 0, total: 0 },
      lastActivity: '2024-01-15T10:00:00Z',
      isLegacy: false,
      status: 'awaiting_mode_selection',
    };

    vi.mocked(detectResumableWorkflows).mockResolvedValue([mockWorkflow]);
    vi.mocked(loadTrustState).mockReturnValue({ current_level: 1 } as any);

    registerSessionStartHooks();

    const hooks = getHooksForEvent('SessionStart');
    const resumeHook = hooks.find((h: any) => h.name === 'workflowResumeDetection');

    const ctx: HookContext = {
      event: 'SessionStart',
      directory: testDir,
      sessionId: 'test-session',
    };

    const result = await resumeHook!.handler(ctx);

    expect(result.hookSpecificOutput?.additionalContext).toContain('awaiting execution mode selection');
    expect(result.hookSpecificOutput?.additionalContext).toContain('/ascent, /olympus, or /ultrawork');
  });

  it('should show review prompt for awaiting_dev_review', async () => {
    const mockWorkflow = {
      workflowId: 'wf-001',
      featureName: 'Test Feature',
      currentPhase: 'inception' as const,
      currentStage: 'intent' as const,
      progress: { completed: 0, total: 0 },
      lastActivity: '2024-01-15T10:00:00Z',
      isLegacy: false,
      status: 'awaiting_dev_review',
    };

    vi.mocked(detectResumableWorkflows).mockResolvedValue([mockWorkflow]);
    vi.mocked(loadTrustState).mockReturnValue({ current_level: 0 } as any);

    registerSessionStartHooks();

    const hooks = getHooksForEvent('SessionStart');
    const resumeHook = hooks.find((h: any) => h.name === 'workflowResumeDetection');

    const ctx: HookContext = {
      event: 'SessionStart',
      directory: testDir,
      sessionId: 'test-session',
    };

    const result = await resumeHook!.handler(ctx);

    expect(result.hookSpecificOutput?.additionalContext).toContain('awaiting developer review');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Risk Tier 3');
  });

  it('should inject trust level', async () => {
    const mockWorkflow = {
      workflowId: 'wf-001',
      featureName: 'Test Feature',
      currentPhase: 'construction' as const,
      currentStage: 'bolt' as const,
      progress: { completed: 0, total: 0 },
      lastActivity: '2024-01-15T10:00:00Z',
      isLegacy: false,
      status: 'in_progress',
    };

    vi.mocked(detectResumableWorkflows).mockResolvedValue([mockWorkflow]);
    vi.mocked(loadTrustState).mockReturnValue({ current_level: 3 } as any);

    registerSessionStartHooks();

    const hooks = getHooksForEvent('SessionStart');
    const resumeHook = hooks.find((h: any) => h.name === 'workflowResumeDetection');

    const ctx: HookContext = {
      event: 'SessionStart',
      directory: testDir,
      sessionId: 'test-session',
    };

    const result = await resumeHook!.handler(ctx);

    expect(result.hookSpecificOutput?.additionalContext).toContain('Trust Level: 3');
  });

  it('should inject workflow summary', async () => {
    const mockWorkflow = {
      workflowId: 'wf-001',
      featureName: 'Test Feature',
      currentPhase: 'construction' as const,
      currentStage: 'bolt' as const,
      progress: { completed: 1, total: 3 },
      lastActivity: '2024-01-15T10:00:00Z',
      isLegacy: false,
      status: 'in_progress',
    };

    const mockSummary = '## Active Workflow\nWorkflow: Test Feature\n...';

    vi.mocked(detectResumableWorkflows).mockResolvedValue([mockWorkflow]);
    vi.mocked(generateWorkflowSummary).mockResolvedValue(mockSummary);
    vi.mocked(loadTrustState).mockReturnValue({ current_level: 1 } as any);

    registerSessionStartHooks();

    const hooks = getHooksForEvent('SessionStart');
    const resumeHook = hooks.find((h: any) => h.name === 'workflowResumeDetection');

    const ctx: HookContext = {
      event: 'SessionStart',
      directory: testDir,
      sessionId: 'test-session',
    };

    const result = await resumeHook!.handler(ctx);

    expect(result.hookSpecificOutput?.additionalContext).toContain('## Active Workflow');
  });

  it('should inject interview progress info', async () => {
    const mockWorkflow = {
      workflowId: 'wf-001',
      featureName: 'Test Feature',
      currentPhase: 'inception' as const,
      currentStage: 'idea' as const,
      progress: { completed: 0, total: 0 },
      lastActivity: '2024-01-15T10:00:00Z',
      isLegacy: false,
      status: 'in_progress',
      interviewProgress: {
        stage: 'idea' as const,
        questions_asked: 5,
        draft_artifact_path: 'aidlc-docs/discovery/idea-draft.md',
      },
    };

    vi.mocked(detectResumableWorkflows).mockResolvedValue([mockWorkflow]);
    vi.mocked(loadTrustState).mockReturnValue({ current_level: 0 } as any);

    registerSessionStartHooks();

    const hooks = getHooksForEvent('SessionStart');
    const resumeHook = hooks.find((h: any) => h.name === 'workflowResumeDetection');

    const ctx: HookContext = {
      event: 'SessionStart',
      directory: testDir,
      sessionId: 'test-session',
    };

    const result = await resumeHook!.handler(ctx);

    expect(result.hookSpecificOutput?.additionalContext).toContain('Interview in progress: idea stage');
    expect(result.hookSpecificOutput?.additionalContext).toContain('5 questions asked');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Draft artifact exists');
  });

  it('should handle errors silently', async () => {
    vi.mocked(detectResumableWorkflows).mockRejectedValue(new Error('Test error'));

    registerSessionStartHooks();

    const hooks = getHooksForEvent('SessionStart');
    const resumeHook = hooks.find((h: any) => h.name === 'workflowResumeDetection');

    const ctx: HookContext = {
      event: 'SessionStart',
      directory: testDir,
      sessionId: 'test-session',
    };

    const result = await resumeHook!.handler(ctx);

    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should have priority 8', () => {
    registerSessionStartHooks();

    const hooks = getHooksForEvent('SessionStart');
    const resumeHook = hooks.find((h: any) => h.name === 'workflowResumeDetection');

    expect(resumeHook!.priority).toBe(8);
  });

  it('should not inject interview progress for legacy workflows', async () => {
    const mockWorkflow = {
      workflowId: 'legacy-wf',
      featureName: 'Legacy Feature',
      currentPhase: 'inception' as const,
      currentStage: 'idea' as const,
      progress: { completed: 0, total: 0 },
      lastActivity: '2024-01-10T10:00:00Z',
      isLegacy: true,
      status: 'in_progress',
      interviewProgress: {
        stage: 'idea' as const,
        questions_asked: 5,
      },
    };

    vi.mocked(detectResumableWorkflows).mockResolvedValue([mockWorkflow]);
    vi.mocked(loadTrustState).mockReturnValue({ current_level: 0 } as any);

    registerSessionStartHooks();

    const hooks = getHooksForEvent('SessionStart');
    const resumeHook = hooks.find((h: any) => h.name === 'workflowResumeDetection');

    const ctx: HookContext = {
      event: 'SessionStart',
      directory: testDir,
      sessionId: 'test-session',
    };

    const result = await resumeHook!.handler(ctx);

    expect(result.hookSpecificOutput?.additionalContext).not.toContain('Interview in progress');
  });
});
