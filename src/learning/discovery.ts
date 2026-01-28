import { join, dirname } from 'path';
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { getLearningDir, getProjectLearningDir, ensureLearningDirs } from './storage.js';
import type { AgentDiscovery, DiscoveryCategory, DiscoverySummary } from './types.js';

/**
 * Record a discovery made by an agent during work.
 * This is the primary API for agents to capture learnings.
 */
export function recordDiscovery(
  discovery: Omit<AgentDiscovery, 'id' | 'timestamp' | 'verified' | 'verification_count' | 'last_useful'>
): AgentDiscovery {
  const entry: AgentDiscovery = {
    ...discovery,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    verified: false,
    verification_count: 0,
    last_useful: new Date().toISOString(),
  };

  // Determine storage location
  const storageDir = entry.scope === 'global'
    ? getLearningDir()
    : getProjectLearningDir(entry.project_path);

  ensureLearningDirs(entry.project_path);

  const filePath = join(storageDir, 'discoveries.jsonl');
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');

  return entry;
}

/**
 * Read all discoveries for a project (includes global discoveries).
 */
export function readDiscoveries(projectPath: string): DiscoverySummary {
  const globalPath = join(getLearningDir(), 'discoveries.jsonl');
  const projectDir = getProjectLearningDir(projectPath);
  const projectDiscoveriesPath = join(projectDir, 'discoveries.jsonl');

  const globalDiscoveries = readDiscoveryFile(globalPath);
  const projectDiscoveries = readDiscoveryFile(projectDiscoveriesPath);

  // Calculate statistics
  const all = [...globalDiscoveries, ...projectDiscoveries];
  const categories: Record<DiscoveryCategory, number> = {
    technical_insight: 0,
    workaround: 0,
    pattern: 0,
    gotcha: 0,
    performance: 0,
    dependency: 0,
    configuration: 0,
  };

  for (const d of all) {
    categories[d.category]++;
  }

  // Sort by verification count for most_useful
  const sorted = [...all].sort((a, b) => b.verification_count - a.verification_count);

  return {
    project_discoveries: projectDiscoveries,
    global_discoveries: globalDiscoveries,
    total_discoveries: all.length,
    categories,
    most_useful: sorted.slice(0, 5),
  };
}

/**
 * Mark a discovery as useful (increments verification_count).
 */
export function markDiscoveryUseful(discoveryId: string, projectPath: string): void {
  const globalPath = join(getLearningDir(), 'discoveries.jsonl');
  const projectLearningPath = join(projectPath, '.olympus', 'learning', 'discoveries.jsonl');

  // Helper to update discoveries in a JSONL file
  const updateFile = (filePath: string): boolean => {
    if (!existsSync(filePath)) return false;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    let found = false;

    const updated = lines.map(line => {
      try {
        const discovery = JSON.parse(line) as AgentDiscovery;
        if (discovery.id === discoveryId) {
          found = true;
          discovery.verification_count = (discovery.verification_count || 0) + 1;
          discovery.last_useful = new Date().toISOString();
        }
        return JSON.stringify(discovery);
      } catch {
        return line; // Keep malformed lines as-is
      }
    });

    if (found) {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, updated.join('\n') + '\n', 'utf-8');
    }
    return found;
  };

  // Try project-specific first, then global
  if (!updateFile(projectLearningPath)) {
    updateFile(globalPath);
  }
}

/**
 * Get discoveries relevant for context injection.
 * Returns top discoveries filtered by recency and usefulness.
 */
export function getDiscoveriesForInjection(
  projectPath: string,
  maxCount: number = 10
): AgentDiscovery[] {
  const summary = readDiscoveries(projectPath);
  const all = [...summary.project_discoveries, ...summary.global_discoveries];

  // Filter out expired discoveries
  const now = new Date();
  const active = all.filter(d => {
    if (!d.expires_at) return true;
    return new Date(d.expires_at) > now;
  });

  // Score by: verification_count * recency_factor
  const scored = active.map(d => {
    const age = (now.getTime() - new Date(d.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    const recencyFactor = Math.max(0.1, 1 - (age / 90)); // Decay over 90 days
    const score = (d.verification_count + 1) * recencyFactor * d.confidence;
    return { discovery: d, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, maxCount).map(s => s.discovery);
}

function readDiscoveryFile(filePath: string): AgentDiscovery[] {
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as AgentDiscovery);
  } catch (error) {
    console.error(`[Olympus Learning] Failed to read discoveries: ${error}`);
    return [];
  }
}
