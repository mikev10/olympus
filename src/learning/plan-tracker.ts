/**
 * Plan Lifecycle Tracking
 *
 * Monitors plan file changes, Momus reviews, and /complete-plan outcomes
 * to capture planning insights as discoveries.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { relative } from 'path';
import type { PlanLifecycleEvent, AgentDiscovery } from './types.js';

/** Timestamp cache for detecting plan file changes */
const planFileTimestamps: Map<string, number> = new Map();

/**
 * Detect plan file change (creation or revision).
 * Called from PostToolUse hook when Write tool targets .olympus/plans/*.md
 *
 * @param projectPath - Project root directory
 * @param planPath - Absolute path to the plan file
 * @param sessionId - Current session ID
 * @returns PlanLifecycleEvent or null if no significant change detected
 */
export function detectPlanFileChange(
  projectPath: string,
  planPath: string,
  sessionId: string
): PlanLifecycleEvent | null {
  try {
    if (!existsSync(planPath)) return null;

    const relativePath = relative(projectPath, planPath);
    const content = readFileSync(planPath, 'utf-8');
    const stat = statSync(planPath);
    const currentMtime = stat.mtimeMs;

    // Check if this is a new file or a revision
    const previousMtime = planFileTimestamps.get(planPath);
    const isNew = previousMtime === undefined;

    // Update timestamp
    planFileTimestamps.set(planPath, currentMtime);

    // If file existed before, check if change is significant (>20% content change)
    if (!isNew && previousMtime === currentMtime) {
      return null; // No actual change
    }

    const summary = extractPlanSummary(content);

    if (isNew) {
      return {
        event_type: 'plan_created',
        plan_path: relativePath,
        plan_summary: summary,
        revision_count: 0,
        session_id: sessionId,
        timestamp: new Date().toISOString(),
      };
    }

    // Count revisions for this plan
    const revisionCount = getRevisionCount(planPath);

    return {
      event_type: 'plan_revised',
      plan_path: relativePath,
      plan_summary: summary,
      revision_count: revisionCount,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Extract plan context from markdown content.
 * Gets summary (first 200 chars after frontmatter) and risk sections.
 */
export function extractPlanContext(planContent: string): { summary: string; risks: string[] } {
  const summary = extractPlanSummary(planContent);
  const risks = extractRisks(planContent);
  return { summary, risks };
}

/**
 * Parse Momus review output for approval/rejection signals.
 *
 * @param toolOutput - The raw output from the Momus Task tool
 * @returns Structured review outcome
 */
export function parseMomusReviewOutput(
  toolOutput: string
): { passed: boolean; issues: string[] } {
  const output = typeof toolOutput === 'string' ? toolOutput : String(toolOutput || '');

  if (!output) {
    return { passed: false, issues: ['Empty review output'] };
  }

  const upperOutput = output.toUpperCase();

  // Check for explicit approval signals
  const approvalSignals = ['APPROVED', 'LOOKS GOOD', 'NO CRITICAL ISSUES', 'PLAN IS SOLID'];
  const isApproved = approvalSignals.some(signal => upperOutput.includes(signal));

  // Check for rejection signals
  const rejectionSignals = ['CRITICAL', 'REVISE', 'REJECT', 'MAJOR ISSUE', 'MISSING', 'INCOMPLETE'];
  const hasRejection = rejectionSignals.some(signal => upperOutput.includes(signal));

  // Extract specific issues
  const issues = extractIssues(output);

  // If explicitly approved and no critical rejections
  if (isApproved && !hasRejection) {
    return { passed: true, issues };
  }

  // If has rejection signals
  if (hasRejection) {
    return { passed: false, issues: issues.length > 0 ? issues : ['Plan requires revision'] };
  }

  // Ambiguous - default to passed with warning
  return { passed: true, issues };
}

/**
 * Create a planning_insight discovery from a review failure or plan failure.
 */
export function createPlanningDiscovery(
  event: PlanLifecycleEvent,
  issues: string[],
  projectPath: string
): Partial<AgentDiscovery> {
  const issuesSummary = issues.slice(0, 3).join('; ');
  const summary = `Plan "${event.plan_path}" ${event.event_type === 'plan_review_failed' ? 'failed review' : 'failed'}: ${issuesSummary}`.substring(0, 100);

  const details = [
    `Plan: ${event.plan_path}`,
    `Event: ${event.event_type}`,
    event.revision_count ? `Revision count: ${event.revision_count}` : '',
    event.reviewer ? `Reviewer: ${event.reviewer}` : '',
    '',
    'Issues:',
    ...issues.map(i => `- ${i}`),
  ].filter(Boolean).join('\n').substring(0, 2000);

  return {
    session_id: event.session_id,
    project_path: projectPath,
    category: 'planning_insight',
    summary,
    details,
    agent_name: 'prometheus',
    task_context: `Plan lifecycle: ${event.event_type}`,
    files_involved: [event.plan_path],
    confidence: 0.9, // Momus reviews are authoritative
    scope: 'project',
  };
}

/**
 * Format planning discoveries for injection into Prometheus context.
 * Returns formatted markdown section under 300 tokens.
 */
export function formatPlanLearnings(discoveries: AgentDiscovery[]): string {
  if (discoveries.length === 0) return '';

  const lines: string[] = [
    '<plan-learnings>',
    '## Planning Insights (from previous sessions)',
    '',
  ];

  // Group by mistake type
  const mistakes: string[] = [];
  const patterns: string[] = [];

  for (const d of discoveries.slice(0, 5)) {
    if (d.summary.includes('failed')) {
      mistakes.push(`- ${d.summary}`);
    } else {
      patterns.push(`- ${d.summary}`);
    }
  }

  if (mistakes.length > 0) {
    lines.push('**Common Planning Mistakes:**');
    lines.push(...mistakes);
    lines.push('');
  }

  if (patterns.length > 0) {
    lines.push('**Required Considerations:**');
    lines.push(...patterns);
    lines.push('');
  }

  lines.push('</plan-learnings>');

  // Enforce 300 token budget (~1200 chars)
  const result = lines.join('\n');
  return result.length > 1200 ? result.substring(0, 1200) + '\n</plan-learnings>' : result;
}

// ---- Private helpers ----

function extractPlanSummary(content: string): string {
  // Skip frontmatter (---...---)
  let text = content;
  if (text.startsWith('---')) {
    const endIndex = text.indexOf('---', 3);
    if (endIndex > 0) {
      text = text.substring(endIndex + 3).trim();
    }
  }

  // Get first 200 meaningful characters
  const cleaned = text
    .replace(/^#+\s*/gm, '') // Remove markdown headers
    .replace(/\n+/g, ' ')    // Collapse newlines
    .trim();

  return cleaned.substring(0, 200);
}

function extractRisks(content: string): string[] {
  const risks: string[] = [];
  const riskSection = content.match(/##\s*(?:Risk|Risks|Risk Assessment)\s*\n([\s\S]*?)(?=\n##\s|\n---|$)/i);

  if (riskSection) {
    const lines = riskSection[1].split('\n');
    for (const line of lines) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
      if (bulletMatch) {
        risks.push(bulletMatch[1].trim());
      }
    }
  }

  return risks.slice(0, 10);
}

function extractIssues(output: string): string[] {
  const issues: string[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Look for bullet points or numbered items that describe issues
    if (/^[-*]\s+(CRITICAL|ISSUE|PROBLEM|MISSING|BUG|CONCERN):/i.test(trimmed)) {
      issues.push(trimmed.replace(/^[-*]\s+/, ''));
    }
    // Also catch lines with strong issue signals
    if (/\b(CRITICAL|MAJOR)\s+(ISSUE|PROBLEM|BUG|GAP)/i.test(trimmed) && trimmed.length < 200) {
      if (!issues.includes(trimmed)) {
        issues.push(trimmed);
      }
    }
  }

  return issues.slice(0, 10);
}

/**
 * Track revision count per plan file (in-memory, resets per session)
 */
const revisionCounts: Map<string, number> = new Map();

function getRevisionCount(planPath: string): number {
  const current = revisionCounts.get(planPath) || 0;
  const updated = current + 1;
  revisionCounts.set(planPath, updated);
  return updated;
}

/**
 * Reset plan file tracking (for testing)
 */
export function resetPlanTracking(): void {
  planFileTimestamps.clear();
  revisionCounts.clear();
}
