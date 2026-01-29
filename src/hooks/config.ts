/**
 * Hook Configuration Loader
 *
 * Loads hook configuration from olympus.jsonc files.
 * Supports project-local and user-global configuration.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { PluginConfig } from '../shared/types.js';

/** Config file paths to search (project then user) */
const CONFIG_PATHS = [
  join(process.cwd(), '.claude', 'olympus.jsonc'),
  join(homedir(), '.claude', 'olympus.jsonc')
];

/** Cached config and timestamp */
let cachedConfig: PluginConfig | null = null;
let lastLoadTime = 0;
const CACHE_TTL_MS = 5000;

/**
 * Strip JSONC comments from content.
 * Handles both single-line (//) and multi-line comments.
 *
 * Note: This is a simple implementation. Consider using jsonc-parser
 * library for production use with complex JSONC files.
 *
 * @param content - JSONC content
 * @returns JSON content with comments removed
 */
function stripJsoncComments(content: string): string {
  // Remove single-line comments
  let result = content.replace(/\/\/.*$/gm, '');
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}

/**
 * Load configuration from olympus.jsonc files.
 *
 * Searches for config in:
 * 1. ./.claude/olympus.jsonc (project)
 * 2. ~/.claude/olympus.jsonc (user)
 *
 * Config is cached for 5 seconds to avoid repeated reads.
 *
 * @returns Plugin configuration (empty object if no config found)
 */
export async function loadConfig(): Promise<PluginConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedConfig && now - lastLoadTime < CACHE_TTL_MS) {
    return cachedConfig;
  }

  // Try each config path
  for (const configPath of CONFIG_PATHS) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        const jsonContent = stripJsoncComments(content);
        cachedConfig = JSON.parse(jsonContent);
        lastLoadTime = now;
        return cachedConfig!;
      } catch (error) {
        // Log error and try next path
        console.error(`[config] Failed to load ${configPath}:`, error);
      }
    }
  }

  // No config found, return empty
  cachedConfig = {};
  lastLoadTime = now;
  return cachedConfig;
}

/**
 * Clear the configuration cache.
 * Primarily used for testing.
 */
export function clearConfigCache(): void {
  cachedConfig = null;
  lastLoadTime = 0;
}

/**
 * Get the paths searched for config files.
 *
 * @returns Array of config file paths
 */
export function getConfigPaths(): string[] {
  return [...CONFIG_PATHS];
}

/**
 * Check if a specific hook is enabled in config.
 * Returns true if the hook is enabled or not configured.
 *
 * @param config - Plugin config
 * @param hookName - Name of the hook
 * @returns Whether the hook is enabled
 */
export function isHookEnabled(config: PluginConfig, hookName: string): boolean {
  // Global hooks disable
  if (config.hooks?.enabled === false) {
    return false;
  }

  // Check hook-specific config
  const hookConfig = (config.hooks as Record<string, { enabled?: boolean } | undefined>)?.[hookName];
  if (hookConfig?.enabled === false) {
    return false;
  }

  // Default to enabled
  return true;
}

/**
 * Get the hook timeout from config.
 *
 * @param config - Plugin config
 * @returns Timeout in milliseconds (default: 100)
 */
export function getHookTimeout(config: PluginConfig): number {
  return config.hooks?.hookTimeoutMs ?? 100;
}
