import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  findDocFiles,
  findReferences,
  generateImpactReport,
  runImpactScan,
  type ImpactScanOptions,
  type ImpactScanResult,
} from '../../../features/workflow-engine/construction/impact-scanner.js';

const TEST_DIR = path.join(process.cwd(), '.test-impact-scanner');

function setupDir(structure: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = path.join(TEST_DIR, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('findDocFiles', () => {
  it('returns README.md when present', () => {
    setupDir({ 'README.md': '# Project' });
    const files = findDocFiles(TEST_DIR, 'wf-1');
    expect(files.some(f => f.endsWith('README.md'))).toBe(true);
  });

  it('returns files from docs/ directory recursively', () => {
    setupDir({
      'docs/guide.md': '# Guide',
      'docs/sub/deep.md': '# Deep',
    });
    const files = findDocFiles(TEST_DIR, 'wf-1');
    expect(files.some(f => f.endsWith('guide.md'))).toBe(true);
    expect(files.some(f => f.endsWith('deep.md'))).toBe(true);
  });

  it('returns prior unit feature docs', () => {
    setupDir({
      'aidlc-docs/wf-1/construction/u-001/documentation/feature-doc.md': '# Feature',
    });
    const files = findDocFiles(TEST_DIR, 'wf-1');
    expect(files.some(f => f.endsWith('feature-doc.md'))).toBe(true);
  });

  it('returns inception artifacts', () => {
    setupDir({
      'aidlc-docs/wf-1/inception/requirements.md': '# Requirements',
    });
    const files = findDocFiles(TEST_DIR, 'wf-1');
    expect(files.some(f => f.endsWith('requirements.md'))).toBe(true);
  });

  it('returns empty array when no docs exist', () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const files = findDocFiles(TEST_DIR, 'wf-1');
    expect(files).toEqual([]);
  });

  it('does not include non-md files from docs/', () => {
    setupDir({ 'docs/diagram.png': 'binary' });
    const files = findDocFiles(TEST_DIR, 'wf-1');
    expect(files.every(f => f.endsWith('.md'))).toBe(true);
  });
});

describe('findReferences', () => {
  it('returns matched terms found in content', () => {
    const content = 'This doc mentions impact-scanner and adr-generator modules.';
    const matched = findReferences(content, ['impact-scanner', 'adr-generator', 'missing-module']);
    expect(matched).toContain('impact-scanner');
    expect(matched).toContain('adr-generator');
    expect(matched).not.toContain('missing-module');
  });

  it('returns empty array when no terms match', () => {
    const matched = findReferences('hello world', ['foo', 'bar']);
    expect(matched).toEqual([]);
  });

  it('filters out empty search terms', () => {
    const matched = findReferences('hello', ['', 'hello']);
    expect(matched).toEqual(['hello']);
  });

  it('returns all matching terms when all match', () => {
    const matched = findReferences('alpha beta gamma', ['alpha', 'beta', 'gamma']);
    expect(matched).toHaveLength(3);
  });
});

describe('generateImpactReport', () => {
  it('writes impact-scan.md to documentation subdirectory', () => {
    const outputDir = path.join(TEST_DIR, 'output');
    const result: ImpactScanResult = {
      status: 'completed',
      affectedDocs: [
        { path: '/some/doc.md', references: ['my-module'], description: 'Check my-module references' },
      ],
      reportPath: null,
    };
    const reportPath = generateImpactReport(result, {
      unitId: 'u-005',
      workflowId: 'wf-1',
      outputDir,
    });
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(reportPath).toMatch(/impact-scan\.md$/);
    const content = fs.readFileSync(reportPath, 'utf-8');
    expect(content).toContain('u-005');
    expect(content).toContain('wf-1');
    expect(content).toContain('my-module');
    expect(content).toContain('Check my-module references');
  });

  it('writes no-affected-docs message when affectedDocs is empty', () => {
    const outputDir = path.join(TEST_DIR, 'output-empty');
    const result: ImpactScanResult = { status: 'skipped', affectedDocs: [], reportPath: null };
    const reportPath = generateImpactReport(result, {
      unitId: 'u-005',
      workflowId: 'wf-1',
      outputDir,
    });
    const content = fs.readFileSync(reportPath, 'utf-8');
    expect(content).toContain('No existing documentation');
  });
});

describe('runImpactScan', () => {
  it('returns skipped when modifiedFiles is empty', () => {
    const result = runImpactScan({
      projectPath: TEST_DIR,
      workflowId: 'wf-1',
      unitId: 'u-005',
      modifiedFiles: [],
    });
    expect(result.status).toBe('skipped');
    expect(result.affectedDocs).toEqual([]);
    expect(result.reportPath).toBeNull();
  });

  it('returns skipped when no docs contain references', () => {
    setupDir({ 'README.md': '# Project with no references to anything' });
    const result = runImpactScan({
      projectPath: TEST_DIR,
      workflowId: 'wf-1',
      unitId: 'u-005',
      modifiedFiles: ['src/features/some-unique-zzz-module/index.ts'],
    });
    expect(result.status).toBe('skipped');
    expect(result.reportPath).toBeNull();
  });

  it('returns completed with affected docs and writes report when references found', () => {
    setupDir({
      'README.md': 'This project uses impact-scanner for scanning docs.',
    });
    const result = runImpactScan({
      projectPath: TEST_DIR,
      workflowId: 'wf-1',
      unitId: 'u-005',
      modifiedFiles: ['src/construction/impact-scanner.ts'],
    });
    expect(result.status).toBe('completed');
    expect(result.affectedDocs.length).toBeGreaterThan(0);
    expect(result.reportPath).not.toBeNull();
    expect(fs.existsSync(result.reportPath!)).toBe(true);
  });

  it('does not throw when doc files are unreadable', () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    expect(() =>
      runImpactScan({
        projectPath: TEST_DIR,
        workflowId: 'wf-missing',
        unitId: 'u-005',
        modifiedFiles: ['src/foo.ts'],
      })
    ).not.toThrow();
  });

  it('short search terms under 3 chars are filtered — returns skipped', () => {
    setupDir({ 'README.md': 'ok so hi' });
    const result = runImpactScan({
      projectPath: TEST_DIR,
      workflowId: 'wf-1',
      unitId: 'u-005',
      modifiedFiles: ['a.ts'],
    });
    expect(result.status).toBe('skipped');
  });
});
