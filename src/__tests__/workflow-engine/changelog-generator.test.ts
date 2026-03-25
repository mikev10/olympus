import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectExistingChangelogTool,
  readFeatureDocSummaries,
  categorizeChanges,
  formatChangelogEntry,
  isKeepAChangelogFormat,
  prependToChangelog,
  appendOlympusSection,
  createNewChangelog,
  generateChangelogEntry,
} from '../../features/workflow-engine/changelog-generator.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-test-'));
}

describe('detectExistingChangelogTool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no tool files exist', () => {
    expect(detectExistingChangelogTool(tmpDir)).toBeNull();
  });

  it('detects .versionrc as conventional-changelog', () => {
    fs.writeFileSync(path.join(tmpDir, '.versionrc'), '{}');
    expect(detectExistingChangelogTool(tmpDir)).toBe('conventional-changelog');
  });

  it('detects .versionrc.json as conventional-changelog', () => {
    fs.writeFileSync(path.join(tmpDir, '.versionrc.json'), '{}');
    expect(detectExistingChangelogTool(tmpDir)).toBe('conventional-changelog');
  });

  it('detects .versionrc.js as conventional-changelog', () => {
    fs.writeFileSync(path.join(tmpDir, '.versionrc.js'), 'module.exports = {}');
    expect(detectExistingChangelogTool(tmpDir)).toBe('conventional-changelog');
  });

  it('detects .changeset directory as changesets', () => {
    fs.mkdirSync(path.join(tmpDir, '.changeset'));
    expect(detectExistingChangelogTool(tmpDir)).toBe('changesets');
  });

  it('detects cliff.toml as git-cliff', () => {
    fs.writeFileSync(path.join(tmpDir, 'cliff.toml'), '[changelog]');
    expect(detectExistingChangelogTool(tmpDir)).toBe('git-cliff');
  });

  it('returns the first detected tool when multiple indicators exist', () => {
    fs.writeFileSync(path.join(tmpDir, '.versionrc'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'cliff.toml'), '[changelog]');
    expect(detectExistingChangelogTool(tmpDir)).toBe('conventional-changelog');
  });
});

describe('readFeatureDocSummaries', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeFeatureDoc(unitId: string, content: string): void {
    const docDir = path.join(tmpDir, 'construction', unitId, 'documentation');
    fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, 'feature-doc.md'), content);
  }

  it('extracts Summary section from a feature doc', () => {
    makeFeatureDoc('u-001', '# Feature\n\n## Summary\n\nAdds a new auth module.\n\n## Details\n\nMore info.');
    const summaries = readFeatureDocSummaries(tmpDir, ['u-001']);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].unitId).toBe('u-001');
    expect(summaries[0].summary).toBe('Adds a new auth module.');
  });

  it('skips units with missing feature doc files', () => {
    const summaries = readFeatureDocSummaries(tmpDir, ['u-missing']);
    expect(summaries).toHaveLength(0);
  });

  it('skips units with no Summary section', () => {
    makeFeatureDoc('u-002', '# Feature\n\n## Details\n\nOnly details here.');
    const summaries = readFeatureDocSummaries(tmpDir, ['u-002']);
    expect(summaries).toHaveLength(0);
  });

  it('handles multiple units', () => {
    makeFeatureDoc('u-001', '# Feature\n\n## Summary\n\nFirst summary.\n\n## Details\n\ninfo.');
    makeFeatureDoc('u-002', '# Feature\n\n## Summary\n\nSecond summary.\n\n## Details\n\ninfo.');
    const summaries = readFeatureDocSummaries(tmpDir, ['u-001', 'u-002', 'u-003']);
    expect(summaries).toHaveLength(2);
    expect(summaries.map(s => s.unitId)).toEqual(['u-001', 'u-002']);
  });

  it('skips summary sections that are empty after trim', () => {
    makeFeatureDoc('u-003', '## Summary\n\n   \n\n## Next');
    const summaries = readFeatureDocSummaries(tmpDir, ['u-003']);
    expect(summaries).toHaveLength(0);
  });
});

