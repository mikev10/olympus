/**
 * The driver-alone verdict is read strictly: the one shape, or unreadable,
 * never a guess at what prose meant (I5).
 */
import { describe, expect, test } from 'vitest';
import { readVerdict } from '../src/alone.js';

describe('readVerdict', () => {
  test('reads a done verdict and a not-done verdict with its reasons', () => {
    expect(readVerdict('{"done": true, "reasons": []}')).toEqual({ kind: 'verdict', done: true, reasons: [] });
    expect(readVerdict('{"done": false, "reasons": ["add is broken"]}')).toEqual({ kind: 'verdict', done: false, reasons: ['add is broken'] });
  });

  test('unwraps one fenced block', () => {
    expect(readVerdict('```json\n{"done": false, "reasons": ["x"]}\n```')).toEqual({ kind: 'verdict', done: false, reasons: ['x'] });
  });

  test.each([
    ['prose', 'Looks done to me.'],
    ['prose around the object', 'Result: {"done": true, "reasons": []}'],
    ['an extra key', '{"done": true, "reasons": [], "confidence": 0.9}'],
    ['a missing key', '{"done": true}'],
    ['a string for done', '{"done": "yes", "reasons": []}'],
    ['done with reasons', '{"done": true, "reasons": ["but add is broken"]}'],
    ['not done with no reason', '{"done": false, "reasons": []}'],
    ['an empty reason', '{"done": false, "reasons": [" "]}'],
    ['an array', '[true]'],
  ])('%s is unreadable', (_name, text) => {
    expect(readVerdict(text)).toEqual({ kind: 'unreadable' });
  });
});
