/**
 * The safety declaration: how the runtime learns which components cannot
 * enforce what their contracts imply, and the line's own declaration.
 */
import { StubDriver } from '@olympus-ai/core';
import { StubSandboxProvider } from '@olympus-ai/sandbox';
import { StubVault } from '@olympus-ai/vault';
import { describe, expect, test } from 'vitest';
import { SKELETON_LINE, unsafeComponents } from '../src/index.js';
import { DelegatingDriver, DelegatingSandbox, DelegatingVault } from './wrappers.js';

function stubs() {
  const driver = new StubDriver();
  return { vault: new StubVault('/'), sandbox: new StubSandboxProvider(), driver, reviewer: driver };
}

describe('unsafeComponents', () => {
  test('lists the vault, sandbox, and driver declarations in that order, then the line itself; a reviewer that is the driver is listed once', () => {
    const graph = stubs();
    const declarations = unsafeComponents(graph);
    expect(declarations.map((d) => d.component)).toEqual(['StubVault', 'StubSandboxProvider', 'StubDriver', 'SkeletonLine']);
    expect(declarations[0]).toEqual(graph.vault.unsafe);
    expect(declarations[3]).toBe(SKELETON_LINE.unsafe);
  });

  test('a reviewer that is a separate component is listed in its own slot, after the driver', () => {
    const graph = { ...stubs(), reviewer: new StubDriver() };
    expect(unsafeComponents(graph).map((d) => d.component)).toEqual(['StubVault', 'StubSandboxProvider', 'StubDriver', 'StubDriver', 'SkeletonLine']);
  });

  test('reads the declaration structurally: a component without one is not listed, and the line always is', () => {
    const graph = stubs();
    const driver = new DelegatingDriver(graph.driver);
    const undeclared: Parameters<typeof unsafeComponents>[0] = {
      vault: new DelegatingVault(graph.vault),
      sandbox: new DelegatingSandbox(graph.sandbox),
      driver,
      reviewer: driver,
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
    const reviewer = Object.assign(new DelegatingDriver(graph.driver), { unsafe: 'no' });
    expect(() => unsafeComponents({ ...graph, reviewer })).toThrow(/reviewer/);
  });
});

describe('SKELETON_LINE', () => {
  test('declares what the line still cannot enforce: tamper analysis, and no longer the policy, the stations P4 paid, or the claim/evidence diff P6 paid', () => {
    expect(SKELETON_LINE.unsafe.component).toBe('SkeletonLine');
    const text = SKELETON_LINE.unsafe.cannotEnforce.join('\n');
    expect(text).toMatch(/tamper/i);
    expect(text).not.toMatch(/claim/i);
    expect(text).not.toMatch(/policy engine/i);
    expect(text).not.toMatch(/no station beyond/i);
  });
});
