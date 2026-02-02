import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnvConfig } from '../config/loader.js';
import type { PluginConfig } from '../shared/types.js';

describe('Config Loader - Ascent Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadEnvConfig - OLYMPUS_MAX_ASCENT_ITERATIONS', () => {
    it('should load valid max iterations from environment', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '150';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBe(150);
    });

    it('should accept minimum value of 10', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '10';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBe(10);
    });

    it('should accept maximum value of 1000', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '1000';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBe(1000);
    });

    it('should reject values below 10', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '5';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBeUndefined();
    });

    it('should reject values above 1000', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '2000';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBeUndefined();
    });

    it('should ignore non-numeric values', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = 'not-a-number';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBeUndefined();
    });

    it('should ignore empty string', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBeUndefined();
    });

    it('should not set ascent config if env var not set', () => {
      delete process.env.OLYMPUS_MAX_ASCENT_ITERATIONS;

      const config = loadEnvConfig();

      // ascent should not be set at all, or should be undefined
      expect(config.ascent).toBeUndefined();
    });

    it('should handle decimal values by truncating', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '150.7';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBe(150);
    });

    it('should handle negative values correctly (reject)', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '-50';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBeUndefined();
    });
  });

  describe('Integration with other env configs', () => {
    it('should not interfere with other environment configurations', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '200';
      process.env.OLYMPUS_MAX_BACKGROUND_TASKS = '3';
      process.env.OLYMPUS_PARALLEL_EXECUTION = 'true';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBe(200);
      expect(config.permissions?.maxBackgroundTasks).toBe(3);
      expect(config.features?.parallelExecution).toBe(true);
    });

    it('should work when only ascent env var is set', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '75';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBe(75);
      // Other configs should be undefined (not set from env)
      expect(config.permissions).toBeUndefined();
      expect(config.features).toBeUndefined();
    });
  });

  describe('Type validation', () => {
    it('should return PluginConfig type', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '100';

      const config: Partial<PluginConfig> = loadEnvConfig();

      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });

    it('should have correct ascent config structure', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '250';

      const config = loadEnvConfig();

      expect(config.ascent).toBeDefined();
      expect(config.ascent).toHaveProperty('maxIterations');
      expect(typeof config.ascent?.maxIterations).toBe('number');
    });
  });

  describe('Edge cases', () => {
    it('should handle boundary value 10 correctly', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '10';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBe(10);
    });

    it('should handle boundary value 1000 correctly', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '1000';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBe(1000);
    });

    it('should reject boundary minus one (9)', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '9';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBeUndefined();
    });

    it('should reject boundary plus one (1001)', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '1001';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBeUndefined();
    });

    it('should handle zero correctly (reject)', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '0';

      const config = loadEnvConfig();

      expect(config.ascent?.maxIterations).toBeUndefined();
    });

    it('should handle whitespace in value', () => {
      process.env.OLYMPUS_MAX_ASCENT_ITERATIONS = '  100  ';

      const config = loadEnvConfig();

      // parseInt handles leading/trailing whitespace
      expect(config.ascent?.maxIterations).toBe(100);
    });
  });
});
