import { join } from 'path';
import { homedir } from 'os';
import { readJsonFile } from './storage.js';

/**
 * Configuration for auto-discovery capture
 */
export interface DiscoveryConfig {
  enabled: boolean;
  minConfidence: number;
  maxPerSession: number;
  maxPerDay: number;
  deduplicationWindowDays: number;
}

/** Default discovery configuration */
const DEFAULT_CONFIG: DiscoveryConfig = {
  enabled: true,
  minConfidence: 0.6,
  maxPerSession: 5,
  maxPerDay: 20,
  deduplicationWindowDays: 7,
};

/**
 * Load discovery configuration with global + project override hierarchy.
 * Project config in `.olympus/config.json` overrides global config in `~/.claude/olympus/config.json`.
 */
export function loadDiscoveryConfig(projectPath?: string): DiscoveryConfig {
  // Load global config
  const globalConfigPath = join(homedir(), '.claude', 'olympus', 'config.json');
  const globalConfig = readJsonFile<{ autoDiscovery?: Partial<DiscoveryConfig> }>(globalConfigPath, {});

  // Load project config (overrides global)
  let projectConfig: { autoDiscovery?: Partial<DiscoveryConfig> } = {};
  if (projectPath) {
    const projectConfigPath = join(projectPath, '.olympus', 'config.json');
    projectConfig = readJsonFile<{ autoDiscovery?: Partial<DiscoveryConfig> }>(projectConfigPath, {});
  }

  // Merge: defaults → global → project
  const merged: DiscoveryConfig = {
    ...DEFAULT_CONFIG,
    ...(globalConfig.autoDiscovery || {}),
    ...(projectConfig.autoDiscovery || {}),
  };

  // Validate bounds
  merged.minConfidence = Math.max(0, Math.min(1, merged.minConfidence));
  merged.maxPerSession = Math.max(1, Math.min(50, merged.maxPerSession));
  merged.maxPerDay = Math.max(1, Math.min(200, merged.maxPerDay));
  merged.deduplicationWindowDays = Math.max(1, Math.min(90, merged.deduplicationWindowDays));

  return merged;
}
