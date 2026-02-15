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

import {
  gatherRetroData,
  analyzeRetroPatterns,
  generateRetroSuggestions,
  runRetro,
} from '../../features/workflow-engine/retro.js';
import type { RetroData, RetroPattern } from '../../features/workflow-engine/retro.js';

describe('retro', () => {
  const projectPath = '/test/project';

  beforeEach(() => {
    vi.resetAllMocks();

    // Default mock returns
    mockManifest.loadManifest.mockReturnValue({
      workflow_id: 'test-workflow',
      feature_name: 'Test Feature',
      gate_audit: [],
      artifacts: [],
    });

    mockTrust.loadTrustState.mockReturnValue({
      bolt_id: 'test-bolt',
      current_level: 5,
      level_history: [],
      rejections: 0,
      approvals: 0,
      bypasses: 0,
      last_updated: new Date().toISOString(),
    });

    mockDiscovery.recordDiscovery.mockImplementation((input) => ({
      ...input,
      id: 'test-discovery-id',
      timestamp: '2025-01-01T00:00:00Z',
      verified: false,
      verification_count: 0,
      last_useful: '2025-01-01T00:00:00Z',
    }));

    mockFs.existsSync.mockReturnValue(false);
    mockFs.readdirSync.mockReturnValue([]);
  });

  describe('gatherRetroData', () => {
    it('returns empty data when no manifest exists', () => {
      mockManifest.loadManifest.mockReturnValue(null);

      const result = gatherRetroData(projectPath);

      expect(result).toEqual({
        workflowId: '',
        featureName: '',
        gateRejections: [],
        cascadeEvents: [],
        trustDecreases: [],
        ciFailureCount: 0,
        totalGates: 0,
        totalRejections: 0,
      });
    });

    it('collects gate rejections from manifest audit', () => {
      mockManifest.loadManifest.mockReturnValue({
        workflow_id: 'wf-123',
        feature_name: 'Feature A',
        gate_audit: [
          {
            phase: 'vision',
            timestamp: '2026-02-14T10:00:00Z',
            action: 'rejected',
            actor: 'human',
            reason: 'Incomplete requirements',
          },
          {
            phase: 'forge',
            timestamp: '2026-02-14T11:00:00Z',
            action: 'approved',
            actor: 'trust',
            reason: null,
          },
          {
            phase: 'summit',
            timestamp: '2026-02-14T12:00:00Z',
            action: 'rejected',
            actor: 'human',
            reason: 'Failed tests',
          },
        ],
        artifacts: [],
      });

      const result = gatherRetroData(projectPath);

      expect(result.gateRejections).toHaveLength(2);
      expect(result.gateRejections[0]).toEqual({
        phase: 'vision',
        timestamp: '2026-02-14T10:00:00Z',
        reason: 'Incomplete requirements',
        actor: 'human',
      });
      expect(result.gateRejections[1]).toEqual({
        phase: 'summit',
        timestamp: '2026-02-14T12:00:00Z',
        reason: 'Failed tests',
        actor: 'human',
      });
      expect(result.totalGates).toBe(3);
      expect(result.totalRejections).toBe(2);
    });

    it('collects cascade events from artifact statusHistory', () => {
      mockManifest.loadManifest.mockReturnValue({
        workflow_id: 'wf-123',
        feature_name: 'Feature A',
        gate_audit: [],
        artifacts: [
          {
            id: 'artifact-1',
            type: 'plan',
            phase: 'vision',
            stage: 'draft',
            path: '/path/to/plan.md',
            created_at: '2026-02-14T09:00:00Z',
            updated_at: '2026-02-14T10:00:00Z',
            validation_passed: true,
            write_complete: true,
            checksum: 'abc123',
            contract_status: 'stale',
            contract_version: 1,
            stale_reason: 'Updated dependency',
            statusHistory: [
              { status: 'active', timestamp: '2026-02-14T09:00:00Z' },
              { status: 'stale', timestamp: '2026-02-14T10:00:00Z' },
            ],
          },
          {
            id: 'artifact-2',
            type: 'code',
            phase: 'forge',
            stage: 'draft',
            path: '/path/to/code.ts',
            created_at: '2026-02-14T09:30:00Z',
            updated_at: '2026-02-14T11:00:00Z',
            validation_passed: false,
            write_complete: true,
            checksum: 'def456',
            contract_status: 'violated',
            contract_version: 1,
            stale_reason: null,
            statusHistory: [
              { status: 'active', timestamp: '2026-02-14T09:30:00Z' },
              { status: 'VIOLATED', timestamp: '2026-02-14T11:00:00Z' },
            ],
          },
          {
            id: 'artifact-3',
            type: 'doc',
            phase: 'vision',
            stage: 'draft',
            path: '/path/to/doc.md',
            created_at: '2026-02-14T10:00:00Z',
            updated_at: '2026-02-14T10:30:00Z',
            validation_passed: true,
            write_complete: true,
            checksum: 'ghi789',
            contract_status: 'active',
            contract_version: 1,
            stale_reason: null,
            statusHistory: [
              { status: 'active', timestamp: '2026-02-14T10:00:00Z' },
            ],
          },
        ],
      });

      const result = gatherRetroData(projectPath);

      expect(result.cascadeEvents).toHaveLength(2);
      expect(result.cascadeEvents[0]).toEqual({
        artifactId: 'artifact-1',
        status: 'stale',
        timestamp: '2026-02-14T10:00:00Z',
      });
      expect(result.cascadeEvents[1]).toEqual({
        artifactId: 'artifact-2',
        status: 'VIOLATED',
        timestamp: '2026-02-14T11:00:00Z',
      });
    });

    it('collects trust decrease events', () => {
      mockManifest.loadManifest.mockReturnValue({
        workflow_id: 'wf-123',
        feature_name: 'Feature A',
        gate_audit: [],
        artifacts: [],
      });

      mockTrust.loadTrustState.mockReturnValue({
        bolt_id: 'test-bolt',
        current_level: 3,
        level_history: [
          {
            from: 5,
            to: 4,
            reason: 'Gate rejection in vision',
            timestamp: '2026-02-14T10:00:00Z',
          },
          {
            from: 4,
            to: 5,
            reason: 'Successful completion',
            timestamp: '2026-02-14T11:00:00Z',
          },
          {
            from: 5,
            to: 3,
            reason: 'Multiple rejections',
            timestamp: '2026-02-14T12:00:00Z',
          },
        ],
        rejections: 2,
        approvals: 1,
        bypasses: 0,
        last_updated: '2026-02-14T12:00:00Z',
      });

      const result = gatherRetroData(projectPath);

      expect(result.trustDecreases).toHaveLength(2);
      expect(result.trustDecreases[0]).toEqual({
        from: 5,
        to: 4,
        reason: 'Gate rejection in vision',
        timestamp: '2026-02-14T10:00:00Z',
      });
      expect(result.trustDecreases[1]).toEqual({
        from: 5,
        to: 3,
        reason: 'Multiple rejections',
        timestamp: '2026-02-14T12:00:00Z',
      });
    });

    it('counts CI failures from validation reports', () => {
      mockManifest.loadManifest.mockReturnValue({
        workflow_id: 'wf-123',
        feature_name: 'Feature A',
        gate_audit: [],
        artifacts: [],
      });

      mockFs.existsSync.mockImplementation((path: string) => {
        // Return true for construction directory and validation report files
        return typeof path === 'string' && (
          path.includes('construction') ||
          path.includes('validation-report.md')
        );
      });

      mockFs.readdirSync.mockReturnValue([
        { isDirectory: () => true, name: 'UNIT-001' },
        { isDirectory: () => true, name: 'UNIT-002' },
        { isDirectory: () => false, name: 'file.txt' },
        { isDirectory: () => true, name: 'OTHER-DIR' },
      ]);

      mockFs.readFileSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('UNIT-001')) {
          return `# Validation Report
Test 1: FAIL
Test 2: pass
Test 3: Fail
`;
        }
        if (typeof path === 'string' && path.includes('UNIT-002')) {
          return `# Validation Report
Test 1: pass
Test 2: FAILURE detected
`;
        }
        return '';
      });

      const result = gatherRetroData(projectPath);

      expect(result.ciFailureCount).toBe(3); // 2 from UNIT-001, 1 from UNIT-002
    });

    it('handles missing construction directory gracefully', () => {
      mockManifest.loadManifest.mockReturnValue({
        workflow_id: 'wf-123',
        feature_name: 'Feature A',
        gate_audit: [],
        artifacts: [],
      });

      mockFs.existsSync.mockReturnValue(false);

      const result = gatherRetroData(projectPath);

      expect(result.ciFailureCount).toBe(0);
    });
  });

  describe('analyzeRetroPatterns', () => {
    it('returns empty array for empty data', () => {
      const data: RetroData = {
        workflowId: 'wf-123',
        featureName: 'Feature A',
        gateRejections: [],
        cascadeEvents: [],
        trustDecreases: [],
        ciFailureCount: 0,
        totalGates: 0,
        totalRejections: 0,
      };

      const patterns = analyzeRetroPatterns(data);

      expect(patterns).toEqual([]);
    });

    it('identifies recurring gate rejection patterns (High)', () => {
      const data: RetroData = {
        workflowId: 'wf-123',
        featureName: 'Feature A',
        gateRejections: [
          { phase: 'vision', timestamp: '2026-02-14T10:00:00Z', reason: 'Incomplete requirements', actor: 'human' },
          { phase: 'forge', timestamp: '2026-02-14T11:00:00Z', reason: 'Incomplete requirements', actor: 'human' },
          { phase: 'summit', timestamp: '2026-02-14T12:00:00Z', reason: 'Incomplete requirements', actor: 'human' },
        ],
        cascadeEvents: [],
        trustDecreases: [],
        ciFailureCount: 0,
        totalGates: 5,
        totalRejections: 3,
      };

      const patterns = analyzeRetroPatterns(data);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].confidence).toBe('High');
      expect(patterns[0].occurrences).toBe(3);
      expect(patterns[0].description).toContain('incomplete requirements');
    });

    it('creates Medium pattern for 2 same-reason rejections', () => {
      const data: RetroData = {
        workflowId: 'wf-123',
        featureName: 'Feature A',
        gateRejections: [
          { phase: 'vision', timestamp: '2026-02-14T10:00:00Z', reason: 'Failed tests', actor: 'human' },
          { phase: 'forge', timestamp: '2026-02-14T11:00:00Z', reason: 'Failed tests', actor: 'human' },
          { phase: 'summit', timestamp: '2026-02-14T12:00:00Z', reason: 'Missing documentation', actor: 'human' },
        ],
        cascadeEvents: [],
        trustDecreases: [],
        ciFailureCount: 0,
        totalGates: 3,
        totalRejections: 3,
      };

      const patterns = analyzeRetroPatterns(data);

      const mediumPattern = patterns.find(p => p.occurrences === 2);
      expect(mediumPattern).toBeDefined();
      expect(mediumPattern?.confidence).toBe('Medium');
      expect(mediumPattern?.description).toContain('failed tests');
    });

    it('creates Low-confidence patterns for unique rejections', () => {
      const data: RetroData = {
        workflowId: 'wf-123',
        featureName: 'Feature A',
        gateRejections: [
          { phase: 'vision', timestamp: '2026-02-14T10:00:00Z', reason: 'Reason A', actor: 'human' },
          { phase: 'forge', timestamp: '2026-02-14T11:00:00Z', reason: 'Reason B', actor: 'human' },
          { phase: 'summit', timestamp: '2026-02-14T12:00:00Z', reason: 'Reason C', actor: 'human' },
        ],
        cascadeEvents: [],
        trustDecreases: [],
        ciFailureCount: 0,
        totalGates: 3,
        totalRejections: 3,
      };

      const patterns = analyzeRetroPatterns(data);

      expect(patterns).toHaveLength(3);
      expect(patterns.every(p => p.confidence === 'Low')).toBe(true);
      expect(patterns.every(p => p.occurrences === 1)).toBe(true);
    });

    it('identifies trust decrease pattern', () => {
      const data: RetroData = {
        workflowId: 'wf-123',
        featureName: 'Feature A',
        gateRejections: [],
        cascadeEvents: [],
        trustDecreases: [
          { from: 5, to: 4, reason: 'Gate rejection', timestamp: '2026-02-14T10:00:00Z' },
          { from: 4, to: 3, reason: 'Multiple failures', timestamp: '2026-02-14T11:00:00Z' },
        ],
        ciFailureCount: 0,
        totalGates: 0,
        totalRejections: 0,
      };

      const patterns = analyzeRetroPatterns(data);

      const trustPattern = patterns.find(p => p.description.includes('Trust level decreases'));
      expect(trustPattern).toBeDefined();
      expect(trustPattern?.confidence).toBe('Medium');
    });

    it('identifies cascade invalidation pattern', () => {
      const data: RetroData = {
        workflowId: 'wf-123',
        featureName: 'Feature A',
        gateRejections: [],
        cascadeEvents: [
          { artifactId: 'artifact-1', status: 'stale', timestamp: '2026-02-14T10:00:00Z' },
          { artifactId: 'artifact-2', status: 'violated', timestamp: '2026-02-14T11:00:00Z' },
        ],
        trustDecreases: [],
        ciFailureCount: 0,
        totalGates: 0,
        totalRejections: 0,
      };

      const patterns = analyzeRetroPatterns(data);

      const cascadePattern = patterns.find(p => p.description.includes('Cascade invalidation'));
      expect(cascadePattern).toBeDefined();
      expect(cascadePattern?.confidence).toBe('Medium');
    });
  });

  describe('generateRetroSuggestions', () => {
    const data: RetroData = {
      workflowId: 'wf-123',
      featureName: 'Feature A',
      gateRejections: [
        { phase: 'vision', timestamp: '2026-02-14T10:00:00Z', reason: 'Incomplete', actor: 'human' },
        { phase: 'forge', timestamp: '2026-02-14T11:00:00Z', reason: 'Incomplete', actor: 'human' },
      ],
      cascadeEvents: [],
      trustDecreases: [],
      ciFailureCount: 1,
      totalGates: 5,
      totalRejections: 2,
    };

    const patterns: RetroPattern[] = [
      {
        description: 'Recurring rejection: Incomplete',
        evidence: '2 rejections with reason: Incomplete',
        suggestion: 'Review requirements gathering process',
        confidence: 'Medium',
        occurrences: 2,
      },
    ];

    it('generates correct markdown format', () => {
      mockTrust.loadTrustState.mockReturnValue({
        bolt_id: 'test-bolt',
        current_level: 5,
        level_history: [],
        rejections: 0,
        approvals: 0,
        bypasses: 0,
        last_updated: new Date().toISOString(),
      });

      generateRetroSuggestions(data, patterns, projectPath);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const content = writeCall[1] as string;

      expect(content).toContain('# Guardrail Retro:');
      expect(content).toContain('## Summary');
      expect(content).toContain('## Patterns Identified');
      expect(content).toContain('## Advisory Recommendations');
      expect(content).toContain('Feature A');
    });

    it('writes to correct path', () => {
      mockTrust.loadTrustState.mockReturnValue({
        bolt_id: 'test-bolt',
        current_level: 5,
        level_history: [],
        rejections: 0,
        approvals: 0,
        bypasses: 0,
        last_updated: new Date().toISOString(),
      });

      const result = generateRetroSuggestions(data, patterns, projectPath);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.olympus'),
        expect.objectContaining({ recursive: true })
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('suggestions.md'),
        expect.any(String),
        'utf-8'
      );
      expect(result).toContain('suggestions.md');
    });

    it('includes rejection rate percentage', () => {
      mockTrust.loadTrustState.mockReturnValue({
        bolt_id: 'test-bolt',
        current_level: 5,
        level_history: [],
        rejections: 0,
        approvals: 0,
        bypasses: 0,
        last_updated: new Date().toISOString(),
      });

      generateRetroSuggestions(data, patterns, projectPath);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const content = writeCall[1] as string;

      expect(content).toContain('40.0%'); // 2 rejections / 5 total gates
    });

    it('handles no patterns gracefully', () => {
      mockTrust.loadTrustState.mockReturnValue({
        bolt_id: 'test-bolt',
        current_level: 5,
        level_history: [],
        rejections: 0,
        approvals: 0,
        bypasses: 0,
        last_updated: new Date().toISOString(),
      });

      generateRetroSuggestions(data, [], projectPath);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const content = writeCall[1] as string;

      expect(content).toContain('No significant patterns identified');
    });

    it('includes trust level changes in summary', () => {
      mockTrust.loadTrustState.mockReturnValue({
        bolt_id: 'test-bolt',
        current_level: 3,
        level_history: [
          { from: 5, to: 3, reason: 'Rejections', timestamp: '2026-02-14T10:00:00Z' },
        ],
        rejections: 2,
        approvals: 0,
        bypasses: 0,
        last_updated: '2026-02-14T10:00:00Z',
      });

      generateRetroSuggestions(data, patterns, projectPath);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const content = writeCall[1] as string;

      expect(content).toContain('5 -> 3');
    });
  });

  describe('runRetro', () => {
    it('returns failure when no manifest', () => {
      mockManifest.loadManifest.mockReturnValue(null);

      const result = runRetro(projectPath);

      expect(result.success).toBe(false);
      expect(result.message).toContain('No workflow data found');
      expect(result.suggestionsPath).toBeNull();
      expect(result.data).toBeNull();
      expect(result.patterns).toEqual([]);
    });

    it('returns success with suggestions path', () => {
      mockManifest.loadManifest.mockReturnValue({
        workflow_id: 'wf-123',
        feature_name: 'Feature A',
        gate_audit: [
          { phase: 'vision', timestamp: '2026-02-14T10:00:00Z', action: 'rejected', actor: 'human', reason: 'Test' },
        ],
        artifacts: [],
      });

      mockTrust.loadTrustState.mockReturnValue({
        bolt_id: 'test-bolt',
        current_level: 5,
        level_history: [],
        rejections: 1,
        approvals: 0,
        bypasses: 0,
        last_updated: new Date().toISOString(),
      });

      const result = runRetro(projectPath);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Retro analysis complete');
      expect(result.suggestionsPath).toContain('suggestions.md');
      expect(result.data).not.toBeNull();
    });

    it('populates patterns in result', () => {
      mockManifest.loadManifest.mockReturnValue({
        workflow_id: 'wf-123',
        feature_name: 'Feature A',
        gate_audit: [
          { phase: 'vision', timestamp: '2026-02-14T10:00:00Z', action: 'rejected', actor: 'human', reason: 'Issue A' },
          { phase: 'forge', timestamp: '2026-02-14T11:00:00Z', action: 'rejected', actor: 'human', reason: 'Issue A' },
        ],
        artifacts: [],
      });

      mockTrust.loadTrustState.mockReturnValue({
        bolt_id: 'test-bolt',
        current_level: 4,
        level_history: [],
        rejections: 2,
        approvals: 0,
        bypasses: 0,
        last_updated: new Date().toISOString(),
      });

      const result = runRetro(projectPath);

      expect(result.patterns.length).toBeGreaterThan(0);
      expect(result.patterns[0]).toHaveProperty('description');
      expect(result.patterns[0]).toHaveProperty('confidence');
      expect(result.patterns[0]).toHaveProperty('occurrences');
    });

    it('works during active workflow', () => {
      mockManifest.loadManifest.mockReturnValue({
        workflow_id: 'wf-active',
        feature_name: 'Active Feature',
        gate_audit: [],
        artifacts: [],
      });

      mockTrust.loadTrustState.mockReturnValue({
        bolt_id: 'test-bolt',
        current_level: 5,
        level_history: [],
        rejections: 0,
        approvals: 0,
        bypasses: 0,
        last_updated: new Date().toISOString(),
      });

      const result = runRetro(projectPath);

      expect(result.success).toBe(true);
      expect(result.data?.workflowId).toBe('wf-active');
    });
  });
});
