import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { loadManifest } from './manifest.js';
import { loadTrustState } from './trust.js';
import type { ManifestSchema, GateAuditEntry, TrustState } from './phase-types.js';
import { recordDiscovery } from '../../learning/discovery.js';
import type { AgentDiscovery } from '../../learning/types.js';

export interface RetroData {
  workflowId: string;
  featureName: string;
  gateRejections: Array<{
    phase: string;
    timestamp: string;
    reason: string | null;
    actor: string;
  }>;
  cascadeEvents: Array<{
    artifactId: string;
    status: string;
    timestamp: string;
  }>;
  trustDecreases: Array<{
    from: number;
    to: number;
    reason: string;
    timestamp: string;
  }>;
  ciFailureCount: number;
  totalGates: number;
  totalRejections: number;
}

export interface RetroPattern {
  description: string;
  evidence: string;
  suggestion: string;
  confidence: 'High' | 'Medium' | 'Low';
  occurrences: number;
}

export interface RetroResult {
  success: boolean;
  message: string;
  suggestionsPath: string | null;
  data: RetroData | null;
  patterns: RetroPattern[];
}

/**
 * Gathers all retro-relevant data from workflow artifacts.
 */
export function gatherRetroData(projectPath: string): RetroData {
  const manifestPath = join(projectPath, 'aidlc-docs', 'manifest.json');
  const manifest = loadManifest(manifestPath);
  const trustState = loadTrustState(projectPath);

  // Default empty data structure
  const emptyData: RetroData = {
    workflowId: '',
    featureName: '',
    gateRejections: [],
    cascadeEvents: [],
    trustDecreases: [],
    ciFailureCount: 0,
    totalGates: 0,
    totalRejections: 0,
  };

  if (!manifest) {
    return emptyData;
  }

  // Extract gate rejections
  const gateRejections = (manifest.gate_audit || [])
    .filter((entry: GateAuditEntry) => entry.action === 'rejected')
    .map((entry: GateAuditEntry) => ({
      phase: entry.phase,
      timestamp: entry.timestamp,
      reason: entry.reason || null,
      actor: entry.actor,
    }));

  // Extract cascade invalidation events
  const cascadeEvents: Array<{
    artifactId: string;
    status: string;
    timestamp: string;
  }> = [];

  for (const artifact of manifest.artifacts || []) {
    if (artifact.statusHistory) {
      for (const historyEntry of artifact.statusHistory) {
        if (
          historyEntry.status.toLowerCase().includes('stale') ||
          historyEntry.status.toLowerCase().includes('violated')
        ) {
          cascadeEvents.push({
            artifactId: artifact.id,
            status: historyEntry.status,
            timestamp: historyEntry.timestamp,
          });
        }
      }
    }
  }

  // Extract trust decreases
  const trustDecreases = (trustState?.level_history || [])
    .filter((change) => change.to < change.from)
    .map((change) => ({
      from: change.from,
      to: change.to,
      reason: change.reason,
      timestamp: change.timestamp,
    }));

  // Count CI failures from validation reports
  let ciFailureCount = 0;
  const constructionPath = join(projectPath, 'aidlc-docs', 'construction');

  if (existsSync(constructionPath)) {
    const unitDirs = readdirSync(constructionPath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory() && dirent.name.startsWith('UNIT-'))
      .map((dirent) => dirent.name);

    for (const unitDir of unitDirs) {
      const reportPath = join(constructionPath, unitDir, 'validation-report.md');
      if (existsSync(reportPath)) {
        const reportContent = readFileSync(reportPath, 'utf-8');
        const lines = reportContent.split('\n');
        ciFailureCount += lines.filter((line) =>
          line.toLowerCase().includes('fail')
        ).length;
      }
    }
  }

  const totalGates = (manifest.gate_audit || []).length;
  const totalRejections = gateRejections.length;

  return {
    workflowId: manifest.workflow_id || '',
    featureName: manifest.feature_name || '',
    gateRejections,
    cascadeEvents,
    trustDecreases,
    ciFailureCount,
    totalGates,
    totalRejections,
  };
}

/**
 * Analyzes retro data to identify recurring patterns.
 */
export function analyzeRetroPatterns(data: RetroData): RetroPattern[] {
  const patterns: RetroPattern[] = [];

  // Group gate rejections by reason
  const rejectionsByReason = new Map<string, Array<typeof data.gateRejections[0]>>();
  for (const rejection of data.gateRejections) {
    const normalizedReason = (rejection.reason || 'unspecified').toLowerCase().trim();
    if (!rejectionsByReason.has(normalizedReason)) {
      rejectionsByReason.set(normalizedReason, []);
    }
    rejectionsByReason.get(normalizedReason)!.push(rejection);
  }

  // Create patterns for gate rejections
  for (const [reason, rejections] of rejectionsByReason.entries()) {
    const occurrences = rejections.length;
    const confidence = occurrences >= 3 ? 'High' : occurrences === 2 ? 'Medium' : 'Low';

    const phases = rejections.map((r) => r.phase).join(', ');
    const evidence = `Gate rejections in ${phases} with reason: "${reason}"`;
    const suggestion = occurrences > 1
      ? `Review and address recurring gate rejection pattern: "${reason}". Consider improving upstream validation or documentation.`
      : `Address gate rejection: "${reason}". Ensure requirements are clear before implementation.`;

    patterns.push({
      description: `Gate rejection pattern: ${reason}`,
      evidence,
      suggestion,
      confidence,
      occurrences,
    });
  }

  // Trust decrease pattern
  if (data.trustDecreases.length > 0) {
    const occurrences = data.trustDecreases.length;
    const confidence = occurrences >= 3 ? 'High' : occurrences === 2 ? 'Medium' : 'Low';

    const trajectory = data.trustDecreases
      .map((td) => `${td.from} → ${td.to} (${td.reason})`)
      .join('; ');

    patterns.push({
      description: 'Trust level decreases detected',
      evidence: `Trust trajectory: ${trajectory}`,
      suggestion: 'Improve code quality and validation processes to rebuild trust. Consider more thorough review before gate submissions.',
      confidence,
      occurrences,
    });
  }

  // Cascade invalidation pattern
  if (data.cascadeEvents.length > 0) {
    const occurrences = data.cascadeEvents.length;
    const confidence = occurrences >= 3 ? 'High' : occurrences === 2 ? 'Medium' : 'Low';

    const artifacts = [...new Set(data.cascadeEvents.map((e) => e.artifactId))].join(', ');

    patterns.push({
      description: 'Cascade invalidation events',
      evidence: `${occurrences} invalidation event(s) affecting: ${artifacts}`,
      suggestion: 'Strengthen contract verification and dependency validation to prevent cascading failures. Consider improving artifact stability.',
      confidence,
      occurrences,
    });
  }

  return patterns;
}

