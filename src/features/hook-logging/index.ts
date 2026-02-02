/**
 * Hook Violation Logging
 *
 * Logs all hook violations (blocked and allowed) for debugging and analysis.
 * Violations are appended to .olympus/logs/hook-violations.jsonl
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

export interface HookViolation {
  timestamp: string;
  filePath: string;
  toolName: string;
  linesChanged?: number;
  wasBlocked: boolean;
  reason: string;
}

/**
 * Log a hook violation to .olympus/logs/hook-violations.jsonl
 */
export function logViolation(violation: HookViolation, workDir?: string): void {
  const baseDir = workDir || process.cwd();
  const logDir = join(baseDir, '.olympus', 'logs');
  const logPath = join(logDir, 'hook-violations.jsonl');

  try {
    // Create directory if needed
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    // Append violation as JSON line
    const line = JSON.stringify(violation) + '\n';
    appendFileSync(logPath, line, 'utf-8');
  } catch (error) {
    // Silently fail - don't block hook execution due to logging errors
    console.error('[Hook Logging] Failed to log violation:', error);
  }
}

/**
 * Get violation statistics from the log
 */
export function getViolationStats(workDir?: string): {
  total: number;
  byFile: Record<string, number>;
  byTool: Record<string, number>;
  blocked: number;
  allowed: number;
} {
  const baseDir = workDir || process.cwd();
  const logPath = join(baseDir, '.olympus', 'logs', 'hook-violations.jsonl');

  const stats = {
    total: 0,
    byFile: {} as Record<string, number>,
    byTool: {} as Record<string, number>,
    blocked: 0,
    allowed: 0,
  };

  try {
    if (!existsSync(logPath)) {
      return stats;
    }

    const content = readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const violation = JSON.parse(line) as HookViolation;
        stats.total++;

        // Count by file
        stats.byFile[violation.filePath] = (stats.byFile[violation.filePath] || 0) + 1;

        // Count by tool
        stats.byTool[violation.toolName] = (stats.byTool[violation.toolName] || 0) + 1;

        // Count blocked vs allowed
        if (violation.wasBlocked) {
          stats.blocked++;
        } else {
          stats.allowed++;
        }
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    return stats;
  } catch {
    return stats;
  }
}

/**
 * Read all violations from the log
 */
export function readViolations(workDir?: string): HookViolation[] {
  const baseDir = workDir || process.cwd();
  const logPath = join(baseDir, '.olympus', 'logs', 'hook-violations.jsonl');

  try {
    if (!existsSync(logPath)) {
      return [];
    }

    const content = readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const violations: HookViolation[] = [];
    for (const line of lines) {
      try {
        violations.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    return violations;
  } catch {
    return [];
  }
}

/**
 * Clear the violations log (for testing)
 */
export function clearViolations(workDir?: string): void {
  const baseDir = workDir || process.cwd();
  const logPath = join(baseDir, '.olympus', 'logs', 'hook-violations.jsonl');

  try {
    if (existsSync(logPath)) {
      const { unlinkSync } = require('fs');
      unlinkSync(logPath);
    }
  } catch {
    // Silently fail
  }
}
