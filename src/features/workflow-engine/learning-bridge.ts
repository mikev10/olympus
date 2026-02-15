/**
 * Workflow-Learning Bridge
 *
 * Integration between the ODLC workflow engine and the learning system.
 * Maps workflow events to existing discovery categories for capture and query.
 * Feeds agent performance data into the agent evaluator.
 */

import { randomUUID } from 'crypto';
import type { DiscoveryCategory, AgentDiscovery, FeedbackEntry } from '../../learning/types.js';
import type {
  WorkflowPhase,
  TrustLevel,
  TrustLevelChange,
  RiskTierClassification,
  ManifestSchema,
} from './phase-types.js';

// ============================================================================
// Types
// ============================================================================

export type WorkflowEventType =
  | 'gate_rejection'
  | 'gate_approval'
  | 'build_failure'
  | 'rework_required'
  | 'contract_violation'
  | 'trust_level_change'
  | 'phase_complete'
  | 'depth_override'
  | 'bolt_execution_complete'
  | 'gate_approval_after_rejection'
  | 'depth_assessment_complete'
  | 'execution_mode_selected'
  | 'retro_completed';

export interface WorkflowEvent {
  type: WorkflowEventType;
  phase: WorkflowPhase;
  stage?: string;
  details: string;
  artifactId?: string;
  agentName?: string;
  timestamp?: string;
}

export interface WorkflowContext {
  workflowId: string;
  featureName: string;
  projectPath: string;
  sessionId: string;
  phase: WorkflowPhase;
  riskTier?: RiskTierClassification | null;
  depthScore?: number;
}

export interface MethodologyPreference {
  key: string;
  value: string;
  count: number;
  lastSeen: string;
}

// ============================================================================
// Event → Discovery Category Mapping
// ============================================================================

const EVENT_CATEGORY_MAP: Record<WorkflowEventType, DiscoveryCategory> = {
  gate_rejection: 'gotcha',
  gate_approval: 'pattern',
  build_failure: 'technical_insight',
  rework_required: 'gotcha',
  contract_violation: 'gotcha',
  trust_level_change: 'planning_insight',
  phase_complete: 'pattern',
  depth_override: 'planning_insight',
  bolt_execution_complete: 'workflow_gate',
  gate_approval_after_rejection: 'workflow_gate',
  depth_assessment_complete: 'planning_insight',
  execution_mode_selected: 'planning_insight',
  retro_completed: 'retro_insight',
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Capture a workflow event as a discovery in the learning system.
 * Maps workflow events to existing DiscoveryCategory values.
 */
export function captureWorkflowDiscovery(
  event: WorkflowEvent,
  context: WorkflowContext,
): AgentDiscovery {
  const category = EVENT_CATEGORY_MAP[event.type];
  const timestamp = event.timestamp ?? new Date().toISOString();

  // Determine confidence based on event type
  const confidence = getEventConfidence(event.type);

  // Build summary (max 100 chars)
  const summary = buildEventSummary(event).slice(0, 100);

  // Build detailed description
  const details = buildEventDetails(event, context);

  const discovery: AgentDiscovery = {
    id: randomUUID(),
    timestamp,
    session_id: context.sessionId,
    project_path: context.projectPath,
    category,
    summary,
    details,
    agent_name: event.agentName ?? 'workflow-engine',
    task_context: `${context.featureName} (${event.phase}${event.stage ? '/' + event.stage : ''})`,
    files_involved: event.artifactId ? [`${event.artifactId}`] : [],
    confidence,
    verified: event.type === 'gate_approval' || event.type === 'phase_complete' || event.type === 'bolt_execution_complete',
    verification_count: 0,
    scope: 'project',
    last_useful: timestamp,
  };

  return discovery;
}

/**
 * Query past discoveries relevant to current workflow context.
 * Filters by feature type, depth, risk tier, and phase.
 */
export function queryRelevantDiscoveries(
  discoveries: AgentDiscovery[],
  context: WorkflowContext,
): AgentDiscovery[] {
  const relevant: AgentDiscovery[] = [];

  for (const discovery of discoveries) {
    let score = 0;

    // Same project gets highest relevance
    if (discovery.project_path === context.projectPath) {
      score += 3;
    }

    // Same phase context
    if (discovery.task_context?.includes(context.phase)) {
      score += 2;
    }

    // Workflow-related categories
    if (['gotcha', 'pattern', 'planning_insight', 'technical_insight'].includes(discovery.category)) {
      score += 1;
    }

    // Higher confidence and verified discoveries are more relevant
    if (discovery.verified) {
      score += 1;
    }

    if (score >= 2) {
      relevant.push(discovery);
    }
  }

  // Sort by relevance (most recent first for ties)
  return relevant.sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeB - timeA;
  });
}

/**
 * Report agent performance for a workflow stage.
 * Creates a FeedbackEntry compatible with the existing agent-evaluator.
 */
export function reportAgentPerformance(
  stage: string,
  agent: string,
  result: { passed: boolean; issues?: string[] },
  sessionId: string,
  projectPath: string,
): FeedbackEntry {
  const entry: FeedbackEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    project_path: projectPath,
    event_type: result.passed ? 'success' : 'revision',
    agent_used: agent,
    user_message: result.passed
      ? `Successfully completed ${stage} stage`
      : `Failed ${stage} stage: ${result.issues?.join(', ') ?? 'unknown issues'}`,
    feedback_category: result.passed ? 'praise' : 'correction',
    confidence: result.passed ? 0.9 : 0.85,
  };

  return entry;
}

