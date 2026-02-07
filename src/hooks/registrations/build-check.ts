/**
 * Build Check Hook Registration
 *
 * Async two-phase build verification:
 * Phase 1 (buildCheckTrigger): Spawns tsc --noEmit after file edits with debounce
 * Phase 2 (buildCheckInjector): Injects results on next tool completion
 *
 * FLOW:
 * 1. Trigger: File write/edit detected -> debounce -> spawn detached tsc
 * 2. Injector: On next tool completion -> inject result (soft=warning, strict=block)
 *
 * MODE:
 * - soft: Inject warning but allow continuation (default)
 * - strict: Block execution on build failure
 *
 * CONFIG:
 * .olympus/config.json:
 * {
 *   "hooks": {
 *     "buildCheck": {
 *       "enabled": true,
 *       "mode": "soft",
 *       "debounceMs": 10000
 *     }
 *   }
 * }
 */

import { registerHook } from '../registry.js';
import { BUILD_CHECK_DEFAULTS } from '../constants.js';
import type { HookContext, HookResult } from '../types.js';
import { spawn, exec, type ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

// Module-level state
let lastTriggerTime = 0;
let pendingResult: { passed: boolean; output: string; timestamp: number } | null = null;
let activeProcess: ChildProcess | null = null;

/**
 * Reset build check state (for testing)
 */
export function resetBuildCheckState(): void {
  lastTriggerTime = 0;
  pendingResult = null;
  if (activeProcess) {
    try {
      activeProcess.kill('SIGTERM');
    } catch {
      // Ignore kill errors
    }
    activeProcess = null;
  }
}

/**
 * Load build check configuration from .olympus/config.json
 */
function loadBuildCheckConfig(directory: string): {
  enabled: boolean;
  mode: 'soft' | 'strict';
  debounceMs: number;
} {
  const configPath = join(directory, '.olympus', 'config.json');

  // Start with defaults
  let config = {
    enabled: BUILD_CHECK_DEFAULTS.enabled,
    mode: BUILD_CHECK_DEFAULTS.mode,
    debounceMs: BUILD_CHECK_DEFAULTS.debounceMs,
  };

  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);

      if (parsed.hooks?.buildCheck) {
        const bc = parsed.hooks.buildCheck;
        if (typeof bc.enabled === 'boolean') {
          config.enabled = bc.enabled;
        }
        if (bc.mode === 'soft' || bc.mode === 'strict') {
          config.mode = bc.mode;
        }
        if (typeof bc.debounceMs === 'number' && bc.debounceMs > 0) {
          config.debounceMs = bc.debounceMs;
        }
      }
    }
  } catch (error) {
    // Silent failure - use defaults
    console.error('[Olympus Build Check] Failed to load config:', error);
  }

  return config;
}

/**
 * Resolve tsc executable path
 * Tries local node_modules/.bin/tsc first, then global tsc
 */
function resolveTsc(directory: string): string | null {
  // Try local first
  const localTsc = join(directory, 'node_modules', '.bin', 'tsc');
  const localTscCmd = process.platform === 'win32' ? `${localTsc}.cmd` : localTsc;

  if (existsSync(localTscCmd)) {
    return localTscCmd;
  }

  // Try global (check if tsc is in PATH)
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const result = require('child_process').execSync(`${which} tsc`, { encoding: 'utf8' });
    const tscPath = result.trim().split('\n')[0];
    if (tscPath) {
      return tscPath;
    }
  } catch {
    // tsc not found in PATH
  }

  return null;
}

/**
 * Kill active process with Windows fallback
 */
function killActiveProcess(): void {
  if (!activeProcess || !activeProcess.pid) {
    return;
  }

  const pid = activeProcess.pid;

  try {
    activeProcess.kill('SIGTERM');
  } catch (error) {
    // Windows fallback: use taskkill
    if (process.platform === 'win32') {
      try {
        exec(`taskkill /PID ${pid} /F`, (err) => {
          if (err) {
            console.error('[Olympus Build Check] Failed to kill process with taskkill:', err);
          }
        });
      } catch {
        // Silent failure
      }
    }
  }

  activeProcess = null;
}

