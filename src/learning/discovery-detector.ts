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

  // Extract meaningful summary from task description
  const summary = extractActionSummary(taskDescription);

  // Extract key details (first meaningful section, code blocks stripped, capped at 500 chars)
  const details = extractKeyDetails(taskDescription);

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
 * Extract the first meaningful sentence from text.
 * Stops at first period, newline, or maxLength (whichever comes first).
 */
export function extractFirstSentence(text: string, maxLength: number = 100): string {
  if (!text || text.length === 0) return '';

  // Find first period followed by space, or newline, or max length
  const periodMatch = text.match(/^[^.]+\./);
  const newlineIndex = text.indexOf('\n');

  let endIndex = text.length;

  if (periodMatch && periodMatch[0].length <= maxLength) {
    endIndex = Math.min(endIndex, periodMatch[0].length);
  }

  if (newlineIndex > 0 && newlineIndex <= maxLength) {
    endIndex = Math.min(endIndex, newlineIndex);
  }

  endIndex = Math.min(endIndex, maxLength);

  const result = text.substring(0, endIndex).trim();

  if (result.length < text.length && !result.endsWith('.')) {
    return truncateAtWordBoundary(result, maxLength);
  }

  return result;
}

/**
 * Strip file paths from text (Windows and Unix paths).
 * Removes patterns like C:\Users\..., /home/user/..., or backtick-wrapped paths.
 */
export function stripFilePaths(text: string): string {
  // Remove backtick-wrapped paths first (more specific)
  let result = text.replace(/`[^`]*[\\\/][^`]*`/g, '');

  // Remove Windows paths (C:\..., D:\...)
  result = result.replace(/[A-Z]:[\\\/][\w\\\/.@-]+/gi, '');

  // Remove Unix paths (/home/..., /Users/..., /var/...) - but be careful with markdown links
  // Only remove if it looks like a file system path (contains multiple segments)
  result = result.replace(/\/[\w-]+(?:\/[\w\/.@-]+)+/g, '');

  // Clean up extra spaces left by path removal
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Extract an action-oriented summary from a task description.
 * Converts action verbs to past tense and focuses on what was done.
 */
export function extractActionSummary(taskDescription: string): string {
  if (!taskDescription || taskDescription.length === 0) {
    return 'Completed task';
  }

  // Common action verbs and their past tense forms
  const actionVerbs: Record<string, string> = {
    'Create': 'Created',
    'Fix': 'Fixed',
    'Update': 'Updated',
    'Add': 'Added',
    'Implement': 'Implemented',
    'Build': 'Built',
    'Write': 'Wrote',
    'Configure': 'Configured',
    'Set up': 'Set up',
    'Setup': 'Set up',
    'Install': 'Installed',
    'Remove': 'Removed',
    'Delete': 'Deleted',
    'Refactor': 'Refactored',
    'Test': 'Tested',
    'Debug': 'Debugged',
    'Deploy': 'Deployed',
    'Migrate': 'Migrated',
    'VERIFY': 'Verified',
    'Verify': 'Verified',
    'Analyze': 'Analyzed',
    'Review': 'Reviewed',
    'Explore': 'Explored',
    'Investigate': 'Investigated',
  };

  // Strip file paths first
  let cleaned = stripFilePaths(taskDescription);

  // Get first sentence or line
  const firstSentence = extractFirstSentence(cleaned, 150);

  // Check if it starts with an action verb
  for (const [present, past] of Object.entries(actionVerbs)) {
    const pattern = new RegExp(`^${present}\\b`, 'i');
    if (pattern.test(firstSentence)) {
      // Replace with past tense
      const transformed = firstSentence.replace(pattern, past);

      // Clean up and truncate
      return truncateAtWordBoundary(transformed.trim(), 100);
    }
  }

  // If no action verb found, extract first meaningful phrase
  // Look for patterns like "In the X project, Y" -> "Y"
  const inPatternMatch = cleaned.match(/^In the .+? project,\s*(.+)/i);
  if (inPatternMatch) {
    const extracted = inPatternMatch[1].trim();
    // Try to make it action-oriented
    if (extracted.toLowerCase().startsWith('i need to')) {
      const action = extracted.replace(/^i need to\s+/i, '');
      return truncateAtWordBoundary(action.charAt(0).toUpperCase() + action.slice(1), 100);
    }
    return truncateAtWordBoundary(extracted, 100);
  }

  // Fallback: just use the first sentence, stripped of paths
  return truncateAtWordBoundary(firstSentence, 100);
}

/**
 * Extract key details from task description.
 * Strips code blocks, extracts first section/paragraph, caps at 500 chars.
 */
export function extractKeyDetails(taskDescription: string): string {
  if (!taskDescription || taskDescription.length === 0) {
    return '';
  }

  let text = taskDescription;

  // Strip code blocks (```...``` or `...`)
  text = text.replace(/```[\s\S]*?```/g, '[code block]');
  text = text.replace(/`[^`]+`/g, '');

  // Look for first markdown section (## heading)
  const sectionMatch = text.match(/^(.*?)(?=\n##|\n\n##|$)/s);
  if (sectionMatch) {
    text = sectionMatch[1].trim();
  }

  // If we have numbered steps, extract just the step descriptions
  const stepsMatch = text.match(/^\d+\.\s+(.+)/gm);
  if (stepsMatch && stepsMatch.length > 0) {
    // Take first 3 steps
    const steps = stepsMatch.slice(0, 3).map(step => {
      return step.replace(/^\d+\.\s+/, '').trim();
    });
    text = steps.join('; ');
  }

  // Take first paragraph if we have multiple paragraphs
  const firstParagraph = text.split(/\n\n/)[0];
  text = firstParagraph || text;

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Cap at 500 chars
  if (text.length > 500) {
    return truncateAtWordBoundary(text, 500);
  }

  return text;
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
