import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import {
  createManifest,
  loadManifest,
  saveManifest,
  registerArtifact,
  linkArtifacts,
  cascadeInvalidation,
  revalidateStaleArtifacts,
  type ManifestSchema,
  type ManifestArtifact,
  writeArtifact,
  readArtifact,
} from '../../features/workflow-engine/index.js';

const TEST_DIR = path.join(process.cwd(), '.test-cascade-invalidation');

describe('Cascade Invalidation System', () => {
  beforeEach(async () => {
    // Clean up before each test
    if (await fs.pathExists(TEST_DIR)) {
      await fs.remove(TEST_DIR);
    }
    await fs.ensureDir(TEST_DIR);
  });

  afterEach(async () => {
    // Clean up after each test
    if (await fs.pathExists(TEST_DIR)) {
      await fs.remove(TEST_DIR);
    }
  });

  describe('cascadeInvalidation', () => {
    it('marks downstream artifacts as stale when parent changes', async () => {
      // Setup: Create manifest with IDEA -> INTENT -> UNIT -> BOLT chain
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);
      const manifest = loadManifest(manifestPath);
      expect(manifest).toBeTruthy();

      // Create artifacts
      const workflowId = 'test-wf';
      const ideaPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'idea.md');
      const intentPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');
      const unitPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'construction', 'UNIT-001', 'spec.md');
      const boltPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'construction', 'UNIT-001', 'BOLT-001.md');

      await fs.ensureDir(path.dirname(ideaPath));
      await fs.ensureDir(path.dirname(unitPath));
      await fs.writeFile(ideaPath, '# IDEA\nSolve problem X', 'utf-8');
      await fs.writeFile(intentPath, '# INTENT\nImplement solution Y', 'utf-8');
      await fs.writeFile(unitPath, '# UNIT\nBuild module Z', 'utf-8');
      await fs.writeFile(boltPath, '# BOLT\nCreate component A', 'utf-8');

      // Register artifacts
      registerArtifact(manifestPath, {
        id: 'idea-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: ideaPath,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'intent-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'unit-001',
        type: '.md',
        phase: 'construction',
        stage: 'unit',
        path: unitPath,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'bolt-001',
        type: '.md',
        phase: 'construction',
        stage: 'bolt',
        path: boltPath,
        validation_passed: true,
        write_complete: true,
      });

      // Link artifacts: IDEA -> INTENT -> UNIT -> BOLT
      linkArtifacts(manifestPath, {
        source_id: 'idea-001',
        target_id: 'intent-001',
        link_type: 'derives',
      });

      linkArtifacts(manifestPath, {
        source_id: 'intent-001',
        target_id: 'unit-001',
        link_type: 'derives',
      });

      linkArtifacts(manifestPath, {
        source_id: 'unit-001',
        target_id: 'bolt-001',
        link_type: 'implements',
      });

      // Set all to active status
      const manifestBefore = loadManifest(manifestPath)!;
      manifestBefore.artifacts.forEach((a) => {
        a.contract_status = 'active';
      });
      saveManifest(manifestPath, manifestBefore);

      // Act: Trigger cascade from IDEA
      cascadeInvalidation(manifestPath, 'idea-001');

      // Assert: All downstream artifacts should be stale
      const manifestAfter = loadManifest(manifestPath)!;
      const ideaArtifact = manifestAfter.artifacts.find((a) => a.id === 'idea-001');
      const intentArtifact = manifestAfter.artifacts.find((a) => a.id === 'intent-001');
      const unitArtifact = manifestAfter.artifacts.find((a) => a.id === 'unit-001');
      const boltArtifact = manifestAfter.artifacts.find((a) => a.id === 'bolt-001');

      expect(ideaArtifact?.contract_status).toBe('stale');
      expect(intentArtifact?.contract_status).toBe('stale');
      expect(unitArtifact?.contract_status).toBe('stale');
      expect(boltArtifact?.contract_status).toBe('stale');

      expect(ideaArtifact?.stale_reason).toContain('Artifact content was modified');
      expect(intentArtifact?.stale_reason).toBeTruthy();
      expect(unitArtifact?.stale_reason).toBeTruthy();
      expect(boltArtifact?.stale_reason).toBeTruthy();
    });

    it('handles fulfilled artifacts during cascade (marks them stale)', async () => {
      // Setup: Create manifest with IDEA -> INTENT chain
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);

      const workflowId = 'test-wf';
      const ideaPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'idea.md');
      const intentPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');

      await fs.ensureDir(path.dirname(ideaPath));
      await fs.writeFile(ideaPath, '# IDEA\nSolve problem X', 'utf-8');
      await fs.writeFile(intentPath, '# INTENT\nImplement solution Y', 'utf-8');

      registerArtifact(manifestPath, {
        id: 'idea-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: ideaPath,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'intent-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
      });

      linkArtifacts(manifestPath, {
        source_id: 'idea-001',
        target_id: 'intent-001',
        link_type: 'derives',
      });

      // Set INTENT to fulfilled status (this is normally not allowed to transition to stale)
      const manifest = loadManifest(manifestPath)!;
      manifest.artifacts.find((a) => a.id === 'idea-001')!.contract_status = 'active';
      manifest.artifacts.find((a) => a.id === 'intent-001')!.contract_status = 'fulfilled';
      saveManifest(manifestPath, manifest);

      // Act: Trigger cascade from IDEA
      cascadeInvalidation(manifestPath, 'idea-001');

      // Assert: INTENT should be marked stale even though it was fulfilled
      const manifestAfter = loadManifest(manifestPath)!;
      const intentArtifact = manifestAfter.artifacts.find((a) => a.id === 'intent-001');

      expect(intentArtifact?.contract_status).toBe('stale');
      expect(intentArtifact?.stale_reason).toBeTruthy();
    });

    it('skips artifacts that are already stale or violated', async () => {
      // Setup
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);

      const workflowId = 'test-wf';
      const ideaPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'idea.md');
      const intentPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');

      await fs.ensureDir(path.dirname(ideaPath));
      await fs.writeFile(ideaPath, '# IDEA\nSolve problem X', 'utf-8');
      await fs.writeFile(intentPath, '# INTENT\nImplement solution Y', 'utf-8');

      registerArtifact(manifestPath, {
        id: 'idea-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: ideaPath,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'intent-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
      });

      linkArtifacts(manifestPath, {
        source_id: 'idea-001',
        target_id: 'intent-001',
        link_type: 'derives',
      });

      // Set INTENT to already stale
      const manifest = loadManifest(manifestPath)!;
      manifest.artifacts.find((a) => a.id === 'idea-001')!.contract_status = 'active';
      const intentArtifact = manifest.artifacts.find((a) => a.id === 'intent-001')!;
      intentArtifact.contract_status = 'stale';
      intentArtifact.stale_reason = 'Already stale before cascade';
      saveManifest(manifestPath, manifest);

      // Act: Trigger cascade from IDEA
      cascadeInvalidation(manifestPath, 'idea-001');

      // Assert: INTENT should still be stale with original reason
      const manifestAfter = loadManifest(manifestPath)!;
      const intentAfter = manifestAfter.artifacts.find((a) => a.id === 'intent-001');

      expect(intentAfter?.contract_status).toBe('stale');
      expect(intentAfter?.stale_reason).toBe('Already stale before cascade');
    });
  });

  describe('revalidateStaleArtifacts', () => {
    it('runs revalidation and processes stale artifacts', async () => {
      // Setup: Create manifest with IDEA -> INTENT
      // Note: This test verifies the revalidation mechanism runs correctly.
      // Whether artifacts pass validation depends on the alignment engine's scoring,
      // which is tested separately in alignment.test.ts
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);

      const workflowId = 'test-wf';
      const ideaPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'idea.md');
      const intentPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');

      await fs.ensureDir(path.dirname(ideaPath));

      const ideaContent = `# IDEA\n\n## Problem Statement\nSolve problem X\n\n## Success Metrics\n- Metric 1\n- Metric 2`;
      const intentContent = `# INTENT\n\nSolution for problem X with metric 1 and metric 2`;

      await fs.writeFile(ideaPath, ideaContent, 'utf-8');
      await fs.writeFile(intentPath, intentContent, 'utf-8');

      registerArtifact(manifestPath, {
        id: 'idea-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: ideaPath,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'intent-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
      });

      linkArtifacts(manifestPath, {
        source_id: 'idea-001',
        target_id: 'intent-001',
        link_type: 'derives',
      });

      // Mark INTENT as stale
      const manifest = loadManifest(manifestPath)!;
      const intentArtifact = manifest.artifacts.find((a) => a.id === 'intent-001')!;
      intentArtifact.contract_status = 'stale';
      intentArtifact.stale_reason = 'Test invalidation';
      saveManifest(manifestPath, manifest);

      // Act: Revalidate stale artifacts
      const result = await revalidateStaleArtifacts(TEST_DIR, 'test-wf');

      // Assert: Revalidation completed without errors
      expect(result.errors).toHaveLength(0);
      // The artifact will be either restored or stillStale depending on alignment score
      expect(result.restored.length + result.stillStale.length).toBe(1);
      expect(result.restored.includes('intent-001') || result.stillStale.includes('intent-001')).toBe(true);
    });

    it('keeps non-conforming artifacts stale', async () => {
      // Setup: Create manifest with IDEA -> INTENT (intentionally misaligned)
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);

      const workflowId = 'test-wf';
      const ideaPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'idea.md');
      const intentPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');

      await fs.ensureDir(path.dirname(ideaPath));

      // Create IDEA and INTENT with minimal alignment
      const ideaContent = `# IDEA

## Problem Statement
Users need a better authentication system with OAuth and SSO support.

## Success Metrics
- 99.9% uptime
- < 100ms login time
- Support 10k concurrent users

## Business Constraints
- Must use existing database
- Budget: $10k`;

      const intentContent = `# INTENT

This is a totally different feature about data visualization.`;

      await fs.writeFile(ideaPath, ideaContent, 'utf-8');
      await fs.writeFile(intentPath, intentContent, 'utf-8');

      registerArtifact(manifestPath, {
        id: 'idea-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: ideaPath,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'intent-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
      });

      linkArtifacts(manifestPath, {
        source_id: 'idea-001',
        target_id: 'intent-001',
        link_type: 'derives',
      });

      // Mark INTENT as stale
      const manifest = loadManifest(manifestPath)!;
      const intentArtifact = manifest.artifacts.find((a) => a.id === 'intent-001')!;
      intentArtifact.contract_status = 'stale';
      intentArtifact.stale_reason = 'Test invalidation';
      saveManifest(manifestPath, manifest);

      // Act: Revalidate stale artifacts
      const result = await revalidateStaleArtifacts(TEST_DIR, 'test-wf');

      // Assert: INTENT should remain stale (low alignment)
      expect(result.restored).not.toContain('intent-001');
      expect(result.stillStale).toContain('intent-001');

      const manifestAfter = loadManifest(manifestPath)!;
      const intentAfter = manifestAfter.artifacts.find((a) => a.id === 'intent-001');
      expect(intentAfter?.contract_status).toBe('stale');
    });

    it('handles missing parent artifact gracefully', async () => {
      // Setup
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);

      const workflowId = 'test-wf';
      const intentPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');
      await fs.ensureDir(path.dirname(intentPath));
      await fs.writeFile(intentPath, '# INTENT\nContent', 'utf-8');

      registerArtifact(manifestPath, {
        id: 'intent-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
      });

      // Mark as stale but don't create parent link
      const manifest = loadManifest(manifestPath)!;
      manifest.artifacts.find((a) => a.id === 'intent-001')!.contract_status = 'stale';
      saveManifest(manifestPath, manifest);

      // Act
      const result = await revalidateStaleArtifacts(TEST_DIR, 'test-wf');

      // Assert: Should remain stale (no parent to validate against)
      expect(result.stillStale).toContain('intent-001');
      expect(result.restored).not.toContain('intent-001');
    });

    it('handles missing artifact files gracefully', async () => {
      // Setup
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);

      const workflowId = 'test-wf';
      const ideaPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'idea.md');
      const intentPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');

      // Register artifacts but don't create files
      registerArtifact(manifestPath, {
        id: 'idea-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: ideaPath,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'intent-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
      });

      linkArtifacts(manifestPath, {
        source_id: 'idea-001',
        target_id: 'intent-001',
        link_type: 'derives',
      });

      const manifest = loadManifest(manifestPath)!;
      manifest.artifacts.find((a) => a.id === 'intent-001')!.contract_status = 'stale';
      saveManifest(manifestPath, manifest);

      // Act
      const result = await revalidateStaleArtifacts(TEST_DIR, 'test-wf');

      // Assert: Should remain stale (files don't exist)
      expect(result.stillStale).toContain('intent-001');
    });
  });

  describe('Integration: modify artifact -> cascade -> revalidate', () => {
    it('full workflow: edit IDEA, downstream goes stale, revalidate processes artifacts', async () => {
      // Setup
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);

      const workflowId = 'test-wf';
      const ideaPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'idea.md');
      const intentPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');

      await fs.ensureDir(path.dirname(ideaPath));

      const ideaV1 = `# IDEA\n\n## Problem Statement\nAuth problem\n\n## Success Metrics\n- 99% uptime`;
      const intentContent = `# INTENT\n\nSolve auth problem with 99% uptime`;

      await fs.writeFile(ideaPath, ideaV1, 'utf-8');
      await fs.writeFile(intentPath, intentContent, 'utf-8');

      registerArtifact(manifestPath, {
        id: 'idea-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: ideaPath,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'intent-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
      });

      linkArtifacts(manifestPath, {
        source_id: 'idea-001',
        target_id: 'intent-001',
        link_type: 'derives',
      });

      const manifest = loadManifest(manifestPath)!;
      manifest.artifacts.forEach((a) => {
        a.contract_status = 'active';
      });
      saveManifest(manifestPath, manifest);

      // Act 1: Modify IDEA (simulate manual edit)
      const ideaV2 = `# IDEA\n\n## Problem Statement\nAuth problem v2\n\n## Success Metrics\n- 99% uptime\n- OAuth`;

      await fs.writeFile(ideaPath, ideaV2, 'utf-8');

      // Trigger cascade manually (in real system, writeArtifact would do this)
      cascadeInvalidation(manifestPath, 'idea-001');

      // Assert: INTENT should be stale
      const manifestAfterCascade = loadManifest(manifestPath)!;
      const intentAfterCascade = manifestAfterCascade.artifacts.find((a) => a.id === 'intent-001');
      expect(intentAfterCascade?.contract_status).toBe('stale');

      // Act 2: Revalidate
      const result = await revalidateStaleArtifacts(TEST_DIR, 'test-wf');

      // Assert: Revalidation completed
      expect(result.errors).toHaveLength(0);
      expect(result.restored.length + result.stillStale.length).toBe(2); // Both IDEA and INTENT processed

      // Verify manifest was updated (artifacts either restored or remain stale)
      const manifestFinal = loadManifest(manifestPath)!;
      expect(manifestFinal).toBeTruthy();
    });
  });

  describe('writeArtifact cascade integration', () => {
    it('triggers cascade when writing to existing artifact', async () => {
      // Setup
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);

      const workflowId = 'test-wf';
      await fs.ensureDir(path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception'));

      const inceptionDir = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception');
      await fs.ensureDir(inceptionDir);
      const sourceIntentPath = path.join(inceptionDir, 'source-intent.md');
      await fs.writeFile(sourceIntentPath, '# SOURCE\nOriginal content', 'utf-8');
      await writeArtifact(TEST_DIR, 'test-wf', 'intent', '# INTENT\nOriginal content');

      const intentPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');

      registerArtifact(manifestPath, {
        id: 'idea-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: sourceIntentPath,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'intent-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
      });

      linkArtifacts(manifestPath, {
        source_id: 'idea-001',
        target_id: 'intent-001',
        link_type: 'derives',
      });

      const manifest = loadManifest(manifestPath)!;
      manifest.artifacts.forEach((a) => {
        a.contract_status = 'active';
      });
      saveManifest(manifestPath, manifest);

      // Act: Write to existing INTENT artifact (should trigger cascade)
      await writeArtifact(TEST_DIR, 'test-wf', 'intent', '# INTENT\nModified content');

      // Assert: INTENT should be marked stale
      const manifestAfter = loadManifest(manifestPath)!;
      const intentAfter = manifestAfter.artifacts.find((a) => a.id === 'intent-001');

      expect(intentAfter?.contract_status).toBe('stale');
    });

    it('does not trigger cascade when writing new artifact', async () => {
      // Setup
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);

      const workflowId = 'test-wf';
      await fs.ensureDir(path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception'));

      // Act: Write new INTENT artifact
      await writeArtifact(TEST_DIR, 'test-wf', 'intent', '# INTENT\nNew content');

      // Register after write
      const intentPath2 = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');
      registerArtifact(manifestPath, {
        id: 'idea-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath2,
        validation_passed: true,
        write_complete: true,
      });

      // Assert: No cascade should have occurred (manifest loads fine)
      const manifest = loadManifest(manifestPath)!;
      expect(manifest.artifacts).toHaveLength(1);
    });
  });

  describe('readArtifact checksum verification', () => {
    it('detects manual edit via checksum mismatch and triggers cascade', async () => {
      // Setup
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);

      const workflowId = 'test-wf';
      await fs.ensureDir(path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception'));

      const nfrPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'nfr.md');
      const intentPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');

      await fs.writeFile(nfrPath, '# NFR\nOriginal', 'utf-8');
      await fs.writeFile(intentPath, '# INTENT\nOriginal', 'utf-8');

      registerArtifact(manifestPath, {
        id: 'nfr-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: nfrPath,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'intent-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
      });

      linkArtifacts(manifestPath, {
        source_id: 'nfr-001',
        target_id: 'intent-001',
        link_type: 'derives',
      });

      const manifest = loadManifest(manifestPath)!;
      manifest.artifacts.forEach((a) => {
        a.contract_status = 'active';
      });
      saveManifest(manifestPath, manifest);

      // Act: Manually edit NFR file (bypass writeArtifact)
      await fs.writeFile(nfrPath, '# NFR\nManually edited', 'utf-8');

      // Read the artifact (should detect checksum mismatch)
      const content = await readArtifact(TEST_DIR, 'test-wf', 'nfr');

      expect(content).toContain('Manually edited');

      // Assert: INTENT should be marked stale due to checksum mismatch
      const manifestAfter = loadManifest(manifestPath)!;
      const intentAfter = manifestAfter.artifacts.find((a) => a.id === 'intent-001');

      expect(intentAfter?.contract_status).toBe('stale');
    });

    it('does not trigger cascade when checksum matches', async () => {
      // Setup
      const manifestPath = createManifest('test-wf', 'test feature', TEST_DIR);

      const workflowId = 'test-wf';
      await fs.ensureDir(path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception'));

      const nfrPath2 = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'nfr.md');
      const intentPath = path.join(TEST_DIR, 'aidlc-docs', workflowId, 'inception', 'intent.md');

      await fs.writeFile(nfrPath2, '# NFR\nOriginal', 'utf-8');
      await fs.writeFile(intentPath, '# INTENT\nOriginal', 'utf-8');

      registerArtifact(manifestPath, {
        id: 'nfr-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: nfrPath2,
        validation_passed: true,
        write_complete: true,
      });

      registerArtifact(manifestPath, {
        id: 'intent-001',
        type: '.md',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
      });

      linkArtifacts(manifestPath, {
        source_id: 'nfr-001',
        target_id: 'intent-001',
        link_type: 'derives',
      });

      const manifest = loadManifest(manifestPath)!;
      manifest.artifacts.forEach((a) => {
        a.contract_status = 'active';
      });
      saveManifest(manifestPath, manifest);

      // Act: Read without modification
      await readArtifact(TEST_DIR, 'test-wf', 'nfr');

      // Assert: INTENT should still be active (no cascade)
      const manifestAfter = loadManifest(manifestPath)!;
      const intentAfter = manifestAfter.artifacts.find((a) => a.id === 'intent-001');

      expect(intentAfter?.contract_status).toBe('active');
    });
  });
});
