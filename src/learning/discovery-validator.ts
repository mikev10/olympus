import type { AgentDiscovery } from './types.js';

/**
 * Validate and deduplicate discoveries before storage.
 */
export function validateDiscovery(discovery: AgentDiscovery): { valid: boolean; reason?: string } {
  // Check required fields
  if (!discovery.summary || discovery.summary.length < 10) {
    return { valid: false, reason: 'Summary too short (min 10 chars)' };
  }

  if (discovery.summary.length > 100) {
    return { valid: false, reason: 'Summary too long (max 100 chars)' };
  }

  if (!discovery.details || discovery.details.length < 20) {
    return { valid: false, reason: 'Details too short (min 20 chars)' };
  }

  if (discovery.confidence < 0.5) {
    return { valid: false, reason: 'Confidence too low (min 0.5)' };
  }

  return { valid: true };
}

/**
 * Check if a discovery is a duplicate of an existing one.
 */
export function isDuplicateDiscovery(
  newDiscovery: AgentDiscovery,
  existingDiscoveries: AgentDiscovery[]
): AgentDiscovery | null {
  // Simple similarity check based on summary
  const newSummaryLower = newDiscovery.summary.toLowerCase();

  for (const existing of existingDiscoveries) {
    const existingSummaryLower = existing.summary.toLowerCase();

    // Check for high similarity (>80% word overlap)
    const newWords = new Set(newSummaryLower.split(/\s+/));
    const existingWords = new Set(existingSummaryLower.split(/\s+/));
    const intersection = [...newWords].filter(w => existingWords.has(w));
    const similarity = intersection.length / Math.max(newWords.size, existingWords.size);

    if (similarity > 0.8) {
      return existing;
    }
  }

  return null;
}

/**
 * Merge a new discovery with an existing similar one.
 */
export function mergeDiscoveries(
  existing: AgentDiscovery,
  newDiscovery: AgentDiscovery
): AgentDiscovery {
  return {
    ...existing,
    // Keep higher confidence
    confidence: Math.max(existing.confidence, newDiscovery.confidence),
    // Merge details if new one is longer
    details: newDiscovery.details.length > existing.details.length
      ? newDiscovery.details
      : existing.details,
    // Merge files involved
    files_involved: [...new Set([
      ...(existing.files_involved || []),
      ...(newDiscovery.files_involved || [])
    ])],
    // Increment verification count (this confirms the discovery)
    verification_count: existing.verification_count + 1,
    last_useful: new Date().toISOString(),
  };
}

/**
 * Sanitize discovery fields before storage.
 */
export function sanitizeDiscovery(discovery: Partial<AgentDiscovery>): Partial<AgentDiscovery> {
  return {
    ...discovery,
    // Truncate summary to max 100 chars
    summary: discovery.summary?.substring(0, 100),
    // Truncate details to max 2000 chars
    details: discovery.details?.substring(0, 2000),
    // Ensure confidence is between 0 and 1
    confidence: Math.max(0, Math.min(1, discovery.confidence || 0.5)),
  };
}
