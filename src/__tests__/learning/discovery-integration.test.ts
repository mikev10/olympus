import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { registerDiscoveryCaptureHooks } from '../../hooks/registrations/discovery-capture.js';
import { registerAgentTrackingHook } from '../../hooks/registrations/agent-tracking.js';
import { registerLearningCaptureHooks } from '../../hooks/registrations/learning-capture.js';
import { registerUserPromptSubmitHooks } from '../../hooks/registrations/user-prompt-submit.js';
import { routeHook } from '../../hooks/router.js';
import { clearHooks } from '../../hooks/registry.js';
import { loadSessionState, saveSessionState, markCompletionClaim, addPromptToSession } from '../../learning/session-state.js';
import { estimateTokens } from '../../learning/token-estimator.js';
import type { HookContext } from '../../hooks/types.js';

const TEST_DIR = join(process.cwd(), '.test-discovery-integration');
const TEST_LEARNING_DIR = join(TEST_DIR, '.claude', 'olympus', 'learning');

describe('Discovery Integration', () => {
  beforeEach(async () => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_LEARNING_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, '.olympus'), { recursive: true });

    process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_LEARNING_DIR;

    // Pre-initialize tokenizer
    await estimateTokens('warm up tokenizer');
  });

  afterEach(() => {
    delete process.env.OLYMPUS_TEST_LEARNING_DIR;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    clearHooks();
  });

  it('should create discovery when agent task completes with praise', async () => {
    registerLearningCaptureHooks();
    registerDiscoveryCaptureHooks();

    const sessionId = 'test-discovery-praise';

    // Simulate: user prompt, agent tracking populates pending_completion, then praise
    const state = loadSessionState(TEST_DIR, sessionId);
    markCompletionClaim(state, 'Fix the authentication bug in login.ts where JWT tokens expire too early', 'olympian');
    addPromptToSession(state, 'perfect, thanks!', 'praise');
    saveSessionState(TEST_DIR, state);

    // Simulate UserPromptSubmit to accumulate tokens (needed for learning-capture)
    await routeHook('UserPromptSubmit', {
      sessionId,
      directory: TEST_DIR,
      prompt: 'perfect, thanks!',
    });

    // Fire Stop hook - should trigger discovery capture
    await routeHook('Stop', {
      sessionId,
      directory: TEST_DIR,
    });

    // Verify discovery was created
    const discoveryPath = join(TEST_DIR, '.olympus', 'learning', 'discoveries.jsonl');
    expect(existsSync(discoveryPath)).toBe(true);

    const content = readFileSync(discoveryPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    expect(lines.length).toBeGreaterThan(0);

    const discovery = JSON.parse(lines[0]);
    expect(discovery.agent_name).toBe('olympian');
    expect(discovery.confidence).toBe(0.85);
    expect(discovery.scope).toBe('project');
  });

  it('should create discovery on topic change', async () => {
    registerLearningCaptureHooks();
    registerDiscoveryCaptureHooks();

    const sessionId = 'test-discovery-topic';

    // Set up state with pending completion and an unrelated new prompt
    const state = loadSessionState(TEST_DIR, sessionId);
    markCompletionClaim(state, 'Fix the authentication bug in login.ts', 'olympian');
    // Add a completely unrelated prompt (topic change)
    addPromptToSession(state, 'Can you help me set up Docker containers for the database?', undefined);
    saveSessionState(TEST_DIR, state);

    await routeHook('UserPromptSubmit', {
      sessionId,
      directory: TEST_DIR,
      prompt: 'Can you help me set up Docker containers for the database?',
    });

    await routeHook('Stop', {
      sessionId,
      directory: TEST_DIR,
    });

    const discoveryPath = join(TEST_DIR, '.olympus', 'learning', 'discoveries.jsonl');
    expect(existsSync(discoveryPath)).toBe(true);

    const content = readFileSync(discoveryPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    expect(lines.length).toBeGreaterThan(0);

    const discovery = JSON.parse(lines[0]);
    expect(discovery.confidence).toBe(0.6); // topic_change confidence
  });

  it('should not create duplicate discoveries', async () => {
    registerLearningCaptureHooks();
    registerDiscoveryCaptureHooks();

    const sessionId = 'test-discovery-dedup';
    const taskDescription = 'Fix the authentication bug in login.ts for JWT tokens';

    // First run - should create discovery
    let state = loadSessionState(TEST_DIR, sessionId);
    markCompletionClaim(state, taskDescription, 'olympian');
    addPromptToSession(state, 'perfect, thanks!', 'praise');
    saveSessionState(TEST_DIR, state);

    await routeHook('UserPromptSubmit', { sessionId, directory: TEST_DIR, prompt: 'perfect, thanks!' });
    await routeHook('Stop', { sessionId, directory: TEST_DIR });

    // Second run with same task - should be deduplicated
    state = loadSessionState(TEST_DIR, sessionId);
    markCompletionClaim(state, taskDescription, 'olympian');
    addPromptToSession(state, 'perfect, thanks!', 'praise');
    saveSessionState(TEST_DIR, state);

    await routeHook('UserPromptSubmit', { sessionId, directory: TEST_DIR, prompt: 'perfect, thanks!' });
    await routeHook('Stop', { sessionId, directory: TEST_DIR });

    const discoveryPath = join(TEST_DIR, '.olympus', 'learning', 'discoveries.jsonl');
    const content = readFileSync(discoveryPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    // Should have exactly 1 discovery (second was deduplicated)
    expect(lines.length).toBe(1);
  });

  it('should not create discovery when volume limit exceeded', async () => {
    registerLearningCaptureHooks();
    registerDiscoveryCaptureHooks();

    const sessionId = 'test-discovery-limit';

    // Pre-fill volume to limit
    const state = loadSessionState(TEST_DIR, sessionId);
    state.discovery_volume = {
      session_count: 5,
      daily_count: 5,
      daily_reset_at: new Date().toISOString(),
    };
    markCompletionClaim(state, 'This should not create a discovery', 'olympian');
    addPromptToSession(state, 'perfect, thanks!', 'praise');
    saveSessionState(TEST_DIR, state);

    await routeHook('UserPromptSubmit', { sessionId, directory: TEST_DIR, prompt: 'perfect, thanks!' });
    await routeHook('Stop', { sessionId, directory: TEST_DIR });

    const discoveryPath = join(TEST_DIR, '.olympus', 'learning', 'discoveries.jsonl');
    expect(existsSync(discoveryPath)).toBe(false);
  });

  it('should not create discovery when config disabled', async () => {
    registerLearningCaptureHooks();
    registerDiscoveryCaptureHooks();

    const sessionId = 'test-discovery-disabled';

    // Create project config with disabled auto-discovery
    const configDir = join(TEST_DIR, '.olympus');
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      autoDiscovery: { enabled: false }
    }));

    const state = loadSessionState(TEST_DIR, sessionId);
    markCompletionClaim(state, 'This should not create a discovery', 'olympian');
    addPromptToSession(state, 'perfect, thanks!', 'praise');
    saveSessionState(TEST_DIR, state);

    await routeHook('UserPromptSubmit', { sessionId, directory: TEST_DIR, prompt: 'perfect, thanks!' });
    await routeHook('Stop', { sessionId, directory: TEST_DIR });

    const discoveryPath = join(TEST_DIR, '.olympus', 'learning', 'discoveries.jsonl');
    expect(existsSync(discoveryPath)).toBe(false);
  });

  it('should verify feedback-log.jsonl is populated by success detector', async () => {
    registerLearningCaptureHooks();
    registerDiscoveryCaptureHooks();
    registerUserPromptSubmitHooks(); // Needed for success/revision detection

    const sessionId = 'test-feedback-validation';

    // Set up state with task completion and praise
    const state = loadSessionState(TEST_DIR, sessionId);
    markCompletionClaim(state, 'Fix the login bug', 'olympian');
    saveSessionState(TEST_DIR, state);

    // UserPromptSubmit with praise - triggers success detector which creates feedback entry
    await routeHook('UserPromptSubmit', {
      sessionId,
      directory: TEST_DIR,
      prompt: 'perfect!',
    });

    await routeHook('PostToolUse', {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Write',
      toolOutput: { content: 'Some tool output content for token estimation' },
    });

    await routeHook('Stop', { sessionId, directory: TEST_DIR });

    // Verify feedback-log.jsonl exists and has content (from success detector, not Stop hook)
    const feedbackPath = join(TEST_LEARNING_DIR, 'feedback-log.jsonl');
    expect(existsSync(feedbackPath)).toBe(true);

    const feedbackContent = readFileSync(feedbackPath, 'utf-8');
    const feedbackLines = feedbackContent.trim().split('\n').filter(l => l.trim());
    expect(feedbackLines.length).toBeGreaterThan(0);

    const feedbackEntry = JSON.parse(feedbackLines[0]);
    expect(feedbackEntry.session_id).toBe(sessionId);
    expect(feedbackEntry.feedback_category).toBe('praise'); // From success detector
  });
});
