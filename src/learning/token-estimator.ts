/**
 * Token estimation utilities for Olympus learning system
 *
 * Uses gpt-tokenizer for accurate token counting with fallback to character-based estimation.
 * Token counts are approximations for tracking trends, not exact billing calculations.
 */

let encode: ((text: string) => number[]) | null = null;
let tokenizerInitialized = false;

/**
 * Initialize the GPT tokenizer (lazy-loaded)
 */
async function initTokenizer(): Promise<void> {
  if (tokenizerInitialized) return;

  try {
    // Dynamic import for gpt-tokenizer
    const { encode: gptEncode } = await import('gpt-tokenizer');
    encode = gptEncode;
    tokenizerInitialized = true;
  } catch (error) {
    // Tokenizer unavailable, will fall back to character counting
    tokenizerInitialized = true;
  }
}

/**
 * Estimate token count using character-based heuristic
 * Claude/GPT-4 average: ~1 token per 4 characters
 */
function estimateTokensByCharacters(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Main token estimation function
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 *
 * @example
 * ```ts
 * const tokens = await estimateTokens("Hello, world!");
 * console.log(tokens); // ~4 tokens
 * ```
 */
export async function estimateTokens(text: string): Promise<number> {
  if (!text || text.length === 0) {
    return 0;
  }

  await initTokenizer();

  try {
    if (encode) {
      const tokens = encode(text);
      return tokens.length;
    }
  } catch (error) {
    // Fall through to character-based estimation
  }

  return estimateTokensByCharacters(text);
}

/**
 * Estimate tokens from tool output (handles various result formats)
 *
 * @param output - Tool output object (from Claude Code SDK)
 * @returns Estimated token count
 *
 * @example
 * ```ts
 * const readResult = { content: "file contents..." };
 * const tokens = await estimateTokensFromToolOutput(readResult);
 * ```
 */
export async function estimateTokensFromToolOutput(output: unknown): Promise<number> {
  if (!output) {
    return 0;
  }

  // Handle common tool output formats
  if (typeof output === 'object' && output !== null) {
    // Check for common content fields
    const obj = output as Record<string, unknown>;

    if ('content' in obj && typeof obj.content === 'string') {
      return estimateTokens(obj.content);
    }

    if ('output' in obj && typeof obj.output === 'string') {
      return estimateTokens(obj.output);
    }

    if ('text' in obj && typeof obj.text === 'string') {
      return estimateTokens(obj.text);
    }

    if ('result' in obj && typeof obj.result === 'string') {
      return estimateTokens(obj.result);
    }
  }

  // Fallback: stringify entire object
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  return estimateTokens(text);
}

/**
 * Synchronous version of estimateTokens using only character-based estimation
 * Useful when async operations aren't possible
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count (character-based)
 */
export function estimateTokensSync(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }
  return estimateTokensByCharacters(text);
}
