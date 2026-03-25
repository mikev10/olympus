import * as fs from 'fs';
import * as path from 'path';

export interface ChangelogOptions {
  projectPath: string;
  workflowId: string;
  featureName: string;
  unitIds: string[];
  pathway?: string;
}

export interface ChangelogResult {
  status: 'completed' | 'skipped';
  path: string | null;
  entriesAdded: number;
  skipReason?: string;
}

/**
 * Detects if an existing changelog management tool is configured.
 * Returns the tool name if found, null otherwise.
 */
export function detectExistingChangelogTool(projectPath: string): string | null {
  const toolIndicators: Array<{ files: string[]; tool: string }> = [
    { files: ['.versionrc', '.versionrc.json', '.versionrc.js'], tool: 'conventional-changelog' },
    { files: ['.changeset'], tool: 'changesets' },
    { files: ['cliff.toml'], tool: 'git-cliff' },
  ];

  for (const { files, tool } of toolIndicators) {
    for (const file of files) {
      const filePath = path.join(projectPath, file);
      if (fs.existsSync(filePath)) return tool;
    }
  }
  return null;
}

/**
 * Reads Summary sections from unit feature docs.
 */
export function readFeatureDocSummaries(
  workflowPath: string,
  unitIds: string[]
): Array<{ unitId: string; summary: string }> {
  const summaries: Array<{ unitId: string; summary: string }> = [];

  for (const unitId of unitIds) {
    const docPath = path.join(
      workflowPath,
      'construction',
      unitId,
      'documentation',
      'feature-doc.md'
    );
    if (!fs.existsSync(docPath)) continue;

    const content = fs.readFileSync(docPath, 'utf-8');
    const summaryMatch = content.match(/## Summary\n\n([\s\S]*?)(?=\n## |\n---|\Z)/);
    if (summaryMatch && summaryMatch[1].trim()) {
      summaries.push({ unitId, summary: summaryMatch[1].trim() });
    }
  }

  return summaries;
}

/**
 * Categorizes changes into Added/Changed/Fixed based on content and pathway.
 */
export function categorizeChanges(
  summaries: Array<{ unitId: string; summary: string }>,
  pathway?: string
): { added: string[]; changed: string[]; fixed: string[] } {
  const result = { added: [] as string[], changed: [] as string[], fixed: [] as string[] };

  for (const { summary } of summaries) {
    const firstLine = summary.split('\n')[0].trim();
    if (!firstLine) continue;

    if (pathway === 'bugfix') {
      result.fixed.push(firstLine);
    } else if (/(?:add|create|implement|introduce|new)/i.test(firstLine)) {
      result.added.push(firstLine);
    } else if (/(?:fix|repair|resolve|patch|correct)/i.test(firstLine)) {
      result.fixed.push(firstLine);
    } else if (/(?:update|change|modify|refactor|improve|enhance)/i.test(firstLine)) {
      result.changed.push(firstLine);
    } else {
      result.added.push(firstLine);
    }
  }

  return result;
}

/**
 * Formats a changelog entry in Keep a Changelog style.
 */
export function formatChangelogEntry(
  version: string,
  date: string,
  categories: { added: string[]; changed: string[]; fixed: string[] }
): string {
  const lines: string[] = [`## [${version}] - ${date}`, ''];

  if (categories.added.length > 0) {
    lines.push('### Added', '');
    for (const item of categories.added) lines.push(`- ${item}`);
    lines.push('');
  }
  if (categories.changed.length > 0) {
    lines.push('### Changed', '');
    for (const item of categories.changed) lines.push(`- ${item}`);
    lines.push('');
  }
  if (categories.fixed.length > 0) {
    lines.push('### Fixed', '');
    for (const item of categories.fixed) lines.push(`- ${item}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Detects if a CHANGELOG.md follows Keep a Changelog format.
 */
export function isKeepAChangelogFormat(content: string): boolean {
  return /^# (?:Changelog|Change\s*Log)/im.test(content) || /^## \[/m.test(content);
}

/**
 * Prepends an entry to an existing Keep a Changelog file.
 * Inserts after the header and any intro text, before the first ## [version] entry.
 */
export function prependToChangelog(changelogPath: string, entry: string): void {
  const content = fs.readFileSync(changelogPath, 'utf-8');
  const firstEntryMatch = content.match(/^## \[/m);
  if (firstEntryMatch && firstEntryMatch.index !== undefined) {
    const before = content.substring(0, firstEntryMatch.index);
    const after = content.substring(firstEntryMatch.index);
    fs.writeFileSync(changelogPath, before + entry + '\n' + after);
  } else {
    fs.writeFileSync(changelogPath, content + '\n' + entry);
  }
}

/**
 * Appends a delimited Olympus section to a non-standard changelog.
 */
export function appendOlympusSection(changelogPath: string, entry: string): void {
  const content = fs.readFileSync(changelogPath, 'utf-8');
  const delimitedEntry = [
    '',
    '<!-- Olympus AI-DLC Generated -->',
    entry,
    '<!-- End Olympus AI-DLC Generated -->',
    '',
  ].join('\n');
  fs.writeFileSync(changelogPath, content + delimitedEntry);
}

/**
 * Creates a new CHANGELOG.md with Keep a Changelog header.
 */
export function createNewChangelog(changelogPath: string, entry: string): void {
  const header = [
    '# Changelog',
    '',
    'All notable changes to this project will be documented in this file.',
    '',
    'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).',
    '',
  ].join('\n');
  fs.writeFileSync(changelogPath, header + entry);
}

/**
 * Main entry point: generates a changelog entry from unit feature docs.
 */
export function generateChangelogEntry(options: ChangelogOptions): ChangelogResult {
  const existingTool = detectExistingChangelogTool(options.projectPath);
  if (existingTool) {
    return {
      status: 'skipped',
      path: null,
      entriesAdded: 0,
      skipReason: `Changelog managed by ${existingTool}`,
    };
  }

  const workflowPath = path.join(options.projectPath, 'aidlc-docs', options.workflowId);
  const summaries = readFeatureDocSummaries(workflowPath, options.unitIds);

  if (summaries.length === 0) {
    return {
      status: 'skipped',
      path: null,
      entriesAdded: 0,
      skipReason: 'No feature doc summaries found',
    };
  }

  const categories = categorizeChanges(summaries, options.pathway);
  const date = new Date().toISOString().split('T')[0];
  const entry = formatChangelogEntry(options.workflowId, date, categories);

  const changelogPath = path.join(options.projectPath, 'CHANGELOG.md');

  if (fs.existsSync(changelogPath)) {
    const content = fs.readFileSync(changelogPath, 'utf-8');
    if (isKeepAChangelogFormat(content)) {
      prependToChangelog(changelogPath, entry);
    } else {
      appendOlympusSection(changelogPath, entry);
    }
  } else {
    createNewChangelog(changelogPath, entry);
  }

  const totalEntries =
    categories.added.length + categories.changed.length + categories.fixed.length;
  return { status: 'completed', path: changelogPath, entriesAdded: totalEntries };
}
