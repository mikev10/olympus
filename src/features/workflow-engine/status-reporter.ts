/**
 * Enhanced Workflow Status Reporter
 *
 * Generates comprehensive workflow reports from manifest data including:
 * - Phase progress with status indicators
 * - Artifact tree with contract status
 * - Trust level and risk tier display
 * - Alignment check summary
 * - Risk and gate audit summary
 */

import type {
  ManifestSchema,
  ManifestArtifact,
  WorkflowPhase,
  TrustState,
  RiskTierClassification,
  DepthAssessment,
  AlignmentCheck,
  GateAuditEntry,
  RiskEntry,
  WorkflowCheckpointV3,
  InceptionStage,
  InceptionStageState,
} from './phase-types.js';

export interface WorkflowReport {
  summary: string;
  phaseProgress: PhaseProgressEntry[];
  artifactTree: string;
  riskSummary: string;
  gateSummary: string;
  trustDisplay: string;
  alignmentSummary: string;
  fullReport: string;
}

export interface PhaseProgressEntry {
  phase: WorkflowPhase;
  percentage: number;
  status: string;
  artifactCount: number;
}

const PHASE_ORDER: WorkflowPhase[] = ['discovery', 'inception', 'construction', 'operations'];

const CONTRACT_STATUS_ICONS: Record<string, string> = {
  draft: 'o',       // ○ draft
  active: '+',      // ✓ active
  fulfilled: '++',  // ✓✓ fulfilled
  violated: 'X',    // ✗ violated
  stale: '!',       // ⚠ stale
};

const TRUST_LEVEL_NAMES: Record<number, string> = {
  0: 'Baseline',
  1: 'Earned',
  2: 'Extended',
  3: 'Trusted',
};

/**
 * Generate a comprehensive workflow report from manifest data
 */
export function generateWorkflowReport(
  manifest: ManifestSchema,
  trustState: TrustState | null = null,
  checkpoint: WorkflowCheckpointV3 | null = null,
): WorkflowReport {
  const phaseProgress = computePhaseProgress(manifest);
  const artifactTree = buildArtifactTree(manifest);
  const riskSummary = buildRiskSummary(manifest.risks);
  const gateSummary = buildGateSummary(manifest.gate_audit);
  const trustDisplay = buildTrustDisplay(trustState);
  const alignmentSummary = buildAlignmentSummary(manifest.alignment_checks);
  const depthDisplay = buildDepthDisplay(manifest.depth_assessment);
  const riskTierDisplay = buildRiskTierDisplay(manifest.risk_tier);

  const summary = buildSummaryLine(manifest, phaseProgress);

  const boltProgress = buildBoltProgress(manifest);

  const inceptionSubStages = checkpoint?.inception_stages
    ? buildInceptionSubStageProgress(checkpoint.inception_stages, checkpoint.current_inception_stage)
    : null;

  const fullReport = [
    `# Workflow Status: ${manifest.feature_name}`,
    `ID: ${manifest.workflow_id}`,
    '',
    summary,
    '',
    '## Phase Progress',
    ...phaseProgress.map(p => formatPhaseProgressBar(p)),
    '',
    ...(inceptionSubStages ? [inceptionSubStages, ''] : []),
    boltProgress,
    depthDisplay,
    riskTierDisplay,
    trustDisplay,
    '',
    '## Artifacts',
    artifactTree,
    '',
    '## Alignment',
    alignmentSummary,
    '',
    '## Risk Summary',
    riskSummary,
    '',
    '## Gate Audit',
    gateSummary,
  ].filter(line => line !== null).join('\n');

  return {
    summary,
    phaseProgress,
    artifactTree,
    riskSummary,
    gateSummary,
    trustDisplay,
    alignmentSummary,
    fullReport,
  };
}

/**
 * Compute progress percentage for each phase based on artifact status
 */
