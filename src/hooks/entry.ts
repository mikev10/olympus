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
    context = JSON.parse(inputStr);
  } catch {
    context = {};
  }

  // Route to appropriate hooks
  const result = await routeHook(event, context);

  // Output result as JSON
  console.log(JSON.stringify(result));

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
