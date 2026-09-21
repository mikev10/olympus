import { describe, expect, it } from 'vitest';
import { bundleMarkers, verifyEcho } from '../integrity.ts';

const BUNDLE = [
  'BASE: reviewed/P10',
  'HEAD: 1f485e2',
  '',
  '=== COMMITS ===',
  '1f485e2 P5: the review prompt and bundle, as sent',
  '',
  '===== packages/core/src/driver/contract.ts =====',
  'export interface Driver {}',
  '',
  '===== packages/sandbox/src/mount.ts =====',
  'export const ro = true;',
  '',
].join('\n');

describe('bundleMarkers', () => {
  it('reads base, head, and the LAST section header', () => {
    expect(bundleMarkers(BUNDLE)).toEqual({
      base: 'reviewed/P10',
      head: '1f485e2',
      finalSection: 'packages/sandbox/src/mount.ts',
    });
  });

  it('refuses a bundle with no BASE line', () => {
    expect(() => bundleMarkers('HEAD: abc\n===== a.ts =====\n')).toThrow(/BASE:/);
  });

  it('refuses a bundle with no section headers at all', () => {
    expect(() => bundleMarkers('BASE: x\nHEAD: y\n')).toThrow(/section header/);
  });

  it('refuses a BASE line with an empty value', () => {
    expect(() => bundleMarkers('BASE:   \nHEAD: y\n===== a.ts =====\n')).toThrow(/no value/);
  });
});

describe('verifyEcho', () => {
  const markers = bundleMarkers(BUNDLE);

  it('verifies a reply echoing all three markers', () => {
    const reply = 'BASE reviewed/P10, HEAD 1f485e2, last packages/sandbox/src/mount.ts. Findings:';
    expect(verifyEcho(markers, reply)).toEqual({ kind: 'verified' });
  });

  it('reports unverified when the reply echoes none of them', () => {
    const v = verifyEcho(markers, 'Here are my findings. 1. foo.ts:12 — unclear.');
    expect(v.kind).toBe('unverified');
  });

  it('fails when some markers are echoed and others are not', () => {
    const reply = 'BASE reviewed/P10 and HEAD 1f485e2, last section packages/core/src/driver/contract.ts';
    const v = verifyEcho(markers, reply);
    expect(v.kind).toBe('failed');
    if (v.kind !== 'verified') expect(v.absent).toEqual(['finalSection']);
  });
});
