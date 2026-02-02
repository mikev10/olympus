/**
 * Tests for Hook Violation Logging
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  logViolation,
  getViolationStats,
  readViolations,
  HookViolation,
} from './index.js';

describe('Hook Logging', () => {
  let testDir: string;

  beforeEach(() => {
    // Create unique test directory
    testDir = join(tmpdir(), `olympus-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('logViolation', () => {
    it('should create log directory if it does not exist', () => {
      const violation: HookViolation = {
        timestamp: new Date().toISOString(),
        filePath: 'src/index.ts',
        toolName: 'Edit',
        wasBlocked: true,
        reason: 'Test violation',
      };

      logViolation(violation, testDir);

      const logDir = join(testDir, '.olympus', 'logs');
      expect(existsSync(logDir)).toBe(true);
    });

    it('should append violation to log file', () => {
      const violation: HookViolation = {
        timestamp: new Date().toISOString(),
        filePath: 'src/index.ts',
        toolName: 'Edit',
        wasBlocked: true,
        reason: 'Test violation',
      };

      logViolation(violation, testDir);

      const violations = readViolations(testDir);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toEqual(violation);
    });

    it('should append multiple violations', () => {
      const violation1: HookViolation = {
        timestamp: new Date().toISOString(),
        filePath: 'src/index.ts',
        toolName: 'Edit',
        wasBlocked: true,
        reason: 'Violation 1',
      };

      const violation2: HookViolation = {
        timestamp: new Date().toISOString(),
        filePath: 'src/utils.ts',
        toolName: 'Write',
        wasBlocked: false,
        reason: 'Violation 2',
      };

      logViolation(violation1, testDir);
      logViolation(violation2, testDir);

      const violations = readViolations(testDir);
      expect(violations).toHaveLength(2);
      expect(violations[0]).toEqual(violation1);
      expect(violations[1]).toEqual(violation2);
    });

    it('should handle violations with linesChanged', () => {
      const violation: HookViolation = {
        timestamp: new Date().toISOString(),
        filePath: 'src/index.ts',
        toolName: 'Edit',
        linesChanged: 25,
        wasBlocked: true,
        reason: 'Large edit',
      };

      logViolation(violation, testDir);

      const violations = readViolations(testDir);
      expect(violations[0].linesChanged).toBe(25);
    });
  });

  describe('getViolationStats', () => {
    it('should return empty stats when no violations', () => {
      const stats = getViolationStats(testDir);

      expect(stats.total).toBe(0);
      expect(stats.blocked).toBe(0);
      expect(stats.allowed).toBe(0);
      expect(stats.byFile).toEqual({});
      expect(stats.byTool).toEqual({});
    });

    it('should count total violations', () => {
      logViolation(
        {
          timestamp: new Date().toISOString(),
          filePath: 'file1.ts',
          toolName: 'Edit',
          wasBlocked: true,
          reason: 'Test',
        },
        testDir
      );

      logViolation(
        {
          timestamp: new Date().toISOString(),
          filePath: 'file2.ts',
          toolName: 'Write',
          wasBlocked: false,
          reason: 'Test',
        },
        testDir
      );

      const stats = getViolationStats(testDir);
      expect(stats.total).toBe(2);
    });

    it('should count violations by file', () => {
      logViolation(
        {
          timestamp: new Date().toISOString(),
          filePath: 'file1.ts',
          toolName: 'Edit',
          wasBlocked: true,
          reason: 'Test',
        },
        testDir
      );

      logViolation(
        {
          timestamp: new Date().toISOString(),
          filePath: 'file1.ts',
          toolName: 'Edit',
          wasBlocked: true,
          reason: 'Test',
        },
        testDir
      );

      logViolation(
        {
          timestamp: new Date().toISOString(),
          filePath: 'file2.ts',
          toolName: 'Write',
          wasBlocked: false,
          reason: 'Test',
        },
        testDir
      );

      const stats = getViolationStats(testDir);
      expect(stats.byFile['file1.ts']).toBe(2);
      expect(stats.byFile['file2.ts']).toBe(1);
    });

    it('should count violations by tool', () => {
      logViolation(
        {
          timestamp: new Date().toISOString(),
          filePath: 'file1.ts',
          toolName: 'Edit',
          wasBlocked: true,
          reason: 'Test',
        },
        testDir
      );

      logViolation(
        {
          timestamp: new Date().toISOString(),
          filePath: 'file2.ts',
          toolName: 'Edit',
          wasBlocked: true,
          reason: 'Test',
        },
        testDir
      );

      logViolation(
        {
          timestamp: new Date().toISOString(),
          filePath: 'file3.ts',
          toolName: 'Write',
          wasBlocked: false,
          reason: 'Test',
        },
        testDir
      );

      const stats = getViolationStats(testDir);
      expect(stats.byTool['Edit']).toBe(2);
      expect(stats.byTool['Write']).toBe(1);
    });

    it('should count blocked vs allowed violations', () => {
      logViolation(
        {
          timestamp: new Date().toISOString(),
          filePath: 'file1.ts',
          toolName: 'Edit',
          wasBlocked: true,
          reason: 'Blocked',
        },
        testDir
      );

      logViolation(
        {
          timestamp: new Date().toISOString(),
          filePath: 'file2.ts',
          toolName: 'Write',
          wasBlocked: true,
          reason: 'Blocked',
        },
        testDir
      );

      logViolation(
        {
          timestamp: new Date().toISOString(),
          filePath: 'file3.ts',
          toolName: 'Edit',
          wasBlocked: false,
          reason: 'Allowed',
        },
        testDir
      );

      const stats = getViolationStats(testDir);
      expect(stats.blocked).toBe(2);
      expect(stats.allowed).toBe(1);
    });

    it('should handle malformed log lines gracefully', () => {
      const logPath = join(testDir, '.olympus', 'logs', 'hook-violations.jsonl');
      mkdirSync(join(testDir, '.olympus', 'logs'), { recursive: true });

      // Write valid and invalid lines
      const fs = require('fs');
      fs.writeFileSync(
        logPath,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          filePath: 'file1.ts',
          toolName: 'Edit',
          wasBlocked: true,
          reason: 'Valid',
        }) +
          '\n' +
          'invalid json line\n' +
          JSON.stringify({
            timestamp: new Date().toISOString(),
            filePath: 'file2.ts',
            toolName: 'Write',
            wasBlocked: false,
            reason: 'Valid',
          }) +
          '\n'
      );

      const stats = getViolationStats(testDir);
      expect(stats.total).toBe(2); // Should skip invalid line
    });
  });

  describe('readViolations', () => {
    it('should return empty array when no log file exists', () => {
      const violations = readViolations(testDir);
      expect(violations).toEqual([]);
    });

    it('should read all violations from log', () => {
      const violation1: HookViolation = {
        timestamp: new Date().toISOString(),
        filePath: 'file1.ts',
        toolName: 'Edit',
        wasBlocked: true,
        reason: 'Test 1',
      };

      const violation2: HookViolation = {
        timestamp: new Date().toISOString(),
        filePath: 'file2.ts',
        toolName: 'Write',
        wasBlocked: false,
        reason: 'Test 2',
      };

      logViolation(violation1, testDir);
      logViolation(violation2, testDir);

      const violations = readViolations(testDir);
      expect(violations).toHaveLength(2);
      expect(violations[0]).toEqual(violation1);
      expect(violations[1]).toEqual(violation2);
    });

    it('should skip malformed lines', () => {
      const logPath = join(testDir, '.olympus', 'logs', 'hook-violations.jsonl');
      mkdirSync(join(testDir, '.olympus', 'logs'), { recursive: true });

      const fs = require('fs');
      fs.writeFileSync(
        logPath,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          filePath: 'file1.ts',
          toolName: 'Edit',
          wasBlocked: true,
          reason: 'Valid',
        }) +
          '\n' +
          'invalid\n' +
          JSON.stringify({
            timestamp: new Date().toISOString(),
            filePath: 'file2.ts',
            toolName: 'Write',
            wasBlocked: false,
            reason: 'Valid',
          }) +
          '\n'
      );

      const violations = readViolations(testDir);
      expect(violations).toHaveLength(2);
    });
  });
});
