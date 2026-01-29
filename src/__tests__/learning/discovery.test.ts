import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Hoisted mock
const mockHomedir = vi.hoisted(() => {
  return { value: '' };
});

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => mockHomedir.value,
  };
});

import {
  recordDiscovery,
  readDiscoveries,
  getDiscoveriesForInjection,
} from '../../learning/discovery.js';

describe('discovery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'olympus-discovery-test-'));
    mockHomedir.value = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('records a discovery to project storage', () => {
    const discovery = recordDiscovery({
      category: 'gotcha',
      summary: 'Test discovery summary',
      details: 'Detailed explanation of the discovery',
      agent_name: 'test-agent',
      session_id: 'test-session',
      project_path: tempDir,
      confidence: 0.9,
      scope: 'project',
    });

    expect(discovery.id).toBeDefined();
    expect(discovery.timestamp).toBeDefined();

    const filePath = join(tempDir, '.olympus', 'learning', 'discoveries.jsonl');
    expect(existsSync(filePath)).toBe(true);
  });

  it('reads discoveries for a project', () => {
    recordDiscovery({
      category: 'pattern',
      summary: 'Uses kebab-case for files',
      details: 'All files in src/ use kebab-case naming',
      agent_name: 'test',
      session_id: 'test',
      project_path: tempDir,
      confidence: 0.8,
      scope: 'project',
    });

    recordDiscovery({
      category: 'workaround',
      summary: 'Build requires NODE_ENV',
      details: 'Must set NODE_ENV=development for local builds',
      agent_name: 'test',
      session_id: 'test',
      project_path: tempDir,
      confidence: 0.9,
      scope: 'project',
    });

    const summary = readDiscoveries(tempDir);

    expect(summary.total_discoveries).toBe(2);
    expect(summary.project_discoveries).toHaveLength(2);
    expect(summary.categories.pattern).toBe(1);
    expect(summary.categories.workaround).toBe(1);
  });
});
