/**
 * Discovery Detection Logic
 *
 * Extracts discoveries from successful agent tasks, performs deduplication,
 * and infers categories from task descriptions.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { SessionState } from './types.js';
import type { AgentDiscovery, DiscoveryCategory } from './types.js';
import { getProjectLearningDir } from './storage.js';

/**
 * Detection methods that trigger discovery capture
 */
export type DetectionMethod = 'praise' | 'topic_change' | 'problem_solved';

/**
 * Confidence scores by detection method
 */
const CONFIDENCE_SCORES: Record<DetectionMethod, number> = {
  praise: 0.85,
  problem_solved: 0.7,
  topic_change: 0.6,
};

/**
 * Keyword patterns for category inference
 */
const CATEGORY_KEYWORDS: Array<{ pattern: RegExp; category: DiscoveryCategory }> = [
  { pattern: /\bworkaround\b/i, category: 'workaround' },
  { pattern: /\bgotcha\b/i, category: 'gotcha' },
  { pattern: /\bperformance\b/i, category: 'performance' },
  { pattern: /\bperformant\b/i, category: 'performance' },
  { pattern: /\bslow\b/i, category: 'performance' },
  { pattern: /\boptimiz/i, category: 'performance' },
  { pattern: /\bdependenc/i, category: 'dependency' },
  { pattern: /\bpackage\b/i, category: 'dependency' },
  { pattern: /\bpeer\s+dep/i, category: 'dependency' },
  { pattern: /\bconfig/i, category: 'configuration' },
  { pattern: /\benvironment\s+variable/i, category: 'configuration' },
  { pattern: /\benv\b/i, category: 'configuration' },
  { pattern: /\bpattern\b/i, category: 'pattern' },
  { pattern: /\bconvention\b/i, category: 'pattern' },
];

/**
 * Extract a discovery from the current session state.
 * Returns null if no pending_completion or no valid content.
 *
 * @param state - Current session state with pending_completion
 * @param detectionMethod - How the success was detected (praise, topic_change, etc.)
 * @returns Partial AgentDiscovery or null if extraction fails
 */
export function extractDiscovery(
  state: SessionState,
  detectionMethod: DetectionMethod
): Partial<AgentDiscovery> | null {
  // Require pending_completion with task context
  if (!state.pending_completion?.task_description) {
    return null;
  }

  const taskDescription = state.pending_completion.task_description;
  const agentUsed = state.pending_completion.agent_used || 'unknown';

  // Extract summary (first 100 chars, truncated at word boundary)
  const summary = truncateAtWordBoundary(taskDescription, 100);

  // Extract details (full task description, capped at 2000 chars)
  const details = taskDescription.length > 2000
    ? taskDescription.substring(0, 2000) + '...'
    : taskDescription;

  // Infer category from task description
  const category = inferCategory(taskDescription, agentUsed);

  // Calculate confidence based on detection method
  const confidence = CONFIDENCE_SCORES[detectionMethod] ?? 0.6;

  return {
    session_id: state.session_id,
    category,
    summary,
    details,
    agent_name: agentUsed,
    task_context: taskDescription.substring(0, 200),
    confidence,
    scope: 'project',
  };
}

/**
 * Check if a discovery is a duplicate using two-tier deduplication.
 *
 * Tier 1: Exact task_description match in last N days
 * Tier 2: Jaccard similarity > 0.7 on summary text
 *
 * @param discovery - The candidate discovery to check
 * @param projectPath - Path to the project
 * @param windowDays - Number of days to look back for duplicates (default: 7)
 * @returns true if the discovery is a duplicate
 */
export function isDuplicate(
  discovery: Partial<AgentDiscovery>,
  projectPath: string,
  windowDays: number = 7
): boolean {
  const existingDiscoveries = readRecentDiscoveries(projectPath, windowDays);

  if (existingDiscoveries.length === 0) {
    return false;
  }

  const candidateSummary = discovery.summary || '';
  const candidateDetails = discovery.details || '';

  for (const existing of existingDiscoveries) {
    // Tier 1: Exact task context match
    if (existing.details === candidateDetails && candidateDetails.length > 0) {
      return true;
    }

    // Tier 2: Jaccard similarity on summary
    if (candidateSummary.length > 0 && existing.summary) {
      const similarity = jaccardSimilarity(candidateSummary, existing.summary);
      if (similarity > 0.7) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Infer discovery category from task description and agent name.
 * Uses keyword matching with fallback to 'technical_insight'.
 *
 * @param taskDescription - The task description to analyze
 * @param agentName - The agent that performed the task
 * @returns The inferred DiscoveryCategory
 */
export function inferCategory(
  taskDescription: string,
  agentName: string
): DiscoveryCategory {
  // Check keyword patterns first (keywords override agent-based inference)
  for (const { pattern, category } of CATEGORY_KEYWORDS) {
    if (pattern.test(taskDescription)) {
      return category;
    }
  }

  // Default fallback
  return 'technical_insight';
}

/**
 * Calculate Jaccard similarity between two strings.
 * Uses word-level tokenization (words > 3 chars).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const extractKeywords = (text: string): Set<string> => {
    return new Set(
      text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)
    );
  };

  const setA = extractKeywords(a);
  const setB = extractKeywords(b);

  if (setA.size === 0 && setB.size === 0) return 1; // Both empty = identical
  if (setA.size === 0 || setB.size === 0) return 0; // One empty = no similarity

  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Truncate text at word boundary, ensuring max length.
 */
function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.5) {
    return truncated.substring(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Read recent discoveries from project storage for deduplication.
 */
function readRecentDiscoveries(
  projectPath: string,
  windowDays: number
): AgentDiscovery[] {
  const projectDir = getProjectLearningDir(projectPath);
  const filePath = join(projectDir, 'discoveries.jsonl');

  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const cutoffDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as AgentDiscovery;
        } catch {
          return null;
        }
      })
      .filter((d): d is AgentDiscovery => {
        if (!d) return false;
        return new Date(d.timestamp) >= cutoffDate;
      });
  } catch {
    return [];
  }
}
