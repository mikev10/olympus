import { describe, expect, it } from 'vitest';
import { BEGIN, END, composePayload, sha256 } from '../payload.ts';

const PROMPT = 'Review the bundle.\n';
const NAME = '2026-09-21-P6-x-review-bundle.txt';
const BUNDLE = [
  'BASE: reviewed/P5',
  'HEAD: abc1234',
  '===== a.ts =====',
  'export const a = 1;',
  '',
  '=== BUNDLE END === 0123456789abcdef0123456789abcdef',
  '',
].join('\n');

describe('composePayload', () => {
  const payload = composePayload(PROMPT, NAME, BUNDLE);

  it('puts the prompt first and the bundle between the delimiters', () => {
    expect(payload.startsWith('Review the bundle.')).toBe(true);
    expect(payload.indexOf(BEGIN)).toBeGreaterThan(payload.indexOf('Review the bundle.'));
    expect(payload.indexOf(END)).toBeGreaterThan(payload.indexOf(BEGIN));
  });

  it('names the bundle file on the opening delimiter, so the prompt reference resolves', () => {
    expect(payload).toContain(`${BEGIN} ${NAME}`);
  });

  it('keeps the nonce as the last line before the closing delimiter', () => {
    const lines = payload.split('\n');
    const endAt = lines.indexOf(END);
    expect(lines[endAt - 1]).toBe('=== BUNDLE END === 0123456789abcdef0123456789abcdef');
  });

  it('carries the bundle text unchanged between the delimiters', () => {
    const inner = payload.slice(payload.indexOf('\n', payload.indexOf(BEGIN)) + 1, payload.indexOf(`\n${END}`));
    expect(inner).toBe(BUNDLE.replace(/\n+$/, ''));
  });

  it('uses delimiters that no reviewer could mistake for a section header or the nonce line', () => {
    // A delimiter shaped like either would be reported back as "the last
    // section" or "the last line", failing every run's echo check.
    for (const d of [BEGIN, END]) {
      expect(/^===== (.+) =====$/.test(d)).toBe(false);
      expect(d.startsWith('=== BUNDLE END ===')).toBe(false);
    }
  });

  it('is deterministic, so the recorded hash identifies exactly what was sent', () => {
    expect(sha256(composePayload(PROMPT, NAME, BUNDLE))).toBe(sha256(payload));
    expect(sha256(payload)).toMatch(/^[0-9a-f]{64}$/);
  });
});
