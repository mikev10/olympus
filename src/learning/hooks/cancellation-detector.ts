import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { HookInput, FeedbackEntry } from '../types.js';
import { loadSessionState, saveSessionState } from '../session-state.js';
import { appendFeedback } from '../storage.js';
import { randomUUID } from 'crypto';

interface StopHookInput extends HookInput {
  // Stop hooks may include additional context
  reason?: string;
}

/** Count incomplete todos from Claude's todo directory */
function countIncompleteTodos(): number {
  const todosDir = join(homedir(), '.claude', 'todos');
  if (!existsSync(todosDir)) return 0;

  let count = 0;
  try {
    const files = readdirSync(todosDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = readFileSync(join(todosDir, file), 'utf-8');
        const todos = JSON.parse(content);
        if (Array.isArray(todos)) {
          count += todos.filter(t =>
            t.status !== 'completed' && t.status !== 'cancelled'
          ).length;
        }
      } catch {
        // Skip unparseable files
      }
    }
  } catch {
    // Directory read error
  }
  return count;
}

/** Detect if this is a user-initiated cancellation */
export async function handleCancellationDetection(input: StopHookInput): Promise<void> {
  const { directory, sessionId } = input;

  if (!directory) return;

  // Load session state
  const state = loadSessionState(directory, sessionId);

  // Check for incomplete todos
  const incompleteTodos = countIncompleteTodos();

  // If there are incomplete todos and there was a pending completion,
  // this might be a user cancellation
  if (incompleteTodos > 0 && state.pending_completion) {
    const feedbackEntry: FeedbackEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      session_id: state.session_id,
      project_path: directory,
      event_type: 'cancellation',
      original_task: state.pending_completion.task_description,
      agent_used: state.pending_completion.agent_used,
      user_message: `[Stopped with ${incompleteTodos} incomplete todos]`,
      feedback_category: 'rejection',
      confidence: 0.7,  // Medium confidence - could be legitimate stop
    };

    appendFeedback(feedbackEntry);
  }

  // Clear session state on stop
  state.pending_completion = null;
  state.todo_snapshot = { total: 0, completed: 0, pending: incompleteTodos };
  saveSessionState(directory, state);
}
