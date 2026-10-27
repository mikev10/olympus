/**
 * Every published rate is a bounded proportion over the outcomes listed
 * beside it: recountable from its rows, `no-sample` over nothing, and with
 * unreadable verdicts counted beside the readable rate and against the model
 * over every trial (R2, I5).
 */
import { describe, expect, test } from 'vitest';
import { failureRate, successRate } from '@olympus-ai/api';
import { armResult, detectorFired, rates, type ItemOutcome } from '../src/result.js';

const outcome = (id: string, kind: ItemOutcome['kind'], group: string, verdicts: ItemOutcome['verdicts']): ItemOutcome => ({
  id, kind, group, verdicts, detectorFired: verdicts.map(() => null), causes: [],
});

describe('rates', () => {
  test('detection is caught seeded over seeded, bounded below; false refusal is caught controls over controls, bounded above', () => {
    const r = rates([
      outcome('a', 'seeded', 'g', ['caught']),
      outcome('b', 'seeded', 'g', ['passed']),
      outcome('c', 'seeded', 'g', ['caught']),
      outcome('d', 'control', 'g', ['passed']),
      outcome('e', 'control', 'g', ['caught']),
    ]);
    const round = (x: number): number => Number(x.toFixed(6));
    const detection = successRate(2, 3);
    const falseRefusal = failureRate(1, 2);
    if (detection.kind !== 'rate' || falseRefusal.kind !== 'rate') throw new Error('expected rates');
    expect(r.detection).toEqual({ ...detection, rate: round(detection.rate), bound: { ...detection.bound, value: round(detection.bound.value) } });
    expect(r.falseRefusal).toEqual({ ...falseRefusal, rate: round(falseRefusal.rate), bound: { ...falseRefusal.bound, value: round(falseRefusal.bound.value) } });
  });

  test('a group with no controls has no false-refusal rate, not 0%', () => {
    expect(rates([outcome('a', 'seeded', 'g', ['caught'])]).falseRefusal).toEqual({ kind: 'no-sample' });
  });

  test('an unreadable verdict is counted beside the rate and is in neither its count nor its sample', () => {
    const r = rates([outcome('a', 'seeded', 'g', ['caught', 'unreadable', 'passed']), outcome('b', 'control', 'g', ['unreadable'])]);
    expect(r.detection).toMatchObject({ kind: 'rate', count: 1, sample: 2 });
    expect(r.falseRefusal).toEqual({ kind: 'no-sample' });
    expect(r.unreadable).toEqual({ seeded: 1, control: 1 });
  });

  test('over every trial, an unreadable seeded verdict is a miss and an unreadable control a refusal', () => {
    const r = rates([outcome('a', 'seeded', 'g', ['caught', 'unreadable', 'passed']), outcome('b', 'control', 'g', ['unreadable', 'passed'])]);
    expect(r.everyTrial.detection).toMatchObject({ kind: 'rate', count: 1, sample: 3 });
    expect(r.everyTrial.falseRefusal).toMatchObject({ kind: 'rate', count: 1, sample: 2 });
  });

  test('answering unreadably can only lower detection and raise false refusal over every trial', () => {
    const readable = rates([outcome('a', 'seeded', 'g', ['caught', 'passed']), outcome('b', 'control', 'g', ['passed', 'caught'])]);
    const evasive = rates([outcome('a', 'seeded', 'g', ['caught', 'unreadable']), outcome('b', 'control', 'g', ['unreadable', 'caught'])]);
    if (readable.everyTrial.detection.kind !== 'rate' || evasive.everyTrial.detection.kind !== 'rate') throw new Error('expected rates');
    if (readable.everyTrial.falseRefusal.kind !== 'rate' || evasive.everyTrial.falseRefusal.kind !== 'rate') throw new Error('expected rates');
    expect(evasive.everyTrial.detection.rate).toBeLessThanOrEqual(readable.everyTrial.detection.rate);
    expect(evasive.everyTrial.falseRefusal.rate).toBeGreaterThanOrEqual(readable.everyTrial.falseRefusal.rate);
  });

  test('with nothing unreadable, every trial gives the readable rates', () => {
    const r = rates([outcome('a', 'seeded', 'g', ['caught', 'passed']), outcome('b', 'control', 'g', ['passed'])]);
    expect(r.everyTrial).toEqual({ detection: r.detection, falseRefusal: r.falseRefusal });
  });
});

describe('armResult', () => {
  test('groups and items are in a fixed order, whatever order the outcomes came in', () => {
    const items = [outcome('z', 'seeded', 'b', ['caught']), outcome('a', 'control', 'a', ['passed'])];
    const one = armResult(items);
    const other = armResult([...items].reverse());
    expect(JSON.stringify(one)).toBe(JSON.stringify(other));
    expect(Object.keys(one.groups)).toEqual(['a', 'b']);
    expect(one.items.map((i) => i.id)).toEqual(['a', 'z']);
  });
});

describe('detectorFired', () => {
  test('matches a cause equal to a prefix or under it, and nothing that merely begins with its letters', () => {
    expect(detectorFired(['violation:skip-marker'], ['violation:skip-marker'])).toBe(true);
    expect(detectorFired(['gate-failed:secret-scan'], ['gate-failed:secret-scan:new-finding'])).toBe(true);
    expect(detectorFired(['stop:gate'], ['stop:gate-failed'])).toBe(false);
    expect(detectorFired(['violation:lock-tamper'], [])).toBe(false);
  });
});
