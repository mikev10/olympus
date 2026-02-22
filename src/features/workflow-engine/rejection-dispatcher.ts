/**
 * Rejection Dispatcher
 *
 * Auto-re-invokes agents after gate rejection with feedback.
 * Handles agent type selection per gate, attempt counting with max retries,
 * contract status transitions, and structured re-invocation prompts.
 */

import { join } from 'path';
import type { ManifestSchema } from './phase-types.js';

export interface RejectionContext {
  gateNumber: number; // 1-5
  artifactId: string; // e.g., "BOLT-003"
  rejectionReason: string;
  rejectedBy: string; // 'human' | 'auto' | 'trust'
  attemptNumber: number; // Current attempt count
}

export interface RejectionDispatchResult {
  agentType: string;
  prompt: string;
  maxRetriesReached?: boolean;
  contractStatusUpdate?: { from: string; to: string };
}

/**
 * Returns the appropriate agent type for a given gate number.
 */
export function getAgentForGate(gateNumber: number): string {
  switch (gateNumber) {
    case 1: // IDEA rejected
      return 'prometheus';
    case 2: // INTENT rejected
      return 'prometheus';
    case 3: // UNITs rejected
      return 'construction-executor';
    case 4: // BOLT rejected
      return 'olympian';
    case 5: // Operations rejected
      return 'olympian';
    default:
      console.error(`Unknown gate number: ${gateNumber}, defaulting to olympian`);
      return 'olympian';
  }
}

/**
 * Dispatches a rejection by determining which agent to re-invoke and
 * constructing a detailed prompt with the rejection feedback.
 */
export async function dispatchRejection(
  projectPath: string,
  workflowId: string,
  context: RejectionContext,
  maxRetries: number = 5
): Promise<RejectionDispatchResult> {
  try {
    // Check if max retries reached
    const maxRetriesReached = context.attemptNumber >= maxRetries;

    // Determine agent based on gate number
    const agentType = getAgentForGate(context.gateNumber);

    // Construct prompt based on gate
    let basePrompt: string;
    switch (context.gateNumber) {
      case 1:
        basePrompt = `Revise the IDEA based on this feedback: ${context.rejectionReason}`;
        break;
      case 2:
        basePrompt = `Update the INTENT based on this feedback: ${context.rejectionReason}`;
        break;
      case 3:
        basePrompt = `Regenerate UNITs based on this feedback: ${context.rejectionReason}`;
        break;
      case 4:
        basePrompt = `Re-implement this BOLT based on this feedback: ${context.rejectionReason}`;
        break;
      case 5:
        basePrompt = `Revise operations artifacts based on this feedback: ${context.rejectionReason}`;
        break;
      default:
        basePrompt = `Address this feedback: ${context.rejectionReason}`;
    }

    // Build detailed prompt
    const prompt = maxRetriesReached
      ? `Maximum revision attempts reached for ${context.artifactId}. Consider manual intervention or scope change.`
      : `${basePrompt}

Artifact ID: ${context.artifactId}
Workflow ID: ${workflowId}
Attempt Number: ${context.attemptNumber}
Rejected By: ${context.rejectedBy}

Please revise the artifact to address the feedback above and re-submit for approval.`;

    // Contract status update: violated → draft (back to draft for revision)
    const contractStatusUpdate = {
      from: 'violated',
      to: 'draft',
    };

    return {
      agentType,
      prompt,
      maxRetriesReached,
      contractStatusUpdate,
    };
  } catch (error) {
    console.error('Error in dispatchRejection:', error);
    throw error;
  }
}
