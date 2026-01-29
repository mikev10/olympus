import { HookInput, FeedbackCategory, FeedbackEntry } from '../types.js';
import { loadSessionState, saveSessionState, addPromptToSession, hasPendingCompletion } from '../session-state.js';
import { appendFeedback, getProjectHash } from '../storage.js';
import { randomUUID } from 'crypto';

// Pattern definitions with associated confidence scores
const REVISION_PATTERNS: Record<FeedbackCategory, Array<{ regex: RegExp; confidence: number }>> = {
  correction: [
    { regex: /no[,.]?\s*(that's|thats)?\s*(not|wrong)/i, confidence: 0.9 },
    { regex: /that's\s*(incorrect|not right|not what)/i, confidence: 0.9 },
    { regex: /you\s*(misunderstood|got it wrong)/i, confidence: 0.85 },
    { regex: /actually,?\s*(I|it|the)/i, confidence: 0.6 },
  ],
  rejection: [
    { regex: /\b(stop|cancel|abort|halt)\b/i, confidence: 0.95 },
    { regex: /don't\s*(do|want|need)\s*(that|this)/i, confidence: 0.85 },
    { regex: /never\s*mind/i, confidence: 0.9 },
    { regex: /forget\s*(it|that|about)/i, confidence: 0.8 },
  ],
  clarification: [
    { regex: /I\s*(meant|wanted|asked for)/i, confidence: 0.85 },
    { regex: /what I\s*(mean|want|need)/i, confidence: 0.8 },
    { regex: /to clarify/i, confidence: 0.9 },
    { regex: /let me\s*(rephrase|explain|be clearer)/i, confidence: 0.85 },
  ],
  explicit_preference: [
    { regex: /always\s+(use|do|include|add|prefer)/i, confidence: 0.95 },
    { regex: /never\s+(use|do|include|add)/i, confidence: 0.95 },
    { regex: /I\s*(prefer|like|want)\s*(you to)?/i, confidence: 0.7 },
    { regex: /from now on/i, confidence: 0.9 },
    { regex: /in the future,?\s*(please|always)/i, confidence: 0.85 },
  ],
  praise: [
    { regex: /\bperfect\b/i, confidence: 0.9 },
    { regex: /exactly(\s+what I (wanted|needed))?/i, confidence: 0.85 },
    { regex: /great(\s+job)?/i, confidence: 0.7 },
    { regex: /\bthanks?\b/i, confidence: 0.5 },  // Lower confidence - could be polite rejection
    { regex: /looks?\s+good/i, confidence: 0.75 },
  ],
  enhancement: [
    { regex: /also\s+(add|include|do)/i, confidence: 0.7 },
    { regex: /can you (also|additionally)/i, confidence: 0.7 },
    { regex: /one more thing/i, confidence: 0.75 },
  ],
};

/** Detect feedback category from user message */
export function detectFeedbackCategory(
  prompt: string
): { category: FeedbackCategory; confidence: number } | null {
  // Remove code blocks to prevent false positives
  const cleanPrompt = prompt
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '');

  let bestMatch: { category: FeedbackCategory; confidence: number } | null = null;

  for (const [category, patterns] of Object.entries(REVISION_PATTERNS)) {
    for (const { regex, confidence } of patterns) {
      if (regex.test(cleanPrompt)) {
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { category: category as FeedbackCategory, confidence };
        }
      }
    }
  }

  return bestMatch;
}

/** Main hook handler */
export async function handleRevisionDetection(input: HookInput): Promise<void> {
  const { prompt, directory, sessionId } = input;

  if (!prompt || !directory) return;

  // Load session state
  const state = loadSessionState(directory, sessionId);

  // Detect feedback category
  const detected = detectFeedbackCategory(prompt);

  // Update session state with this prompt
  const updatedState = addPromptToSession(state, prompt, detected?.category);

  // If feedback detected and there was a pending completion, log it
  if (detected && hasPendingCompletion(state)) {
    const feedbackEntry: FeedbackEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      session_id: state.session_id,
      project_path: directory,
      event_type: detected.category === 'explicit_preference' ? 'explicit_preference' : 'revision',
      original_task: state.pending_completion?.task_description,
      agent_used: state.pending_completion?.agent_used,
      user_message: prompt,
      feedback_category: detected.category,
      confidence: detected.confidence,
    };

    appendFeedback(feedbackEntry);
  }

  // Save updated state
  saveSessionState(directory, updatedState);
}
