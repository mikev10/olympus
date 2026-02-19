/**
 * Comprehensive tests for ODLC Artifact Manifest System
 *
 * Tests all exported functions from manifest.ts with 90%+ coverage.
 * Validates artifact tracking, versioning, checksums, links, and recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ManifestSchema, ManifestArtifact, ArtifactLink } from '../../features/workflow-engine/phase-types.js';
import {
  createManifest,
  loadManifest,
  saveManifest,
  registerArtifact,
  linkArtifacts,
  computeChecksum,
  detectStaleArtifacts,
  cascadeInvalidation,
  runAlignmentCheck,
  recoverManifest,
  normalizePath,
  updatePhaseStatus,
  addGateAuditEntry,
  getArtifactById,
  getArtifactsByPhase,
  updateContractStatus,
} from '../../features/workflow-engine/manifest.js';

describe('Manifest System', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'manifest-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('normalizePath', () => {
    it('converts backslashes to forward slashes', () => {
      expect(normalizePath('C:\\Users\\test\\file.txt')).toBe('C:/Users/test/file.txt');
    });

    it('leaves forward slashes unchanged', () => {
      expect(normalizePath('/home/user/file.txt')).toBe('/home/user/file.txt');
    });

    it('handles mixed separators', () => {
      expect(normalizePath('C:\\Users/test\\file.txt')).toBe('C:/Users/test/file.txt');
    });

    it('handles empty string', () => {
      expect(normalizePath('')).toBe('');
    });
  });

  describe('createManifest', () => {
    it('creates manifest.json at correct path', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      expect(manifestPath).toBe(join(tmpDir, 'aidlc-docs', 'test-workflow', 'manifest.json'));
      expect(fs.existsSync(manifestPath)).toBe(true);
    });

    it('initializes with schema_version 2.0.0', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath);

      expect(manifest).not.toBeNull();
      expect(manifest!.schema_version).toBe('2.0.0');
    });

    it('sets workflow_id and feature_name correctly', () => {
      const manifestPath = createManifest('my-workflow', 'My Feature', tmpDir);
      const manifest = loadManifest(manifestPath);

      expect(manifest!.workflow_id).toBe('my-workflow');
      expect(manifest!.feature_name).toBe('My Feature');
    });

    it('initializes all phases as not_started', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath);

      expect(manifest!.phases.discovery.status).toBe('not_started');
      expect(manifest!.phases.inception.status).toBe('not_started');
      expect(manifest!.phases.construction.status).toBe('not_started');
      expect(manifest!.phases.operations.status).toBe('not_started');
    });

    it('initializes all arrays as empty', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath);

      expect(manifest!.artifacts).toEqual([]);
      expect(manifest!.links).toEqual([]);
      expect(manifest!.risks).toEqual([]);
      expect(manifest!.gate_audit).toEqual([]);
      expect(manifest!.alignment_checks).toEqual([]);
    });

    it('initializes nullable fields as null', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath);

      expect(manifest!.depth_assessment).toBeNull();
      expect(manifest!.metrics).toBeNull();
      expect(manifest!.risk_tier).toBeNull();
    });

    it('sets created_at and updated_at timestamps', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath);

      expect(manifest!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(manifest!.updated_at).toBe(manifest!.created_at);
    });

    it('creates directory structure if needed', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const workflowDir = join(tmpDir, 'aidlc-docs', 'test-workflow');

      expect(fs.existsSync(workflowDir)).toBe(true);
      expect(fs.statSync(workflowDir).isDirectory()).toBe(true);
    });

    it('creates directory even if parent does not exist', () => {
      // ensureDirSync creates the full path, so this should succeed
      const deepPath = join(tmpDir, 'deeply', 'nested', 'path');
      const manifestPath = createManifest('test-workflow', 'Test Feature', deepPath);

      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = loadManifest(manifestPath);
      expect(manifest).not.toBeNull();
    });
  });

  describe('loadManifest', () => {
    it('returns parsed manifest for valid file', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath);

      expect(manifest).not.toBeNull();
      expect(manifest!.workflow_id).toBe('test-workflow');
    });

    it('returns null for non-existent file', () => {
      const manifestPath = join(tmpDir, 'nonexistent.json');
      const manifest = loadManifest(manifestPath);

      expect(manifest).toBeNull();
    });

    it('returns null for corrupt JSON', () => {
      const manifestPath = join(tmpDir, 'corrupt.json');
      fs.writeFileSync(manifestPath, '{ invalid json }', 'utf-8');

      const manifest = loadManifest(manifestPath);
      expect(manifest).toBeNull();
    });

    it('handles empty file gracefully', () => {
      const manifestPath = join(tmpDir, 'empty.json');
      fs.writeFileSync(manifestPath, '', 'utf-8');

      const manifest = loadManifest(manifestPath);
      expect(manifest).toBeNull();
    });
  });

  describe('saveManifest', () => {
    it('saves manifest with updated_at timestamp', async () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath)!;

      const originalUpdatedAt = manifest.updated_at;

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      saveManifest(manifestPath, manifest);
      const reloaded = loadManifest(manifestPath)!;

      expect(reloaded.updated_at).not.toBe(originalUpdatedAt);
      expect(new Date(reloaded.updated_at).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
    });

    it('uses pretty formatting with 2 spaces', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath)!;

      saveManifest(manifestPath, manifest);
      const content = fs.readFileSync(manifestPath, 'utf-8');

      // Check for indentation
      expect(content).toContain('  "schema_version"');
      expect(content).toContain('  "workflow_id"');
    });

    it('overwrites existing file', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath)!;

      manifest.feature_name = 'Updated Feature';
      saveManifest(manifestPath, manifest);

      const reloaded = loadManifest(manifestPath)!;
      expect(reloaded.feature_name).toBe('Updated Feature');
    });

    it('throws error for invalid path', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath)!;

      expect(() => {
        saveManifest('/nonexistent/directory/manifest.json', manifest);
      }).toThrow();
    });
  });

  describe('computeChecksum', () => {
    it('returns SHA-256 hex string for existing file', () => {
      const filePath = join(tmpDir, 'test.txt');
      fs.writeFileSync(filePath, 'Hello, World!', 'utf-8');

      const checksum = computeChecksum(filePath);

      expect(checksum).not.toBeNull();
      expect(checksum).toHaveLength(64); // SHA-256 hex is 64 characters
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns null for non-existent file', () => {
      const checksum = computeChecksum(join(tmpDir, 'nonexistent.txt'));
      expect(checksum).toBeNull();
    });

    it('returns different checksums for different content', () => {
      const file1 = join(tmpDir, 'file1.txt');
      const file2 = join(tmpDir, 'file2.txt');

      fs.writeFileSync(file1, 'Content A', 'utf-8');
      fs.writeFileSync(file2, 'Content B', 'utf-8');

      const checksum1 = computeChecksum(file1);
      const checksum2 = computeChecksum(file2);

      expect(checksum1).not.toBe(checksum2);
    });

    it('returns same checksum for identical content', () => {
      const file1 = join(tmpDir, 'file1.txt');
      const file2 = join(tmpDir, 'file2.txt');

      fs.writeFileSync(file1, 'Same Content', 'utf-8');
      fs.writeFileSync(file2, 'Same Content', 'utf-8');

      const checksum1 = computeChecksum(file1);
      const checksum2 = computeChecksum(file2);

      expect(checksum1).toBe(checksum2);
    });

    it('handles binary files', () => {
      const filePath = join(tmpDir, 'binary.dat');
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF]);
      fs.writeFileSync(filePath, buffer);

      const checksum = computeChecksum(filePath);

      expect(checksum).not.toBeNull();
      expect(checksum).toHaveLength(64);
    });
  });

  describe('registerArtifact', () => {
    it('registers new artifact with contract_version 1', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const manifest = loadManifest(manifestPath)!;
      const artifact = manifest.artifacts.find(a => a.id === 'prd-1');

      expect(artifact).toBeDefined();
      expect(artifact!.contract_version).toBe(1);
      expect(artifact!.contract_status).toBe('draft');
    });

    it('increments contract_version when updating existing artifact', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: true,
        write_complete: true,
        checksum: null,
      });

      const manifest = loadManifest(manifestPath)!;
      const artifact = manifest.artifacts.find(a => a.id === 'prd-1');

      expect(artifact!.contract_version).toBe(2);
      expect(artifact!.validation_passed).toBe(true);
      expect(artifact!.write_complete).toBe(true);
    });

    it('normalizes path to forward slashes', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: 'C:\\Users\\test\\prd.md',
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const manifest = loadManifest(manifestPath)!;
      const artifact = manifest.artifacts.find(a => a.id === 'prd-1');

      expect(artifact!.path).toBe('C:/Users/test/prd.md');
    });

    it('auto-computes checksum for existing files', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const filePath = join(tmpDir, 'prd.md');
      fs.writeFileSync(filePath, 'PRD content', 'utf-8');

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: filePath,
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });

      const manifest = loadManifest(manifestPath)!;
      const artifact = manifest.artifacts.find(a => a.id === 'prd-1');

      expect(artifact!.checksum).not.toBeNull();
      expect(artifact!.checksum).toHaveLength(64);
    });

    it('sets checksum to null for non-existent files', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'nonexistent.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const manifest = loadManifest(manifestPath)!;
      const artifact = manifest.artifacts.find(a => a.id === 'prd-1');

      expect(artifact!.checksum).toBeNull();
    });

    it('throws error if manifest not found', () => {
      const manifestPath = join(tmpDir, 'nonexistent', 'manifest.json');

      expect(() => {
        registerArtifact(manifestPath, {
          id: 'prd-1',
          type: 'intent',
          phase: 'inception',
          stage: 'intent',
          path: join(tmpDir, 'prd.md'),
          validation_passed: null,
          write_complete: false,
          checksum: null,
        });
      }).toThrow('Manifest not found');
    });

    it('sets created_at and updated_at for new artifacts', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const manifest = loadManifest(manifestPath)!;
      const artifact = manifest.artifacts.find(a => a.id === 'prd-1');

      expect(artifact!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(artifact!.updated_at).toBe(artifact!.created_at);
    });

    it('updates updated_at but preserves created_at on update', async () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const manifest1 = loadManifest(manifestPath)!;
      const originalCreatedAt = manifest1.artifacts[0].created_at;

      await new Promise(resolve => setTimeout(resolve, 10));

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: true,
        write_complete: true,
        checksum: null,
      });

      const manifest2 = loadManifest(manifestPath)!;
      const artifact = manifest2.artifacts[0];

      expect(artifact.created_at).toBe(originalCreatedAt);
      expect(new Date(artifact.updated_at).getTime()).toBeGreaterThan(new Date(originalCreatedAt).getTime());
    });
  });

  describe('linkArtifacts', () => {
    it('links two existing artifacts', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const link: ArtifactLink = {
        source_id: 'prd-1',
        target_id: 'arch-1',
        link_type: 'derives',
      };

      linkArtifacts(manifestPath, link);

      const manifest = loadManifest(manifestPath)!;
      expect(manifest.links).toHaveLength(1);
      expect(manifest.links[0]).toEqual(link);
    });

    it('throws if source artifact does not exist', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const link: ArtifactLink = {
        source_id: 'nonexistent',
        target_id: 'arch-1',
        link_type: 'derives',
      };

      expect(() => {
        linkArtifacts(manifestPath, link);
      }).toThrow('Source artifact not found');
    });

    it('throws if target artifact does not exist', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const link: ArtifactLink = {
        source_id: 'prd-1',
        target_id: 'nonexistent',
        link_type: 'derives',
      };

      expect(() => {
        linkArtifacts(manifestPath, link);
      }).toThrow('Target artifact not found');
    });

    it('prevents duplicate links', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const link: ArtifactLink = {
        source_id: 'prd-1',
        target_id: 'arch-1',
        link_type: 'derives',
      };

      linkArtifacts(manifestPath, link);
      linkArtifacts(manifestPath, link); // Duplicate

      const manifest = loadManifest(manifestPath)!;
      expect(manifest.links).toHaveLength(1);
    });

    it('allows same artifacts with different link types', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      linkArtifacts(manifestPath, {
        source_id: 'prd-1',
        target_id: 'arch-1',
        link_type: 'derives',
      });

      linkArtifacts(manifestPath, {
        source_id: 'prd-1',
        target_id: 'arch-1',
        link_type: 'refines',
      });

      const manifest = loadManifest(manifestPath)!;
      expect(manifest.links).toHaveLength(2);
    });

    it('saves manifest after linking', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const manifest1 = loadManifest(manifestPath)!;
      const originalUpdatedAt = manifest1.updated_at;

      linkArtifacts(manifestPath, {
        source_id: 'prd-1',
        target_id: 'arch-1',
        link_type: 'derives',
      });

      const manifest2 = loadManifest(manifestPath)!;
      expect(new Date(manifest2.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(originalUpdatedAt).getTime());
    });
  });

  describe('detectStaleArtifacts', () => {
    it('returns empty array when no artifacts changed', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const filePath = join(tmpDir, 'prd.md');
      fs.writeFileSync(filePath, 'Original content', 'utf-8');

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: filePath,
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });

      const staleIds = detectStaleArtifacts(manifestPath);
      expect(staleIds).toEqual([]);
    });

    it('detects artifacts with changed checksums', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const filePath = join(tmpDir, 'prd.md');
      fs.writeFileSync(filePath, 'Original content', 'utf-8');

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: filePath,
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });

      // Modify file
      fs.writeFileSync(filePath, 'Modified content', 'utf-8');

      const staleIds = detectStaleArtifacts(manifestPath);
      expect(staleIds).toEqual(['prd-1']);
    });

    it('skips artifacts with no checksum', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'nonexistent.md'),
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });

      const staleIds = detectStaleArtifacts(manifestPath);
      expect(staleIds).toEqual([]);
    });

    it('skips artifacts where write_complete is false', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const filePath = join(tmpDir, 'prd.md');
      fs.writeFileSync(filePath, 'Original content', 'utf-8');

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: filePath,
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      // Modify file
      fs.writeFileSync(filePath, 'Modified content', 'utf-8');

      const staleIds = detectStaleArtifacts(manifestPath);
      expect(staleIds).toEqual([]);
    });

    it('returns empty array for missing manifest', () => {
      const staleIds = detectStaleArtifacts(join(tmpDir, 'nonexistent', 'manifest.json'));
      expect(staleIds).toEqual([]);
    });

    it('detects multiple changed artifacts', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const file1 = join(tmpDir, 'prd.md');
      const file2 = join(tmpDir, 'arch.md');

      fs.writeFileSync(file1, 'PRD content', 'utf-8');
      fs.writeFileSync(file2, 'Arch content', 'utf-8');

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: file1,
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: file2,
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });

      // Modify both files
      fs.writeFileSync(file1, 'Modified PRD', 'utf-8');
      fs.writeFileSync(file2, 'Modified Arch', 'utf-8');

      const staleIds = detectStaleArtifacts(manifestPath);
      expect(staleIds).toHaveLength(2);
      expect(staleIds).toContain('prd-1');
      expect(staleIds).toContain('arch-1');
    });
  });

  describe('cascadeInvalidation', () => {
    it('marks changed artifact as stale', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      cascadeInvalidation(manifestPath, 'prd-1');

      const manifest = loadManifest(manifestPath)!;
      const artifact = manifest.artifacts.find(a => a.id === 'prd-1');

      expect(artifact!.contract_status).toBe('stale');
      expect(artifact!.stale_reason).toBe('Artifact content was modified');
    });

    it('marks all downstream artifacts as stale', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      linkArtifacts(manifestPath, {
        source_id: 'prd-1',
        target_id: 'arch-1',
        link_type: 'derives',
      });

      cascadeInvalidation(manifestPath, 'prd-1');

      const manifest = loadManifest(manifestPath)!;
      const archArtifact = manifest.artifacts.find(a => a.id === 'arch-1');

      expect(archArtifact!.contract_status).toBe('stale');
      expect(archArtifact!.stale_reason).toContain('Parent artifact');
    });

    it('cascades through multiple levels', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'code-1',
        type: 'code',
        phase: 'construction',
        stage: 'implementation',
        path: join(tmpDir, 'code.ts'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      linkArtifacts(manifestPath, {
        source_id: 'prd-1',
        target_id: 'arch-1',
        link_type: 'derives',
      });

      linkArtifacts(manifestPath, {
        source_id: 'arch-1',
        target_id: 'code-1',
        link_type: 'implements',
      });

      cascadeInvalidation(manifestPath, 'prd-1');

      const manifest = loadManifest(manifestPath)!;
      const prdArtifact = manifest.artifacts.find(a => a.id === 'prd-1');
      const archArtifact = manifest.artifacts.find(a => a.id === 'arch-1');
      const codeArtifact = manifest.artifacts.find(a => a.id === 'code-1');

      expect(prdArtifact!.contract_status).toBe('stale');
      expect(archArtifact!.contract_status).toBe('stale');
      expect(codeArtifact!.contract_status).toBe('stale');
    });

    it('handles circular links without infinite loop', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'art-1',
        type: 'doc',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'art1.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'art-2',
        type: 'doc',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'art2.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      linkArtifacts(manifestPath, {
        source_id: 'art-1',
        target_id: 'art-2',
        link_type: 'derives',
      });

      linkArtifacts(manifestPath, {
        source_id: 'art-2',
        target_id: 'art-1',
        link_type: 'derives',
      });

      // Should not hang or throw
      expect(() => {
        cascadeInvalidation(manifestPath, 'art-1');
      }).not.toThrow();

      const manifest = loadManifest(manifestPath)!;
      const art1 = manifest.artifacts.find(a => a.id === 'art-1');
      const art2 = manifest.artifacts.find(a => a.id === 'art-2');

      expect(art1!.contract_status).toBe('stale');
      expect(art2!.contract_status).toBe('stale');
    });

    it('saves manifest after cascade', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const manifest1 = loadManifest(manifestPath)!;
      const originalUpdatedAt = manifest1.updated_at;

      cascadeInvalidation(manifestPath, 'prd-1');

      const manifest2 = loadManifest(manifestPath)!;
      expect(new Date(manifest2.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(originalUpdatedAt).getTime());
    });

    it('silently handles missing manifest', () => {
      expect(() => {
        cascadeInvalidation(join(tmpDir, 'nonexistent', 'manifest.json'), 'prd-1');
      }).not.toThrow();
    });
  });

  describe('runAlignmentCheck', () => {
    it('creates placeholder alignment check', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      runAlignmentCheck(manifestPath, 'prd-1', 'arch-1');

      const manifest = loadManifest(manifestPath)!;
      expect(manifest.alignment_checks).toHaveLength(1);

      const check = manifest.alignment_checks[0];
      expect(check.source_artifact_id).toBe('prd-1');
      expect(check.target_artifact_id).toBe('arch-1');
    });

    it('sets verification with zero scores', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      runAlignmentCheck(manifestPath, 'prd-1', 'arch-1');

      const manifest = loadManifest(manifestPath)!;
      const check = manifest.alignment_checks[0];

      expect(check.verification.conformance_score).toBe(0);
      expect(check.verification.coverage_percentage).toBe(0);
      expect(check.verification.missing_items).toEqual([]);
      expect(check.verification.passed).toBe(false);
    });

    it('sets validation with zero scores', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      runAlignmentCheck(manifestPath, 'prd-1', 'arch-1');

      const manifest = loadManifest(manifestPath)!;
      const check = manifest.alignment_checks[0];

      expect(check.validation.alignment_score).toBe(0);
      expect(check.validation.alignment_questions).toEqual([]);
      expect(check.validation.passed).toBe(false);
    });

    it('sets alignment_passed to false', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      runAlignmentCheck(manifestPath, 'prd-1', 'arch-1');

      const manifest = loadManifest(manifestPath)!;
      const check = manifest.alignment_checks[0];

      expect(check.alignment_passed).toBe(false);
    });

    it('sets checked_at to current timestamp', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      runAlignmentCheck(manifestPath, 'prd-1', 'arch-1');

      const manifest = loadManifest(manifestPath)!;
      const check = manifest.alignment_checks[0];

      expect(check.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('appends to alignment_checks array', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-2',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch2.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      runAlignmentCheck(manifestPath, 'prd-1', 'arch-1');
      runAlignmentCheck(manifestPath, 'prd-1', 'arch-2');

      const manifest = loadManifest(manifestPath)!;
      expect(manifest.alignment_checks).toHaveLength(2);
    });

    it('silently handles missing manifest', () => {
      expect(() => {
        runAlignmentCheck(join(tmpDir, 'nonexistent', 'manifest.json'), 'prd-1', 'arch-1');
      }).not.toThrow();
    });
  });

  describe('recoverManifest', () => {
    it('returns null for non-existent directory', () => {
      const manifest = recoverManifest(tmpDir, 'nonexistent-workflow');
      expect(manifest).toBeNull();
    });

    it('creates manifest from discovered files', () => {
      const workflowDir = join(tmpDir, 'aidlc-docs', 'test-workflow');
      fs.ensureDirSync(workflowDir);
      fs.writeFileSync(join(workflowDir, 'prd.md'), 'PRD content', 'utf-8');
      fs.writeFileSync(join(workflowDir, 'arch.md'), 'Arch content', 'utf-8');

      const manifest = recoverManifest(tmpDir, 'test-workflow');

      expect(manifest).not.toBeNull();
      expect(manifest!.artifacts.length).toBeGreaterThan(0);
    });

    it('sets workflow_id and feature_name correctly', () => {
      const workflowDir = join(tmpDir, 'aidlc-docs', 'my-workflow');
      fs.ensureDirSync(workflowDir);
      fs.writeFileSync(join(workflowDir, 'file.txt'), 'content', 'utf-8');

      const manifest = recoverManifest(tmpDir, 'my-workflow');

      expect(manifest!.workflow_id).toBe('my-workflow');
      expect(manifest!.feature_name).toBe('Recovered Workflow');
    });

    it('computes checksums for found files', () => {
      const workflowDir = join(tmpDir, 'aidlc-docs', 'test-workflow');
      fs.ensureDirSync(workflowDir);
      fs.writeFileSync(join(workflowDir, 'test.txt'), 'Test content', 'utf-8');

      const manifest = recoverManifest(tmpDir, 'test-workflow');

      expect(manifest!.artifacts[0].checksum).not.toBeNull();
      expect(manifest!.artifacts[0].checksum).toHaveLength(64);
    });

    it('excludes manifest.json from artifacts', () => {
      const workflowDir = join(tmpDir, 'aidlc-docs', 'test-workflow');
      fs.ensureDirSync(workflowDir);
      fs.writeFileSync(join(workflowDir, 'manifest.json'), '{}', 'utf-8');
      fs.writeFileSync(join(workflowDir, 'other.txt'), 'content', 'utf-8');

      const manifest = recoverManifest(tmpDir, 'test-workflow');

      const manifestArtifact = manifest!.artifacts.find(a => a.path.includes('manifest.json'));
      expect(manifestArtifact).toBeUndefined();
    });

    it('returns null on error', () => {
      // Force an error by using an invalid project path
      const manifest = recoverManifest('/nonexistent/path', 'test-workflow');
      expect(manifest).toBeNull();
    });

    it('handles nested files in subdirectories', () => {
      const workflowDir = join(tmpDir, 'aidlc-docs', 'test-workflow');
      const subDir = join(workflowDir, 'subdir');
      fs.ensureDirSync(subDir);
      fs.writeFileSync(join(subDir, 'nested.txt'), 'Nested content', 'utf-8');

      const manifest = recoverManifest(tmpDir, 'test-workflow');

      expect(manifest!.artifacts.length).toBeGreaterThan(0);
      const nestedArtifact = manifest!.artifacts.find(a => a.path.includes('nested.txt'));
      expect(nestedArtifact).toBeDefined();
    });
  });

  describe('updatePhaseStatus', () => {
    it('updates phase status', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      updatePhaseStatus(manifestPath, 'inception', 'in_progress');

      const manifest = loadManifest(manifestPath)!;
      expect(manifest.phases.inception.status).toBe('in_progress');
    });

    it('sets started_at when provided', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const timestamp = new Date().toISOString();

      updatePhaseStatus(manifestPath, 'inception', 'in_progress', timestamp);

      const manifest = loadManifest(manifestPath)!;
      expect(manifest.phases.inception.started_at).toBe(timestamp);
    });

    it('sets completed_at when provided', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const startTime = new Date().toISOString();
      const endTime = new Date(Date.now() + 1000).toISOString();

      updatePhaseStatus(manifestPath, 'inception', 'in_progress', startTime);
      updatePhaseStatus(manifestPath, 'inception', 'completed', undefined, endTime);

      const manifest = loadManifest(manifestPath)!;
      expect(manifest.phases.inception.completed_at).toBe(endTime);
    });

    it('updates all phases independently', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      updatePhaseStatus(manifestPath, 'discovery', 'completed');
      updatePhaseStatus(manifestPath, 'inception', 'completed');
      updatePhaseStatus(manifestPath, 'construction', 'in_progress');
      updatePhaseStatus(manifestPath, 'operations', 'not_started');

      const manifest = loadManifest(manifestPath)!;
      expect(manifest.phases.discovery.status).toBe('completed');
      expect(manifest.phases.inception.status).toBe('completed');
      expect(manifest.phases.construction.status).toBe('in_progress');
      expect(manifest.phases.operations.status).toBe('not_started');
    });

    it('silently handles missing manifest', () => {
      expect(() => {
        updatePhaseStatus(join(tmpDir, 'nonexistent', 'manifest.json'), 'inception', 'in_progress');
      }).not.toThrow();
    });
  });

  describe('addGateAuditEntry', () => {
    it('adds entry with auto timestamp', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      addGateAuditEntry(manifestPath, {
        phase: 'inception',
        gate_type: 'depth',
        result: 'pass',
        bypassed: false,
        notes: 'All checks passed',
      });

      const manifest = loadManifest(manifestPath)!;
      expect(manifest.gate_audit).toHaveLength(1);

      const entry = manifest.gate_audit[0];
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('appends to gate_audit array', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      addGateAuditEntry(manifestPath, {
        phase: 'inception',
        gate_type: 'depth',
        result: 'pass',
        bypassed: false,
        notes: 'First entry',
      });

      addGateAuditEntry(manifestPath, {
        phase: 'construction',
        gate_type: 'risk',
        result: 'fail',
        bypassed: true,
        notes: 'Second entry',
      });

      const manifest = loadManifest(manifestPath)!;
      expect(manifest.gate_audit).toHaveLength(2);
      expect(manifest.gate_audit[0].notes).toBe('First entry');
      expect(manifest.gate_audit[1].notes).toBe('Second entry');
    });

    it('preserves all entry fields', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      addGateAuditEntry(manifestPath, {
        phase: 'inception',
        gate_type: 'depth',
        result: 'pass',
        bypassed: false,
        notes: 'Test notes',
      });

      const manifest = loadManifest(manifestPath)!;
      const entry = manifest.gate_audit[0];

      expect(entry.phase).toBe('inception');
      expect(entry.gate_type).toBe('depth');
      expect(entry.result).toBe('pass');
      expect(entry.bypassed).toBe(false);
      expect(entry.notes).toBe('Test notes');
    });

    it('silently handles missing manifest', () => {
      expect(() => {
        addGateAuditEntry(join(tmpDir, 'nonexistent', 'manifest.json'), {
          phase: 'inception',
          gate_type: 'depth',
          result: 'pass',
          bypassed: false,
          notes: 'Test',
        });
      }).not.toThrow();
    });
  });

  describe('getArtifactById', () => {
    it('returns correct artifact by ID', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const manifest = loadManifest(manifestPath)!;
      const artifact = getArtifactById(manifest, 'prd-1');

      expect(artifact).toBeDefined();
      expect(artifact!.id).toBe('prd-1');
    });

    it('returns undefined for missing ID', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath)!;

      const artifact = getArtifactById(manifest, 'nonexistent');
      expect(artifact).toBeUndefined();
    });

    it('finds artifact among multiple artifacts', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const manifest = loadManifest(manifestPath)!;
      const artifact = getArtifactById(manifest, 'arch-1');

      expect(artifact!.id).toBe('arch-1');
      expect(artifact!.type).toBe('architecture');
    });
  });

  describe('getArtifactsByPhase', () => {
    it('returns all artifacts for a phase', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'prd-2',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd2.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const manifest = loadManifest(manifestPath)!;
      const artifacts = getArtifactsByPhase(manifest, 'inception');

      expect(artifacts).toHaveLength(2);
      expect(artifacts.every(a => a.phase === 'inception')).toBe(true);
    });

    it('returns empty array for phase with no artifacts', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);
      const manifest = loadManifest(manifestPath)!;

      const artifacts = getArtifactsByPhase(manifest, 'construction');
      expect(artifacts).toEqual([]);
    });

    it('filters correctly across multiple phases', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'arch-1',
        type: 'architecture',
        phase: 'construction',
        stage: 'architecture',
        path: join(tmpDir, 'arch.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      const manifest = loadManifest(manifestPath)!;
      const inceptionArtifacts = getArtifactsByPhase(manifest, 'inception');
      const constructionArtifacts = getArtifactsByPhase(manifest, 'construction');

      expect(inceptionArtifacts).toHaveLength(1);
      expect(constructionArtifacts).toHaveLength(1);
      expect(inceptionArtifacts[0].id).toBe('prd-1');
      expect(constructionArtifacts[0].id).toBe('arch-1');
    });
  });

  describe('updateContractStatus', () => {
    it('updates contract status', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      updateContractStatus(manifestPath, 'prd-1', 'active');

      const manifest = loadManifest(manifestPath)!;
      const artifact = getArtifactById(manifest, 'prd-1');
      expect(artifact!.contract_status).toBe('active');
    });

    it('requires staleReason for stale status', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      // The function catches the error internally, so it doesn't throw
      // but the artifact status should remain unchanged
      updateContractStatus(manifestPath, 'prd-1', 'stale');

      const manifest = loadManifest(manifestPath)!;
      const artifact = getArtifactById(manifest, 'prd-1');

      // Status should remain 'draft' (initial state) since update failed
      expect(artifact!.contract_status).toBe('draft');
    });

    it('sets stale_reason when status is stale', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      // First transition to active (valid: draft → active)
      updateContractStatus(manifestPath, 'prd-1', 'active');
      // Then transition to stale (valid: active → stale)
      updateContractStatus(manifestPath, 'prd-1', 'stale', 'Content modified');

      const manifest = loadManifest(manifestPath)!;
      const artifact = getArtifactById(manifest, 'prd-1');
      expect(artifact!.contract_status).toBe('stale');
      expect(artifact!.stale_reason).toBe('Content modified');
    });

    it('clears stale_reason when setting non-stale status', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      registerArtifact(manifestPath, {
        id: 'prd-1',
        type: 'intent',
        phase: 'inception',
        stage: 'intent',
        path: join(tmpDir, 'prd.md'),
        validation_passed: null,
        write_complete: false,
        checksum: null,
      });

      updateContractStatus(manifestPath, 'prd-1', 'stale', 'Content modified');
      updateContractStatus(manifestPath, 'prd-1', 'active');

      const manifest = loadManifest(manifestPath)!;
      const artifact = getArtifactById(manifest, 'prd-1');
      expect(artifact!.contract_status).toBe('active');
      expect(artifact!.stale_reason).toBeNull();
    });

    it('silently handles missing artifact', () => {
      const manifestPath = createManifest('test-workflow', 'Test Feature', tmpDir);

      expect(() => {
        updateContractStatus(manifestPath, 'nonexistent', 'active');
      }).not.toThrow();
    });

    it('silently handles missing manifest', () => {
      expect(() => {
        updateContractStatus(join(tmpDir, 'nonexistent', 'manifest.json'), 'prd-1', 'active');
      }).not.toThrow();
    });
  });
});
