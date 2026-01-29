/**
 * Read Tool File Size Limit Recovery Hook
 *
 * Intercepts Read tool errors when files exceed the 25000 token limit
 * and provides helpful recovery strategies.
 */

export type { ReadToolSizeError } from './types.js';

const FILE_SIZE_LIMIT_PATTERN = /File content \((\d+) tokens\) exceeds maximum allowed tokens \((\d+)\)/i;
const ALTERNATE_PATTERN = /exceeds maximum allowed tokens/i;

/**
 * Parse the error to extract token counts
 */
function parseFileSizeError(error: string): { current: number; max: number } | null {
  const match = error.match(FILE_SIZE_LIMIT_PATTERN);
  if (match) {
    return {
      current: parseInt(match[1], 10),
      max: parseInt(match[2], 10),
    };
  }
  return null;
}

/**
 * Check if error is a Read tool file size limit error
 */
function isReadToolSizeError(toolName: string, error: string): boolean {
  return toolName.toLowerCase() === 'read' && (
    FILE_SIZE_LIMIT_PATTERN.test(error) ||
    ALTERNATE_PATTERN.test(error)
  );
}

/**
 * Generate recovery message with strategies
 */
function generateRecoveryMessage(
  filePath: string,
  tokens?: { current: number; max: number }
): string {
  const tokenInfo = tokens
    ? `The file contains ${tokens.current} tokens, exceeding the ${tokens.max} token limit.`
    : 'The file is too large to read in one operation.';

  return `[SYSTEM RECOVERY - READ TOOL FILE SIZE LIMIT]

${tokenInfo}

**File**: ${filePath}

**RECOVERY STRATEGIES**:

1. **Use Grep for Targeted Search** (RECOMMENDED for finding specific content):
   - Grep(pattern="keyword", path="${filePath}", output_mode="content")
   - More efficient than reading entire file

2. **Read in Chunks** (for sequential reading):
   - Read(file_path="${filePath}", offset=0, limit=500)    # First 500 lines
   - Read(file_path="${filePath}", offset=500, limit=500)  # Next 500 lines
   - Continue with additional chunks as needed

3. **Strategic Partial Read** (if you know which section you need):
   - Read(file_path="${filePath}", offset=0, limit=100)    # Read header/summary
   - Use Grep to find specific sections, then read those ranges

4. **Summarization via Multimodal Agent** (for getting overview):
   - Task(subagent_type="multimodal-looker", prompt="Summarize the key points from ${filePath}")

**CHOOSE THE RIGHT STRATEGY**:
- Need specific content? → Use Grep
- Need to read sequentially? → Use offset/limit chunks
- Need overview/summary? → Use multimodal-looker agent
- Need specific section? → Grep to find it, then Read that portion

Proceed with one of these strategies.`.trim();
}

/**
 * Create Read Tool Limit Recovery Hook
 *
 * Returns a hook object compatible with the post-tool-use registration pattern.
 */
export function createReadToolLimitRecoveryHook() {
  return {
    /**
     * PostToolUse - Check for file size limit errors in Read tool responses
     */
    postToolUse: (input: {
      tool_name: string;
      session_id: string;
      tool_input: Record<string, unknown>;
      tool_response?: string;
    }): string | null => {
      if (!input.tool_response) {
        return null;
      }

      // Only handle Read tool errors
      if (!isReadToolSizeError(input.tool_name, input.tool_response)) {
        return null;
      }

      // Extract file path from tool input
      const filePath = (input.tool_input?.file_path as string) || '<unknown file>';

      // Parse token counts if available
      const tokens = parseFileSizeError(input.tool_response);

      // Generate recovery message
      const message = generateRecoveryMessage(filePath, tokens || undefined);

      return message;
    },
  };
}
