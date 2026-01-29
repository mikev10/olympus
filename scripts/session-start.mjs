#!/usr/bin/env node

/**
 * Olympus Session Start Hook (Node.js)
 * Restores persistent mode states when session starts
 * Cross-platform: Windows, macOS, Linux
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Read all stdin
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// Read JSON file safely
function readJsonFile(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

// Count incomplete todos
function countIncompleteTodos(todosDir) {
  let count = 0;
  if (existsSync(todosDir)) {
    try {
      const files = readdirSync(todosDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const todos = readJsonFile(join(todosDir, file));
        if (Array.isArray(todos)) {
          count += todos.filter(t => t.status !== 'completed' && t.status !== 'cancelled').length;
        }
      }
    } catch {}
  }
  return count;
}

// Main
async function main() {
  try {
    const input = await readStdin();
    let data = {};
    try { data = JSON.parse(input); } catch {}

    const directory = data.directory || process.cwd();
    const messages = [];

    // Check for ultrawork state
    const ultraworkState = readJsonFile(join(directory, '.olympus', 'ultrawork-state.json'))
      || readJsonFile(join(homedir(), '.claude', 'ultrawork-state.json'));

    if (ultraworkState?.active) {
      messages.push(`<session-restore>

[ULTRAWORK MODE RESTORED]

You have an active ultrawork session from ${ultraworkState.started_at}.
Original task: ${ultraworkState.original_prompt}

Continue working in ultrawork mode until all tasks are complete.

</session-restore>

---
`);
    }

    // Check for ascent loop state
    const ascentState = readJsonFile(join(directory, '.olympus', 'ascent-state.json'));
    if (ascentState?.active) {
      messages.push(`<session-restore>

[ASCENT LOOP RESTORED]

You have an active ascent-loop session.
Original task: ${ascentState.prompt || 'Task in progress'}
Iteration: ${ascentState.iteration || 1}/${ascentState.max_iterations || 10}

Continue working until the task is verified complete.

</session-restore>

---
`);
    }

    // Check for incomplete todos
    const todosDir = join(homedir(), '.claude', 'todos');
    const incompleteCount = countIncompleteTodos(todosDir);

    if (incompleteCount > 0) {
      messages.push(`<session-restore>

[PENDING TASKS DETECTED]

You have ${incompleteCount} incomplete tasks from a previous session.
Please continue working on these tasks.

</session-restore>

---
`);
    }

    if (messages.length > 0) {
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: messages.join('\n')
        }
      }));
    } else {
      console.log(JSON.stringify({ continue: true }));
    }
  } catch (error) {
    console.log(JSON.stringify({ continue: true }));
  }
}

main();
