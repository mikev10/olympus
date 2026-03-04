import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { deriveTechStack, deriveConventions, writeProjectPatterns } from '../../learning/project-patterns.js';
import type { WorkspaceScanResult } from '../../features/workflow-engine/brownfield-scanner.js';
import type { ProjectPatterns } from '../../learning/types.js';
import { writeJsonFile } from '../../learning/storage.js';

const testDir = resolve('.test-project-patterns');

function mockScan(overrides?: Partial<WorkspaceScanResult>): WorkspaceScanResult {
  return {
    totalFiles: 0,
    sourceFiles: 0,
    languageDistribution: {},
    configFiles: [],
    directoryTree: [],
    entryPoints: [],
    largestFilesByDirectory: {},
    importGraph: [],
    ...overrides,
  };
}

describe('project-patterns', () => {
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    process.env.OLYMPUS_TEST_LEARNING_DIR = join(testDir, 'global-learning');
  });

  afterEach(() => {
    delete process.env.OLYMPUS_TEST_LEARNING_DIR;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('deriveTechStack', () => {
    it('maps file extensions and config files to tech stack entries', () => {
      const scan = mockScan({
        languageDistribution: { '.ts': 50, '.py': 10 },
        configFiles: ['tsconfig.json', 'vitest.config.ts'],
      });

      const result = deriveTechStack(scan);

      expect(result).toContain('TypeScript');
      expect(result).toContain('Python');
      expect(result).toContain('Vitest');
    });

    it('returns empty array for empty scan', () => {
      const result = deriveTechStack(mockScan());
      expect(result).toEqual([]);
    });

    it('deduplicates when extension and config both map to same language', () => {
      const scan = mockScan({
        languageDistribution: { '.ts': 20 },
        configFiles: ['tsconfig.json'],
      });

      const result = deriveTechStack(scan);
      const tsCount = result.filter(s => s === 'TypeScript').length;
      expect(tsCount).toBe(1);
    });

    it('ignores unknown extensions', () => {
      const scan = mockScan({
        languageDistribution: { '.xyz': 10, '.ts': 5 },
      });

      const result = deriveTechStack(scan);
      expect(result).toEqual(['TypeScript']);
    });
  });

  describe('deriveConventions', () => {
    it('detects conventions from top-level directories', () => {
      const scan = mockScan({
        directoryTree: [
          { name: 'src', path: 'src', fileCount: 10, children: [] },
          { name: '__tests__', path: '__tests__', fileCount: 5, children: [] },
        ],
      });

      const result = deriveConventions(scan);

      expect(result).toContain('Uses src/ directory for source code');
      expect(result).toContain('Has dedicated test directory');
    });

    it('returns empty array for empty directory tree', () => {
      const result = deriveConventions(mockScan());
      expect(result).toEqual([]);
    });

    it('detects multi-language project', () => {
      const scan = mockScan({
        languageDistribution: { '.ts': 20, '.py': 10 },
      });

      const result = deriveConventions(scan);
      expect(result).toContain('Multi-language project');
    });

    it('does not flag multi-language when only one language has >5 files', () => {
      const scan = mockScan({
        languageDistribution: { '.ts': 20, '.py': 2 },
      });

      const result = deriveConventions(scan);
      expect(result).not.toContain('Multi-language project');
    });

    it('detects packages/ monorepo convention', () => {
      const scan = mockScan({
        directoryTree: [
          { name: 'packages', path: 'packages', fileCount: 0, children: [] },
        ],
      });

      const result = deriveConventions(scan);
      expect(result).toContain('Monorepo with packages/ directory');
    });

    it('detects docs/ and lib/ conventions', () => {
      const scan = mockScan({
        directoryTree: [
          { name: 'docs', path: 'docs', fileCount: 3, children: [] },
          { name: 'lib', path: 'lib', fileCount: 8, children: [] },
        ],
      });

      const result = deriveConventions(scan);
      expect(result).toContain('Has documentation directory');
      expect(result).toContain('Uses lib/ directory for library code');
    });

    it('detects tests/ directory same as __tests__/', () => {
      const scan = mockScan({
        directoryTree: [
          { name: 'tests', path: 'tests', fileCount: 5, children: [] },
        ],
      });

      const result = deriveConventions(scan);
      expect(result).toContain('Has dedicated test directory');
    });
  });

  describe('writeProjectPatterns', () => {
    it('creates valid JSON patterns file', () => {
      const projectPath = testDir;
      const scan = mockScan({
        languageDistribution: { '.ts': 30 },
        configFiles: ['tsconfig.json'],
        directoryTree: [
          { name: 'src', path: 'src', fileCount: 30, children: [] },
        ],
      });

      writeProjectPatterns(projectPath, scan);

      const patternsPath = join(testDir, '.olympus', 'learning', 'patterns.json');
      expect(existsSync(patternsPath)).toBe(true);

      const written = JSON.parse(readFileSync(patternsPath, 'utf-8')) as ProjectPatterns;
      expect(written.project_path).toBe(projectPath);
      expect(written.project_hash).toBeTruthy();
      expect(written.tech_stack).toContain('TypeScript');
      expect(written.conventions).toContain('Uses src/ directory for source code');
      expect(written.learned_rules).toEqual([]);
      expect(written.common_mistakes).toEqual([]);
      expect(written.last_updated).toBeTruthy();
    });

    it('is idempotent - second call merges without duplicating', () => {
      const projectPath = testDir;
      const scan = mockScan({
        languageDistribution: { '.ts': 30 },
        configFiles: ['tsconfig.json'],
      });

      writeProjectPatterns(projectPath, scan);
      writeProjectPatterns(projectPath, scan);

      const patternsPath = join(testDir, '.olympus', 'learning', 'patterns.json');
      const written = JSON.parse(readFileSync(patternsPath, 'utf-8')) as ProjectPatterns;

      const tsCount = written.tech_stack.filter(s => s === 'TypeScript').length;
      expect(tsCount).toBe(1);
    });

    it('preserves existing learned_rules and common_mistakes on merge', () => {
      const projectPath = testDir;
      const patternsPath = join(testDir, '.olympus', 'learning', 'patterns.json');

      mkdirSync(join(testDir, '.olympus', 'learning'), { recursive: true });
      const existingPatterns: ProjectPatterns = {
        project_hash: 'abc123',
        project_path: projectPath,
        conventions: ['Existing convention'],
        tech_stack: ['React'],
        learned_rules: ['Always run migrations first'],
        common_mistakes: ['Forgot to update imports'],
        last_updated: '2025-01-01T00:00:00.000Z',
      };
      writeJsonFile(patternsPath, existingPatterns);

      const scan = mockScan({
        languageDistribution: { '.ts': 10 },
        configFiles: ['tsconfig.json'],
      });

      writeProjectPatterns(projectPath, scan);

      const written = JSON.parse(readFileSync(patternsPath, 'utf-8')) as ProjectPatterns;
      expect(written.learned_rules).toContain('Always run migrations first');
      expect(written.common_mistakes).toContain('Forgot to update imports');
      expect(written.tech_stack).toContain('React');
      expect(written.tech_stack).toContain('TypeScript');
      expect(written.conventions).toContain('Existing convention');
    });

    it('handles empty scan gracefully', () => {
      const projectPath = testDir;

      writeProjectPatterns(projectPath, mockScan());

      const patternsPath = join(testDir, '.olympus', 'learning', 'patterns.json');
      expect(existsSync(patternsPath)).toBe(true);

      const written = JSON.parse(readFileSync(patternsPath, 'utf-8')) as ProjectPatterns;
      expect(written.tech_stack).toEqual([]);
      expect(written.conventions).toEqual([]);
      expect(written.learned_rules).toEqual([]);
      expect(written.common_mistakes).toEqual([]);
    });

    it('merges new tech stack entries with existing ones', () => {
      const projectPath = testDir;
      const patternsPath = join(testDir, '.olympus', 'learning', 'patterns.json');

      mkdirSync(join(testDir, '.olympus', 'learning'), { recursive: true });
      writeJsonFile(patternsPath, {
        project_hash: 'abc',
        project_path: projectPath,
        conventions: [],
        tech_stack: ['React'],
        learned_rules: [],
        common_mistakes: [],
        last_updated: '2025-01-01T00:00:00.000Z',
      });

      const scan = mockScan({
        languageDistribution: { '.py': 15 },
        configFiles: ['pyproject.toml'],
      });

      writeProjectPatterns(projectPath, scan);

      const written = JSON.parse(readFileSync(patternsPath, 'utf-8')) as ProjectPatterns;
      expect(written.tech_stack).toContain('React');
      expect(written.tech_stack).toContain('Python');
    });
  });
});