describe('categorizeChanges', () => {
  it('routes "add" keyword to Added', () => {
    const result = categorizeChanges([{ unitId: 'u', summary: 'Add new payment service' }]);
    expect(result.added).toContain('Add new payment service');
    expect(result.fixed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });

  it('routes "create" keyword to Added', () => {
    const result = categorizeChanges([{ unitId: 'u', summary: 'Create user onboarding flow' }]);
    expect(result.added).toContain('Create user onboarding flow');
  });

  it('routes "implement" keyword to Added', () => {
    const result = categorizeChanges([{ unitId: 'u', summary: 'Implement retry logic' }]);
    expect(result.added).toContain('Implement retry logic');
  });

  it('routes "fix" keyword to Fixed', () => {
    const result = categorizeChanges([{ unitId: 'u', summary: 'Fix race condition in queue' }]);
    expect(result.fixed).toContain('Fix race condition in queue');
  });

  it('routes "resolve" keyword to Fixed', () => {
    const result = categorizeChanges([{ unitId: 'u', summary: 'Resolve timeout in login' }]);
    expect(result.fixed).toContain('Resolve timeout in login');
  });

  it('routes "update" keyword to Changed', () => {
    const result = categorizeChanges([{ unitId: 'u', summary: 'Update dependency versions' }]);
    expect(result.changed).toContain('Update dependency versions');
  });

  it('routes "refactor" keyword to Changed', () => {
    const result = categorizeChanges([{ unitId: 'u', summary: 'Refactor authentication module' }]);
    expect(result.changed).toContain('Refactor authentication module');
  });

  it('defaults to Added when no keyword matches', () => {
    const result = categorizeChanges([{ unitId: 'u', summary: 'New behavior for pipelines' }]);
    expect(result.added).toContain('New behavior for pipelines');
  });

  it('routes everything to Fixed when pathway is bugfix', () => {
    const summaries = [
      { unitId: 'u1', summary: 'Add logging to service' },
      { unitId: 'u2', summary: 'Update config schema' },
    ];
    const result = categorizeChanges(summaries, 'bugfix');
    expect(result.fixed).toHaveLength(2);
    expect(result.added).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });

  it('uses only the first line of multi-line summaries', () => {
    const result = categorizeChanges([{ unitId: 'u', summary: 'Add cache layer\n\nSecond line detail.' }]);
    expect(result.added[0]).toBe('Add cache layer');
  });

  it('skips entries with empty first lines', () => {
    const result = categorizeChanges([{ unitId: 'u', summary: '   ' }]);
    expect(result.added).toHaveLength(0);
    expect(result.fixed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });
});

describe('formatChangelogEntry', () => {
  it('formats a version header in Keep a Changelog style', () => {
    const entry = formatChangelogEntry('v1.0.0', '2024-01-15', { added: [], changed: [], fixed: [] });
    expect(entry).toContain('## [v1.0.0] - 2024-01-15');
  });

  it('includes ### Added section when items present', () => {
    const entry = formatChangelogEntry('v1.0.0', '2024-01-15', {
      added: ['New feature'],
      changed: [],
      fixed: [],
    });
    expect(entry).toContain('### Added');
    expect(entry).toContain('- New feature');
  });

  it('includes ### Changed section when items present', () => {
    const entry = formatChangelogEntry('v1.0.0', '2024-01-15', {
      added: [],
      changed: ['Updated config'],
      fixed: [],
    });
    expect(entry).toContain('### Changed');
    expect(entry).toContain('- Updated config');
  });

  it('includes ### Fixed section when items present', () => {
    const entry = formatChangelogEntry('v1.0.0', '2024-01-15', {
      added: [],
      changed: [],
      fixed: ['Fixed crash on startup'],
    });
    expect(entry).toContain('### Fixed');
    expect(entry).toContain('- Fixed crash on startup');
  });

  it('omits sections that have no items', () => {
    const entry = formatChangelogEntry('v1.0.0', '2024-01-15', {
      added: ['New thing'],
      changed: [],
      fixed: [],
    });
    expect(entry).not.toContain('### Changed');
    expect(entry).not.toContain('### Fixed');
  });

  it('formats multiple items per section correctly', () => {
    const entry = formatChangelogEntry('v1.0.0', '2024-01-15', {
      added: ['Feature A', 'Feature B'],
      changed: [],
      fixed: [],
    });
    expect(entry).toContain('- Feature A');
    expect(entry).toContain('- Feature B');
  });
});

describe('isKeepAChangelogFormat', () => {
  it('recognizes "# Changelog" header', () => {
    expect(isKeepAChangelogFormat('# Changelog\n\nSome text')).toBe(true);
  });

  it('recognizes "# Change Log" header (with space)', () => {
    expect(isKeepAChangelogFormat('# Change Log\n\nSome text')).toBe(true);
  });

  it('recognizes ## [ version entries', () => {
    expect(isKeepAChangelogFormat('## [1.0.0] - 2024-01-01\n\n### Added')).toBe(true);
  });

  it('rejects plain text files', () => {
    expect(isKeepAChangelogFormat('Some random text\nwithout proper headers')).toBe(false);
  });

  it('rejects files with only non-standard headers', () => {
    expect(isKeepAChangelogFormat('## My Custom Log\n\nSome changes')).toBe(false);
  });
});

describe('prependToChangelog', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts new entry before the first ## [version] entry', () => {
    const changelogPath = path.join(tmpDir, 'CHANGELOG.md');
    const existing = '# Changelog\n\n## [1.0.0] - 2024-01-01\n\n### Added\n\n- Old feature\n';
    fs.writeFileSync(changelogPath, existing);

    const newEntry = '## [2.0.0] - 2024-06-01\n\n### Added\n\n- New feature\n\n';
    prependToChangelog(changelogPath, newEntry);

    const result = fs.readFileSync(changelogPath, 'utf-8');
    const newIdx = result.indexOf('## [2.0.0]');
    const oldIdx = result.indexOf('## [1.0.0]');
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it('appends after content when no existing ## [ entry', () => {
    const changelogPath = path.join(tmpDir, 'CHANGELOG.md');
    fs.writeFileSync(changelogPath, '# Changelog\n\nNo entries yet.\n');

    const newEntry = '## [1.0.0] - 2024-01-01\n\n### Added\n\n- First release\n\n';
    prependToChangelog(changelogPath, newEntry);

    const result = fs.readFileSync(changelogPath, 'utf-8');
    expect(result).toContain('## [1.0.0]');
    expect(result).toContain('No entries yet.');
  });
});

describe('appendOlympusSection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends a delimited section with HTML comments', () => {
    const changelogPath = path.join(tmpDir, 'CHANGELOG.md');
    fs.writeFileSync(changelogPath, 'Existing content\n');

    const entry = '## [wf-001] - 2024-01-01\n\n### Added\n\n- Something\n\n';
    appendOlympusSection(changelogPath, entry);

    const result = fs.readFileSync(changelogPath, 'utf-8');
    expect(result).toContain('<!-- Olympus AI-DLC Generated -->');
    expect(result).toContain('<!-- End Olympus AI-DLC Generated -->');
    expect(result).toContain(entry);
    expect(result).toContain('Existing content');
  });

  it('preserves the original content before the appended section', () => {
    const changelogPath = path.join(tmpDir, 'CHANGELOG.md');
    const original = 'Custom changelog format\nWith some entries\n';
    fs.writeFileSync(changelogPath, original);

    appendOlympusSection(changelogPath, '## [x] - 2024-01-01\n\n');

    const result = fs.readFileSync(changelogPath, 'utf-8');
    expect(result.startsWith(original)).toBe(true);
  });
});

