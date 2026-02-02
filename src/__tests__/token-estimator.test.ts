/**
 * Tests for token estimation utilities
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateTokensDetailed,
  estimateTokensFromToolOutput,
  estimateContextSize,
  estimateTokensSync,
} from '../features/token-metrics/index.js';

describe('Token Estimator', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens for simple text', async () => {
      const text = 'Hello, world!';
      const tokens = await estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10); // ~3-4 tokens
    });

    it('should return 0 for empty string', async () => {
      const tokens = await estimateTokens('');
      expect(tokens).toBe(0);
    });

    it('should handle long text', async () => {
      const longText = 'a'.repeat(1000);
      const tokens = await estimateTokens(longText);
      expect(tokens).toBeGreaterThan(100); // ~250 tokens
    });

    it('should handle multi-line text', async () => {
      const text = 'Line 1\nLine 2\nLine 3';
      const tokens = await estimateTokens(text);
      expect(tokens).toBeGreaterThan(3);
    });

    it('should handle code snippets', async () => {
      const code = `
function hello() {
  console.log("Hello, world!");
}
      `.trim();
      const tokens = await estimateTokens(code);
      expect(tokens).toBeGreaterThan(5);
    });
  });

  describe('estimateTokensDetailed', () => {
    it('should return detailed estimation for string', async () => {
      const result = await estimateTokensDetailed('Hello');
      expect(result.tokens).toBeGreaterThan(0);
      expect(result.method).toMatch(/gpt-tokenizer|character-fallback/);
      expect(result.inputType).toBe('string');
    });

    it('should handle objects', async () => {
      const obj = { key: 'value', nested: { data: 'test' } };
      const result = await estimateTokensDetailed(obj);
      expect(result.tokens).toBeGreaterThan(0);
      expect(result.inputType).toBe('object');
    });

    it('should handle arrays', async () => {
      const arr = ['item1', 'item2', 'item3'];
      const result = await estimateTokensDetailed(arr);
      expect(result.tokens).toBeGreaterThan(0);
      expect(result.inputType).toBe('array');
    });

    it('should handle null/undefined', async () => {
      const result1 = await estimateTokensDetailed(null);
      expect(result1.tokens).toBe(0);

      const result2 = await estimateTokensDetailed(undefined);
      expect(result2.tokens).toBe(0);
    });
  });

  describe('estimateTokensFromToolOutput', () => {
    it('should extract tokens from content field', async () => {
      const output = { content: 'Tool result content' };
      const tokens = await estimateTokensFromToolOutput(output);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should extract tokens from output field', async () => {
      const output = { output: 'Command output' };
      const tokens = await estimateTokensFromToolOutput(output);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should extract tokens from text field', async () => {
      const output = { text: 'Text data' };
      const tokens = await estimateTokensFromToolOutput(output);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should extract tokens from result field', async () => {
      const output = { result: 'Operation result' };
      const tokens = await estimateTokensFromToolOutput(output);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should fallback to stringifying entire object', async () => {
      const output = { customField: 'data', nested: { more: 'data' } };
      const tokens = await estimateTokensFromToolOutput(output);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle null/undefined', async () => {
      const tokens1 = await estimateTokensFromToolOutput(null);
      expect(tokens1).toBe(0);

      const tokens2 = await estimateTokensFromToolOutput(undefined);
      expect(tokens2).toBe(0);
    });

    it('should handle string output', async () => {
      const tokens = await estimateTokensFromToolOutput('Direct string output');
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateContextSize', () => {
    it('should estimate total tokens for conversation', async () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there! How can I help you?' },
        { role: 'user', content: 'What is the weather?' },
      ];
      const metrics = await estimateContextSize(messages);

      expect(metrics.messageCount).toBe(3);
      expect(metrics.totalTokens).toBeGreaterThan(0);
      expect(metrics.averageTokensPerMessage).toBeGreaterThan(0);
    });

    it('should handle empty messages array', async () => {
      const metrics = await estimateContextSize([]);

      expect(metrics.messageCount).toBe(0);
      expect(metrics.totalTokens).toBe(0);
      expect(metrics.averageTokensPerMessage).toBe(0);
    });

    it('should handle string messages', async () => {
      const messages = ['Message 1', 'Message 2', 'Message 3'];
      const metrics = await estimateContextSize(messages);

      expect(metrics.messageCount).toBe(3);
      expect(metrics.totalTokens).toBeGreaterThan(0);
    });

    it('should handle multi-part content (Claude SDK format)', async () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: 'World' },
          ],
        },
      ];
      const metrics = await estimateContextSize(messages);

      expect(metrics.messageCount).toBe(1);
      expect(metrics.totalTokens).toBeGreaterThan(0);
    });

    it('should handle messages with text field', async () => {
      const messages = [{ text: 'Message 1' }, { text: 'Message 2' }];
      const metrics = await estimateContextSize(messages);

      expect(metrics.messageCount).toBe(2);
      expect(metrics.totalTokens).toBeGreaterThan(0);
    });

    it('should skip null/undefined messages', async () => {
      const messages = [{ content: 'Valid' }, null, undefined, { content: 'Also valid' }];
      const metrics = await estimateContextSize(messages);

      // Should count all 4 elements but only estimate tokens for valid ones
      expect(metrics.messageCount).toBe(4);
      expect(metrics.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('estimateTokensSync', () => {
    it('should estimate tokens synchronously', () => {
      const text = 'Hello, world!';
      const tokens = estimateTokensSync(text);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should return 0 for empty string', () => {
      const tokens = estimateTokensSync('');
      expect(tokens).toBe(0);
    });

    it('should use character-based estimation', () => {
      // 100 characters = ~25 tokens (1 token per 4 chars)
      const text = 'a'.repeat(100);
      const tokens = estimateTokensSync(text);
      expect(tokens).toBe(25);
    });
  });

  describe('Token estimation accuracy', () => {
    it('should provide reasonable estimates', async () => {
      // Test with known-ish token counts
      const samples = [
        { text: 'a', expectedRange: [1, 2] },
        { text: 'Hello world', expectedRange: [2, 4] },
        { text: 'The quick brown fox jumps over the lazy dog', expectedRange: [8, 12] },
      ];

      for (const sample of samples) {
        const tokens = await estimateTokens(sample.text);
        expect(tokens).toBeGreaterThanOrEqual(sample.expectedRange[0]);
        expect(tokens).toBeLessThanOrEqual(sample.expectedRange[1]);
      }
    });

    it('should be consistent for same input', async () => {
      const text = 'Consistent estimation test';
      const tokens1 = await estimateTokens(text);
      const tokens2 = await estimateTokens(text);
      expect(tokens1).toBe(tokens2);
    });
  });
});
