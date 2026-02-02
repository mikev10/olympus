/**
 * Type definitions for the Olympus token metrics tracking system
 */

/**
 * Token metrics entry for JSONL storage
 */
export interface TokenMetricsEntry {
  timestamp: string;           // ISO 8601
  session_id: string;          // correlate events
  event_type: 'prompt' | 'tool_use' | 'response';
  input_tokens?: number;       // estimated input tokens
  output_tokens?: number;      // estimated output tokens
  model?: string;              // model used
  tool_name?: string;          // tool name (if tool_use event)
  context_size?: number;       // total conversation size estimate
  project_path?: string;       // working directory
}

/**
 * Aggregated metrics for reporting
 */
export interface TokenMetricsReport {
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  events_count: number;
  session_count: number;

  by_event_type: Record<string, {
    input_tokens: number;
    output_tokens: number;
    count: number;
  }>;

  by_model: Record<string, {
    input_tokens: number;
    output_tokens: number;
    count: number;
  }>;

  by_project: Record<string, {
    input_tokens: number;
    output_tokens: number;
    count: number;
  }>;

  date_range: {
    start: string;
    end: string;
  };
}

/**
 * Token estimation result with metadata
 */
export interface TokenEstimate {
  tokens: number;
  method: 'gpt-tokenizer' | 'character-fallback';
  inputType: 'string' | 'object' | 'array' | 'unknown';
}

/**
 * Conversation-level token metrics
 */
export interface ConversationMetrics {
  totalTokens: number;
  messageCount: number;
  averageTokensPerMessage: number;
}
