import { HookInput, FeedbackEntry } from '../types.js';
import { loadSessionState, saveSessionState, hasPendingCompletion, clearCompletionClaim } from '../session-state.js';
import { appendFeedback } from '../storage.js';
import { detectFeedbackCategory } from './revision-detector.js';
import { randomUUID } from 'crypto';

/** Detect if this prompt indicates task success */
export async function handleSuccessDetection(input: HookInput): Promise<void> {
  const { prompt, directory, sessionId } = input;

  if (!prompt || !directory) return;

  const state = loadSessionState(directory, sessionId);

  const detected = detectFeedbackCategory(prompt);

  const isPraise = detected?.category === 'praise' && detected.confidence > 0.7;

  // Only log explicit praise — topic-change detection created ~91% noise entries
  if (isPraise) {
    const feedbackEntry: FeedbackEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      session_id: state.session_id,
      project_path: directory,
      event_type: 'success',
      original_task: state.pending_completion?.task_description,
      agent_used: state.pending_completion?.agent_used,
      user_message: prompt,
      feedback_category: 'praise',
      confidence: detected!.confidence,
    };

    appendFeedback(feedbackEntry);

    // Clear the completion claim if there was a pending completion
    if (hasPendingCompletion(state)) {
      const updatedState = clearCompletionClaim(state);
      saveSessionState(directory, updatedState);
    }
  }
}
