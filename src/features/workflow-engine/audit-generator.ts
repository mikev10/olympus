import * as fs from 'fs-extra';
import * as path from 'path';
import { loadManifest, registerArtifact } from './manifest.js';
import { loadTrustState } from './trust.js';
import { gatherRetroData, analyzeRetroPatterns } from './retro.js';
import type { ManifestSchema, GateAuditEntry, TrustState, WorkflowPhase } from './phase-types.js';
import type { WorkflowStage } from './types.js';

export interface AuditTimelineEntry {
  timestamp: string;
  phase: string;
  action: string;
  actor: string;
  reason: string | null;
}

export interface TraceabilityEntry {
  intentId: string;
  unitIds: string[];
  codeGenerationIds: string[];
  codeFiles: string[];
}

export interface TrustChange {
  from: number;
  to: number;
  reason: string;
  timestamp: string;
}

export interface CascadeEvent {
  artifactId: string;
  previousStatus: string;
  newStatus: string;
  reason: string;
  timestamp: string;
}

export interface AuditDocument {
  workflowId: string;
  featureName: string;
  generatedAt: string;
  timeline: AuditTimelineEntry[];
  traceabilityMatrix: TraceabilityEntry[];
  trustHistory: TrustChange[];
  cascadeEvents: CascadeEvent[];
  retroInsights: string[];
}