/**
 * Track methodology preferences from workflow events.
 * Tracks depth preferences, gate bypass patterns, preferred agents, trust patterns.
 */
export function trackMethodologyPreferences(
  event: WorkflowEvent,
  existingPreferences: MethodologyPreference[],
): MethodologyPreference[] {
  const updated = [...existingPreferences];
  const now = new Date().toISOString();

  let key: string;
  let value: string;

  switch (event.type) {
    case 'depth_override':
      key = 'depth_preference';
      value = event.details;
      break;
    case 'gate_approval':
      key = `gate_pattern:${event.phase}`;
      value = 'approved';
      break;
    case 'gate_rejection':
      key = `gate_pattern:${event.phase}`;
      value = 'rejected';
      break;
    case 'phase_complete':
      key = `phase_duration:${event.phase}`;
      value = event.details;
      break;
    case 'bolt_execution_complete':
      key = `bolt_completion:${event.phase}`;
      value = event.details;
      break;
    case 'gate_approval_after_rejection':
      key = `gate_revision_success:${event.phase}`;
      value = event.stage ?? 'unknown';
      break;
    case 'depth_assessment_complete':
      key = 'depth_assessment';
      value = event.details;
      break;
    case 'execution_mode_selected':
      key = 'execution_mode';
      value = event.details;
      break;
    default:
      key = `event:${event.type}`;
      value = event.details;
  }

  const existing = updated.find(p => p.key === key && p.value === value);
  if (existing) {
    existing.count++;
    existing.lastSeen = now;
  } else {
    updated.push({ key, value, count: 1, lastSeen: now });
  }

  return updated;
}

/**
 * Record a trust level change as a discovery.
 */
export function recordTrustLevelChange(
  change: TrustLevelChange,
  context: WorkflowContext,
): AgentDiscovery {
  const event: WorkflowEvent = {
    type: 'trust_level_change',
    phase: context.phase,
    details: `Trust level changed from ${change.from} to ${change.to}: ${change.reason}`,
    timestamp: change.timestamp,
  };

  return captureWorkflowDiscovery(event, context);
}

// ============================================================================
// Helper Functions
// ============================================================================

function getEventConfidence(eventType: WorkflowEventType): number {
  switch (eventType) {
    case 'gate_approval':
    case 'phase_complete':
      return 0.9;
    case 'gate_rejection':
    case 'contract_violation':
      return 0.85;
    case 'build_failure':
    case 'rework_required':
      return 0.8;
    case 'trust_level_change':
      return 0.95;
    case 'depth_override':
      return 0.7;
    case 'bolt_execution_complete':
      return 0.85;
    case 'gate_approval_after_rejection':
      return 0.9;
    case 'depth_assessment_complete':
      return 0.8;
    case 'execution_mode_selected':
      return 0.75;
    default:
      return 0.5;
  }
}

function buildEventSummary(event: WorkflowEvent): string {
  switch (event.type) {
    case 'gate_rejection':
      return `Gate rejected at ${event.phase}${event.stage ? '/' + event.stage : ''}: ${event.details}`;
    case 'gate_approval':
      return `Gate approved at ${event.phase}${event.stage ? '/' + event.stage : ''}`;
    case 'build_failure':
      return `Build failed during ${event.phase}: ${event.details}`;
    case 'rework_required':
      return `Rework needed: ${event.details}`;
    case 'contract_violation':
      return `Contract violated: ${event.artifactId ?? 'unknown'} - ${event.details}`;
    case 'trust_level_change':
      return `Trust level change: ${event.details}`;
    case 'phase_complete':
      return `Phase ${event.phase} completed`;
    case 'depth_override':
      return `Depth assessment overridden: ${event.details}`;
    case 'bolt_execution_complete':
      return `BOLT execution complete at ${event.phase}${event.stage ? '/' + event.stage : ''}: ${event.details}`;
    case 'gate_approval_after_rejection':
      return `Gate approved after rejection at ${event.phase}${event.stage ? '/' + event.stage : ''}`;
    case 'depth_assessment_complete':
      return `Depth assessment: ${event.details}`;
    case 'execution_mode_selected':
      return `Execution mode selected: ${event.details}`;
    default:
      return `Workflow event: ${event.type}`;
  }
}

function buildEventDetails(event: WorkflowEvent, context: WorkflowContext): string {
  const lines = [
    `Event: ${event.type}`,
    `Workflow: ${context.workflowId} (${context.featureName})`,
    `Phase: ${event.phase}${event.stage ? ' / Stage: ' + event.stage : ''}`,
    `Details: ${event.details}`,
  ];

  if (event.artifactId) {
    lines.push(`Artifact: ${event.artifactId}`);
  }
  if (event.agentName) {
    lines.push(`Agent: ${event.agentName}`);
  }
  if (context.riskTier) {
    lines.push(`Risk Tier: ${context.riskTier.tier}`);
  }
  if (context.depthScore !== undefined) {
    lines.push(`Depth Score: ${context.depthScore}`);
  }

  return lines.join('\n');
}
