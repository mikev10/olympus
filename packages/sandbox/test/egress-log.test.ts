/**
 * The proxy's log, parsed (A-P14-02, D-P14-03). Pure: no daemon. A log that
 * is not the proxy's whole account throws rather than returning the part it
 * could read, since a partial list would present some connections as all.
 */
import { describe, expect, test } from 'vitest';
import { EGRESS_PREFIX, egressLogFrom } from '../src/local/proxy.js';

function line(event: Record<string, unknown>): string {
  return EGRESS_PREFIX + JSON.stringify(event);
}

const OPENED = { event: 'connection', verdict: 'opened', host: 'registry.npmjs.org', at: '2026-09-30T00:00:01.000Z' };
const REFUSED = { event: 'connection', verdict: 'refused', host: null, at: '2026-09-30T00:00:02.000Z' };

describe('egressLogFrom', () => {
  test('reads every connection in the order logged, and skips lines that are not decisions', () => {
    const log = ['egress-proxy listening on 3128 for registry.npmjs.org', line(OPENED), line(REFUSED), line({ event: 'closed', connections: 2 }), ''].join('\r\n');
    expect(egressLogFrom(log)).toEqual({
      kind: 'proxied',
      connections: [
        { verdict: 'opened', host: 'registry.npmjs.org', at: OPENED.at },
        { verdict: 'refused', host: null, at: REFUSED.at },
      ],
    });
  });

  test('a proxy that decided nothing closes with a count of zero', () => {
    expect(egressLogFrom(line({ event: 'closed', connections: 0 }))).toEqual({ kind: 'proxied', connections: [] });
  });

  test('a decision line that is not JSON throws', () => {
    expect(() => egressLogFrom([`${EGRESS_PREFIX}{"event":"connection",`, line({ event: 'closed', connections: 1 })].join('\n'))).toThrow(/not JSON/);
  });

  test('a log with no closed line throws, since it may not hold every connection', () => {
    expect(() => egressLogFrom(line(OPENED))).toThrow(/did not write its closed line/);
  });

  test('a closed line whose count disagrees with the log throws', () => {
    expect(() => egressLogFrom([line(OPENED), line({ event: 'closed', connections: 2 })].join('\n'))).toThrow(/names 2 connections and its log holds 1/);
  });

  test('a closed line without an integer count throws', () => {
    expect(() => egressLogFrom(line({ event: 'closed', connections: '1' }))).toThrow(/without a count/);
    expect(() => egressLogFrom(line({ event: 'closed', connections: 1.5 }))).toThrow(/without a count/);
  });

  test('a verdict outside the closed set throws', () => {
    expect(() => egressLogFrom([line({ ...OPENED, verdict: 'allowed' }), line({ event: 'closed', connections: 1 })].join('\n'))).toThrow(/not a connection/);
  });

  test('a connection with a host that is neither a string nor null, or with no time, throws', () => {
    expect(() => egressLogFrom([line({ ...OPENED, host: 7 }), line({ event: 'closed', connections: 1 })].join('\n'))).toThrow(/not a connection/);
    expect(() => egressLogFrom([line({ ...OPENED, at: undefined }), line({ event: 'closed', connections: 1 })].join('\n'))).toThrow(/not a connection/);
  });

  test('a decision line that is not a record throws', () => {
    expect(() => egressLogFrom([`${EGRESS_PREFIX}[1]`, line({ event: 'closed', connections: 1 })].join('\n'))).toThrow(/not a record/);
  });

  test('a decision written after the closed line throws', () => {
    expect(() => egressLogFrom([line({ event: 'closed', connections: 0 }), line(OPENED)].join('\n'))).toThrow(/after its closed line/);
  });
});
