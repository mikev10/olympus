/**
 * Directory README Injector Types
 *
 * Type definitions for tracking injected README files per session.
 *
 * Olympus directory-readme-injector hook for extending Claude Code behavior.
 */

/**
 * Storage data for tracking which directory READMEs have been injected
 * into a session's context.
 */
export interface InjectedPathsData {
  /** Session identifier */
  sessionID: string;
  /** List of directory paths whose READMEs have been injected */
  injectedPaths: string[];
  /** Timestamp of last update */
  updatedAt: number;
}
