import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

const mockReadFile = vi.hoisted(() => vi.fn<[string, string], Promise<string>>());

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
}));

vi.mock('../../features/workflow-engine/discovery.js', () => ({
  detectBrownfield: vi.fn(),
}));

vi.mock('../../features/workflow-engine/manifest.js', () => ({
  registerArtifact: vi.fn(),
}));

import {
  loadPathwayBehaviors,
} from '../../features/workflow-engine/workflow-routing.js';

const BEHAVIORS_JSON_PATH = path.join(process.cwd(), 'resources', 'rules', 'common', 'pathway-behaviors.json');
const REAL_JSON_CONTENT = fs.readFileSync(BEHAVIORS_JSON_PATH, 'utf-8');

function readSourceJson(): Record<string, unknown> {
  return JSON.parse(REAL_JSON_CONTENT);
}

beforeEach(() => {
  mockReadFile.mockImplementation(async (filePath: string) => {
    if (String(filePath).includes('pathway-behaviors.json')) {
      return REAL_JSON_CONTENT;
    }
    throw Object.assign(new Error(`ENOENT: no such file: ${filePath}`), { code: 'ENOENT' });
  });
});

afterEach(() => {
  mockReadFile.mockReset();
});

describe('loadPathwayBehaviors', () => {
  describe('null-returning pathways', () => {
    it('returns null for greenfield', async () => {
      expect(await loadPathwayBehaviors('greenfield')).toBeNull();
    });

    it('returns null for brownfield-enhancement', async () => {
      expect(await loadPathwayBehaviors('brownfield-enhancement')).toBeNull();
    });

    it('returns null for brownfield-refactor', async () => {
      expect(await loadPathwayBehaviors('brownfield-refactor')).toBeNull();
    });
  });

  describe('bugfix pathway', () => {
    it('returns non-null result', async () => {
      const result = await loadPathwayBehaviors('bugfix');
      expect(result).not.toBeNull();
    });

    it('contains autonomous-diagnosis rule (BF-001)', async () => {
      const result = await loadPathwayBehaviors('bugfix');
      const rule = result!.rules.find(r => r.id === 'BF-001');
      expect(rule).toBeDefined();
      expect(rule!.name).toBe('autonomous-diagnosis');
      expect(rule!.enforcement).toBe('mandatory');
    });

    it('contains root-cause-analysis rule (BF-002)', async () => {
      const result = await loadPathwayBehaviors('bugfix');
      const rule = result!.rules.find(r => r.id === 'BF-002');
      expect(rule).toBeDefined();
      expect(rule!.name).toBe('root-cause-analysis');
      expect(rule!.enforcement).toBe('mandatory');
    });

    it('contains missing-test-rule (BF-003)', async () => {
      const result = await loadPathwayBehaviors('bugfix');
      const rule = result!.rules.find(r => r.id === 'BF-003');
      expect(rule).toBeDefined();
      expect(rule!.name).toBe('missing-test-rule');
      expect(rule!.enforcement).toBe('mandatory');
    });

    it('has a non-empty quality gate checklist', async () => {
      const result = await loadPathwayBehaviors('bugfix');
      expect(result!.qualityGateChecklist.length).toBeGreaterThan(0);
    });

    it('quality gate checklist mentions root cause', async () => {
      const result = await loadPathwayBehaviors('bugfix');
      const hasRootCause = result!.qualityGateChecklist.some(item =>
        item.toLowerCase().includes('root cause')
      );
      expect(hasRootCause).toBe(true);
    });
  });

  describe('optimization pathway', () => {
    it('returns non-null result', async () => {
      const result = await loadPathwayBehaviors('optimization');
      expect(result).not.toBeNull();
    });

    it('contains baseline-measurement rule (OPT-001)', async () => {
      const result = await loadPathwayBehaviors('optimization');
      const rule = result!.rules.find(r => r.id === 'OPT-001');
      expect(rule).toBeDefined();
      expect(rule!.name).toBe('baseline-measurement');
      expect(rule!.enforcement).toBe('mandatory');
    });

    it('contains before-after-comparison rule (OPT-002)', async () => {
      const result = await loadPathwayBehaviors('optimization');
      const rule = result!.rules.find(r => r.id === 'OPT-002');
      expect(rule).toBeDefined();
      expect(rule!.name).toBe('before-after-comparison');
      expect(rule!.enforcement).toBe('mandatory');
    });

    it('has a non-empty quality gate checklist', async () => {
      const result = await loadPathwayBehaviors('optimization');
      expect(result!.qualityGateChecklist.length).toBeGreaterThan(0);
    });

    it('quality gate checklist mentions baseline', async () => {
      const result = await loadPathwayBehaviors('optimization');
      const hasBaseline = result!.qualityGateChecklist.some(item =>
        item.toLowerCase().includes('baseline')
      );
      expect(hasBaseline).toBe(true);
    });
  });

  describe('JSON schema validation', () => {
    it('JSON file parses without error', () => {
      expect(() => readSourceJson()).not.toThrow();
    });

    it('JSON file contains bugfix section', () => {
      const json = readSourceJson() as Record<string, { rules: unknown[]; quality_gate_checklist: unknown[] }>;
      expect(json['bugfix']).toBeDefined();
      expect(Array.isArray(json['bugfix'].rules)).toBe(true);
      expect(Array.isArray(json['bugfix'].quality_gate_checklist)).toBe(true);
    });

    it('JSON file contains optimization section', () => {
      const json = readSourceJson() as Record<string, { rules: unknown[]; quality_gate_checklist: unknown[] }>;
      expect(json['optimization']).toBeDefined();
      expect(Array.isArray(json['optimization'].rules)).toBe(true);
      expect(Array.isArray(json['optimization'].quality_gate_checklist)).toBe(true);
    });

    it('every rule has id, name, description, and enforcement fields', () => {
      const json = readSourceJson() as Record<string, { rules: Array<Record<string, unknown>> }>;
      for (const section of Object.values(json)) {
        for (const rule of section.rules) {
          expect(typeof rule['id']).toBe('string');
          expect(typeof rule['name']).toBe('string');
          expect(typeof rule['description']).toBe('string');
          expect(typeof rule['enforcement']).toBe('string');
        }
      }
    });
  });

  describe('JSON and markdown rule ID sync', () => {
    it('bugfix section contains BF-001, BF-002, BF-003', () => {
      const json = readSourceJson() as Record<string, { rules: Array<{ id: string }> }>;
      const ids = json['bugfix'].rules.map(r => r.id);
      expect(ids).toContain('BF-001');
      expect(ids).toContain('BF-002');
      expect(ids).toContain('BF-003');
    });

    it('optimization section contains OPT-001, OPT-002', () => {
      const json = readSourceJson() as Record<string, { rules: Array<{ id: string }> }>;
      const ids = json['optimization'].rules.map(r => r.id);
      expect(ids).toContain('OPT-001');
      expect(ids).toContain('OPT-002');
    });
  });

  describe('graceful error handling', () => {
    it('returns null when JSON file cannot be read', async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const result = await loadPathwayBehaviors('bugfix');
      expect(result).toBeNull();
    });

    it('returns null when JSON is malformed', async () => {
      mockReadFile.mockResolvedValue('{ not valid json }');
      const result = await loadPathwayBehaviors('bugfix');
      expect(result).toBeNull();
    });
  });
});
