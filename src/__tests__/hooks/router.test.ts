/**
 * Hook Router Tests
 *
 * Comprehensive test suite for the hook router system.
 * Tests routing, filtering, aggregation, timeout handling, and error isolation.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { registerHook, clearHooks, getHooksForEvent } from '../../hooks/registry.js';
import { routeHook, shouldContinue } from '../../hooks/router.js';
import type { HookContext, HookResult } from '../../hooks/types.js';

// Mock config loader to avoid file system dependencies
vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    hooks: {
      enabled: true,
      hookTimeoutMs: 100
    }
  }),
  DEFAULT_CONFIG: {}
}));

describe('Hook Router', () => {
  beforeEach(() => {
    clearHooks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearHooks();
  });

  describe('Basic Routing', () => {
    it('routes to registered hooks', async () => {
      registerHook({
        name: 'test',
        event: 'UserPromptSubmit',
        handler: () => ({ continue: true, message: 'test message' })
      });

      const result = await routeHook('UserPromptSubmit', { prompt: 'hello' });

      expect(result.continue).toBe(true);
      expect(result.message).toBe('test message');
    });

    it('returns continue=true when no hooks registered', async () => {
      const result = await routeHook('UserPromptSubmit', {});
      expect(result.continue).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('routes to multiple hooks for same event', async () => {
      const calls: string[] = [];

      registerHook({
        name: 'hook1',
        event: 'UserPromptSubmit',
        handler: () => {
          calls.push('hook1');
          return { continue: true };
        }
      });

      registerHook({
        name: 'hook2',
        event: 'UserPromptSubmit',
        handler: () => {
          calls.push('hook2');
          return { continue: true };
        }
      });

      await routeHook('UserPromptSubmit', {});

      expect(calls).toHaveLength(2);
      expect(calls).toContain('hook1');
      expect(calls).toContain('hook2');
    });

    it('does not route to hooks for different events', async () => {
      const handler = vi.fn().mockReturnValue({ continue: true });

      registerHook({
        name: 'submitHook',
        event: 'UserPromptSubmit',
        handler
      });

      await routeHook('Stop', {});

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Message Aggregation', () => {
    it('aggregates messages from multiple hooks', async () => {
      registerHook({
        name: 'hook1',
        event: 'UserPromptSubmit',
        priority: 10,
        handler: () => ({ continue: true, message: 'message 1' })
      });

      registerHook({
        name: 'hook2',
        event: 'UserPromptSubmit',
        priority: 20,
        handler: () => ({ continue: true, message: 'message 2' })
      });

      const result = await routeHook('UserPromptSubmit', {});

      expect(result.message).toContain('message 1');
      expect(result.message).toContain('message 2');
      expect(result.message).toBe('message 1\n\n---\n\nmessage 2');
    });

    it('handles hooks with no messages', async () => {
      registerHook({
        name: 'noMessage',
        event: 'UserPromptSubmit',
        handler: () => ({ continue: true })
      });

      const result = await routeHook('UserPromptSubmit', {});

      expect(result.message).toBeUndefined();
    });

    it('aggregates only non-empty messages', async () => {
      registerHook({
        name: 'withMessage',
        event: 'UserPromptSubmit',
        priority: 10,
        handler: () => ({ continue: true, message: 'has message' })
      });

      registerHook({
        name: 'noMessage',
        event: 'UserPromptSubmit',
        priority: 20,
        handler: () => ({ continue: true })
      });

      const result = await routeHook('UserPromptSubmit', {});

      expect(result.message).toBe('has message');
    });
  });

  describe('Continue/Block Behavior', () => {
    it('sets continue=false when any hook blocks', async () => {
      registerHook({
        name: 'blocker',
        event: 'Stop',
        handler: () => ({ continue: false, stopReason: 'tasks remain' })
      });

      const result = await routeHook('Stop', {});

      expect(result.continue).toBe(false);
      expect(result.stopReason).toBe('tasks remain');
    });

    it('sets continue=false if any hook in chain blocks', async () => {
      registerHook({
        name: 'allows',
        event: 'Stop',
        priority: 10,
        handler: () => ({ continue: true })
      });

      registerHook({
        name: 'blocks',
        event: 'Stop',
        priority: 20,
        handler: () => ({ continue: false, stopReason: 'blocked' })
      });

      const result = await routeHook('Stop', {});

      expect(result.continue).toBe(false);
      expect(result.stopReason).toBe('blocked');
    });

    it('continues if all hooks allow', async () => {
      registerHook({
        name: 'allows1',
        event: 'Stop',
        priority: 10,
        handler: () => ({ continue: true })
      });

      registerHook({
        name: 'allows2',
        event: 'Stop',
        priority: 20,
        handler: () => ({ continue: true })
      });

      const result = await routeHook('Stop', {});

      expect(result.continue).toBe(true);
    });

    it('uses shouldContinue helper for simple checks', async () => {
      registerHook({
        name: 'blocker',
        event: 'Stop',
        handler: () => ({ continue: false })
      });

      const result = await shouldContinue('Stop', {});

      expect(result).toBe(false);
    });
  });

  describe('Matcher Filtering', () => {
    it('only runs hooks matching tool name with string matcher', async () => {
      registerHook({
        name: 'editOnly',
        event: 'PostToolUse',
        matcher: 'edit',
        handler: () => ({ continue: true, message: 'edit hook ran' })
      });

      const editResult = await routeHook('PostToolUse', { toolName: 'edit' });
      expect(editResult.message).toBe('edit hook ran');

      const readResult = await routeHook('PostToolUse', { toolName: 'read' });
      expect(readResult.message).toBeUndefined();
    });

    it('only runs hooks matching tool name with regex matcher', async () => {
      registerHook({
        name: 'editOnly',
        event: 'PostToolUse',
        matcher: /^edit$/i,
        handler: () => ({ continue: true, message: 'edit hook ran' })
      });

      const editResult = await routeHook('PostToolUse', { toolName: 'edit' });
      expect(editResult.message).toBe('edit hook ran');

      const readResult = await routeHook('PostToolUse', { toolName: 'read' });
      expect(readResult.message).toBeUndefined();
    });

    it('runs hook when no matcher specified', async () => {
      registerHook({
        name: 'universal',
        event: 'PostToolUse',
        handler: () => ({ continue: true, message: 'ran' })
      });

      const result = await routeHook('PostToolUse', { toolName: 'anything' });
      expect(result.message).toBe('ran');
    });

    it('matches case-insensitively for string matchers', async () => {
      registerHook({
        name: 'editMatcher',
        event: 'PostToolUse',
        matcher: 'edit',
        handler: () => ({ continue: true, message: 'matched' })
      });

      const result = await routeHook('PostToolUse', { toolName: 'EDIT' });
      expect(result.message).toBe('matched');
    });

    it('supports regex patterns for flexible matching', async () => {
      registerHook({
        name: 'fileOps',
        event: 'PostToolUse',
        matcher: /^(read|write|edit)$/i,
        handler: () => ({ continue: true, message: 'file op' })
      });

      const readResult = await routeHook('PostToolUse', { toolName: 'read' });
      expect(readResult.message).toBe('file op');

      const writeResult = await routeHook('PostToolUse', { toolName: 'write' });
      expect(writeResult.message).toBe('file op');

      const bashResult = await routeHook('PostToolUse', { toolName: 'bash' });
      expect(bashResult.message).toBeUndefined();
    });

    it('runs hook when toolName is undefined and no matcher', async () => {
      registerHook({
        name: 'noMatcher',
        event: 'PostToolUse',
        handler: () => ({ continue: true, message: 'ran' })
      });

      const result = await routeHook('PostToolUse', {});
      expect(result.message).toBe('ran');
    });
  });

  describe('Timeout Handling', () => {
    it('handles hook timeout gracefully', async () => {
      registerHook({
        name: 'slow',
        event: 'UserPromptSubmit',
        handler: async () => {
          await new Promise(r => setTimeout(r, 200)); // Exceeds 100ms timeout
          return { continue: true, message: 'slow' };
        }
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await routeHook('UserPromptSubmit', {});

      // Hook timed out, no message
      expect(result.message).toBeUndefined();
      expect(result.continue).toBe(true); // Default continue state

      // Should log timeout error
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('timed out after 100ms')
      );

      consoleSpy.mockRestore();
    });

    it('continues to next hook after timeout', async () => {
      registerHook({
        name: 'slow',
        event: 'UserPromptSubmit',
        priority: 10,
        handler: async () => {
          await new Promise(r => setTimeout(r, 200));
          return { continue: true, message: 'slow' };
        }
      });

      registerHook({
        name: 'fast',
        event: 'UserPromptSubmit',
        priority: 20,
        handler: () => ({ continue: true, message: 'fast' })
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await routeHook('UserPromptSubmit', {});

      expect(result.message).toBe('fast');

      consoleSpy.mockRestore();
    });

    it('respects custom timeout from config', async () => {
      // This test verifies that timeouts work with different values
      // Since the mock is set globally to 100ms, we test that a hook
      // timing out respects that configured value
      registerHook({
        name: 'slowHook',
        event: 'UserPromptSubmit',
        handler: async () => {
          await new Promise(r => setTimeout(r, 150)); // Exceeds 100ms default timeout
          return { continue: true, message: 'done' };
        }
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await routeHook('UserPromptSubmit', {});

      // Hook should timeout with the configured 100ms timeout
      expect(result.message).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      const errorCall = consoleSpy.mock.calls[0][0] as string;
      expect(errorCall).toContain('slowHook');
      expect(errorCall).toContain('timed out');
      expect(errorCall).toMatch(/\d+ms/); // Contains timeout value

      consoleSpy.mockRestore();
    });
  });

  describe('Error Isolation', () => {
    it('continues to next hook when one throws', async () => {
      registerHook({
        name: 'failing',
        event: 'UserPromptSubmit',
        priority: 10,
        handler: () => {
          throw new Error('intentional fail');
        }
      });

      registerHook({
        name: 'working',
        event: 'UserPromptSubmit',
        priority: 20,
        handler: () => ({ continue: true, message: 'works' })
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await routeHook('UserPromptSubmit', {});

      expect(result.message).toBe('works');
      expect(result.continue).toBe(true);

      // Should log the error
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[hook-router] failing error:'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('handles async errors', async () => {
      registerHook({
        name: 'asyncFailing',
        event: 'UserPromptSubmit',
        handler: async () => {
          throw new Error('async fail');
        }
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await routeHook('UserPromptSubmit', {});

      expect(result.continue).toBe(true);
      expect(result.message).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('isolates errors to individual hooks', async () => {
      const calls: string[] = [];

      registerHook({
        name: 'first',
        event: 'UserPromptSubmit',
        priority: 10,
        handler: () => {
          calls.push('first');
          return { continue: true };
        }
      });

      registerHook({
        name: 'failing',
        event: 'UserPromptSubmit',
        priority: 20,
        handler: () => {
          calls.push('failing');
          throw new Error('fail');
        }
      });

      registerHook({
        name: 'third',
        event: 'UserPromptSubmit',
        priority: 30,
        handler: () => {
          calls.push('third');
          return { continue: true };
        }
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await routeHook('UserPromptSubmit', {});

      expect(calls).toEqual(['first', 'failing', 'third']);

      consoleSpy.mockRestore();
    });
  });

  describe('Priority Ordering', () => {
    it('executes hooks in priority order', async () => {
      const order: number[] = [];

      registerHook({
        name: 'second',
        event: 'UserPromptSubmit',
        priority: 20,
        handler: () => {
          order.push(2);
          return { continue: true };
        }
      });

      registerHook({
        name: 'first',
        event: 'UserPromptSubmit',
        priority: 10,
        handler: () => {
          order.push(1);
          return { continue: true };
        }
      });

      registerHook({
        name: 'third',
        event: 'UserPromptSubmit',
        priority: 30,
        handler: () => {
          order.push(3);
          return { continue: true };
        }
      });

      await routeHook('UserPromptSubmit', {});

      expect(order).toEqual([1, 2, 3]);
    });

    it('uses default priority of 100 when not specified', async () => {
      const order: string[] = [];

      registerHook({
        name: 'highPriority',
        event: 'UserPromptSubmit',
        priority: 50,
        handler: () => {
          order.push('high');
          return { continue: true };
        }
      });

      registerHook({
        name: 'defaultPriority',
        event: 'UserPromptSubmit',
        handler: () => {
          order.push('default');
          return { continue: true };
        }
      });

      registerHook({
        name: 'lowPriority',
        event: 'UserPromptSubmit',
        priority: 150,
        handler: () => {
          order.push('low');
          return { continue: true };
        }
      });

      await routeHook('UserPromptSubmit', {});

      expect(order).toEqual(['high', 'default', 'low']);
    });

    it('maintains registration order for same priority', async () => {
      const order: string[] = [];

      registerHook({
        name: 'first',
        event: 'UserPromptSubmit',
        priority: 50,
        handler: () => {
          order.push('first');
          return { continue: true };
        }
      });

      registerHook({
        name: 'second',
        event: 'UserPromptSubmit',
        priority: 50,
        handler: () => {
          order.push('second');
          return { continue: true };
        }
      });

      await routeHook('UserPromptSubmit', {});

      expect(order).toEqual(['first', 'second']);
    });
  });

  describe('Input/Message Modification', () => {
    it('passes modified input to subsequent hooks', async () => {
      registerHook({
        name: 'modifier',
        event: 'PreToolUse',
        priority: 10,
        handler: (ctx) => ({
          continue: true,
          modifiedInput: { ...(ctx.toolInput as object), modified: true }
        })
      });

      registerHook({
        name: 'reader',
        event: 'PreToolUse',
        priority: 20,
        handler: (ctx) => ({
          continue: true,
          message: (ctx.toolInput as { modified?: boolean })?.modified
            ? 'saw modified'
            : 'not modified'
        })
      });

      const result = await routeHook('PreToolUse', { toolInput: { original: true } });
      expect(result.message).toBe('saw modified');
    });

    it('chains multiple input modifications', async () => {
      registerHook({
        name: 'modifier1',
        event: 'PreToolUse',
        priority: 10,
        handler: (ctx) => ({
          continue: true,
          modifiedInput: { ...(ctx.toolInput as object), step1: true }
        })
      });

      registerHook({
        name: 'modifier2',
        event: 'PreToolUse',
        priority: 20,
        handler: (ctx) => ({
          continue: true,
          modifiedInput: { ...(ctx.toolInput as object), step2: true }
        })
      });

      const result = await routeHook('PreToolUse', { toolInput: { original: true } });

      expect(result.modifiedInput).toEqual({
        original: true,
        step1: true,
        step2: true
      });
    });

    it('returns modifiedInput only if changed', async () => {
      registerHook({
        name: 'noModification',
        event: 'PreToolUse',
        handler: () => ({ continue: true })
      });

      const result = await routeHook('PreToolUse', { toolInput: { original: true } });

      expect(result.modifiedInput).toBeUndefined();
    });

    it('handles PostToolUseFailure with error context', async () => {
      registerHook({
        name: 'errorHandler',
        event: 'PostToolUseFailure',
        handler: (ctx) => ({
          continue: true,
          message: ctx.error ? `Error handled: ${JSON.stringify(ctx.error)}` : undefined
        })
      });

      const result = await routeHook('PostToolUseFailure', {
        toolName: 'edit',
        error: { message: 'test error' }
      });

      expect(result.continue).toBe(true);
      expect(result.message).toContain('Error handled');
    });
  });

  describe('Context Propagation', () => {
    it('passes full context to hook handlers', async () => {
      let receivedContext: HookContext | null = null;

      registerHook({
        name: 'contextCapture',
        event: 'UserPromptSubmit',
        handler: (ctx) => {
          receivedContext = ctx;
          return { continue: true };
        }
      });

      const inputContext: HookContext = {
        sessionId: 'test-session',
        directory: '/test/dir',
        prompt: 'test prompt',
        message: { content: 'test', model: { modelId: 'test-model', providerId: 'test' } }
      };

      await routeHook('UserPromptSubmit', inputContext);

      expect(receivedContext).toMatchObject(inputContext);
    });

    it('provides toolName and toolInput for tool hooks', async () => {
      let receivedContext: HookContext | null = null;

      registerHook({
        name: 'toolContext',
        event: 'PreToolUse',
        handler: (ctx) => {
          receivedContext = ctx;
          return { continue: true };
        }
      });

      await routeHook('PreToolUse', {
        toolName: 'edit',
        toolInput: { file: 'test.ts', content: 'new content' }
      });

      expect(receivedContext).toMatchObject({
        toolName: 'edit',
        toolInput: { file: 'test.ts', content: 'new content' }
      });
    });

    it('provides toolOutput for PostToolUse hooks', async () => {
      let receivedContext: HookContext | null = null;

      registerHook({
        name: 'outputCapture',
        event: 'PostToolUse',
        handler: (ctx) => {
          receivedContext = ctx;
          return { continue: true };
        }
      });

      await routeHook('PostToolUse', {
        toolName: 'read',
        toolOutput: { content: 'file contents' }
      });

      expect((receivedContext as unknown as HookContext)?.toolOutput).toEqual({ content: 'file contents' });
    });
  });

  describe('Hook Configuration', () => {
    it('skips disabled hooks via global config', async () => {
      const { loadConfig } = await import('../../config/loader.js');
      vi.mocked(loadConfig).mockReturnValue({
        hooks: {
          enabled: false,
          hookTimeoutMs: 100
        }
      } as any);

      const handler = vi.fn().mockReturnValue({ continue: true });

      registerHook({
        name: 'test',
        event: 'UserPromptSubmit',
        handler
      });

      await routeHook('UserPromptSubmit', {});

      expect(handler).not.toHaveBeenCalled();
    });

    it('skips specifically disabled hooks', async () => {
      const { loadConfig } = await import('../../config/loader.js');
      vi.mocked(loadConfig).mockReturnValue({
        hooks: {
          enabled: true,
          hookTimeoutMs: 100,
          disabledHook: {
            enabled: false
          }
        }
      } as any);

      const disabledHandler = vi.fn().mockReturnValue({ continue: true });
      const enabledHandler = vi.fn().mockReturnValue({ continue: true });

      registerHook({
        name: 'disabledHook',
        event: 'UserPromptSubmit',
        handler: disabledHandler
      });

      registerHook({
        name: 'enabledHook',
        event: 'UserPromptSubmit',
        handler: enabledHandler
      });

      await routeHook('UserPromptSubmit', {});

      expect(disabledHandler).not.toHaveBeenCalled();
      expect(enabledHandler).toHaveBeenCalled();
    });

    it('runs hooks enabled by default when not in config', async () => {
      const { loadConfig } = await import('../../config/loader.js');
      vi.mocked(loadConfig).mockReturnValue({
        hooks: {
          enabled: true,
          hookTimeoutMs: 100
        }
      } as any);

      const handler = vi.fn().mockReturnValue({ continue: true });

      registerHook({
        name: 'notInConfig',
        event: 'UserPromptSubmit',
        handler
      });

      await routeHook('UserPromptSubmit', {});

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Async Handler Support', () => {
    it('handles async handlers', async () => {
      registerHook({
        name: 'asyncHook',
        event: 'UserPromptSubmit',
        handler: async () => {
          await new Promise(r => setTimeout(r, 10));
          return { continue: true, message: 'async result' };
        }
      });

      const result = await routeHook('UserPromptSubmit', {});

      expect(result.message).toBe('async result');
    });

    it('handles mix of sync and async handlers', async () => {
      const order: string[] = [];

      registerHook({
        name: 'sync',
        event: 'UserPromptSubmit',
        priority: 10,
        handler: () => {
          order.push('sync');
          return { continue: true };
        }
      });

      registerHook({
        name: 'async',
        event: 'UserPromptSubmit',
        priority: 20,
        handler: async () => {
          await new Promise(r => setTimeout(r, 10));
          order.push('async');
          return { continue: true };
        }
      });

      await routeHook('UserPromptSubmit', {});

      expect(order).toEqual(['sync', 'async']);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty context object', async () => {
      registerHook({
        name: 'emptyContext',
        event: 'SessionStart',
        handler: () => ({ continue: true })
      });

      const result = await routeHook('SessionStart', {});

      expect(result.continue).toBe(true);
    });

    it('handles null/undefined values in context', async () => {
      let receivedContext: HookContext | null = null;

      registerHook({
        name: 'nullContext',
        event: 'UserPromptSubmit',
        handler: (ctx) => {
          receivedContext = ctx;
          return { continue: true };
        }
      });

      await routeHook('UserPromptSubmit', {
        sessionId: undefined,
        directory: undefined,
        prompt: undefined
      });

      expect(receivedContext).toBeDefined();
      expect((receivedContext as unknown as HookContext)?.sessionId).toBeUndefined();
    });

    it('handles complex objects in toolInput', async () => {
      const complexInput = {
        nested: { deeply: { value: 42 } },
        array: [1, 2, 3],
        func: () => 'test'
      };

      registerHook({
        name: 'complexInput',
        event: 'PreToolUse',
        handler: (ctx) => {
          expect(ctx.toolInput).toEqual(complexInput);
          return { continue: true };
        }
      });

      await routeHook('PreToolUse', { toolInput: complexInput });
    });

    it('handles very long message aggregation', async () => {
      const hookCount = 10;
      for (let i = 0; i < hookCount; i++) {
        registerHook({
          name: `hook${i}`,
          event: 'UserPromptSubmit',
          handler: () => ({ continue: true, message: `message ${i}` })
        });
      }

      const result = await routeHook('UserPromptSubmit', {});

      expect(result.message?.split('---').length).toBe(hookCount);
      expect(result.message).toContain('message 0');
      expect(result.message).toContain('message 9');
    });
  });
});
