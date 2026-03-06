/**
 * Enforcement constants for AIDLC hooks.
 *
 * Provides read-only agent detection, bash write pattern matching,
 * and build-check default configuration.
 */

/**
 * Base names of agents that are read-only (should not write/edit files).
 * Does NOT include document-writer (which legitimately writes docs).
 */
export const READONLY_AGENT_BASES: readonly string[] = [
  'explore',
  'explore-medium',
  'librarian',
  'librarian-low',
  'oracle',
  'oracle-low',
  'oracle-medium',
  'momus',
  'metis',
  'multimodal-looker',
] as const;

/**
 * Checks whether a given agent name is a read-only agent.
 * Matches against READONLY_AGENT_BASES using exact match.
 *
 * @param agentName - The agent name to check (e.g., 'oracle-low')
 * @returns true if the agent should be restricted from write operations
 */
export function isReadOnlyAgent(agentName: string): boolean {
  return READONLY_AGENT_BASES.includes(agentName);
}

/**
 * Regex patterns that indicate a bash command is performing a write operation.
 * Used by agent-role-guard to detect write attempts via bash.
 *
 * Matches common shell write patterns:
 * - Redirect operators: >, >>
 * - File manipulation: rm, mv, cp, mkdir, rmdir, touch
 * - Package managers: npm install, pip install, cargo add
 * - File writers: tee, dd, install
 * - Editors: sed -i, awk (with -i)
 * - Permission changes: chmod, chown
 */
export const BASH_WRITE_PATTERNS: RegExp = /(?:^|\s|&&|\|\||;)(?:>|>>|rm\s|mv\s|cp\s|mkdir\s|rmdir\s|touch\s|npm\s+install|pip\s+install|cargo\s+add|tee\s|dd\s|install\s|sed\s+-i|awk\s+-i|chmod\s|chown\s)/;

/**
 * Default configuration for the build-check hook.
 */
export const BUILD_CHECK_DEFAULTS = {
  /** Debounce interval in milliseconds */
  debounceMs: 10_000,
  /** Default check mode: 'soft' warns, 'strict' blocks */
  mode: 'soft' as const,
  /** Whether build-check is enabled by default */
  enabled: true,
} as const;
