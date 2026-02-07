/**
 * Checkpoint V1 → V2 Migration Tests
 *
 * Comprehensive test coverage for automatic checkpoint schema migration.
 * Tests both the migrateCheckpointV1toV2 function and the auto-migration
 * behavior in loadCheckpoint.
 */

import * as fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  migrateCheckpointV1toV2,
  loadCheckpoint,
  saveCheckpoint,
  clearCache,
} from '../../features/workflow-engine/checkpoint.js';
import type { WorkflowCheckpoint } from '../../features/workflow-engine/types.js';
import type { WorkflowCheckpointV2 } from '../../features/workflow-engine/phase-types.js';

describe('Checkpoint Migration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'migration-test-'));
    clearCache();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  /**
   * Helper: Create a v1 checkpoint with sensible defaults
   */
  function createV1Checkpoint(
    overrides?: Partial<WorkflowCheckpoint>
  ): WorkflowCheckpoint {
    return {
      schema_version: '1.0.0',
      workflow_id: 'test-v1-workflow',
      feature_name: 'test-feature',
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T12:00:00Z',
      current_stage: 'prd',
      status: 'in_progress',
      artifacts: {
        idea: {
          id: 'IDEA-001',
          path: '.olympus/workflow/test/idea.md',
          created_at: '2024-01-15T10:00:00Z',
          validation_passed: true,
        },
        prd: null,
        spec: null,
        intents: null,
        complete: null,
      },
      validation_results: {
        idea: {
          passed: true,
          coverage_percentage: 100,
          blocking_issues: [],
          timestamp: '2024-01-15T10:30:00Z',
        },
        prd: null,
        spec: null,
        intents: null,
        complete: null,
      },
      ...overrides,
    };
  }

  describe('migrateCheckpointV1toV2', () => {
    describe('Schema version handling', () => {
      it('migrates v1 checkpoint (schema_version 1.0.0) to v2 (schema_version 2.0.0)', () => {
        const v1 = createV1Checkpoint();
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.schema_version).toBe('2.0.0');
      });

      it('returns already v2 checkpoint as-is', () => {
        const alreadyV2: WorkflowCheckpointV2 = {
          schema_version: '2.0.0',
          workflow_id: 'test-workflow',
          feature_name: 'test-feature',
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
          current_phase: 'forge',
          phases: {
            vision: {
              status: 'complete',
              started_at: '2024-01-15T10:00:00Z',
              completed_at: '2024-01-15T11:00:00Z',
              gate_result: null,
              gate_bypassed: false,
              bypass_reason: null,
            },
            forge: {
              status: 'in_progress',
              started_at: '2024-01-15T11:00:00Z',
              completed_at: null,
              gate_result: null,
              gate_bypassed: false,
              bypass_reason: null,
            },
            summit: {
              status: 'not_started',
              started_at: null,
              completed_at: null,
              gate_result: null,
              gate_bypassed: false,
              bypass_reason: null,
            },
          },
          current_stage: 'spec',
          status: 'in_progress',
          artifacts: {
            idea: null,
            prd: null,
            spec: null,
            intents: null,
            complete: null,
          },
          validation_results: {
            idea: null,
            prd: null,
            spec: null,
            intents: null,
            complete: null,
          },
          manifest_path: '.olympus/workflow/test/manifest.json',
          trust_state_path: null,
          risk_tier: null,
        };

        const result = migrateCheckpointV1toV2(alreadyV2 as any);

        expect(result).toEqual(alreadyV2);
        expect(result.schema_version).toBe('2.0.0');
      });

      it('treats unknown schema_version (e.g., 0.5.0) as v1 and migrates', () => {
        const oldVersion = createV1Checkpoint({ schema_version: '0.5.0' });
        const v2 = migrateCheckpointV1toV2(oldVersion);

        expect(v2.schema_version).toBe('2.0.0');
        expect(v2.current_phase).toBe('vision');
        expect(v2.phases.vision.status).toBe('in_progress');
      });
    });

    describe('Field preservation', () => {
      it('preserves workflow_id', () => {
        const v1 = createV1Checkpoint({ workflow_id: 'custom-id-12345' });
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.workflow_id).toBe('custom-id-12345');
      });

      it('preserves feature_name', () => {
        const v1 = createV1Checkpoint({ feature_name: 'user-authentication' });
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.feature_name).toBe('user-authentication');
      });

      it('preserves created_at', () => {
        const timestamp = '2023-12-01T08:00:00Z';
        const v1 = createV1Checkpoint({ created_at: timestamp });
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.created_at).toBe(timestamp);
      });

      it('preserves updated_at', () => {
        const timestamp = '2024-02-01T16:30:00Z';
        const v1 = createV1Checkpoint({ updated_at: timestamp });
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.updated_at).toBe(timestamp);
      });

      it('preserves current_stage', () => {
        const v1 = createV1Checkpoint({ current_stage: 'spec' });
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.current_stage).toBe('spec');
      });

      it('preserves status', () => {
        const v1 = createV1Checkpoint({ status: 'paused' });
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.status).toBe('paused');
      });

      it('preserves artifacts record', () => {
        const artifacts: WorkflowCheckpoint['artifacts'] = {
          idea: {
            id: 'IDEA-123',
            path: 'custom/path.md',
            created_at: '2024-01-01T00:00:00Z',
            validation_passed: false,
          },
          prd: {
            id: 'PRD-456',
            path: 'custom/prd.md',
            created_at: '2024-01-02T00:00:00Z',
            validation_passed: true,
          },
          spec: null,
          intents: null,
          complete: null,
        };
        const v1 = createV1Checkpoint({ artifacts });
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.artifacts).toEqual(artifacts);
      });

      it('preserves validation_results record', () => {
        const validation_results: WorkflowCheckpoint['validation_results'] = {
          idea: {
            passed: false,
            coverage_percentage: 75,
            blocking_issues: ['Missing requirements'],
            timestamp: '2024-01-01T10:00:00Z',
          },
          prd: {
            passed: true,
            coverage_percentage: 95,
            blocking_issues: [],
            timestamp: '2024-01-02T11:00:00Z',
          },
          spec: null,
          intents: null,
          complete: null,
        };
        const v1 = createV1Checkpoint({ validation_results });
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.validation_results).toEqual(validation_results);
      });

      it('preserves resume_context', () => {
        const resume_context = {
          last_agent: 'prometheus',
          notes: 'Paused for user input',
          custom_data: { foo: 'bar' },
        };
        const v1 = createV1Checkpoint({ resume_context });
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.resume_context).toEqual(resume_context);
      });
    });

    describe('New v2 fields', () => {
      it('sets current_phase to vision', () => {
        const v1 = createV1Checkpoint();
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.current_phase).toBe('vision');
      });

      it('sets manifest_path to null', () => {
        const v1 = createV1Checkpoint();
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.manifest_path).toBeNull();
      });

      it('sets trust_state_path to null', () => {
        const v1 = createV1Checkpoint();
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.trust_state_path).toBeNull();
      });

      it('sets risk_tier to null', () => {
        const v1 = createV1Checkpoint();
        const v2 = migrateCheckpointV1toV2(v1);

        expect(v2.risk_tier).toBeNull();
      });
    });

    describe('Phase state initialization', () => {
      describe('Vision phase status', () => {
        it('sets vision.status to in_progress when current_stage is idea and status is in_progress', () => {
          const v1 = createV1Checkpoint({
            current_stage: 'idea',
            status: 'in_progress',
          });
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.vision.status).toBe('in_progress');
        });

        it('sets vision.status to in_progress when current_stage is prd and status is in_progress', () => {
          const v1 = createV1Checkpoint({
            current_stage: 'prd',
            status: 'in_progress',
          });
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.vision.status).toBe('in_progress');
        });

        it('sets vision.status to complete when current_stage is complete', () => {
          const v1 = createV1Checkpoint({
            current_stage: 'complete',
            status: 'complete',
          });
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.vision.status).toBe('complete');
        });

        it('sets vision.status to paused when current_stage is spec and status is paused', () => {
          const v1 = createV1Checkpoint({
            current_stage: 'spec',
            status: 'paused',
          });
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.vision.status).toBe('paused');
        });

        it('sets vision.status to blocked when status is blocked', () => {
          const v1 = createV1Checkpoint({
            current_stage: 'prd',
            status: 'blocked',
          });
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.vision.status).toBe('blocked');
        });
      });

      describe('Vision phase timestamps', () => {
        it('sets vision.started_at to checkpoint.created_at', () => {
          const created_at = '2024-01-15T10:00:00Z';
          const v1 = createV1Checkpoint({ created_at });
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.vision.started_at).toBe(created_at);
        });

        it('sets vision.completed_at to checkpoint.updated_at when current_stage is complete', () => {
          const updated_at = '2024-01-15T18:00:00Z';
          const v1 = createV1Checkpoint({
            current_stage: 'complete',
            updated_at,
          });
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.vision.completed_at).toBe(updated_at);
        });

        it('sets vision.completed_at to null when current_stage is not complete', () => {
          const v1 = createV1Checkpoint({ current_stage: 'prd' });
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.vision.completed_at).toBeNull();
        });
      });

      describe('Vision phase gate fields', () => {
        it('sets vision.gate_result to null', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.vision.gate_result).toBeNull();
        });

        it('sets vision.gate_bypassed to false', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.vision.gate_bypassed).toBe(false);
        });

        it('sets vision.bypass_reason to null', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.vision.bypass_reason).toBeNull();
        });
      });

      describe('Forge phase initialization', () => {
        it('sets forge.status to not_started', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.forge.status).toBe('not_started');
        });

        it('sets forge.started_at to null', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.forge.started_at).toBeNull();
        });

        it('sets forge.completed_at to null', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.forge.completed_at).toBeNull();
        });

        it('sets forge.gate_result to null', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.forge.gate_result).toBeNull();
        });

        it('sets forge.gate_bypassed to false', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.forge.gate_bypassed).toBe(false);
        });

        it('sets forge.bypass_reason to null', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.forge.bypass_reason).toBeNull();
        });
      });

      describe('Summit phase initialization', () => {
        it('sets summit.status to not_started', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.summit.status).toBe('not_started');
        });

        it('sets summit.started_at to null', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.summit.started_at).toBeNull();
        });

        it('sets summit.completed_at to null', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.summit.completed_at).toBeNull();
        });

        it('sets summit.gate_result to null', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.summit.gate_result).toBeNull();
        });

        it('sets summit.gate_bypassed to false', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.summit.gate_bypassed).toBe(false);
        });

        it('sets summit.bypass_reason to null', () => {
          const v1 = createV1Checkpoint();
          const v2 = migrateCheckpointV1toV2(v1);

          expect(v2.phases.summit.bypass_reason).toBeNull();
        });
      });
    });
  });

  describe('loadCheckpoint with auto-migration', () => {
    describe('Auto-migration behavior', () => {
      it('auto-migrates v1 checkpoint to v2 on load', async () => {
        const v1 = createV1Checkpoint();
        await saveCheckpoint(tmpDir, v1);

        // Clear cache to force disk read, which triggers migration
        clearCache();

        const loaded = await loadCheckpoint(tmpDir, v1.workflow_id);

        expect(loaded).not.toBeNull();
        expect(loaded!.schema_version).toBe('2.0.0');
        expect((loaded as any).current_phase).toBe('vision');
      });

      it('persists migrated checkpoint to disk', async () => {
        const v1 = createV1Checkpoint();
        await saveCheckpoint(tmpDir, v1);

        // Clear cache to trigger migration on load
        clearCache();

        // Load once to trigger migration
        await loadCheckpoint(tmpDir, v1.workflow_id);

        // Clear cache again to force fresh read from disk
        clearCache();

        // Read file directly from disk
        const checkpointPath = join(
          tmpDir,
          '.olympus',
          'workflow',
          v1.workflow_id,
          'checkpoint.json'
        );
        const fileContent = await fs.readFile(checkpointPath, 'utf-8');
        const onDisk = JSON.parse(fileContent);

        expect(onDisk.schema_version).toBe('2.0.0');
        expect(onDisk.current_phase).toBe('vision');
      });

      it('does not trigger migration when loading v2 checkpoint', async () => {
        const v1 = createV1Checkpoint();
        await saveCheckpoint(tmpDir, v1);

        // Clear cache to trigger migration on first load
        clearCache();

        // First load migrates to v2
        const migrated = await loadCheckpoint(tmpDir, v1.workflow_id);
        expect(migrated!.schema_version).toBe('2.0.0');

        // Record the updated_at timestamp after migration
        const updatedAfterMigration = migrated!.updated_at;

        // Clear cache to force a fresh load
        clearCache();

        // Wait a tiny bit to ensure timestamp would differ if re-saved
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Second load should NOT trigger another migration
        const secondLoad = await loadCheckpoint(tmpDir, v1.workflow_id);
        expect(secondLoad!.schema_version).toBe('2.0.0');

        // updated_at should remain the same (no re-save occurred)
        expect(secondLoad!.updated_at).toBe(updatedAfterMigration);
      });

      it('reloading after auto-migration returns v2 without re-migration', async () => {
        const v1 = createV1Checkpoint();
        await saveCheckpoint(tmpDir, v1);

        // Clear cache to trigger migration on first load
        clearCache();

        // First load migrates
        const firstLoad = await loadCheckpoint(tmpDir, v1.workflow_id);
        expect(firstLoad!.schema_version).toBe('2.0.0');

        const firstUpdatedAt = firstLoad!.updated_at;

        // Reload multiple times
        clearCache();
        const secondLoad = await loadCheckpoint(tmpDir, v1.workflow_id);
        clearCache();
        const thirdLoad = await loadCheckpoint(tmpDir, v1.workflow_id);

        // All should be v2 with same updated_at (no re-migration)
        expect(secondLoad!.schema_version).toBe('2.0.0');
        expect(thirdLoad!.schema_version).toBe('2.0.0');
        expect(secondLoad!.updated_at).toBe(firstUpdatedAt);
        expect(thirdLoad!.updated_at).toBe(firstUpdatedAt);
      });
    });

    describe('Cache with structuredClone', () => {
      it('returns deep copy - modifying returned checkpoint does not affect cache', async () => {
        const v1 = createV1Checkpoint();
        await saveCheckpoint(tmpDir, v1);

        const first = await loadCheckpoint(tmpDir, v1.workflow_id);
        expect(first).not.toBeNull();

        // Mutate the returned checkpoint
        first!.feature_name = 'mutated-feature';
        first!.status = 'blocked';

        // Load again - should return original values, not mutated
        const second = await loadCheckpoint(tmpDir, v1.workflow_id);
        expect(second!.feature_name).toBe('test-feature');
        expect(second!.status).toBe('in_progress');
      });

      it('nested objects (like phases) are properly deep-cloned', async () => {
        const v1 = createV1Checkpoint();
        await saveCheckpoint(tmpDir, v1);

        // Clear cache to trigger migration on first load
        clearCache();

        // First load triggers migration and caches v2
        const first = (await loadCheckpoint(
          tmpDir,
          v1.workflow_id
        )) as WorkflowCheckpointV2;
        expect(first).not.toBeNull();

        // Mutate nested phase state
        first.phases.vision.status = 'blocked';
        first.phases.vision.completed_at = '2099-12-31T23:59:59Z';

        // Load again - nested objects should not be mutated
        const second = (await loadCheckpoint(
          tmpDir,
          v1.workflow_id
        )) as WorkflowCheckpointV2;
        expect(second.phases.vision.status).toBe('in_progress');
        expect(second.phases.vision.completed_at).toBeNull();
      });
    });

    describe('Error handling', () => {
      it('returns null for corrupt JSON', async () => {
        const checkpointPath = join(
          tmpDir,
          '.olympus',
          'workflow',
          'corrupt-id',
          'checkpoint.json'
        );
        await fs.ensureDir(join(tmpDir, '.olympus', 'workflow', 'corrupt-id'));
        await fs.writeFile(checkpointPath, '{ invalid json ~~~', 'utf-8');

        const result = await loadCheckpoint(tmpDir, 'corrupt-id');

        expect(result).toBeNull();
      });

      it('returns null for missing file', async () => {
        const result = await loadCheckpoint(tmpDir, 'non-existent-id');

        expect(result).toBeNull();
      });

      it('returns null for checkpoint missing schema_version', async () => {
        // Create a checkpoint that's completely missing schema_version
        const malformed = {
          workflow_id: 'malformed',
          feature_name: 'test',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          // Missing schema_version entirely
        };

        const checkpointPath = join(
          tmpDir,
          '.olympus',
          'workflow',
          'malformed',
          'checkpoint.json'
        );
        await fs.ensureDir(join(tmpDir, '.olympus', 'workflow', 'malformed'));
        await fs.writeJson(checkpointPath, malformed);

        const result = await loadCheckpoint(tmpDir, 'malformed');

        // Should return null due to missing schema_version
        expect(result).toBeNull();
      });
    });
  });
});
