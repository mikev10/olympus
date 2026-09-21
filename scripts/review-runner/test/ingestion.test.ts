import { describe, expect, it } from 'vitest';
import { BYTES_PER_TOKEN_FLOOR, verifyIngestion } from '../ingestion.ts';

// Measured against the real 403,661-byte P5 bundle on 2026-09-21.
const BYTES = 403_661;

describe('verifyIngestion', () => {
  it('accepts the Codex measurement: 127,096 input tokens', () => {
    expect(verifyIngestion(BYTES, 127_096).kind).toBe('complete');
  });

  it('accepts the Gemini measurement: 126,072 input tokens', () => {
    expect(verifyIngestion(BYTES, 126_072).kind).toBe('complete');
  });

  it('rejects the measured @-injection failure: ~33k tokens, the rest navigated by grep', () => {
    expect(verifyIngestion(BYTES, 32_893).kind).toBe('short');
  });

  it('rejects the measured blocked-read failure: the system prompt alone', () => {
    expect(verifyIngestion(BYTES, 24_181).kind).toBe('short');
  });

  it('refuses when the vendor reported no token count, rather than assuming', () => {
    expect(verifyIngestion(BYTES, null).kind).toBe('unreported');
  });

  it('records the floor it applied, so a reader can check the arithmetic', () => {
    const v = verifyIngestion(BYTES, 127_096);
    expect(v.floor).toBe(Math.floor(BYTES / BYTES_PER_TOKEN_FLOOR));
  });
});
