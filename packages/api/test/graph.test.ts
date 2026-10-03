/**
 * The graph builder: provenance read once, when the graph is built, and
 * positive — a component is safe only when it is the real one for its slot
 * (D-A-I1-05, D-I1a-06).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StubDriver } from '@olympus-ai/core';
import { ClaudeCodeDriver, MODEL_RELAY } from '@olympus-ai/driver-claude-code';
import { StubSandboxProvider } from '@olympus-ai/sandbox';
import { LocalVault, StubVault } from '@olympus-ai/vault';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildGraph, isBuilt, provenanceOf, unsafeComponents, type GraphParts } from '../src/index.js';
import { storeFor } from './harness.js';
import { DelegatingDriver, DelegatingSandbox, DelegatingVault } from './wrappers.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'graph-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function stubs(): GraphParts {
  const driver = new StubDriver();
  return { vault: new StubVault('/'), sandbox: new StubSandboxProvider(), driver, reviewer: driver, workspaces: storeFor(join(root, 'ws')) };
}

/** Every slot real except the sandbox, which needs a daemon to construct: the conformance registry attests that one. */
function real(): GraphParts {
  const sandbox = new StubSandboxProvider();
  const driver = new ClaudeCodeDriver({ provider: sandbox });
  return { vault: new LocalVault({ store: join(root, 'store'), artifacts: join(root, 'repo') }), sandbox, driver, reviewer: driver, workspaces: storeFor(join(root, 'ws')) };
}

const names = (parts: GraphParts): string[] => unsafeComponents(buildGraph(parts)).map((d) => d.component);

describe('buildGraph', () => {
  test('lists the stubs\' declarations in slot order, and a reviewer that is the driver once; nothing for the line itself', () => {
    expect(names(stubs())).toEqual(['StubVault', 'StubSandboxProvider', 'StubDriver']);
    expect(names({ ...stubs(), reviewer: new StubDriver() })).toEqual(['StubVault', 'StubSandboxProvider', 'StubDriver', 'StubDriver']);
  });

  test('attests the real vault and driver, and names nothing for them', () => {
    expect(names(real())).toEqual(['StubSandboxProvider']);
  });

  test('a wrapper that does not forward a stub\'s declaration is named unattested, whether it was made before the build or not (D-I1a-06)', () => {
    const parts = stubs();
    const driver = new DelegatingDriver(parts.driver);
    expect(names({ ...parts, vault: new DelegatingVault(parts.vault), sandbox: new DelegatingSandbox(parts.sandbox), driver, reviewer: driver }))
      .toEqual(['unattested vault', 'unattested sandbox', 'unattested driver']);
  });

  test('a wrapper around a real component is unattested too: provenance is positive, so a wrapper fails closed', () => {
    const parts = real();
    expect(names({ ...parts, driver: new DelegatingDriver(parts.driver) })).toContain('unattested driver');
  });

  test('a Proxy around a real component is that component, and passes', () => {
    const parts = real();
    const driver = new Proxy(parts.driver, {});
    expect(names({ ...parts, driver, reviewer: driver })).toEqual(['StubSandboxProvider']);
  });

  test('a driver with no relay is declared unmetered (A-I1a-02)', () => {
    const parts = real();
    const relayless = new Proxy(parts.driver, { get: (target, key, receiver) => (key === 'relayRequest' ? () => null : Reflect.get(target, key, receiver) as unknown) });
    expect(names({ ...parts, driver: relayless, reviewer: relayless })).toContain('driver claude-code');
  });

  test('throws on a malformed declaration rather than treating it as absent (I5)', () => {
    const parts = stubs();
    const empty = Object.assign(new DelegatingDriver(parts.driver), { unsafe: { component: 'Empty', cannotEnforce: [] } });
    expect(() => buildGraph({ ...parts, driver: empty })).toThrow(/Empty/);
    const notAnObject = Object.assign(new DelegatingSandbox(parts.sandbox), { unsafe: 'yes' });
    expect(() => buildGraph({ ...parts, sandbox: notAnObject })).toThrow(/sandbox/);
  });

  test('the graph is frozen, and a graph not made by the builder is one declaration naming it unbuilt', () => {
    const graph = buildGraph(stubs());
    expect(isBuilt(graph)).toBe(true);
    expect(Object.isFrozen(graph)).toBe(true);
    const copy = { ...graph };
    expect(isBuilt(copy)).toBe(false);
    expect(provenanceOf(copy).map((d) => d.component)).toEqual(['unbuilt graph']);
  });

  test('the declarations are those read at build time: changing a component afterwards changes nothing recorded', () => {
    const parts = real();
    const graph = buildGraph(parts);
    Object.assign(parts.driver, { unsafe: { component: 'Late', cannotEnforce: ['x'] } });
    expect(unsafeComponents(graph).map((d) => d.component)).toEqual(['StubSandboxProvider']);
  });
});

describe('ClaudeCodeDriver.relayRequest', () => {
  test('is the relay the driver exports, as a copy a caller cannot change it through', () => {
    const driver = new ClaudeCodeDriver({ provider: new StubSandboxProvider() });
    const relay = driver.relayRequest();
    expect(relay).toStrictEqual({ ...MODEL_RELAY, paths: [...MODEL_RELAY.paths] });
    relay.paths.push('/v1/other');
    expect(driver.relayRequest().paths).toStrictEqual(MODEL_RELAY.paths);
  });
});
