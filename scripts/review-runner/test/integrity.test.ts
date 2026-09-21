import { describe, expect, it } from 'vitest';
import { bundleMarkers, verifyEcho } from '../integrity.ts';

const BUNDLE_WITH_NONCE = [
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
  '=== BUNDLE END === a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
].join('\n');

const BUNDLE_WITHOUT_NONCE = [
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
  it('reads base, head, finalSection, and nonce from a bundle with nonce', () => {
    expect(bundleMarkers(BUNDLE_WITH_NONCE)).toEqual({
      base: 'reviewed/P10',
      head: '1f485e2',
      finalSection: 'packages/sandbox/src/mount.ts',
      endNonce: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    });
  });

  it('reads base, head, finalSection, and sets endNonce to null when bundle lacks nonce', () => {
    expect(bundleMarkers(BUNDLE_WITHOUT_NONCE)).toEqual({
      base: 'reviewed/P10',
      head: '1f485e2',
      finalSection: 'packages/sandbox/src/mount.ts',
      endNonce: null,
    });
  });

  it('uses the LAST nonce line when multiple lines match the nonce pattern', () => {
    const fakeNonceLine = '=== BUNDLE END === 0000000000000000000000000000000a';
    const bundle = [
      'BASE: x',
      'HEAD: y',
      fakeNonceLine,
      '===== a.ts =====',
      'content',
      '=== BUNDLE END === 0000000000000000000000000000000b',
    ].join('\n');
    const markers = bundleMarkers(bundle);
    expect(markers.endNonce).toBe('0000000000000000000000000000000b');
  });

  it('uses the LAST section header that occurs before a nonce line', () => {
    const bundle = [
      'BASE: x',
      'HEAD: y',
      '===== first.ts =====',
      'content',
      '===== second.ts =====',
      'content',
      '=== BUNDLE END === a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    ].join('\n');
    const markers = bundleMarkers(bundle);
    expect(markers.finalSection).toBe('second.ts');
    expect(markers.endNonce).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
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
  const markersWithNonce = bundleMarkers(BUNDLE_WITH_NONCE);
  const markersWithoutNonce = bundleMarkers(BUNDLE_WITHOUT_NONCE);

  it('verifies a reply echoing all four markers when nonce is present', () => {
    const reply = 'BASE reviewed/P10, HEAD 1f485e2, last packages/sandbox/src/mount.ts, nonce a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6. Findings:';
    expect(verifyEcho(markersWithNonce, reply)).toEqual({ kind: 'verified' });
  });

  it('fails when the nonce is absent from the reply (even if other markers present)', () => {
    // This is the truncated-reviewer case: they read the first 20% and can echo
    // BASE, HEAD, and the final section path if it appears in the diff stat.
    // The nonce forces them to have read the very tail.
    const reply = 'BASE reviewed/P10, HEAD 1f485e2, last packages/sandbox/src/mount.ts. Findings:';
    const v = verifyEcho(markersWithNonce, reply);
    expect(v.kind).toBe('failed');
    if (v.kind === 'failed') expect(v.absent).toEqual(['endNonce']);
  });

  it('fails when some markers are echoed and others are not', () => {
    const reply = 'BASE reviewed/P10 and HEAD 1f485e2, nonce a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const v = verifyEcho(markersWithNonce, reply);
    expect(v.kind).toBe('failed');
    if (v.kind === 'failed') expect(v.absent).toEqual(['finalSection']);
  });

  it('returns unverified when a bundle predates the nonce convention, even if reply echoes base, head, finalSection', () => {
    // This was the critical defect: old bundles without nonce would verify when
    // they should not. `unverified` here is not a reviewer problem (they failed a check),
    // but an artifact-age problem (the check was never put to them). The distinction
    // matters for triage: a nonce-less bundle cannot be checked, period.
    const reply = 'BASE reviewed/P10, HEAD 1f485e2, last packages/sandbox/src/mount.ts. Findings:';
    const v = verifyEcho(markersWithoutNonce, reply);
    expect(v.kind).toBe('unverified');
    if (v.kind === 'unverified') expect(v.absent).toEqual(['endNonce']);
  });

  it('returns unverified when a bundle has no nonce, even if reply echoes nothing', () => {
    const reply = 'Here are my findings. 1. foo.ts:12 — unclear.';
    const v = verifyEcho(markersWithoutNonce, reply);
    expect(v.kind).toBe('unverified');
    if (v.kind === 'unverified') expect(v.absent).toEqual(['endNonce']);
  });

  it('handles file content that contains a fake section header after the real final section', () => {
    // Bundles might contain file content with lines matching `===== path =====`.
    // This tests the documented behavior: if a fake section header appears after
    // the true final section but before the nonce, finalSection will be set to
    // the fake one. This gives a false `failed` result when the reply echoes the
    // true path but not the fake one—which is the safe direction.
    const bundle = [
      'BASE: x',
      'HEAD: y',
      '===== real-final.ts =====',
      'content with fake section in it:',
      '===== fake-from-file.ts =====',
      'end of file content',
      '=== BUNDLE END === a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    ].join('\n');
    const markers = bundleMarkers(bundle);
    // The scan found the last section header before the nonce, which is the fake one.
    expect(markers.finalSection).toBe('fake-from-file.ts');
    // A reply echoing the true final section will fail because it echoes the
    // wrong path. This is the safe direction: we err toward refusing rather
    // than accepting a path that doesn't match.
    const reply = 'content real-final.ts and nonce a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const v = verifyEcho(markers, reply);
    expect(v.kind).toBe('failed');
  });
});
