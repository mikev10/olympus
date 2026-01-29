/**
 * Persistent Mode Hook
 *
 * Unified handler for persistent work modes: ascent, ultrawork, olympus, and todo-continuation.
 * This hook intercepts Stop events and enforces work continuation based on:
 * 1. Active ascent with incomplete promise
 * 2. Active ultrawork mode with pending todos
 * 3. Active olympus mode with pending todos or missing Oracle verification
 * 4. Any pending todos (general enforcement)
 *
 * Priority order: The Ascent > Ultrawork > Olympus > Todo Continuation
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  readUltraworkState,
  incrementReinforcement,
  deactivateUltrawork,
  getUltraworkPersistenceMessage
} from '../ultrawork-state/index.js';
import {
  readAscentState,
  incrementAscentIteration,
  clearAscentState,
  detectCompletionPromise
} from '../ascent/index.js';
import {
  readVerificationState,
  startVerification,
  recordOracleFeedback,
  getOracleVerificationPrompt,
  getOracleRejectionContinuationPrompt,
  detectOracleApproval,
  detectOracleRejection,
  clearVerificationState
} from '../ascent-verifier/index.js';
import {
  readOlympusState,
  incrementReinforcement as incrementOlympusReinforcement,
  deactivateOlympus,
  getOlympusPersistenceMessage,
  recordOracleApproval as recordOlympusOracleApproval
} from '../olympus-state/index.js';
import { checkIncompleteTodos, getNextPendingTodo } from '../todo-continuation/index.js';
import { TODO_CONTINUATION_PROMPT } from '../../installer/hooks.js';

export interface PersistentModeResult {
  /** Whether to block the stop event */
  shouldBlock: boolean;
  /** Message to inject into context */
  message: string;
  /** Which mode triggered the block */
  mode: 'ascent' | 'ultrawork' | 'olympus' | 'todo-continuation' | 'none';
  /** Additional metadata */
  metadata?: {
    todoCount?: number;
    iteration?: number;
    maxIterations?: number;
    reinforcementCount?: number;
  };
}

/**
 * Check for oracle approval in session transcript
 */
