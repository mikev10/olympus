/**
 * The safety declaration: how the runtime learns which components cannot
 * enforce what their contracts imply, and the line's own declaration.
 */
import { StubDriver } from '@olympus-ai/core';
import { StubSandboxProvider } from '@olympus-ai/sandbox';
import { StubVault } from '@olympus-ai/vault';
import { describe, expect, test } from 'vitest';
import { SKELETON_LINE, unsafeComponents, type ComponentGraph } from '../src/index.js';
import { DelegatingDriver, DelegatingSandbox, DelegatingVault } from './wrappers.js';

function stubs() {
  return { vault: new StubVault('/'), sandbox: new StubSandboxProvider(), driver: new StubDriver() };
}

describe('unsafeComponents', () => {
  test('lists the vault, sandbox, and driver declarations in that order, then the line itself', () => {
    const graph = stubs();
    const declarations = unsafeComponents(graph);
    expect(declarations.map((d) => d.component)).toEqual(['StubVault', 'StubSandboxProvider', 'StubDriver', 'SkeletonLine']);
    expect(declarations[0]).toEqual(graph.vault.unsafe);
    expect(declarations[3]).toBe(SKELETON_LINE.unsafe);
  });

  test('reads the declaration structurally: a component without one is not listed, and the line always is', () => {
    const graph = stubs();
    const undeclared: ComponentGraph = {
      vault: new DelegatingVault(graph.vault),
      sandbox: new DelegatingSandbox(graph.sandbox),
      driver: new DelegatingDriver(graph.driver),
    };
    expect(unsafeComponents(undeclared).map((d) => d.component)).toEqual(['SkeletonLine']);
  });

  test('throws on a malformed declaration rather than treating it as absent (I5)', () => {
    const graph = stubs();
    const empty = Object.assign(new DelegatingDriver(graph.driver), { unsafe: { component: 'Empty', cannotEnforce: [] } });
    expect(() => unsafeComponents({ ...graph, driver: empty })).toThrow(/Empty/);
    const notAnObject = Object.assign(new DelegatingSandbox(graph.sandbox), { unsafe: 'yes' });
    expect(() => unsafeComponents({ ...graph, sandbox: notAnObject })).toThrow(/sandbox/);
    const noName = Object.assign(new DelegatingVault(graph.vault), { unsafe: { cannotEnforce: ['x'] } });
    expect(() => unsafeComponents({ ...graph, vault: noName })).toThrow(/vault/);
  });
});

describe('SKELETON_LINE', () => {
  test('declares the line unsafe, naming the policy engine, tamper analysis, the claim/evidence diff, and the missing stations', () => {
    expect(SKELETON_LINE.unsafe.component).toBe('SkeletonLine');
    const text = SKELETON_LINE.unsafe.cannotEnforce.join('\n');
    expect(text).toMatch(/policy/i);
    expect(text).toMatch(/tamper/i);
    expect(text).toMatch(/claim/i);
    expect(text).toMatch(/station/i);
  });
});
