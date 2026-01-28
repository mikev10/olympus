/**
 * Types for Read Tool Limit Recovery Hook
 */

/**
 * Information about a file size error from the Read tool
 */
export interface ReadToolSizeError {
  /** Number of tokens in the file */
  currentTokens: number;
  /** Maximum allowed tokens */
  maxTokens: number;
  /** Path to the file that exceeded the limit */
  filePath: string;
}
