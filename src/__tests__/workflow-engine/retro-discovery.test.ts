import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

const mockManifest = vi.hoisted(() => ({
  loadManifest: vi.fn(),
}));

const mockTrust = vi.hoisted(() => ({
  loadTrustState: vi.fn(),
}));

const mockDiscovery = vi.hoisted(() => ({
  recordDiscovery: vi.fn().mockImplementation((input) => ({
    ...input,
    id: 'test-discovery-id',
    timestamp: '2025-01-01T00:00:00Z',
    verified: false,
    verification_count: 0,
    last_useful: '2025-01-01T00:00:00Z',
  })),
}));

vi.mock('fs', () => mockFs);
vi.mock('../../features/workflow-engine/manifest.js', () => mockManifest);
vi.mock('../../features/workflow-engine/trust.js', () => mockTrust);
vi.mock('../../learning/discovery.js', () => mockDiscovery);

import { persistRetroDiscoveries } from '../../features/workflow-engine/retro.js';
import type { RetroPattern, RetroData } from '../../features/workflow-engine/retro.js';

const baseData: RetroData = {
  workflowId: 'test-wf',
  featureName: 'Test Feature',
  gateRejections: [],
  cascadeEvents: [],
  trustDecreases: [],
  ciFailureCount: 0,
  totalGates: 5,
  totalRejections: 2,
};

describe('retro discovery integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDiscovery.recordDiscovery.mockImplementation((input) => ({
      ...input,
      id: 'test-discovery-id',
      timestamp: '2025-01-01T00:00:00Z',
      verified: false,
      verification_count: 0,
      last_useful: '2025-01-01T00:00:00Z',
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists high-confidence patterns as discoveries', () => {
    const patterns: RetroPattern[] = [{
      description: 'Recurring gate rejections',
      evidence: 'Gate rejected 3 times for same reason',
      suggestion: 'Improve upstream validation',
      confidence: 'High',
      occurrences: 3,
    }];

    const result = persistRetroDiscoveries(patterns, baseData, '/test/project', 'test-session');

    expect(mockDiscovery.recordDiscovery).toHaveBeenCalledTimes(1);
    expect(mockDiscovery.recordDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      category: 'retro_insight',
      scope: 'project',
      confidence: 0.9,
      agent_name: 'retro',
      session_id: 'test-session',
      project_path: '/test/project',
    }));
    expect(result).toHaveLength(1);
  });

  it('persists medium-confidence patterns with confidence 0.7', () => {
    const patterns: RetroPattern[] = [{
      description: 'Gate rejection pattern',
      evidence: 'Gate rejected 2 times',
      suggestion: 'Review rejections',
      confidence: 'Medium',
      occurrences: 2,
    }];

    persistRetroDiscoveries(patterns, baseData, '/test/project', 'test-session');

    expect(mockDiscovery.recordDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      confidence: 0.7,
    }));
  });

  it('does NOT persist low-confidence patterns', () => {
    const patterns: RetroPattern[] = [{
      description: 'Single occurrence',
      evidence: 'One rejection',
      suggestion: 'Address it',
      confidence: 'Low',
      occurrences: 1,
    }];

    const result = persistRetroDiscoveries(patterns, baseData, '/test/project', 'test-session');

    expect(mockDiscovery.recordDiscovery).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it('handles mixed confidence patterns correctly', () => {
    const patterns: RetroPattern[] = [
      { description: 'High pattern', evidence: 'e1', suggestion: 's1', confidence: 'High', occurrences: 3 },
      { description: 'Medium pattern', evidence: 'e2', suggestion: 's2', confidence: 'Medium', occurrences: 2 },
      { description: 'Low pattern', evidence: 'e3', suggestion: 's3', confidence: 'Low', occurrences: 1 },
    ];

    const result = persistRetroDiscoveries(patterns, baseData, '/test/project', 'test-session');

    expect(mockDiscovery.recordDiscovery).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });

  it('returns list of created discoveries', () => {
    const patterns: RetroPattern[] = [{
      description: 'Pattern A',
      evidence: 'Evidence A',
      suggestion: 'Suggestion A',
      confidence: 'High',
      occurrences: 3,
    }];

    const result = persistRetroDiscoveries(patterns, baseData, '/test/project', 'test-session');

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('category', 'retro_insight');
  });

  it('handles empty patterns array', () => {
    const result = persistRetroDiscoveries([], baseData, '/test/project', 'test-session');

    expect(mockDiscovery.recordDiscovery).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it('tags discoveries with workflow ID', () => {
    const patterns: RetroPattern[] = [{
      description: 'Tagged pattern',
      evidence: 'Some evidence',
      suggestion: 'Some suggestion',
      confidence: 'High',
      occurrences: 3,
    }];

    persistRetroDiscoveries(patterns, baseData, '/test/project', 'test-session');

    expect(mockDiscovery.recordDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      task_context: expect.stringContaining('test-wf'),
    }));
  });
});
