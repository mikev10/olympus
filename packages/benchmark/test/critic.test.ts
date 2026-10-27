/**
 * The critic arm's verdict from the first attempt's record. An answer the
 * runtime could not read is unreadable, never a catch: the line sends such a
 * draft back, but no finding identified anything wrong with it (I5).
 */
import { describe, expect, test } from 'vitest';
import { criticVerdict } from '../src/critic.js';

describe('criticVerdict', () => {
  test('readable findings, and the send-back they cause, are a catch', () => {
    expect(criticVerdict([], { readable: true, findings: 1 }, 'critic')).toEqual({ verdict: 'caught', causes: ['critic:findings', 'sent-back:critic'] });
  });

  test('no finding and no send-back is a pass', () => {
    expect(criticVerdict([], { readable: true, findings: 0 }, null)).toEqual({ verdict: 'passed', causes: [] });
  });

  test('an unreadable critic answer is unreadable, though the runtime sent the draft back on it', () => {
    expect(criticVerdict([], { readable: false, findings: 1 }, 'critic')).toEqual({ verdict: 'unreadable', causes: ['critic:unreadable', 'sent-back:critic'] });
  });

  test("the runtime's own problems with a draft are a catch whatever the critic answered", () => {
    expect(criticVerdict(['empty-draft'], { readable: false, findings: 1 }, 'critic').verdict).toBe('caught');
    expect(criticVerdict(['empty-draft'], null, 'runtime').verdict).toBe('caught');
  });

  test('a draft sent back before any critic read it, with no problem recorded, measured nothing', () => {
    expect(() => criticVerdict([], null, null)).toThrow(/measured nothing/);
  });
});
