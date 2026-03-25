import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  findDocFiles,
  findReferences,
  generateImpactReport,
  runImpactScan,
  updateAffectedDocs,
  buildRenameMap,
  type ImpactScanOptions,
  type ImpactScanResult,
  type DocUpdate,
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

  it('returns updatedDocs when docs are updated by impact scan', () => {
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
    expect(result.updatedDocs).toBeDefined();
    expect(result.updatedDocs!.length).toBeGreaterThan(0);
  });

  it('impact report includes auto-updated documents section when docs are updated', () => {
    setupDir({
      'README.md': 'This project uses impact-scanner for scanning docs.',
    });
    const result = runImpactScan({
      projectPath: TEST_DIR,
      workflowId: 'wf-1',
      unitId: 'u-005',
      modifiedFiles: ['src/construction/impact-scanner.ts'],
    });
    expect(result.reportPath).not.toBeNull();
    const reportContent = fs.readFileSync(result.reportPath!, 'utf-8');
    expect(reportContent).toContain('Auto-Updated Documents');
  });
});

describe('buildRenameMap', () => {
  it('returns empty map when renamedFiles is undefined', () => {
    const map = buildRenameMap(undefined);
    expect(map.size).toBe(0);
  });

  it('returns empty map when renamedFiles is empty', () => {
    const map = buildRenameMap({});
    expect(map.size).toBe(0);
  });

  it('maps old basename to new basename for a renamed file', () => {
    const map = buildRenameMap({ 'src/old-name.ts': 'src/new-name.ts' });
    expect(map.size).toBe(1);
    expect(map.get('old-name')).toBe('new-name');
  });

  it('ignores entries where basenames are the same (directory move only)', () => {
    const map = buildRenameMap({ 'src/module.ts': 'lib/module.ts' });
    expect(map.size).toBe(0);
  });

  it('handles multiple renames', () => {
    const map = buildRenameMap({
      'src/old-scanner.ts': 'src/new-scanner.ts',
      'src/old-util.ts': 'src/new-util.ts',
    });
    expect(map.size).toBe(2);
    expect(map.get('old-scanner')).toBe('new-scanner');
    expect(map.get('old-util')).toBe('new-util');
  });
});

describe('updateAffectedDocs', () => {
  it('adds advisory notes to affected docs with unresolved references', () => {
    setupDir({
      'docs/guide.md': 'This guide references my-module for processing.',
    });
    const docPath = path.join(TEST_DIR, 'docs', 'guide.md');
    const affectedDocs = [{
      path: docPath,
      references: ['my-module'],
      description: 'References to my-module',
    }];
    const updates = updateAffectedDocs(affectedDocs, ['src/my-module.ts']);
    expect(updates.length).toBe(1);
    expect(updates[0].notesAdded.length).toBeGreaterThan(0);
    const content = fs.readFileSync(docPath, 'utf-8');
    expect(content).toContain('<!-- Impact scan');
    expect(content).toContain('my-module');
  });

  it('returns empty array when doc files cannot be read', () => {
    const affectedDocs = [{
      path: path.join(TEST_DIR, 'nonexistent.md'),
      references: ['foo'],
      description: 'test',
    }];
    const updates = updateAffectedDocs(affectedDocs, ['src/foo.ts']);
    expect(updates).toEqual([]);
  });

  it('does not modify docs when no references match rename map or unresolved terms', () => {
    setupDir({
      'docs/clean.md': 'No relevant references here at all.',
    });
    const docPath = path.join(TEST_DIR, 'docs', 'clean.md');
    const affectedDocs = [{
      path: docPath,
      references: [],
      description: 'No refs',
    }];
    const updates = updateAffectedDocs(affectedDocs, ['src/unrelated.ts']);
    expect(updates).toEqual([]);
  });

  it('applies rename replacements when renamedFiles is provided', () => {
    setupDir({
      'docs/api.md': 'Import from old-scanner to use scanning.',
    });
    const docPath = path.join(TEST_DIR, 'docs', 'api.md');
    const affectedDocs = [{
      path: docPath,
      references: ['old-scanner'],
      description: 'References old-scanner',
    }];
    const updates = updateAffectedDocs(
      affectedDocs,
      ['src/old-scanner.ts', 'src/new-scanner.ts'],
      { 'src/old-scanner.ts': 'src/new-scanner.ts' }
    );
    expect(updates.length).toBe(1);
    const content = fs.readFileSync(docPath, 'utf-8');
    expect(content).toContain('new-scanner');
    expect(content).not.toContain('old-scanner');
    expect(updates[0].updatedReferences.length).toBeGreaterThan(0);
  });
});
