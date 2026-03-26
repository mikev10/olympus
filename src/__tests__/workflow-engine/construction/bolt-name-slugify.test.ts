import { describe, it, expect } from 'vitest';
import { slugifyBoltName } from '../../../features/workflow-engine/construction/decomposition.js';

describe('slugifyBoltName', () => {
  it('converts title and index to BOLT-NNN-slug format', () => {
    expect(slugifyBoltName('Add Auth Middleware', 1)).toBe('BOLT-001-add-auth-middleware');
  });

  it('pads index to 3 digits', () => {
    expect(slugifyBoltName('Database Schema', 12)).toBe('BOLT-012-database-schema');
  });

  it('falls back to untitled for empty string', () => {
    expect(slugifyBoltName('', 3)).toBe('BOLT-003-untitled');
  });

  it('falls back to untitled for whitespace-only title', () => {
    expect(slugifyBoltName('   ', 5)).toBe('BOLT-005-untitled');
  });

  it('strips special characters', () => {
    expect(slugifyBoltName('Hello! @World# $Test%', 2)).toBe('BOLT-002-hello-world-test');
  });

  it('truncates slug portion to 60 characters', () => {
    const longTitle = 'a'.repeat(80);
    const result = slugifyBoltName(longTitle, 1);
    const slugPortion = result.replace(/^BOLT-\d{3}-/, '');
    expect(slugPortion.length).toBeLessThanOrEqual(60);
  });

  it('handles 3-digit zero-padded indices correctly', () => {
    expect(slugifyBoltName('Test', 1)).toBe('BOLT-001-test');
    expect(slugifyBoltName('Test', 10)).toBe('BOLT-010-test');
    expect(slugifyBoltName('Test', 100)).toBe('BOLT-100-test');
  });

  it('collapses multiple hyphens', () => {
    expect(slugifyBoltName('foo---bar', 1)).toBe('BOLT-001-foo-bar');
  });

  it('converts underscores and spaces to hyphens', () => {
    expect(slugifyBoltName('foo_bar baz', 1)).toBe('BOLT-001-foo-bar-baz');
  });

  it('falls back to untitled when title has only special chars', () => {
    expect(slugifyBoltName('!!!@@@', 7)).toBe('BOLT-007-untitled');
  });
});