/**
 * Generates markdown suggestions file from retro analysis.
 */
export function generateRetroSuggestions(
  data: RetroData,
  patterns: RetroPattern[],
  projectPath: string
): string {
  const retroDir = join(projectPath, '.olympus', 'retro');
  if (!existsSync(retroDir)) {
    mkdirSync(retroDir, { recursive: true });
  }

  const suggestionsPath = join(retroDir, 'suggestions.md');
  const timestamp = new Date().toISOString();

  const rejectionRate = data.totalGates > 0
    ? ((data.totalRejections / data.totalGates) * 100).toFixed(1)
    : '0.0';

  // Determine trust trajectory
  const trustState = loadTrustState(projectPath);
  const startLevel = trustState?.level_history?.[0]?.from || trustState?.current_level || 0;
  const endLevel = trustState?.current_level || 0;

  let markdown = `# Guardrail Retro: ${data.featureName || 'Unknown Feature'}
Generated: ${timestamp}

## Summary
- Total gates: ${data.totalGates} | Rejections: ${data.totalRejections} | Rejection rate: ${rejectionRate}%
- Trust changes: ${startLevel} -> ${endLevel}
- CI failures: ${data.ciFailureCount}

## Patterns Identified

`;

  if (patterns.length === 0) {
    markdown += 'No significant patterns identified in this workflow run.\n\n';
  } else {
    patterns.forEach((pattern, index) => {
      markdown += `### Pattern ${index + 1}: ${pattern.description}
**Evidence**: ${pattern.evidence}
**Suggestion**: ${pattern.suggestion}
**Confidence**: ${pattern.confidence} (${pattern.occurrences} occurrence${pattern.occurrences > 1 ? 's' : ''})

`;
    });
  }

  markdown += `## Advisory Recommendations

`;

  if (patterns.length === 0) {
    markdown += '- [ ] Continue current workflow practices\n\n';
  } else {
    patterns.forEach((pattern) => {
      markdown += `- [ ] ${pattern.suggestion}\n`;
    });
    markdown += '\n';
  }

  markdown += `---
*These are suggestions only. No changes have been applied automatically.*
*Review each recommendation and manually apply what you agree with.*
`;

  writeFileSync(suggestionsPath, markdown, 'utf-8');
  return suggestionsPath;
}

/**
 * Persists high and medium confidence retro patterns as discoveries.
 * Low-confidence patterns are NOT persisted.
 */
export function persistRetroDiscoveries(
  patterns: RetroPattern[],
  data: RetroData,
  projectPath: string,
  sessionId: string,
): AgentDiscovery[] {
  const discoveries: AgentDiscovery[] = [];

  for (const pattern of patterns) {
    // Only persist High and Medium confidence patterns
    if (pattern.confidence === 'Low') continue;

    const confidence = pattern.confidence === 'High' ? 0.9 : 0.7;

    const discovery = recordDiscovery({
      session_id: sessionId,
      project_path: projectPath,
      category: 'retro_insight',
      summary: `Retro: ${pattern.description}`.slice(0, 100),
      details: `${pattern.description}\n\nEvidence: ${pattern.evidence}\n\nSuggestion: ${pattern.suggestion}`,
      agent_name: 'retro',
      task_context: `Retro analysis for workflow ${data.workflowId}`,
      confidence,
      scope: 'project',
    });

    discoveries.push(discovery);
  }

  return discoveries;
}

/**
 * Main entry point for retro analysis.
 */
export function runRetro(projectPath: string): RetroResult {
  const manifestPath = join(projectPath, 'aidlc-docs', 'manifest.json');
  const manifest = loadManifest(manifestPath);

  if (!manifest) {
    return {
      success: false,
      message: 'No workflow data found for retro analysis',
      suggestionsPath: null,
      data: null,
      patterns: [],
    };
  }

  const data = gatherRetroData(projectPath);
  const patterns = analyzeRetroPatterns(data);
  const suggestionsPath = generateRetroSuggestions(data, patterns, projectPath);

  // Persist high-confidence patterns as discoveries
  persistRetroDiscoveries(patterns, data, projectPath, 'retro-session');

  return {
    success: true,
    message: `Retro analysis complete. Suggestions written to ${suggestionsPath}`,
    suggestionsPath,
    data,
    patterns,
  };
}