export function computePhaseProgress(manifest: ManifestSchema): PhaseProgressEntry[] {
  return PHASE_ORDER.map(phase => {
    const phaseState = manifest.phases[phase];
    const artifacts = manifest.artifacts.filter(a => a.phase === phase);
    const total = artifacts.length;

    if (total === 0) {
      return {
        phase,
        percentage: phaseState.status === 'complete' ? 100 : 0,
        status: phaseState.status,
        artifactCount: 0,
      };
    }

    // Calculate completion based on contract status
    const completed = artifacts.filter(a =>
      a.contract_status === 'active' ||
      a.contract_status === 'fulfilled'
    ).length;

    const percentage = Math.round((completed / total) * 100);

    return {
      phase,
      percentage,
      status: phaseState.status,
      artifactCount: total,
    };
  });
}

/**
 * Format a phase progress bar like: Inception [========--] 80% (in_progress)
 */
export function formatPhaseProgressBar(entry: PhaseProgressEntry): string {
  const barWidth = 20;
  const filled = Math.round((entry.percentage / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = '='.repeat(filled) + '-'.repeat(empty);
  const phaseName = entry.phase.charAt(0).toUpperCase() + entry.phase.slice(1);
  const padded = phaseName.padEnd(8);

  return `${padded} [${bar}] ${String(entry.percentage).padStart(3)}% (${entry.status}) ${entry.artifactCount} artifacts`;
}

/**
 * Build artifact tree showing hierarchical artifact status
 */
export function buildArtifactTree(manifest: ManifestSchema): string {
  const lines: string[] = [];

  for (const phase of PHASE_ORDER) {
    const artifacts = manifest.artifacts.filter(a => a.phase === phase);
    if (artifacts.length === 0) continue;

    const phaseName = phase.charAt(0).toUpperCase() + phase.slice(1);
    lines.push(`[${phaseName}]`);

    // Group by stage
    const stageGroups = new Map<string, ManifestArtifact[]>();
    for (const artifact of artifacts) {
      const stage = artifact.stage;
      if (!stageGroups.has(stage)) {
        stageGroups.set(stage, []);
      }
      stageGroups.get(stage)!.push(artifact);
    }

    for (const [stage, stageArtifacts] of stageGroups) {
      lines.push(`  ${stage}/`);
      for (const artifact of stageArtifacts) {
        const icon = CONTRACT_STATUS_ICONS[artifact.contract_status] ?? '?';
        const validationMark = artifact.validation_passed === true ? 'v' :
                              artifact.validation_passed === false ? 'x' : '-';
        lines.push(`    [${icon}] ${artifact.id} (${artifact.type}) [${validationMark}]`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Build risk summary
 */
export function buildRiskSummary(risks: RiskEntry[]): string {
  if (risks.length === 0) return 'No risks registered';

  const open = risks.filter(r => r.status === 'open').length;
  const mitigated = risks.filter(r => r.status === 'mitigated').length;
  const accepted = risks.filter(r => r.status === 'accepted').length;
  const closed = risks.filter(r => r.status === 'closed').length;

  const lines = [
    `Total: ${risks.length} | Open: ${open} | Mitigated: ${mitigated} | Accepted: ${accepted} | Closed: ${closed}`,
  ];

  // Show open risks
  const openRisks = risks.filter(r => r.status === 'open');
  for (const risk of openRisks) {
    lines.push(`  [OPEN] ${risk.id}: ${risk.description} (${risk.likelihood}/${risk.impact})`);
  }

  return lines.join('\n');
}

/**
 * Build gate audit summary
 */
export function buildGateSummary(gateAudit: GateAuditEntry[]): string {
  if (gateAudit.length === 0) return 'No gate transitions recorded';

  const approved = gateAudit.filter(g => g.action === 'approved').length;
  const rejected = gateAudit.filter(g => g.action === 'rejected').length;
  const bypassed = gateAudit.filter(g => g.action === 'bypassed').length;

  const lines = [
    `Total: ${gateAudit.length} | Approved: ${approved} | Rejected: ${rejected} | Bypassed: ${bypassed}`,
  ];

  for (const entry of gateAudit) {
    const phase = entry.phase.charAt(0).toUpperCase() + entry.phase.slice(1);
    lines.push(`  [${entry.action.toUpperCase()}] ${phase} by ${entry.actor}${entry.reason ? ': ' + entry.reason : ''}`);
  }

  return lines.join('\n');
}

/**
 * Build trust level display
 */
export function buildTrustDisplay(trustState: TrustState | null): string {
  if (!trustState) return 'Trust: Not initialized';

  const levelName = TRUST_LEVEL_NAMES[trustState.current_level] ?? 'Unknown';
  const lines = [
    `Trust Level ${trustState.current_level}: ${levelName}`,
    `  Transitions: ${trustState.total_transitions} | Rejections: ${trustState.rejection_count} (${(trustState.rejection_rate * 100).toFixed(1)}%) | Incidents: ${trustState.incident_count}`,
  ];

  return lines.join('\n');
}

/**
 * Build alignment check summary
 */
export function buildAlignmentSummary(checks: AlignmentCheck[]): string {
  if (checks.length === 0) return 'No alignment checks recorded';

  const passed = checks.filter(c => c.alignment_passed).length;
  const failed = checks.filter(c => !c.alignment_passed).length;

  const lines = [
    `Total: ${checks.length} | Passed: ${passed} | Failed: ${failed}`,
  ];

  for (const check of checks) {
    const status = check.alignment_passed ? 'PASS' : 'FAIL';
    const vScore = check.verification.conformance_score;
    const vPassed = check.verification.passed ? 'v' : 'x';
    const valPassed = check.validation.passed ? 'v' : 'x';
    lines.push(`  [${status}] ${check.source_artifact_id} -> ${check.target_artifact_id}: verification=${vScore}% [${vPassed}] validation [${valPassed}]`);
  }

  return lines.join('\n');
}

/**
 * Build depth assessment display
 */
export function buildDepthDisplay(depth: DepthAssessment | null): string {
  if (!depth) return 'Depth: Not assessed';
  return `Depth: ${depth.recommended_depth} (score: ${depth.total_score}/30)${depth.skip_units ? ' [skip-units]' : ''}`;
}

/**
 * Build risk tier display
 */
export function buildRiskTierDisplay(riskTier: RiskTierClassification | null): string {
  if (!riskTier) return 'Risk Tier: Not classified';
  return `Risk Tier: ${riskTier.tier} (${riskTier.rationale})`;
}

/**
 * Build bolt progress display
 */
export function buildBoltProgress(manifest: ManifestSchema): string {
  const boltArtifacts = manifest.artifacts.filter(a => a.stage === 'code-generation');
  const total = boltArtifacts.length;

  if (total === 0) return 'Bolts: 0/0';

  const completed = boltArtifacts.filter(a =>
    a.contract_status === 'active' || a.contract_status === 'fulfilled'
  ).length;

  return `Bolts: ${completed}/${total} complete`;
}

/**
 * Build one-line summary
 */
function buildSummaryLine(manifest: ManifestSchema, progress: PhaseProgressEntry[]): string {
  const totalArtifacts = manifest.artifacts.length;
  const activePhases = progress.filter(p => p.status !== 'not_started');
  const completePhases = progress.filter(p => p.percentage === 100 && p.status === 'complete');

  return `${completePhases.length}/${PHASE_ORDER.length} phases complete | ${totalArtifacts} artifacts total`;
}

const INCEPTION_STAGE_ORDER: InceptionStage[] = [
  'workspace-detection',
  'reverse-engineering',
  'requirements-analysis',
  'user-stories',
  'workflow-planning',
  'application-design',
  'units-generation',
  'bolt-planning',
];

const INCEPTION_STAGE_LABELS: Record<InceptionStage, string> = {
  'workspace-detection': 'Workspace Detection',
  'reverse-engineering': 'Reverse Engineering',
  'requirements-analysis': 'Requirements Analysis',
  'user-stories': 'User Stories',
  'workflow-planning': 'Workflow Planning',
  'application-design': 'Application Design',
  'units-generation': 'Units Generation',
  'bolt-planning': 'Bolt Planning',
};

export function buildInceptionSubStageProgress(
  inceptionStages: Record<InceptionStage, InceptionStageState>,
  currentInceptionStage: InceptionStage | undefined,
): string {
  const total = INCEPTION_STAGE_ORDER.length;
  const completed = INCEPTION_STAGE_ORDER.filter(
    s => inceptionStages[s]?.status === 'completed'
  ).length;
  const percentage = Math.round((completed / total) * 100);

  const barWidth = 10;
  const filled = Math.round((percentage / 100) * barWidth);
  const barStr = filled >= barWidth
    ? '='.repeat(barWidth)
    : '='.repeat(filled) + '>' + '-'.repeat(barWidth - filled - 1);

  const lines: string[] = [
    `Inception [${barStr}] ${percentage}%  (${completed}/${total} stages)`,
  ];

  for (const stage of INCEPTION_STAGE_ORDER) {
    const state = inceptionStages[stage];
    const label = INCEPTION_STAGE_LABELS[stage];

    if (!state) {
      lines.push(`  [ ] ${label}`);
      continue;
    }

    if (state.status === 'completed') {
      lines.push(`  [x] ${label}`);
    } else if (state.status === 'skipped') {
      const reason = state.skip_reason ? ` (${state.skip_reason})` : ' (skipped)';
      lines.push(`  [-] ${label}${reason}`);
    } else if (state.status === 'in_progress' || stage === currentInceptionStage) {
      lines.push(`  [ ] ${label}        <- current`);
    } else {
      lines.push(`  [ ] ${label}`);
    }
  }

  return lines.join('\n');
}

export function generateWelcomeMessage(): string {
  return `## Welcome to AIDLC Adaptive Workflow

This workflow follows the AI-Driven Development Life Cycle (AI-DLC) methodology.

### Three-Phase Lifecycle
1. **Inception** — Define what to build and why (requirements, stories, design)
2. **Construction** — Build it right (domain design, functional design, code generation)
3. **Operations** — Ship and monitor (deployment, runbook, monitoring)

### Your Role
- **Inception**: Answer questions, approve artifacts, provide domain expertise
- **Construction**: Review designs, approve bolt plans, verify code
- **Operations**: Validate deployment guides, confirm monitoring setup

The workflow adapts to your project's complexity and your trust level.`;
}

/**
 * Generate a welcome back message showing current status and options for resuming
 */
export function generateWelcomeBackMessage(checkpoint: WorkflowCheckpointV3, featureName: string): string {
  const phase = checkpoint.current_phase;
  const stage = checkpoint.current_stage;
  const pathway = checkpoint.pathway_type ?? 'unknown';

  return `## Welcome Back — ${featureName}

**Current Phase:** ${phase}
**Current Stage:** ${stage}
**Pathway:** ${pathway}
**Workflow ID:** ${checkpoint.workflow_id}

### Options
1. **Continue where you left off** — Resume from ${stage}
2. **Review a previous stage** — Go back and review completed artifacts`;
}

/**
 * Get context loading recommendations based on current workflow stage
 */
export function getContextLoadingRecommendation(stage: string): string[] {
  const earlyStages = ['intent', 'discovery'];
  const requirementsStages = ['requirements', 'stories'];
  const designStages = ['architecture', 'design', 'domain-design', 'logical-design'];
  const codeStages = ['code', 'code-generation', 'implementation'];

  if (earlyStages.includes(stage)) {
    return ['workspace-scan'];
  }

  if (requirementsStages.includes(stage)) {
    return ['workspace-scan', 'reverse-engineering', 'requirements'];
  }

  if (designStages.includes(stage)) {
    return ['requirements', 'user-stories', 'architecture', 'design-artifacts'];
  }

  if (codeStages.includes(stage)) {
    return ['requirements', 'user-stories', 'architecture', 'design-artifacts', 'existing-code'];
  }

  return ['workspace-scan'];
}
