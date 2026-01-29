import { join } from 'path';
import { existsSync, statSync, readdirSync } from 'fs';
import { getLearningDir, getProjectLearningDir, readFeedbackLog } from './storage.js';
import { readDiscoveries } from './discovery.js';
import type { AgentPerformance } from './types.js';

export interface LearningStats {
  feedback: {
    total_entries: number;
    file_size_mb: number;
    categories: Record<string, number>;
  };
  discoveries: {
    total: number;
    by_category: Record<string, number>;
    most_verified: Array<{ summary: string; count: number }>;
  };
  storage: {
    total_size_mb: number;
    archived_files: number;
  };
  agent_performance?: Record<string, {
    success_rate: number;
    total_invocations: number;
  }>;
}

/** Generate learning statistics */
export function generateLearningStats(projectPath: string): LearningStats {
  const globalDir = getLearningDir();
  const projectDir = getProjectLearningDir(projectPath);

  // Feedback stats
  const feedbackLog = readFeedbackLog();
  const feedbackCategories: Record<string, number> = {};
  for (const entry of feedbackLog) {
    feedbackCategories[entry.feedback_category] = (feedbackCategories[entry.feedback_category] || 0) + 1;
  }

  const feedbackPath = join(globalDir, 'feedback-log.jsonl');
  const feedbackSize = existsSync(feedbackPath)
    ? statSync(feedbackPath).size / (1024 * 1024)
    : 0;

  // Discovery stats
  const discoveries = readDiscoveries(projectPath);
  const discoveryCategories: Record<string, number> = {};
  for (const category in discoveries.categories) {
    discoveryCategories[category] = discoveries.categories[category as keyof typeof discoveries.categories];
  }

  const mostVerified = discoveries.most_useful.slice(0, 5).map(d => ({
    summary: d.summary,
    count: d.verification_count,
  }));

  // Storage stats
  let totalSize = 0;
  let archivedCount = 0;

  const countArchived = (dir: string) => {
    if (!existsSync(dir)) return;
    const files = readdirSync(dir);
    for (const file of files) {
      const filePath = join(dir, file);
      if (file.endsWith('.old.jsonl')) {
        archivedCount++;
      }
      if (existsSync(filePath)) {
        const stats = statSync(filePath);
        if (stats.isFile()) {
          totalSize += stats.size;
        }
      }
    }
  };

  countArchived(globalDir);
  countArchived(projectDir);

  return {
    feedback: {
      total_entries: feedbackLog.length,
      file_size_mb: parseFloat(feedbackSize.toFixed(2)),
      categories: feedbackCategories,
    },
    discoveries: {
      total: discoveries.total_discoveries,
      by_category: discoveryCategories,
      most_verified: mostVerified,
    },
    storage: {
      total_size_mb: parseFloat((totalSize / (1024 * 1024)).toFixed(2)),
      archived_files: archivedCount,
    },
  };
}

/** Format stats for console output */
export function formatLearningStats(stats: LearningStats): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Learning System Statistics');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  // Feedback
  lines.push(`Feedback Entries:    ${stats.feedback.total_entries} (${stats.feedback.file_size_mb} MB)`);
  lines.push(`Discoveries:         ${stats.discoveries.total}`);
  lines.push(`Total Storage:       ${stats.storage.total_size_mb} MB`);
  if (stats.storage.archived_files > 0) {
    lines.push(`Archived Files:      ${stats.storage.archived_files}`);
  }
  lines.push('');

  // Feedback categories
  if (Object.keys(stats.feedback.categories).length > 0) {
    lines.push('Feedback by Category:');
    for (const [category, count] of Object.entries(stats.feedback.categories)) {
      lines.push(`  ${category.padEnd(20)} ${count}`);
    }
    lines.push('');
  }

  // Discovery categories
  if (Object.keys(stats.discoveries.by_category).length > 0) {
    lines.push('Discoveries by Category:');
    for (const [category, count] of Object.entries(stats.discoveries.by_category)) {
      lines.push(`  ${category.padEnd(20)} ${count}`);
    }
    lines.push('');
  }

  // Most verified discoveries
  if (stats.discoveries.most_verified.length > 0) {
    lines.push('Top Verified Discoveries:');
    for (const [idx, discovery] of stats.discoveries.most_verified.entries()) {
      const summary = discovery.summary.length > 60
        ? discovery.summary.substring(0, 57) + '...'
        : discovery.summary;
      lines.push(`  ${idx + 1}. ${summary} (${discovery.count}×)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
