/**
 * Olympus Hooks Entry Point
 *
 * CLI entry point for the bundled hooks.
 * Called by Claude Code via shell command.
 *
 * Usage:
 *   node olympus-hooks.mjs --event=<event-type>
 *
 * Reads JSON from stdin, outputs JSON to stdout.
 */

import { registerAllHooks } from './registrations/index.js';
import { routeHook } from './router.js';
import type { HookEvent, HookContext } from './types.js';

// Register all hooks on module load
registerAllHooks();

/**
 * Read all data from stdin with aggressive timeout
 */
async function readStdin(): Promise<string> {
  // If stdin is a TTY (interactive terminal), return empty immediately
  if (process.stdin.isTTY) {
    return '{}';
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let hasData = false;

    // Very aggressive timeout - if nothing comes in 1 second, assume empty
    const timeout = setTimeout(() => {
      process.stdin.pause();
      process.stdin.destroy();
      resolve(hasData ? Buffer.concat(chunks).toString('utf-8') : '{}');
    }, 1000);

    process.stdin.on('data', (chunk) => {
      hasData = true;
      chunks.push(chunk);
    });

    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(hasData ? Buffer.concat(chunks).toString('utf-8') : '{}');
    });

    process.stdin.on('error', () => {
      clearTimeout(timeout);
      resolve('{}');
    });

    // Force stdin to start reading
    process.stdin.resume();
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const eventArg = args.find(a => a.startsWith('--event='));

  if (!eventArg) {
    console.error('Usage: node olympus-hooks.mjs --event=<event-type>');
    process.exit(1);
  }

  const event = eventArg.split('=')[1] as HookEvent;

  // Read input from stdin
  const inputStr = await readStdin();

  let context: HookContext;
  try {
    const rawContext = JSON.parse(inputStr) as Record<string, unknown>;

    // Map Claude Code field names to our HookContext interface
    // Claude Code sends: cwd, session_id, transcript_path, hook_event_name, tool_name, tool_input, tool_response
    // We expect: directory, sessionId, toolName, toolInput, toolOutput, etc.
    context = {
      ...rawContext,
      directory: (rawContext.cwd as string) || (rawContext.directory as string),
      sessionId: (rawContext.session_id as string) || (rawContext.sessionId as string),
      toolName: (rawContext.tool_name as string) || (rawContext.toolName as string),
      toolInput: rawContext.tool_input || rawContext.toolInput,
      toolOutput: rawContext.tool_response || rawContext.toolOutput,
    } as HookContext;
  } catch {
    context = {};
  }

  // Route to appropriate hooks
  const result = await routeHook(event, context);

  // Map internal HookResult to Claude Code's expected output format
  // Claude Code expects: { continue, stopReason, hookSpecificOutput: { additionalContext } }
  // Our internal format uses: { continue, message, stopReason }
  const output: Record<string, unknown> = {
    continue: result.continue,
  };

  if (result.stopReason) {
    output.stopReason = result.stopReason;
  }

  // Map aggregated messages to hookSpecificOutput.additionalContext
  // This is the field Claude Code actually injects into the AI's context
  // Only emit hookSpecificOutput for events Claude Code supports in its schema:
  // PreToolUse, UserPromptSubmit, and PostToolUse
  if (result.message) {
    if (event === 'PreToolUse' || event === 'UserPromptSubmit' || event === 'PostToolUse') {
      output.hookSpecificOutput = {
        hookEventName: event,
        additionalContext: result.message,
      };
    } else {
      output.reason = result.message;
    }
  }

  // Output result as JSON
  console.log(JSON.stringify(output));

  // Force exit to prevent hanging (stdin may keep process alive)
  process.exit(0);
}

// Run main when executed directly
// Handle both direct execution and bundled execution on all platforms
const scriptPath = process.argv[1] || '';
const isMainModule =
  scriptPath.endsWith('entry.ts') ||
  scriptPath.endsWith('entry.js') ||
  scriptPath.endsWith('olympus-hooks.mjs') ||
  scriptPath.includes('olympus-hooks');

if (isMainModule) {
  main().catch(err => {
    console.error('[olympus-hooks] Fatal error:', err);
    process.exit(1);
  });
}

// Also export for testing
export { main };