function checkOracleApprovalInTranscript(sessionId: string): boolean {
  const claudeDir = join(homedir(), '.claude');
  const possiblePaths = [
    join(claudeDir, 'sessions', sessionId, 'transcript.md'),
    join(claudeDir, 'sessions', sessionId, 'messages.json'),
    join(claudeDir, 'transcripts', `${sessionId}.md`)
  ];

  for (const transcriptPath of possiblePaths) {
    if (existsSync(transcriptPath)) {
      try {
        const content = readFileSync(transcriptPath, 'utf-8');
        if (detectOracleApproval(content)) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }
  return false;
}

/**
 * Check for oracle rejection in session transcript
 */
function checkOracleRejectionInTranscript(sessionId: string): { rejected: boolean; feedback: string } {
  const claudeDir = join(homedir(), '.claude');
  const possiblePaths = [
    join(claudeDir, 'sessions', sessionId, 'transcript.md'),
    join(claudeDir, 'sessions', sessionId, 'messages.json'),
    join(claudeDir, 'transcripts', `${sessionId}.md`)
  ];

  for (const transcriptPath of possiblePaths) {
    if (existsSync(transcriptPath)) {
      try {
        const content = readFileSync(transcriptPath, 'utf-8');
        const result = detectOracleRejection(content);
        if (result.rejected) {
          return result;
        }
      } catch {
        continue;
      }
    }
  }
  return { rejected: false, feedback: '' };
}

/**
 * Check The Ascent state and determine if it should continue
 * Now includes Oracle verification for completion claims
 */
async function checkAscentLoop(
  sessionId?: string,
  directory?: string
): Promise<PersistentModeResult | null> {
  const workingDir = directory || process.cwd();
  const state = readAscentState(workingDir);

  if (!state || !state.active) {
    return null;
  }

  // Check if this is the right session
  if (state.session_id && sessionId && state.session_id !== sessionId) {
    return null;
  }

  // Check for existing verification state (oracle verification in progress)
  const verificationState = readVerificationState(workingDir);

  if (verificationState?.pending) {
    // Verification is in progress - check for oracle's response
    if (sessionId) {
      // Check for oracle approval
      if (checkOracleApprovalInTranscript(sessionId)) {
        // Oracle approved - truly complete
        clearVerificationState(workingDir);
        clearAscentState(workingDir);
        return {
          shouldBlock: false,
          message: `[ASCENT LOOP VERIFIED COMPLETE] Oracle verified task completion after ${state.iteration} iteration(s). Excellent work!`,
          mode: 'none'
        };
      }

      // Check for oracle rejection
      const rejection = checkOracleRejectionInTranscript(sessionId);
      if (rejection.rejected) {
        // Oracle rejected - continue with feedback
        recordOracleFeedback(workingDir, false, rejection.feedback);
        const updatedVerification = readVerificationState(workingDir);

        if (updatedVerification) {
          const continuationPrompt = getOracleRejectionContinuationPrompt(updatedVerification);
          return {
            shouldBlock: true,
            message: continuationPrompt,
            mode: 'ascent',
            metadata: {
              iteration: state.iteration,
              maxIterations: state.max_iterations
            }
          };
        }
      }
    }

    // Verification still pending - remind to spawn oracle
    const verificationPrompt = getOracleVerificationPrompt(verificationState);
    return {
      shouldBlock: true,
      message: verificationPrompt,
      mode: 'ascent',
      metadata: {
        iteration: state.iteration,
        maxIterations: state.max_iterations
      }
    };
  }

  // Check for completion promise in transcript
  const completed = detectCompletionPromise(sessionId || '', state.completion_promise);

  if (completed) {
    // Completion promise detected - START oracle verification instead of completing
    startVerification(workingDir, state.completion_promise, state.prompt);
    const newVerificationState = readVerificationState(workingDir);

    if (newVerificationState) {
      const verificationPrompt = getOracleVerificationPrompt(newVerificationState);
      return {
        shouldBlock: true,
        message: verificationPrompt,
        mode: 'ascent',
        metadata: {
          iteration: state.iteration,
          maxIterations: state.max_iterations
        }
      };
    }

    // Fallback if verification state couldn't be created
    clearAscentState(workingDir);
    return {
      shouldBlock: false,
      message: `[ASCENT LOOP COMPLETE] Task completed after ${state.iteration} iteration(s). Great work!`,
      mode: 'none'
    };
  }

  // Check max iterations
  if (state.iteration >= state.max_iterations) {
    clearAscentState(workingDir);
    clearVerificationState(workingDir);
    return {
      shouldBlock: false,
      message: `[ASCENT LOOP STOPPED] Max iterations (${state.max_iterations}) reached without completion promise. Consider reviewing the task requirements.`,
      mode: 'none'
    };
  }

  // Increment and continue
  const newState = incrementAscentIteration(workingDir);
  if (!newState) {
    return null;
  }

  const continuationPrompt = `<ascent-continuation>

[ASCENT LOOP - ITERATION ${newState.iteration}/${newState.max_iterations}]

Your previous attempt did not output the completion promise. The work is NOT done yet.

CRITICAL INSTRUCTIONS:
1. Review your progress and the original task
2. Check your todo list - are ALL items marked complete?
3. Continue from where you left off
4. When FULLY complete, output: <promise>${newState.completion_promise}</promise>
5. Do NOT stop until the task is truly done

${newState.prompt ? `Original task: ${newState.prompt}` : ''}

</ascent-continuation>

---

`;

  return {
    shouldBlock: true,
    message: continuationPrompt,
    mode: 'ascent',
    metadata: {
      iteration: newState.iteration,
      maxIterations: newState.max_iterations
    }
  };
}

/**
 * Check Ultrawork state and determine if it should reinforce
 */
async function checkUltrawork(
  sessionId?: string,
  directory?: string,
  hasIncompleteTodos?: boolean
): Promise<PersistentModeResult | null> {
  const state = readUltraworkState(directory);

  if (!state || !state.active) {
    return null;
  }

  // If bound to a session, only reinforce for that session
  if (state.session_id && sessionId && state.session_id !== sessionId) {
    return null;
  }

  // If no incomplete todos, ultrawork can complete
  if (!hasIncompleteTodos) {
    deactivateUltrawork(directory);
    return {
      shouldBlock: false,
      message: `[ULTRAWORK COMPLETE] All tasks finished. Ultrawork mode deactivated. Well done!`,
      mode: 'none'
    };
  }

  // Reinforce ultrawork mode
  const newState = incrementReinforcement(directory);
  if (!newState) {
    return null;
  }

  const message = getUltraworkPersistenceMessage(newState);

  return {
    shouldBlock: true,
    message,
    mode: 'ultrawork',
    metadata: {
      reinforcementCount: newState.reinforcement_count
    }
  };
}

/**
 * Check Olympus state and determine if it should reinforce
 * Similar to ultrawork but with Oracle verification requirement
 */
async function checkOlympusMode(
  sessionId?: string,
  directory?: string,
  hasIncompleteTodos?: boolean
): Promise<PersistentModeResult | null> {
  const state = readOlympusState(directory);

  if (!state || !state.active) {
    return null;
  }

  // If bound to a session, only reinforce for that session
  if (state.session_id && sessionId && state.session_id !== sessionId) {
    return null;
  }

  // If no incomplete todos AND Oracle has approved, olympus can complete
  if (!hasIncompleteTodos && state.oracle_approved) {
    deactivateOlympus(directory);
    return {
      shouldBlock: false,
      message: `[OLYMPUS COMPLETE] All tasks finished and Oracle verified. Orchestration mode deactivated. Excellent work!`,
      mode: 'none'
    };
  }

  // If no incomplete todos but Oracle hasn't approved, require verification
  if (!hasIncompleteTodos && !state.oracle_approved && state.requires_oracle_verification) {
    // Check if Oracle has approved in transcript
    if (sessionId && checkOracleApprovalInTranscript(sessionId)) {
      recordOlympusOracleApproval(directory);
      deactivateOlympus(directory);
      return {
        shouldBlock: false,
        message: `[OLYMPUS VERIFIED COMPLETE] Oracle approved. Orchestration mode deactivated. Excellent work!`,
        mode: 'none'
      };
    }

    // Oracle verification required
    return {
      shouldBlock: true,
      message: `<olympus-verification-required>

[OLYMPUS MODE - ORACLE VERIFICATION REQUIRED]

All todos appear complete, but Oracle verification is MANDATORY before completion.

You MUST spawn Oracle to verify your work:

\`\`\`
Task(subagent_type="oracle", prompt="VERIFY COMPLETION:
Original task: ${state.original_prompt}
What I implemented: [list all changes]
Tests run: [test results]
Please verify this is truly complete and production-ready.
Return: APPROVED or REJECTED with reasons.")
\`\`\`

DO NOT stop until Oracle has approved.

</olympus-verification-required>

---

`,
      mode: 'olympus',
      metadata: {
        reinforcementCount: state.reinforcement_count
      }
    };
  }

  // Reinforce olympus mode (todos remain)
  const newState = incrementOlympusReinforcement(directory);
  if (!newState) {
    return null;
  }

  const message = getOlympusPersistenceMessage(newState);

  return {
    shouldBlock: true,
    message,
    mode: 'olympus',
    metadata: {
      reinforcementCount: newState.reinforcement_count
    }
  };
}

/**
 * Check for incomplete todos (baseline enforcement)
 */
async function checkTodoContinuation(
  sessionId?: string,
  directory?: string
): Promise<PersistentModeResult | null> {
  const result = await checkIncompleteTodos(sessionId, directory);

  if (result.count === 0) {
    return null;
  }

  const nextTodo = getNextPendingTodo(result);
  const nextTaskInfo = nextTodo
    ? `\n\nNext task: "${nextTodo.content}" (${nextTodo.status})`
    : '';

  const message = `<todo-continuation>

${TODO_CONTINUATION_PROMPT}

[Status: ${result.count} of ${result.total} tasks remaining]${nextTaskInfo}

</todo-continuation>

---

`;

  return {
    shouldBlock: true,
    message,
    mode: 'todo-continuation',
    metadata: {
      todoCount: result.count
    }
  };
}

/**
 * Main persistent mode checker
 * Checks all persistent modes in priority order and returns appropriate action
 */
export async function checkPersistentModes(
  sessionId?: string,
  directory?: string
): Promise<PersistentModeResult> {
  const workingDir = directory || process.cwd();

  // First, check for incomplete todos (we need this info for ultrawork)
  const todoResult = await checkIncompleteTodos(sessionId, workingDir);
  const hasIncompleteTodos = todoResult.count > 0;

  // Priority 1: The Ascent (explicit loop mode)
  const ascentResult = await checkAscentLoop(sessionId, workingDir);
  if (ascentResult?.shouldBlock) {
    return ascentResult;
  }

  // Priority 2: Ultrawork Mode (performance mode with persistence)
  const ultraworkResult = await checkUltrawork(sessionId, workingDir, hasIncompleteTodos);
  if (ultraworkResult?.shouldBlock) {
    return ultraworkResult;
  }

  // Priority 2.5: Olympus Mode (orchestration mode with Oracle verification)
  const olympusResult = await checkOlympusMode(sessionId, workingDir, hasIncompleteTodos);
  if (olympusResult?.shouldBlock) {
    return olympusResult;
  }

  // Priority 3: Todo Continuation (baseline enforcement)
  if (hasIncompleteTodos) {
    const todoContResult = await checkTodoContinuation(sessionId, workingDir);
    if (todoContResult?.shouldBlock) {
      return todoContResult;
    }
  }

  // No blocking needed
  return {
    shouldBlock: false,
    message: '',
    mode: 'none'
  };
}

/**
 * Create hook output for Claude Code
 */
export function createHookOutput(result: PersistentModeResult): {
  continue: boolean;
  stopReason?: string;
  message?: string;
} {
  if (!result.shouldBlock) {
    // Allow stop, but optionally inject completion message
    return {
      continue: true,
      message: result.message || undefined
    };
  }

  // Block stop and inject continuation message
  return {
    continue: false,
    stopReason: result.message
  };
}
