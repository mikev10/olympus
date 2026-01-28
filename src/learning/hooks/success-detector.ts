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

  // Only check for success if there's a pending completion
  if (!hasPendingCompletion(state)) return;

  const detected = detectFeedbackCategory(prompt);

  // Success indicators:
  // 1. Explicit praise
  // 2. New, unrelated task (topic change)
  // 3. Simple acknowledgment + moving on

  const isPraise = detected?.category === 'praise' && detected.confidence > 0.7;
  const isNewTask = isTopicChange(prompt, state.pending_completion?.task_description || '');

  if (isPraise || isNewTask) {
    const feedbackEntry: FeedbackEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      session_id: state.session_id,
      project_path: directory,
      event_type: 'success',
      original_task: state.pending_completion?.task_description,
      agent_used: state.pending_completion?.agent_used,
      user_message: prompt,
      feedback_category: isPraise ? 'praise' : 'enhancement',
      confidence: isPraise ? detected!.confidence : 0.6,
    };

    appendFeedback(feedbackEntry);

    // Clear the completion claim
    const updatedState = clearCompletionClaim(state);
    saveSessionState(directory, updatedState);
  }
}

/** Simple topic change detection using keyword overlap */
function isTopicChange(newPrompt: string, previousTask: string): boolean {
  const extractKeywords = (text: string): Set<string> => {
    return new Set(
      text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)  // Skip short words
    );
  };

  const newKeywords = extractKeywords(newPrompt);
  const oldKeywords = extractKeywords(previousTask);

  // Calculate Jaccard similarity
  const intersection = new Set([...newKeywords].filter(x => oldKeywords.has(x)));
  const union = new Set([...newKeywords, ...oldKeywords]);

  const similarity = union.size > 0 ? intersection.size / union.size : 0;

  // If similarity is low, it's likely a new topic
  return similarity < 0.2;
}
