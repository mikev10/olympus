/**
 * Gate-Discovery Bridge
 *
 * Converts gate rejection/approval events into learning discoveries.
 * Automatically records workflow gate events in the discovery system for future reference.
 */

import { captureWorkflowDiscovery } from './learning-bridge.js';
import type { WorkflowContext, WorkflowEvent } from './learning-bridge.js';
import { recordDiscovery } from '../../learning/discovery.js';
import type { AgentDiscovery } from '../../learning/types.js';

// ============================================================================
// Types
// ============================================================================

export interface GateEvent {
  gateNumber: number;       // 1-5
  artifactId: string;       // e.g., "code-gen-003"
  artifactType: string;     // e.g., "code-generation", "intent", "unit"
  action: 'approved' | 'rejected';
  reason: string;
  previouslyRejected: boolean;  // true if this artifact was rejected before
  whatChanged?: string;     // If approved after rejection, what changed
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Record a gate rejection as a learning discovery.
 * Creates a discovery with category 'workflow_gate'.
 */
export function recordGateRejection(
  event: GateEvent,
  context: WorkflowContext
): AgentDiscovery {
  // Create workflow event for the bridge
  const workflowEvent: WorkflowEvent = {
    type: 'gate_rejection',
    phase: context.phase,
    details: event.reason,
    artifactId: event.artifactId,
    agentName: 'workflow-engine',
  };

  // Get base discovery from learning bridge
  const baseDiscovery = captureWorkflowDiscovery(workflowEvent, context);

  // Override category to workflow_gate
  const discovery: Omit<AgentDiscovery, 'id' | 'timestamp' | 'verified' | 'verification_count' | 'last_useful'> = {
    session_id: baseDiscovery.session_id,
    project_path: baseDiscovery.project_path,
    category: 'workflow_gate',
    summary: `Gate ${event.gateNumber} rejected ${event.artifactId}: ${event.reason}`.slice(0, 100),
    details: buildGateRejectionDetails(event, context),
    agent_name: baseDiscovery.agent_name,
    task_context: baseDiscovery.task_context,
    files_involved: baseDiscovery.files_involved,
    confidence: baseDiscovery.confidence,
    scope: 'project',
  };

  // Persist via recordDiscovery
  return recordDiscovery(discovery);
}

/**
 * Record a gate approval after previous rejection as a "lesson learned" discovery.
 */
export function recordGateApprovalAfterRejection(
  event: GateEvent,
  context: WorkflowContext
): AgentDiscovery {
  // Create workflow event for the bridge
  const workflowEvent: WorkflowEvent = {
    type: 'gate_approval',
    phase: context.phase,
    details: event.whatChanged ?? 'Revised after rejection',
    artifactId: event.artifactId,
    agentName: 'workflow-engine',
  };

  // Get base discovery from learning bridge
  const baseDiscovery = captureWorkflowDiscovery(workflowEvent, context);

  // Override category to workflow_gate
  const discovery: Omit<AgentDiscovery, 'id' | 'timestamp' | 'verified' | 'verification_count' | 'last_useful'> = {
    session_id: baseDiscovery.session_id,
    project_path: baseDiscovery.project_path,
    category: 'workflow_gate',
    summary: `Gate ${event.gateNumber} approved ${event.artifactId} after revision: ${event.whatChanged ?? 'changes applied'}`.slice(0, 100),
    details: buildGateApprovalDetails(event, context),
    agent_name: baseDiscovery.agent_name,
    task_context: baseDiscovery.task_context,
    files_involved: baseDiscovery.files_involved,
    confidence: baseDiscovery.confidence,
    scope: 'project',
  };

  // Persist via recordDiscovery
  return recordDiscovery(discovery);
}

/**
 * Process a gate event - dispatches to the appropriate handler.
 * Returns the created discovery, or null if no discovery is needed
 * (e.g., first-time approval without prior rejection).
 */
export function processGateEvent(
  event: GateEvent,
  context: WorkflowContext
): AgentDiscovery | null {
  if (event.action === 'rejected') {
    return recordGateRejection(event, context);
  }

  if (event.action === 'approved' && event.previouslyRejected) {
    return recordGateApprovalAfterRejection(event, context);
  }

  // First-time approval: no discovery needed
  return null;
}

/**
 * Query past gate rejections for similar artifacts.
 * Useful when dispatching a BOLT to check if similar BOLTs were rejected before.
 */
export function queryPreviousGateRejections(
  discoveries: AgentDiscovery[],
  artifactType: string,
  gateNumber: number
): AgentDiscovery[] {
  // Filter by workflow_gate category
  const gateDiscoveries = discoveries.filter(d => d.category === 'workflow_gate');

  // Filter by artifact type and gate number in details
  const matches = gateDiscoveries.filter(d => {
    const detailsMatch = d.details.includes(`Artifact Type: ${artifactType}`) &&
                        d.details.includes(`Gate Number: ${gateNumber}`);
    return detailsMatch;
  });

  // Sort by timestamp descending (most recent first)
  return matches.sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeB - timeA;
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildGateRejectionDetails(event: GateEvent, context: WorkflowContext): string {
  const lines = [
    `Gate Number: ${event.gateNumber}`,
    `Artifact ID: ${event.artifactId}`,
    `Artifact Type: ${event.artifactType}`,
    `Action: Rejected`,
    `Reason: ${event.reason}`,
    `Workflow: ${context.workflowId} (${context.featureName})`,
    `Phase: ${context.phase}`,
  ];

  if (context.riskTier) {
    lines.push(`Risk Tier: ${context.riskTier.tier}`);
  }
  if (context.depthScore !== undefined) {
    lines.push(`Depth Score: ${context.depthScore}`);
  }

  return lines.join('\n');
}

function buildGateApprovalDetails(event: GateEvent, context: WorkflowContext): string {
  const lines = [
    `Gate Number: ${event.gateNumber}`,
    `Artifact ID: ${event.artifactId}`,
    `Artifact Type: ${event.artifactType}`,
    `Action: Approved (after rejection)`,
    `What Changed: ${event.whatChanged ?? 'Not specified'}`,
    `Original Rejection Reason: ${event.reason}`,
    `Workflow: ${context.workflowId} (${context.featureName})`,
    `Phase: ${context.phase}`,
  ];

  if (context.riskTier) {
    lines.push(`Risk Tier: ${context.riskTier.tier}`);
  }
  if (context.depthScore !== undefined) {
    lines.push(`Depth Score: ${context.depthScore}`);
  }

  return lines.join('\n');
}
