import type { FeedbackEntry, ExtractedPattern } from './types.js';

/** Extract n-grams from text for similarity comparison */
function extractNgrams(text: string, n: number = 3): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, '');
  const words = normalized.split(/\s+/).filter(w => w.length > 0);

  if (words.length < n) {
    return new Set([normalized]);
  }

  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

/** Calculate Jaccard similarity between two texts (exported for reuse) */
export function jaccardSimilarity(text1: string, text2: string): number {
  const ngrams1 = extractNgrams(text1);
  const ngrams2 = extractNgrams(text2);

  const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
  const union = new Set([...ngrams1, ...ngrams2]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

/** Group similar feedback entries */
function clusterFeedback(
  entries: FeedbackEntry[],
  similarityThreshold: number = 0.3
): FeedbackEntry[][] {
  const clusters: FeedbackEntry[][] = [];
  const assigned = new Set<string>();

  for (const entry of entries) {
    if (assigned.has(entry.id)) continue;

    const cluster = [entry];
    assigned.add(entry.id);

    for (const other of entries) {
      if (assigned.has(other.id)) continue;

      const similarity = jaccardSimilarity(entry.user_message, other.user_message);
      if (similarity >= similarityThreshold) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

/** Extract patterns from feedback log */
export function extractPatterns(
  feedbackLog: FeedbackEntry[],
  minOccurrences: number = 3
): ExtractedPattern[] {
  // Only analyze corrections and clarifications
  const relevantFeedback = feedbackLog.filter(
    e => e.feedback_category === 'correction' ||
         e.feedback_category === 'clarification' ||
         e.feedback_category === 'explicit_preference'
  );

  const clusters = clusterFeedback(relevantFeedback);

  return clusters
    .filter(cluster => cluster.length >= minOccurrences)
    .map(cluster => {
      // Use the most recent entry as the pattern description
      const mostRecent = cluster.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )[0];

      // Calculate average confidence
      const avgConfidence = cluster.reduce((sum, e) => sum + e.confidence, 0) / cluster.length;

      // Determine scope
      const projectPaths = new Set(cluster.map(e => e.project_path));
      const scope = projectPaths.size === 1 ? 'project' : 'global';

      // Categorize
      const category = categorizePattern(cluster);

      return {
        pattern: generatePatternDescription(cluster),
        confidence: avgConfidence,
        evidence_count: cluster.length,
        evidence_examples: cluster.slice(0, 3).map(e => e.user_message),
        scope,
        category,
      };
    });
}

/** Generate human-readable pattern description */
function generatePatternDescription(cluster: FeedbackEntry[]): string {
  // Find common keywords in the cluster
  const allWords: Map<string, number> = new Map();

  for (const entry of cluster) {
    const words = entry.user_message.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);

    for (const word of words) {
      allWords.set(word, (allWords.get(word) || 0) + 1);
    }
  }

  // Get top 3 most common words
  const topWords = [...allWords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);

  // Return most recent message as base, with common themes noted
  const mostRecent = cluster[0].user_message.substring(0, 100);
  return mostRecent + (topWords.length > 0 ? ` [themes: ${topWords.join(', ')}]` : '');
}

/** Categorize pattern based on content */
function categorizePattern(cluster: FeedbackEntry[]): 'style' | 'behavior' | 'tooling' | 'communication' {
  const text = cluster.map(e => e.user_message).join(' ').toLowerCase();

  if (/typescript|eslint|prettier|format|indent|naming/i.test(text)) return 'style';
  if (/test|build|npm|yarn|run|command|install/i.test(text)) return 'tooling';
  if (/verbose|brief|explain|detail|ask|confirm/i.test(text)) return 'communication';
  return 'behavior';
}
