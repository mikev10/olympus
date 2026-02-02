/**
 * Token Metrics CLI Commands Tests
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { logTokenMetric } from '../features/token-metrics/storage.js';
import type { TokenMetricsEntry } from '../features/token-metrics/types.js';

describe('Token Metrics CLI Commands', () => {
  it('logTokenMetric creates entry', async () => {
    // Create sample metrics in current directory
    const entry: TokenMetricsEntry = {
      timestamp: new Date().toISOString(),
      session_id: 'test-session',
      event_type: 'prompt',
      input_tokens: 100,
      output_tokens: 50,
      project_path: process.cwd()
    };

    await logTokenMetric(entry);

    const metricsPath = join(process.cwd(), '.olympus', 'token-metrics.jsonl');
    expect(existsSync(metricsPath)).toBe(true);
  });
});
