/**
 * Token estimation utilities for Olympus metrics
 *
 * Uses gpt-tokenizer for accurate token counting with fallback to character-based estimation.
 * Token counts are approximations for tracking trends, not exact billing calculations.
 */

import type { TokenEstimate, ConversationMetrics } from './types.js';

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
 * Convert unknown input to string for token estimation
 */
function stringifyInput(input: unknown): { text: string; inputType: TokenEstimate['inputType'] } {
  if (input === null || input === undefined) {
    return { text: '', inputType: 'unknown' };
  }

  if (typeof input === 'string') {
    return { text: input, inputType: 'string' };
  }

  if (Array.isArray(input)) {
    return { text: JSON.stringify(input), inputType: 'array' };
  }

  if (typeof input === 'object') {
    return { text: JSON.stringify(input), inputType: 'object' };
  }

  return { text: String(input), inputType: 'unknown' };
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
 * Estimate tokens with detailed metadata
 *
 * @param input - Input to estimate (string, object, array, etc.)
 * @returns Token estimate with method and input type
 */
export async function estimateTokensDetailed(input: unknown): Promise<TokenEstimate> {
  const { text, inputType } = stringifyInput(input);

  if (!text || text.length === 0) {
    return {
      tokens: 0,
      method: 'character-fallback',
      inputType,
    };
  }

  await initTokenizer();

  try {
    if (encode) {
      const tokens = encode(text);
      return {
        tokens: tokens.length,
        method: 'gpt-tokenizer',
        inputType,
      };
    }
  } catch (error) {
    // Fall through to character-based estimation
  }

  return {
    tokens: estimateTokensByCharacters(text),
    method: 'character-fallback',
    inputType,
  };
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
  const { text } = stringifyInput(output);
  return estimateTokens(text);
}

/**
 * Estimate total context size from conversation messages
 *
 * @param messages - Array of message objects (any format with text content)
 * @returns Conversation metrics with total tokens and averages
 *
 * @example
 * ```ts
 * const messages = [
 *   { role: "user", content: "Hello" },
 *   { role: "assistant", content: "Hi there!" }
 * ];
 * const metrics = await estimateContextSize(messages);
 * console.log(metrics.totalTokens); // ~8 tokens
 * ```
 */
export async function estimateContextSize(messages: unknown[]): Promise<ConversationMetrics> {
  if (!messages || messages.length === 0) {
    return {
      totalTokens: 0,
      messageCount: 0,
      averageTokensPerMessage: 0,
    };
  }

  let totalTokens = 0;

  for (const message of messages) {
    if (!message) continue;

    // Handle various message formats
    if (typeof message === 'string') {
      totalTokens += await estimateTokens(message);
    } else if (typeof message === 'object') {
      const obj = message as Record<string, unknown>;

      // Check common message content fields
      if ('content' in obj) {
        if (typeof obj.content === 'string') {
          totalTokens += await estimateTokens(obj.content);
        } else if (Array.isArray(obj.content)) {
          // Handle multi-part content (e.g., Claude SDK format)
          for (const part of obj.content) {
            if (typeof part === 'string') {
              totalTokens += await estimateTokens(part);
            } else if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
              totalTokens += await estimateTokens(part.text);
            }
          }
        }
      } else if ('text' in obj && typeof obj.text === 'string') {
        totalTokens += await estimateTokens(obj.text);
      } else {
        // Fallback: entire message object
        totalTokens += await estimateTokensFromToolOutput(message);
      }
    }
  }

  return {
    totalTokens,
    messageCount: messages.length,
    averageTokensPerMessage: messages.length > 0 ? Math.round(totalTokens / messages.length) : 0,
  };
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
