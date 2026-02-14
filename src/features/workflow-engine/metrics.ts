/**
 * Methodology Metrics
 *
 * Tracks timing, quality, and methodology metrics for ODLC workflows.
 * Records phase durations, validation rates, gate statistics, and rework counts.
 */

import type {
  WorkflowPhase,
  ManifestSchema,
  MethodologyMetrics,
  PhaseState,
} from './phase-types.js';
import type { WorkflowEvent, WorkflowContext } from './learning-bridge.js';
import { captureWorkflowDiscovery } from './learning-bridge.js';
import type { AgentDiscovery } from '../../learning/types.js';

// ============================================================================
// Phase Timing
// ============================================================================

/**
 * Record phase start time in phase state.
 * Returns updated phase state.
 */
export function recordPhaseStart(phaseState: PhaseState): PhaseState {
  return {
    ...phaseState,
    status: 'in_progress',
    started_at: phaseState.started_at ?? new Date().toISOString(),
  };
}

/**
 * Record phase completion time in phase state.
 * Returns updated phase state.
 */
export function recordPhaseComplete(phaseState: PhaseState): PhaseState {
  return {
    ...phaseState,
    status: 'complete',
    completed_at: new Date().toISOString(),
  };
}

// ============================================================================
// Metrics Computation
// ============================================================================

/**
 * Compute methodology metrics from manifest data.
 */
export function computeMetrics(manifest: ManifestSchema): MethodologyMetrics {
  const inceptionDuration = computePhaseDuration(manifest.phases.inception);
  const constructionDuration = computePhaseDuration(manifest.phases.construction);
  const operationsDuration = computePhaseDuration(manifest.phases.operations);

  const totalArtifacts = manifest.artifacts.length;

  // Compute validation pass rate
  const validatedArtifacts = manifest.artifacts.filter(a => a.validation_passed !== null);
  const passedArtifacts = manifest.artifacts.filter(a => a.validation_passed === true);
  const validationPassRate = validatedArtifacts.length > 0
    ? passedArtifacts.length / validatedArtifacts.length
    : 0;

  // Count gate bypasses
  const gateBypasses = manifest.gate_audit.filter(g => g.action === 'bypassed').length;

  // Count rework (gate rejections indicate rework)
  const reworkCount = manifest.gate_audit.filter(g => g.action === 'rejected').length;

  // Depth assessment accuracy: compare recommended depth vs actual outcome
  // null if no depth assessment
  const depthAccuracy = computeDepthAccuracy(manifest);

  return {
    inception_duration_ms: inceptionDuration,
    construction_duration_ms: constructionDuration,
    operations_duration_ms: operationsDuration,
    total_artifacts: totalArtifacts,
    validation_pass_rate: Math.round(validationPassRate * 100) / 100,
    gate_bypass_count: gateBypasses,
    rework_count: reworkCount,
    depth_assessment_accuracy: depthAccuracy,
  };
}

/**
 * Export metrics as discoveries for the learning system.
 * Creates summary discoveries for significant metrics.
 */
export function exportToLearningSystem(
  metrics: MethodologyMetrics,
  context: WorkflowContext,
): AgentDiscovery[] {
  const discoveries: AgentDiscovery[] = [];

  // Record phase completion times as planning insights
  if (metrics.inception_duration_ms !== null) {
    const event: WorkflowEvent = {
      type: 'phase_complete',
      phase: 'inception',
      details: `Inception phase completed in ${formatDuration(metrics.inception_duration_ms)}`,
    };
    discoveries.push(captureWorkflowDiscovery(event, context));
  }

  if (metrics.construction_duration_ms !== null) {
    const event: WorkflowEvent = {
      type: 'phase_complete',
      phase: 'construction',
      details: `Construction phase completed in ${formatDuration(metrics.construction_duration_ms)}`,
    };
    discoveries.push(captureWorkflowDiscovery(event, context));
  }

  if (metrics.operations_duration_ms !== null) {
    const event: WorkflowEvent = {
      type: 'phase_complete',
      phase: 'operations',
      details: `Operations phase completed in ${formatDuration(metrics.operations_duration_ms)}`,
    };
    discoveries.push(captureWorkflowDiscovery(event, context));
  }

  // Record high rework count as a gotcha
  if (metrics.rework_count > 2) {
    const event: WorkflowEvent = {
      type: 'rework_required',
      phase: context.phase,
      details: `High rework count: ${metrics.rework_count} rejections. Consider more thorough upfront analysis.`,
    };
    discoveries.push(captureWorkflowDiscovery(event, context));
  }

  // Record low validation pass rate as an insight
  if (metrics.validation_pass_rate < 0.8 && metrics.total_artifacts > 0) {
    const event: WorkflowEvent = {
      type: 'build_failure',
      phase: context.phase,
      details: `Low validation pass rate: ${(metrics.validation_pass_rate * 100).toFixed(0)}%. Review artifact quality.`,
    };
    discoveries.push(captureWorkflowDiscovery(event, context));
  }

  return discoveries;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compute duration in milliseconds from phase state timestamps.
 */
export function computePhaseDuration(phaseState: PhaseState): number | null {
  if (!phaseState.started_at || !phaseState.completed_at) {
    return null;
  }

  const start = new Date(phaseState.started_at).getTime();
  const end = new Date(phaseState.completed_at).getTime();

  if (isNaN(start) || isNaN(end)) {
    return null;
  }

  return Math.max(0, end - start);
}

/**
 * Compute depth assessment accuracy.
 * Compares recommended depth against actual rework/rejection counts.
 * Returns null if no depth assessment available.
 */
function computeDepthAccuracy(manifest: ManifestSchema): number | null {
  if (!manifest.depth_assessment) return null;

  const recommended = manifest.depth_assessment.recommended_depth;
  const reworkCount = manifest.gate_audit.filter(g => g.action === 'rejected').length;
  const totalGates = manifest.gate_audit.length;

  if (totalGates === 0) return null;

  // If minimal was recommended and no rework occurred, accuracy is high
  // If comprehensive was recommended but lots of rework, accuracy is low
  const reworkRate = reworkCount / totalGates;

  switch (recommended) {
    case 'minimal':
      // Minimal depth: accurate if rework rate < 10%
      return reworkRate <= 0.1 ? 1.0 : Math.max(0, 1 - reworkRate);
    case 'standard':
      // Standard depth: accurate if rework rate < 20%
      return reworkRate <= 0.2 ? 1.0 : Math.max(0, 1 - reworkRate * 0.8);
    case 'comprehensive':
      // Comprehensive: accurate if rework rate < 30% (more overhead accepted)
      return reworkRate <= 0.3 ? 1.0 : Math.max(0, 1 - reworkRate * 0.6);
    default:
      return null;
  }
}

/**
 * Format a duration in milliseconds to human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
