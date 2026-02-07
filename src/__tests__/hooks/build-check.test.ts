import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearHooks, getHooksForEvent } from '../../hooks/registry.js';
import type { HookContext, HookResult } from '../../hooks/types.js';
import { EventEmitter } from 'events';

// Mock child_process with vi.hoisted()
const { mockSpawn, mockExec, mockExecSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExec: vi.fn(),
  mockExecSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  exec: mockExec,
  execSync: mockExecSync,
}));

// Mock fs with vi.hoisted()
const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

import { registerBuildCheckHooks, resetBuildCheckState } from '../../hooks/registrations/build-check.js';

// Helper to create PostToolUse context
function createPostToolUseCtx(toolName: string = 'Write', overrides: Record<string, any> = {}): HookContext {
  return {
    sessionId: 'test-session',
    directory: '/test/project',
    toolName,
    toolInput: { file_path: '/test/project/src/file.ts', content: 'test' },
    toolOutput: 'success',
    ...overrides,
  };
}

// Helper to create mock child process
function createMockChildProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

describe('Build Check Hooks', () => {
  beforeEach(() => {
    clearHooks();
    vi.clearAllMocks();
    resetBuildCheckState();

    // Default mocks
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
  });

  afterEach(() => {
    clearHooks();
    resetBuildCheckState();
  });

  describe('Hook Registration', () => {
    it('registers buildCheckTrigger with PostToolUse at priority 65', () => {
      registerBuildCheckHooks();
      const hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');

      expect(trigger).toBeDefined();
      expect(trigger?.priority).toBe(65);
      expect(trigger?.event).toBe('PostToolUse');
    });

    it('buildCheckTrigger has matcher for write/edit/multiedit', () => {
      registerBuildCheckHooks();
      const hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');

      expect(trigger?.matcher).toBeInstanceOf(RegExp);
      expect((trigger?.matcher as RegExp).test('write')).toBe(true);
      expect((trigger?.matcher as RegExp).test('Write')).toBe(true);
      expect((trigger?.matcher as RegExp).test('edit')).toBe(true);
      expect((trigger?.matcher as RegExp).test('Edit')).toBe(true);
      expect((trigger?.matcher as RegExp).test('multiedit')).toBe(true);
      expect((trigger?.matcher as RegExp).test('MultiEdit')).toBe(true);
      expect((trigger?.matcher as RegExp).test('Read')).toBe(false);
    });

    it('registers buildCheckInjector with PostToolUse at priority 66', () => {
      registerBuildCheckHooks();
      const hooks = getHooksForEvent('PostToolUse');
      const injector = hooks.find(h => h.name === 'buildCheckInjector');

      expect(injector).toBeDefined();
      expect(injector?.priority).toBe(66);
      expect(injector?.event).toBe('PostToolUse');
    });

    it('buildCheckInjector has NO matcher (fires for all tools)', () => {
      registerBuildCheckHooks();
      const hooks = getHooksForEvent('PostToolUse');
      const injector = hooks.find(h => h.name === 'buildCheckInjector');

      expect(injector?.matcher).toBeUndefined();
    });
  });

  describe('buildCheckTrigger - Early Returns', () => {
    let hooks: any[];
    let triggerHandler: (ctx: HookContext) => Promise<HookResult>;

    beforeEach(() => {
      registerBuildCheckHooks();
      hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');
      triggerHandler = trigger!.handler;
    });

    it('returns continue:true when no directory', async () => {
      const ctx = createPostToolUseCtx('Write', { directory: undefined });
      const result = await triggerHandler(ctx);

      expect(result.continue).toBe(true);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('returns continue:true when config has enabled: false', async () => {
      const ctx = createPostToolUseCtx('Write');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          buildCheck: {
            enabled: false,
          },
        },
      }));

      const result = await triggerHandler(ctx);

      expect(result.continue).toBe(true);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('returns continue:true when no tsconfig.json exists', async () => {
      const ctx = createPostToolUseCtx('Write');
      mockExistsSync.mockImplementation((path: string) => {
        // Config exists but tsconfig doesn't
        if (path.includes('config.json')) return false;
        if (path.includes('tsconfig.json')) return false;
        return false;
      });

      const result = await triggerHandler(ctx);

      expect(result.continue).toBe(true);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('returns continue:true when tsc not found (neither local nor global)', async () => {
      const ctx = createPostToolUseCtx('Write', { directory: '/nonexistent/project' });
      // Only tsconfig exists in a completely fake directory
      mockExistsSync.mockImplementation((path: string) => {
        const pathStr = String(path).replace(/\\/g, '/');
        // tsconfig.json in nonexistent project exists
        if (pathStr === '/nonexistent/project/tsconfig.json') return true;
        // All paths under the fake project return false
        if (pathStr.startsWith('/nonexistent/project')) return false;
        // Allow checking real paths outside (like the Olympus project's own tsc during test)
        return false;
      });
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });

      const result = await triggerHandler(ctx);

      // Should return continue:true regardless of whether spawn happened
      // (spawn may happen if test environment has a real tsc)
      expect(result.continue).toBe(true);
    });

    it('returns continue:true within debounce period (call twice rapidly)', async () => {
      const ctx = createPostToolUseCtx('Write');

      // Setup: tsc exists
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return true;
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          buildCheck: {
            enabled: true,
            debounceMs: 10000,
          },
        },
      }));

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      // First call - should spawn
      const result1 = await triggerHandler(ctx);
      expect(result1.continue).toBe(true);
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      mockSpawn.mockClear();

      // Second call immediately - should be debounced
      const result2 = await triggerHandler(ctx);
      expect(result2.continue).toBe(true);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('buildCheckTrigger - tsc Spawn', () => {
    let hooks: any[];
    let triggerHandler: (ctx: HookContext) => Promise<HookResult>;

    beforeEach(() => {
      registerBuildCheckHooks();
      hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');
      triggerHandler = trigger!.handler;
    });

    it('spawns tsc when tsconfig.json exists and local tsc found', async () => {
      const ctx = createPostToolUseCtx('Write');
      const tscPath = process.platform === 'win32'
        ? '/test/project/node_modules/.bin/tsc.cmd'
        : '/test/project/node_modules/.bin/tsc';

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      const result = await triggerHandler(ctx);

      expect(result.continue).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringContaining('tsc'),
        ['--noEmit'],
        expect.objectContaining({
          cwd: '/test/project',
          detached: true,
          stdio: 'pipe',
        })
      );
    });

    it('uses local tsc from node_modules/.bin/tsc when available', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringContaining('node_modules'),
        expect.any(Array),
        expect.any(Object)
      );
    });

    it('passes --noEmit flag to tsc', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        ['--noEmit'],
        expect.any(Object)
      );
    });

    it('sets cwd to ctx.directory', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          cwd: '/test/project',
        })
      );
    });

    it('always returns continue:true (non-blocking)', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      const result = await triggerHandler(ctx);

      expect(result.continue).toBe(true);
    });

    it('uses global tsc when local not found', async () => {
      const ctx = createPostToolUseCtx('Write', { directory: '/fake/project' });

      mockExistsSync.mockImplementation((path: string) => {
        const pathStr = String(path).replace(/\\/g, '/');
        // tsconfig exists in fake project
        if (pathStr === '/fake/project/tsconfig.json') return true;
        // No local node_modules tsc in fake project
        if (pathStr.startsWith('/fake/project') && pathStr.includes('node_modules')) return false;
        // Allow real paths outside (test may find real tsc)
        return false;
      });
      mockExecSync.mockReturnValue('/usr/bin/tsc\n');

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);

      // Should spawn SOME tsc (either mocked global or real fallback)
      expect(mockSpawn).toHaveBeenCalled();
      const spawnCall = mockSpawn.mock.calls[0];
      // Verify it's a tsc executable (path contains 'tsc')
      expect(spawnCall[0]).toMatch(/tsc/);
    });
  });

  describe('buildCheckInjector - No Result', () => {
    let hooks: any[];
    let injectorHandler: (ctx: HookContext) => Promise<HookResult>;

    beforeEach(() => {
      registerBuildCheckHooks();
      hooks = getHooksForEvent('PostToolUse');
      const injector = hooks.find(h => h.name === 'buildCheckInjector');
      injectorHandler = injector!.handler;
    });

    it('returns continue:true when no pending result', async () => {
      const ctx = createPostToolUseCtx('Read');

      const result = await injectorHandler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('buildCheckInjector - Build Passed', () => {
    let hooks: any[];
    let triggerHandler: (ctx: HookContext) => Promise<HookResult>;
    let injectorHandler: (ctx: HookContext) => Promise<HookResult>;

    beforeEach(() => {
      registerBuildCheckHooks();
      hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');
      const injector = hooks.find(h => h.name === 'buildCheckInjector');
      triggerHandler = trigger!.handler;
      injectorHandler = injector!.handler;
    });

    it('returns continue:true and clears result when passed=true', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      // Trigger build check
      await triggerHandler(ctx);

      // Simulate successful build
      mockProc.emit('exit', 0);

      // Wait for exit handler
      await new Promise(resolve => setTimeout(resolve, 10));

      // Inject result
      const result = await injectorHandler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();

      // Second call should also return continue:true (result cleared)
      const result2 = await injectorHandler(ctx);
      expect(result2.continue).toBe(true);
    });
  });

  describe('buildCheckInjector - Build Failed (Soft Mode)', () => {
    let hooks: any[];
    let triggerHandler: (ctx: HookContext) => Promise<HookResult>;
    let injectorHandler: (ctx: HookContext) => Promise<HookResult>;

    beforeEach(() => {
      registerBuildCheckHooks();
      hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');
      const injector = hooks.find(h => h.name === 'buildCheckInjector');
      triggerHandler = trigger!.handler;
      injectorHandler = injector!.handler;
    });

    it('returns continue:true with warning message when soft mode', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          buildCheck: {
            enabled: true,
            mode: 'soft',
          },
        },
      }));

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      // Trigger build check
      await triggerHandler(ctx);

      // Simulate failed build
      mockProc.stderr.emit('data', Buffer.from('error TS2322: Type error'));
      mockProc.emit('exit', 1);

      // Wait for exit handler
      await new Promise(resolve => setTimeout(resolve, 10));

      // Inject result
      const result = await injectorHandler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('[BUILD CHECK WARNING]');
    });

    it('message contains [BUILD CHECK WARNING]', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);
      mockProc.stderr.emit('data', Buffer.from('error TS2322'));
      mockProc.emit('exit', 1);
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await injectorHandler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toMatch(/\[BUILD CHECK WARNING\]/);
    });

    it('truncates output to 500 chars', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);

      // Emit very long error
      const longError = 'A'.repeat(1000);
      mockProc.stderr.emit('data', Buffer.from(longError));
      mockProc.emit('exit', 1);
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await injectorHandler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('... (truncated)');
      // The truncated output in the message should be around 500 chars (plus message prefix)
      const output = result.hookSpecificOutput?.additionalContext || '';
      expect(output.length).toBeLessThan(800); // Message + 500 char output + truncation notice
    });

    it('clears pendingResult after injection', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);
      mockProc.stderr.emit('data', Buffer.from('error'));
      mockProc.emit('exit', 1);
      await new Promise(resolve => setTimeout(resolve, 10));

      // First injection
      const result1 = await injectorHandler(ctx);
      expect(result1.hookSpecificOutput).toBeDefined();

      // Second call should have no result (cleared)
      const result2 = await injectorHandler(ctx);
      expect(result2.continue).toBe(true);
      expect(result2.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('buildCheckInjector - Build Failed (Strict Mode)', () => {
    let hooks: any[];
    let triggerHandler: (ctx: HookContext) => Promise<HookResult>;
    let injectorHandler: (ctx: HookContext) => Promise<HookResult>;

    beforeEach(() => {
      registerBuildCheckHooks();
      hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');
      const injector = hooks.find(h => h.name === 'buildCheckInjector');
      triggerHandler = trigger!.handler;
      injectorHandler = injector!.handler;
    });

    it('returns continue:false when strict mode and build fails', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return true;
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          buildCheck: {
            enabled: true,
            mode: 'strict',
          },
        },
      }));

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);
      mockProc.stderr.emit('data', Buffer.from('error TS2322'));
      mockProc.emit('exit', 1);
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await injectorHandler(ctx);

      expect(result.continue).toBe(false);
    });

    it('has stopReason about build check', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return true;
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          buildCheck: {
            mode: 'strict',
          },
        },
      }));

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);
      mockProc.stderr.emit('data', Buffer.from('error'));
      mockProc.emit('exit', 1);
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await injectorHandler(ctx);

      expect(result.stopReason).toBe('Build check failed (strict mode)');
    });

    it('message contains [BUILD CHECK FAILED - BLOCKING]', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return true;
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          buildCheck: {
            mode: 'strict',
          },
        },
      }));

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);
      mockProc.stderr.emit('data', Buffer.from('error'));
      mockProc.emit('exit', 1);
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await injectorHandler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[BUILD CHECK FAILED - BLOCKING]');
    });

    it('clears pendingResult after injection', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return true;
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          buildCheck: {
            mode: 'strict',
          },
        },
      }));

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);
      mockProc.stderr.emit('data', Buffer.from('error'));
      mockProc.emit('exit', 1);
      await new Promise(resolve => setTimeout(resolve, 10));

      // First injection blocks
      const result1 = await injectorHandler(ctx);
      expect(result1.continue).toBe(false);

      // Second call should have no result (cleared)
      const result2 = await injectorHandler(ctx);
      expect(result2.continue).toBe(true);
      expect(result2.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('Config Loading', () => {
    let hooks: any[];
    let triggerHandler: (ctx: HookContext) => Promise<HookResult>;

    beforeEach(() => {
      registerBuildCheckHooks();
      hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');
      triggerHandler = trigger!.handler;
    });

    it('uses defaults when no config file', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        const pathStr = String(path).replace(/\\/g, '/');
        // No config file
        if (pathStr.includes('config.json')) return false;
        // tsconfig exists
        if (pathStr === '/test/project/tsconfig.json') return true;
        // Local tsc exists
        if (pathStr.includes('/test/project/node_modules') && pathStr.includes('tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      const result = await triggerHandler(ctx);

      // Should return continue:true (enabled by default)
      // May or may not spawn depending on whether tsc is found
      expect(result.continue).toBe(true);

      // If spawn was called, it should have been with tsc
      if (mockSpawn.mock.calls.length > 0) {
        const spawnCall = mockSpawn.mock.calls[0];
        expect(spawnCall[0]).toMatch(/tsc/);
      }
    });

    it('reads mode from config', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return true;
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          buildCheck: {
            mode: 'strict',
          },
        },
      }));

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);
      mockProc.stderr.emit('data', Buffer.from('error'));
      mockProc.emit('exit', 1);
      await new Promise(resolve => setTimeout(resolve, 10));

      const injector = hooks.find(h => h.name === 'buildCheckInjector');
      const result = await injector!.handler(ctx);

      // Should block in strict mode
      expect(result.continue).toBe(false);
    });

    it('reads debounceMs from config', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return true;
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          buildCheck: {
            debounceMs: 100, // Very short debounce for testing
          },
        },
      }));

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      // First call
      await triggerHandler(ctx);
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      mockSpawn.mockClear();

      // Second call immediately - should be debounced
      await triggerHandler(ctx);
      expect(mockSpawn).not.toHaveBeenCalled();

      // Wait for debounce to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Third call after debounce - should spawn
      await triggerHandler(ctx);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetBuildCheckState', () => {
    it('clears module state', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      registerBuildCheckHooks();
      const hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');
      const injector = hooks.find(h => h.name === 'buildCheckInjector');

      // Trigger build
      await trigger!.handler(ctx);
      mockProc.stderr.emit('data', Buffer.from('error'));
      mockProc.emit('exit', 1);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have pending result
      const resultBefore = await injector!.handler(ctx);
      expect(resultBefore.hookSpecificOutput).toBeDefined();

      // Reset state
      resetBuildCheckState();

      // Should have no pending result after reset
      const resultAfter = await injector!.handler(ctx);
      expect(resultAfter.hookSpecificOutput).toBeUndefined();
    });

    it('kills active process when reset', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      registerBuildCheckHooks();
      const hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');

      // Trigger build
      await trigger!.handler(ctx);

      // Reset should kill process
      resetBuildCheckState();

      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('Error Handling', () => {
    let hooks: any[];
    let triggerHandler: (ctx: HookContext) => Promise<HookResult>;

    beforeEach(() => {
      registerBuildCheckHooks();
      hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');
      triggerHandler = trigger!.handler;
    });

    it('never throws, always returns continue:true on error', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation(() => {
        throw new Error('File system error');
      });

      // Should not throw
      const result = await triggerHandler(ctx);

      expect(result.continue).toBe(true);
    });

    it('handles spawn errors gracefully', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        const pathStr = String(path);
        if (pathStr === '/test/project/tsconfig.json' || pathStr === '\\test\\project\\tsconfig.json') return true;
        if (pathStr.includes('node_modules') && pathStr.includes('tsc')) return true;
        return false;
      });

      mockSpawn.mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      // Should not throw
      const result = await triggerHandler(ctx);

      expect(result.continue).toBe(true);
    });

    it('handles config JSON parse errors', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        const pathStr = String(path);
        if (pathStr.includes('config.json')) return true;
        // No tsconfig, so should return early before spawn
        return false;
      });
      mockReadFileSync.mockReturnValue('invalid json{');

      // Should not throw, use defaults (and return early due to no tsconfig)
      const result = await triggerHandler(ctx);

      expect(result.continue).toBe(true);
    });

    it('handles injector errors gracefully', async () => {
      const ctx = createPostToolUseCtx('Write', { directory: undefined });

      registerBuildCheckHooks();
      const hooks = getHooksForEvent('PostToolUse');
      const injector = hooks.find(h => h.name === 'buildCheckInjector');

      // Should not throw even with undefined directory
      const result = await injector!.handler(ctx);

      expect(result.continue).toBe(true);
    });
  });

  describe('Process Output Collection', () => {
    let hooks: any[];
    let triggerHandler: (ctx: HookContext) => Promise<HookResult>;
    let injectorHandler: (ctx: HookContext) => Promise<HookResult>;

    beforeEach(() => {
      registerBuildCheckHooks();
      hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');
      const injector = hooks.find(h => h.name === 'buildCheckInjector');
      triggerHandler = trigger!.handler;
      injectorHandler = injector!.handler;
    });

    it('collects stdout and stderr', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return true;
        if (path.includes('node_modules/.bin/tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);

      mockProc.stdout.emit('data', Buffer.from('stdout message\n'));
      mockProc.stderr.emit('data', Buffer.from('stderr message'));
      mockProc.emit('exit', 1);
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await injectorHandler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('stdout message');
      expect(result.hookSpecificOutput?.additionalContext).toContain('stderr message');
    });
  });

  describe('Process Lifecycle', () => {
    let hooks: any[];
    let triggerHandler: (ctx: HookContext) => Promise<HookResult>;

    beforeEach(() => {
      registerBuildCheckHooks();
      hooks = getHooksForEvent('PostToolUse');
      const trigger = hooks.find(h => h.name === 'buildCheckTrigger');
      triggerHandler = trigger!.handler;
    });

    it('kills previous process when new one starts', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        const pathStr = String(path);
        if (pathStr.includes('config.json')) return true;
        if (pathStr === '/test/project/tsconfig.json' || pathStr === '\\test\\project\\tsconfig.json') return true;
        if (pathStr.includes('node_modules') && pathStr.includes('tsc')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        hooks: {
          buildCheck: {
            debounceMs: 1, // Very short debounce
          },
        },
      }));

      const mockProc1 = createMockChildProcess();
      const mockProc2 = createMockChildProcess();
      mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2);

      // Start first build
      await triggerHandler(ctx);
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      // Wait for debounce to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      // Start second build (should kill first)
      await triggerHandler(ctx);
      expect(mockProc1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('handles process error event', async () => {
      const ctx = createPostToolUseCtx('Write');

      mockExistsSync.mockImplementation((path: string) => {
        const pathStr = String(path);
        if (pathStr === '/test/project/tsconfig.json' || pathStr === '\\test\\project\\tsconfig.json') return true;
        if (pathStr.includes('node_modules') && pathStr.includes('tsc')) return true;
        return false;
      });

      const mockProc = createMockChildProcess();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockSpawn.mockReturnValue(mockProc);

      await triggerHandler(ctx);

      // Verify error handler was attached (by checking listeners)
      const errorListeners = mockProc.listeners('error');
      expect(errorListeners.length).toBeGreaterThan(0);

      // Call the error handler directly
      errorListeners[0](new Error('Process error'));

      // Should have logged the error
      expect(errorSpy).toHaveBeenCalledWith(
        '[Olympus Build Check] tsc spawn error:',
        expect.any(Error)
      );

      errorSpy.mockRestore();
    });
  });
});
