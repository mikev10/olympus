import { describe, expect, it } from 'vitest';

describe('tooling harness', () => {
  it('runs on a Node version the review runner can be invoked directly on', () => {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    const supportsTypeStripping = major > 22 || (major === 22 && minor >= 18);
    expect(supportsTypeStripping, `Node ${process.versions.node} cannot run .ts directly`).toBe(true);
  });
});
