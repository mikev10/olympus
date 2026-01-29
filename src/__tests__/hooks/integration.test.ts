/**
 * Hook Integration Tests
 *
 * Tests that all hooks are properly registered and assigned to correct events.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerAllHooks, resetRegistration } from '../../hooks/registrations/index.js';
import { getAllHooks, getHooksForEvent, clearHooks } from '../../hooks/registry.js';

describe('Hook Integration', () => {
  beforeAll(() => {
    clearHooks();
    registerAllHooks();
  });

  afterAll(() => {
    clearHooks();
    resetRegistration();
  });

  describe('Hook Registration', () => {
    it('registers all expected hooks', () => {
      const hooks = getAllHooks();
      const hookNames = hooks.map(h => h.name);

      const expectedHooks = [
        // UserPromptSubmit
        'keywordDetector',
        'autoSlashCommand',
        'thinkMode',
        // SessionStart
        'sessionStart',
        // Stop
        'persistentMode',
        // PreToolUse
        'rulesInjector',
        'directoryReadmeInjector',
        'nonInteractiveEnv',
        'olympusOrchestratorPre',
        // PostToolUse
        'editErrorRecovery',
        'commentChecker',
        'contextWindowLimitRecovery',
        'preemptiveCompaction',
        'agentUsageReminder',
        'olympusOrchestratorPost',
        // Notification
        'backgroundNotification',
        // PostToolUseFailure
        'sessionRecovery'
      ];

      for (const expected of expectedHooks) {
        expect(hookNames).toContain(expected);
      }
    });

    it('has no duplicate hook names', () => {
      const hooks = getAllHooks();
      const names = hooks.map(h => h.name);
      const uniqueNames = [...new Set(names)];
      expect(names.length).toBe(uniqueNames.length);
    });
  });

  describe('Event Assignment', () => {
    it('has UserPromptSubmit hooks', () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      expect(hooks.length).toBeGreaterThanOrEqual(3);

      const names = hooks.map(h => h.name);
      expect(names).toContain('keywordDetector');
      expect(names).toContain('autoSlashCommand');
      expect(names).toContain('thinkMode');
    });

    it('has SessionStart hooks', () => {
      const hooks = getHooksForEvent('SessionStart');
      expect(hooks.length).toBeGreaterThanOrEqual(1);

      const names = hooks.map(h => h.name);
      expect(names).toContain('sessionStart');
    });

    it('has Stop hooks', () => {
      const hooks = getHooksForEvent('Stop');
      expect(hooks.length).toBeGreaterThanOrEqual(1);

      const names = hooks.map(h => h.name);
      expect(names).toContain('persistentMode');
    });

    it('has PreToolUse hooks', () => {
      const hooks = getHooksForEvent('PreToolUse');
      expect(hooks.length).toBeGreaterThanOrEqual(4);

      const names = hooks.map(h => h.name);
      expect(names).toContain('rulesInjector');
      expect(names).toContain('directoryReadmeInjector');
      expect(names).toContain('nonInteractiveEnv');
      expect(names).toContain('olympusOrchestratorPre');
    });

    it('has PostToolUse hooks', () => {
      const hooks = getHooksForEvent('PostToolUse');
      expect(hooks.length).toBeGreaterThanOrEqual(6);

      const names = hooks.map(h => h.name);
      expect(names).toContain('editErrorRecovery');
      expect(names).toContain('commentChecker');
      expect(names).toContain('contextWindowLimitRecovery');
      expect(names).toContain('preemptiveCompaction');
      expect(names).toContain('agentUsageReminder');
      expect(names).toContain('olympusOrchestratorPost');
    });

    it('has Notification hooks', () => {
      const hooks = getHooksForEvent('Notification');
      expect(hooks.length).toBeGreaterThanOrEqual(1);

      const names = hooks.map(h => h.name);
      expect(names).toContain('backgroundNotification');
    });

    it('has PostToolUseFailure hooks', () => {
      const hooks = getHooksForEvent('PostToolUseFailure');
      expect(hooks.length).toBeGreaterThanOrEqual(1);

      const names = hooks.map(h => h.name);
      expect(names).toContain('sessionRecovery');
    });
  });

  describe('Priority Ordering', () => {
    it('sorts UserPromptSubmit hooks by priority', () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const priorities = hooks.map(h => h.priority ?? 100);

      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]);
      }
    });

    it('sorts PostToolUse hooks by priority', () => {
      const hooks = getHooksForEvent('PostToolUse');
      const priorities = hooks.map(h => h.priority ?? 100);

      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]);
      }
    });
  });
});
