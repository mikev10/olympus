/**
 * Task pattern matching for agent routing optimization.
 * Uses simple keyword matching — no ML/NLP.
 */

/** Pattern keyword taxonomy */
const PATTERN_KEYWORDS: Record<string, string[]> = {
  simple_search: ['find file', 'search for', 'locate', 'where is', 'look for', 'find the'],
  debugging: ['debug', 'error', 'fix bug', 'why is', 'not working', 'broken', 'failing', 'crash'],
  implementation: ['implement', 'add feature', 'create function', 'build', 'write code', 'develop'],
  refactoring: ['refactor', 'restructure', 'reorganize', 'clean up', 'rename', 'extract'],
  documentation: ['document', 'write docs', 'add comments', 'explain', 'readme', 'api docs'],
  analysis: ['analyze', 'investigate', 'examine', 'review', 'understand', 'trace'],
};

/**
 * Extract task pattern categories from a task description.
 * Returns matching pattern names.
 */
export function extractPatterns(originalTask: string): string[] {
  if (!originalTask) return [];

  const taskLower = originalTask.toLowerCase();
  const matches: string[] = [];

  for (const [pattern, keywords] of Object.entries(PATTERN_KEYWORDS)) {
    for (const keyword of keywords) {
      if (taskLower.includes(keyword)) {
        matches.push(pattern);
        break; // One match per pattern is enough
      }
    }
  }

  return matches;
}

/**
 * Compute confidence score based on sample size.
 * Monotonically increasing with sample count.
 * Returns 0-1.
 */
export function computePatternConfidence(sampleSize: number): number {
  if (sampleSize <= 0) return 0;
  if (sampleSize >= 50) return 1.0;

  // Logarithmic growth: confidence = min(1, log2(sampleSize + 1) / log2(51))
  return Math.min(1, Math.log2(sampleSize + 1) / Math.log2(51));
}

/** Exported for testing */
export { PATTERN_KEYWORDS };