/**
 * Phase 1: Build Check Trigger
 * Spawns tsc --noEmit after file edits with debounce
 */
export function registerBuildCheckHooks(): void {
  // Hook 1: Trigger
  registerHook({
    name: 'buildCheckTrigger',
    event: 'PostToolUse',
    priority: 65,
    matcher: /write|edit|multiedit/i,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        // Validate directory
        if (!ctx.directory) {
          return { continue: true };
        }

        // Load config
        const config = loadBuildCheckConfig(ctx.directory);
        if (!config.enabled) {
          return { continue: true };
        }

        // Check debounce
        const now = Date.now();
        if (now - lastTriggerTime < config.debounceMs) {
          return { continue: true };
        }

        // Check if tsconfig.json exists
        const tsconfigPath = join(ctx.directory, 'tsconfig.json');
        if (!existsSync(tsconfigPath)) {
          return { continue: true };
        }

        // Resolve tsc
        const tscPath = resolveTsc(ctx.directory);
        if (!tscPath) {
          return { continue: true };
        }

        // Kill previous process if still running
        killActiveProcess();

        // Spawn tsc --noEmit detached
        try {
          const child = spawn(tscPath, ['--noEmit'], {
            cwd: ctx.directory,
            detached: true,
            stdio: 'pipe',
          });

          activeProcess = child;
          lastTriggerTime = now;

          // Collect output
          let stdout = '';
          let stderr = '';

          if (child.stdout) {
            child.stdout.on('data', (data: Buffer) => {
              stdout += data.toString();
            });
          }

          if (child.stderr) {
            child.stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            });
          }

          child.on('exit', (code) => {
            const output = (stdout + stderr).trim();
            pendingResult = {
              passed: code === 0,
              output,
              timestamp: Date.now(),
            };
            activeProcess = null;
          });

          child.on('error', (error) => {
            console.error('[Olympus Build Check] tsc spawn error:', error);
            activeProcess = null;
          });
        } catch (error) {
          console.error('[Olympus Build Check] Failed to spawn tsc:', error);
        }
      } catch (error) {
        console.error('[Olympus Build Check] Error in buildCheckTrigger:', error);
      }

      return { continue: true };
    },
  });

  // Hook 2: Injector
  registerHook({
    name: 'buildCheckInjector',
    event: 'PostToolUse',
    priority: 66,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        // No result to inject
        if (!pendingResult) {
          return { continue: true };
        }

        // Load config for mode
        const config = ctx.directory ? loadBuildCheckConfig(ctx.directory) : { mode: 'soft' as const };

        // If passed, clear and continue
        if (pendingResult.passed) {
          pendingResult = null;
          return { continue: true };
        }

        // Build failed - prepare message
        const truncatedOutput = pendingResult.output.length > 500
          ? pendingResult.output.substring(0, 500) + '\n... (truncated)'
          : pendingResult.output;

        const message = config.mode === 'strict'
          ? `[BUILD CHECK FAILED - BLOCKING]\n\nTypeScript compilation failed:\n\n${truncatedOutput}\n\nFix build errors before proceeding.`
          : `[BUILD CHECK WARNING]\n\nTypeScript compilation failed:\n\n${truncatedOutput}\n\nConsider fixing these errors.`;

        // Clear result
        pendingResult = null;

        // Inject based on mode
        if (config.mode === 'strict') {
          return {
            continue: false,
            stopReason: 'Build check failed (strict mode)',
            hookSpecificOutput: {
              hookEventName: 'PostToolUse',
              additionalContext: message,
            },
          };
        } else {
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'PostToolUse',
              additionalContext: message,
            },
          };
        }
      } catch (error) {
        console.error('[Olympus Build Check] Error in buildCheckInjector:', error);
      }

      return { continue: true };
    },
  });
}