describe('createNewChangelog', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a file with Keep a Changelog header', () => {
    const changelogPath = path.join(tmpDir, 'CHANGELOG.md');
    createNewChangelog(changelogPath, '## [1.0.0] - 2024-01-01\n\n### Added\n\n- First\n\n');

    const result = fs.readFileSync(changelogPath, 'utf-8');
    expect(result).toContain('# Changelog');
    expect(result).toContain('Keep a Changelog');
    expect(result).toContain('## [1.0.0]');
  });

  it('creates the file at the specified path', () => {
    const changelogPath = path.join(tmpDir, 'CHANGELOG.md');
    expect(fs.existsSync(changelogPath)).toBe(false);
    createNewChangelog(changelogPath, '## [1.0.0] - 2024-01-01\n\n');
    expect(fs.existsSync(changelogPath)).toBe(true);
  });
});

describe('generateChangelogEntry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeWorkflowFeatureDoc(workflowId: string, unitId: string, summary: string): void {
    const docDir = path.join(tmpDir, 'aidlc-docs', workflowId, 'construction', unitId, 'documentation');
    fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, 'feature-doc.md'), `# Feature\n\n## Summary\n\n${summary}\n\n## Details\n\nMore.\n`);
  }

  it('skips when a changelog tool is detected', () => {
    fs.writeFileSync(path.join(tmpDir, '.versionrc'), '{}');
    const result = generateChangelogEntry({
      projectPath: tmpDir,
      workflowId: 'wf-001',
      featureName: 'test',
      unitIds: ['u-001'],
    });
    expect(result.status).toBe('skipped');
    expect(result.skipReason).toContain('conventional-changelog');
    expect(result.path).toBeNull();
  });

  it('skips when no feature doc summaries are found', () => {
    const result = generateChangelogEntry({
      projectPath: tmpDir,
      workflowId: 'wf-001',
      featureName: 'test',
      unitIds: ['u-001'],
    });
    expect(result.status).toBe('skipped');
    expect(result.skipReason).toContain('No feature doc summaries found');
  });

  it('creates a new CHANGELOG.md when none exists', () => {
    makeWorkflowFeatureDoc('wf-001', 'u-001', 'Add new authentication module');
    const result = generateChangelogEntry({
      projectPath: tmpDir,
      workflowId: 'wf-001',
      featureName: 'test',
      unitIds: ['u-001'],
    });
    expect(result.status).toBe('completed');
    expect(result.path).toBe(path.join(tmpDir, 'CHANGELOG.md'));
    expect(result.entriesAdded).toBeGreaterThan(0);

    const content = fs.readFileSync(result.path!, 'utf-8');
    expect(content).toContain('# Changelog');
    expect(content).toContain('## [wf-001]');
    expect(content).toContain('Add new authentication module');
  });

  it('prepends to an existing Keep a Changelog file', () => {
    makeWorkflowFeatureDoc('wf-002', 'u-001', 'Implement search feature');
    const changelogPath = path.join(tmpDir, 'CHANGELOG.md');
    fs.writeFileSync(changelogPath, '# Changelog\n\n## [1.0.0] - 2023-01-01\n\n### Added\n\n- Old feature\n');

    const result = generateChangelogEntry({
      projectPath: tmpDir,
      workflowId: 'wf-002',
      featureName: 'search',
      unitIds: ['u-001'],
    });

    expect(result.status).toBe('completed');
    const content = fs.readFileSync(changelogPath, 'utf-8');
    const newIdx = content.indexOf('## [wf-002]');
    const oldIdx = content.indexOf('## [1.0.0]');
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it('appends delimited section to a non-standard changelog', () => {
    makeWorkflowFeatureDoc('wf-003', 'u-001', 'Fix null pointer in parser');
    const changelogPath = path.join(tmpDir, 'CHANGELOG.md');
    fs.writeFileSync(changelogPath, 'My Custom Format\nRelease notes here\n');

    const result = generateChangelogEntry({
      projectPath: tmpDir,
      workflowId: 'wf-003',
      featureName: 'fix',
      unitIds: ['u-001'],
    });

    expect(result.status).toBe('completed');
    const content = fs.readFileSync(changelogPath, 'utf-8');
    expect(content).toContain('<!-- Olympus AI-DLC Generated -->');
    expect(content).toContain('<!-- End Olympus AI-DLC Generated -->');
    expect(content).toContain('My Custom Format');
  });

  it('derives entry content from actual feature doc summaries', () => {
    makeWorkflowFeatureDoc('wf-004', 'u-001', 'Add rate limiting to API endpoints');
    makeWorkflowFeatureDoc('wf-004', 'u-002', 'Fix memory leak in connection pool');

    const result = generateChangelogEntry({
      projectPath: tmpDir,
      workflowId: 'wf-004',
      featureName: 'api-improvements',
      unitIds: ['u-001', 'u-002'],
    });

    expect(result.status).toBe('completed');
    expect(result.entriesAdded).toBe(2);

    const content = fs.readFileSync(result.path!, 'utf-8');
    expect(content).toContain('Add rate limiting to API endpoints');
    expect(content).toContain('Fix memory leak in connection pool');
  });

  it('categorizes all entries as Fixed for bugfix pathway', () => {
    makeWorkflowFeatureDoc('wf-005', 'u-001', 'Resolve incorrect tax calculation');

    generateChangelogEntry({
      projectPath: tmpDir,
      workflowId: 'wf-005',
      featureName: 'bugfix-tax',
      unitIds: ['u-001'],
      pathway: 'bugfix',
    });

    const content = fs.readFileSync(path.join(tmpDir, 'CHANGELOG.md'), 'utf-8');
    expect(content).toContain('### Fixed');
    expect(content).not.toContain('### Added');
  });
});