function buildTimeline(manifest: ManifestSchema): AuditTimelineEntry[] {
  return (manifest.gate_audit || [])
    .map((entry: GateAuditEntry) => ({
      timestamp: entry.timestamp,
      phase: entry.phase,
      action: entry.action,
      actor: entry.actor,
      reason: entry.reason ?? null,
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function buildTraceabilityMatrix(manifest: ManifestSchema): TraceabilityEntry[] {
  const artifacts = manifest.artifacts || [];
  const links = manifest.links || [];

  // Find all INTENT-stage artifacts as roots of the hierarchy
  const intentArtifacts = artifacts.filter((a) => a.stage === 'intent');

  return intentArtifacts.map((intent) => {
    // Trace UNIT artifacts that derive/implement from this INTENT
    const unitIds = links
      .filter(
        (l) =>
          l.source_id === intent.id &&
          (l.link_type === 'derives' || l.link_type === 'implements')
      )
      .map((l) => l.target_id)
      .filter((id) => artifacts.some((a) => a.id === id && a.stage === 'unit'));

    // Trace code-generation artifacts that derive/implement from any of the resolved UNITs
    const codeGenIds: string[] = [];
    for (const unitId of unitIds) {
      const codeGenIdsForUnit = links
        .filter(
          (l) =>
            l.source_id === unitId &&
            (l.link_type === 'derives' || l.link_type === 'implements')
        )
        .map((l) => l.target_id)
        .filter((id) => artifacts.some((a) => a.id === id && a.stage === 'code-generation'));
      codeGenIds.push(...codeGenIdsForUnit);
    }

    // Collect non-markdown, non-json paths from code-generation artifacts as code file references
    const codeFiles = [...new Set(
      codeGenIds.flatMap((codeGenId) => {
        const codeGenArtifact = artifacts.find((a) => a.id === codeGenId);
        if (!codeGenArtifact) return [];
        const ext = path.extname(codeGenArtifact.path).toLowerCase();
        return ext && ext !== '.md' && ext !== '.json' ? [codeGenArtifact.path] : [];
      })
    )];

    return {
      intentId: intent.id,
      unitIds,
      codeGenerationIds: [...new Set(codeGenIds)],
      codeFiles,
    };
  });
}

function buildTrustHistory(trustState: TrustState): TrustChange[] {
  return (trustState.level_history || []).map((change) => ({
    from: change.from,
    to: change.to,
    reason: change.reason,
    timestamp: change.timestamp,
  }));
}

function buildCascadeEvents(manifest: ManifestSchema): CascadeEvent[] {
  const events: CascadeEvent[] = [];

  for (const artifact of manifest.artifacts || []) {
    if (!artifact.statusHistory || artifact.statusHistory.length < 2) continue;

    const history = artifact.statusHistory;
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      const newStatusLower = curr.status.toLowerCase();

      if (newStatusLower.includes('stale') || newStatusLower.includes('violated')) {
        events.push({
          artifactId: artifact.id,
          previousStatus: prev.status,
          newStatus: curr.status,
          reason: artifact.stale_reason ?? `Artifact transitioned to ${curr.status}`,
          timestamp: curr.timestamp,
        });
      }
    }
  }

  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function emptyAuditDocument(workflowId: string): AuditDocument {
  return {
    workflowId,
    featureName: '',
    generatedAt: new Date().toISOString(),
    timeline: [],
    traceabilityMatrix: [],
    trustHistory: [],
    cascadeEvents: [],
    retroInsights: [],
  };
}

/**
 * Generates a comprehensive AuditDocument for a workflow.
 * Returns a minimal empty document if the manifest is not found.
 */
export function generateAuditDocument(projectPath: string, workflowId: string): AuditDocument {
  try {
    const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
    const manifest = loadManifest(manifestPath);

    if (!manifest) {
      return emptyAuditDocument(workflowId);
    }

    const trustState = loadTrustState(projectPath);
    const retroData = gatherRetroData(projectPath, workflowId);
    const retroPatterns = analyzeRetroPatterns(retroData);

    const retroInsights = retroPatterns
      .filter((p) => p.confidence === 'High' || p.confidence === 'Medium')
      .map((p) => p.description);

    return {
      workflowId: manifest.workflow_id,
      featureName: manifest.feature_name,
      generatedAt: new Date().toISOString(),
      timeline: buildTimeline(manifest),
      traceabilityMatrix: buildTraceabilityMatrix(manifest),
      trustHistory: buildTrustHistory(trustState),
      cascadeEvents: buildCascadeEvents(manifest),
      retroInsights,
    };
  } catch (error) {
    console.error(`Failed to generate audit document for workflow ${workflowId}:`, error);
    return emptyAuditDocument(workflowId);
  }
}

export function renderAuditMarkdown(audit: AuditDocument): string {
  const lines: string[] = [];

  lines.push(`# Audit Report: ${audit.featureName}`);
  lines.push('');
  lines.push(`Generated: ${audit.generatedAt}`);
  lines.push(`Workflow ID: ${audit.workflowId}`);
  lines.push('');

  lines.push('## Timeline');
  lines.push('');
  if (audit.timeline.length === 0) {
    lines.push('_No gate decisions recorded._');
  } else {
    lines.push('| Timestamp | Phase | Action | Actor | Reason |');
    lines.push('|-----------|-------|--------|-------|--------|');
    for (const entry of audit.timeline) {
      lines.push(
        `| ${entry.timestamp} | ${entry.phase} | ${entry.action} | ${entry.actor} | ${entry.reason ?? '—'} |`
      );
    }
  }
  lines.push('');

  lines.push('## Traceability Matrix');
  lines.push('');
  if (audit.traceabilityMatrix.length === 0) {
    lines.push('_No traceability data available._');
  } else {
    lines.push('| Intent | Units | Code Generation | Code Files |');
    lines.push('|--------|-------|-----------------|------------|');
    for (const entry of audit.traceabilityMatrix) {
      const units = entry.unitIds.length > 0 ? entry.unitIds.join(', ') : '—';
      const codeGens = entry.codeGenerationIds.length > 0 ? entry.codeGenerationIds.join(', ') : '—';
      const files = entry.codeFiles.length > 0 ? entry.codeFiles.join(', ') : '—';
      lines.push(`| ${entry.intentId} | ${units} | ${codeGens} | ${files} |`);
    }
  }
  lines.push('');

  lines.push('## Trust History');
  lines.push('');
  if (audit.trustHistory.length === 0) {
    lines.push('_No trust level changes recorded._');
  } else {
    lines.push('| From | To | Reason | Timestamp |');
    lines.push('|------|----|--------|-----------|');
    for (const change of audit.trustHistory) {
      lines.push(
        `| ${change.from} | ${change.to} | ${change.reason} | ${change.timestamp} |`
      );
    }
  }
  lines.push('');

  lines.push('## Cascade Events');
  lines.push('');
  if (audit.cascadeEvents.length === 0) {
    lines.push('_No cascade invalidation events recorded._');
  } else {
    for (const event of audit.cascadeEvents) {
      lines.push(
        `- **${event.artifactId}**: \`${event.previousStatus}\` → \`${event.newStatus}\` — ${event.reason} _(${event.timestamp})_`
      );
    }
  }
  lines.push('');

  lines.push('## Retrospective Insights');
  lines.push('');
  if (audit.retroInsights.length === 0) {
    lines.push('_No retrospective insights available._');
  } else {
    for (const insight of audit.retroInsights) {
      lines.push(`- ${insight}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Renders and writes the audit document to `aidlc-docs/{workflowId}/audit.md`,
 * then registers an AUDIT artifact in the manifest.
 * Returns the absolute path to the written file.
 */
export async function writeAuditArtifact(
  projectPath: string,
  workflowId: string,
  audit: AuditDocument
): Promise<string> {
  const workflowDir = path.join(projectPath, 'aidlc-docs', workflowId);
  const auditPath = path.join(workflowDir, 'audit.md');
  const manifestPath = path.join(workflowDir, 'manifest.json');

  try {
    const markdown = renderAuditMarkdown(audit);
    await fs.ensureDir(workflowDir);
    await fs.writeFile(auditPath, markdown, 'utf-8');

    registerArtifact(manifestPath, {
      id: `audit-${workflowId}`,
      type: 'AUDIT',
      phase: 'operations' as WorkflowPhase,
      stage: 'complete' as WorkflowStage,
      path: auditPath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });
  } catch (error) {
    console.error(`Failed to write audit artifact for workflow ${workflowId}:`, error);
  }

  return auditPath;
}

/**
 * Appends a single timeline entry to an existing audit.md file.
 * Creates the file with a minimal header if it does not yet exist.
 * Silent error handling — catches and logs, never throws.
 */
export function appendToAudit(
  projectPath: string,
  workflowId: string,
  entry: AuditTimelineEntry
): void {
  try {
    const auditPath = path.join(projectPath, 'aidlc-docs', workflowId, 'audit.md');

    if (!fs.existsSync(auditPath)) {
      const header = [
        `# Audit Report`,
        '',
        `Generated: ${new Date().toISOString()}`,
        `Workflow ID: ${workflowId}`,
        '',
        '## Timeline',
        '',
        '| Timestamp | Phase | Action | Actor | Reason |',
        '|-----------|-------|--------|-------|--------|',
        '',
      ].join('\n');

      fs.ensureDirSync(path.dirname(auditPath));
      fs.writeFileSync(auditPath, header, 'utf-8');
    }

    const row = `| ${entry.timestamp} | ${entry.phase} | ${entry.action} | ${entry.actor} | ${entry.reason ?? '—'} |\n`;
    fs.appendFileSync(auditPath, row, 'utf-8');
  } catch (error) {
    console.error(`Failed to append to audit for workflow ${workflowId}:`, error);
  }
}

export interface AuditInteraction {
  timestamp: string; // ISO 8601
  stage: string;
  interactionType: 'user_input' | 'ai_prompt' | 'approval_request' | 'approval_response' | 'change_request' | 'error';
  content: string; // complete raw text — never summarized
  context: string; // stage and action description
}

export function appendInteraction(
  projectPath: string,
  workflowId: string,
  interaction: AuditInteraction
): void {
  try {
    const auditPath = path.join(projectPath, 'aidlc-docs', workflowId, 'audit.md');

    if (!fs.existsSync(auditPath)) {
      const header = [
        `# Audit Report`,
        '',
        `Generated: ${new Date().toISOString()}`,
        `Workflow ID: ${workflowId}`,
        '',
      ].join('\n');

      fs.ensureDirSync(path.dirname(auditPath));
      fs.writeFileSync(auditPath, header, 'utf-8');
    }

    const block = [
      '',
      `### [${interaction.interactionType}] ${interaction.timestamp}`,
      `**Stage:** ${interaction.stage}`,
      `**Context:** ${interaction.context}`,
      '',
      interaction.content,
      '',
    ].join('\n');

    fs.appendFileSync(auditPath, block, 'utf-8');
  } catch (error) {
    console.error(`Failed to append interaction to audit for workflow ${workflowId}:`, error);
  }
}

export function logApprovalPrompt(
  projectPath: string,
  workflowId: string,
  stage: string,
  prompt: string
): void {
  const interaction: AuditInteraction = {
    timestamp: new Date().toISOString(),
    stage,
    interactionType: 'approval_request',
    content: prompt,
    context: `Approval prompt presented at ${stage} stage`,
  };
  appendInteraction(projectPath, workflowId, interaction);
}

export function logApprovalResponse(
  projectPath: string,
  workflowId: string,
  stage: string,
  response: string
): void {
  const interaction: AuditInteraction = {
    timestamp: new Date().toISOString(),
    stage,
    interactionType: 'approval_response',
    content: response,
    context: `Approval response received at ${stage} stage`,
  };
  appendInteraction(projectPath, workflowId, interaction);
}
