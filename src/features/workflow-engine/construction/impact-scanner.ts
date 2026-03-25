import * as fs from 'fs';
import * as path from 'path';

export interface ImpactScanOptions {
  projectPath: string;
  workflowId: string;
  unitId: string;
  modifiedFiles: string[];
}

export interface ImpactScanResult {
  status: 'completed' | 'skipped';
  affectedDocs: Array<{
    path: string;
    references: string[];
    description: string;
  }>;
  reportPath: string | null;
}

export function findDocFiles(projectPath: string, workflowId: string): string[] {
  const results: string[] = [];

  const readmePath = path.join(projectPath, 'README.md');
  if (fs.existsSync(readmePath)) {
    results.push(readmePath);
  }

  const docsDir = path.join(projectPath, 'docs');
  if (fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()) {
    const collectMd = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collectMd(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath);
        }
      }
    };
    collectMd(docsDir);
  }

  const constructionDir = path.join(projectPath, 'aidlc-docs', workflowId, 'construction');
  if (fs.existsSync(constructionDir) && fs.statSync(constructionDir).isDirectory()) {
    const unitEntries = fs.readdirSync(constructionDir, { withFileTypes: true });
    for (const unitEntry of unitEntries) {
      if (!unitEntry.isDirectory()) continue;
      const docDir = path.join(constructionDir, unitEntry.name, 'documentation');
      if (fs.existsSync(docDir) && fs.statSync(docDir).isDirectory()) {
        const docEntries = fs.readdirSync(docDir, { withFileTypes: true });
        for (const docEntry of docEntries) {
          if (docEntry.isFile() && docEntry.name.endsWith('.md')) {
            results.push(path.join(docDir, docEntry.name));
          }
        }
      }
    }
  }

  const inceptionDir = path.join(projectPath, 'aidlc-docs', workflowId, 'inception');
  if (fs.existsSync(inceptionDir) && fs.statSync(inceptionDir).isDirectory()) {
    const collectMd = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collectMd(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath);
        }
      }
    };
    collectMd(inceptionDir);
  }

  return results;
}

export function findReferences(docContent: string, searchTerms: string[]): string[] {
  return searchTerms.filter(term => term && docContent.includes(term));
}

function extractSearchTerms(modifiedFiles: string[]): string[] {
  const terms = new Set<string>();
  for (const filePath of modifiedFiles) {
    const basename = path.basename(filePath);
    const withoutExt = basename.replace(/\.[^.]+$/, '');
    if (withoutExt) terms.add(withoutExt);
    if (basename) terms.add(basename);
    const parentDir = path.basename(path.dirname(filePath));
    if (parentDir && parentDir !== '.' && parentDir !== '..') {
      terms.add(parentDir);
    }
  }
  return Array.from(terms).filter(t => t.length > 2);
}

export function generateImpactReport(
  result: ImpactScanResult,
  options: { unitId: string; workflowId: string; outputDir: string }
): string {
  const docDir = path.join(options.outputDir, 'documentation');
  fs.mkdirSync(docDir, { recursive: true });

  const lines: string[] = [
    `# Impact Scan: ${options.unitId}`,
    '',
    `**Generated:** ${new Date().toISOString().split('T')[0]}`,
    `**Workflow:** ${options.workflowId}`,
    `**Unit:** ${options.unitId}`,
    `**Status:** ${result.status}`,
    '',
  ];

  if (result.affectedDocs.length === 0) {
    lines.push('## Result', '', 'No existing documentation references were found that require updates.', '');
  } else {
    lines.push(
      '## Affected Documents',
      '',
      `${result.affectedDocs.length} document(s) may need updating:`,
      ''
    );
    for (const doc of result.affectedDocs) {
      lines.push(`### ${path.basename(doc.path)}`);
      lines.push('');
      lines.push(`**Path:** \`${doc.path}\``);
      lines.push(`**References found:** ${doc.references.join(', ')}`);
      lines.push(`**Action needed:** ${doc.description}`);
      lines.push('');
    }
  }

  lines.push('> This is an advisory scan. Review and update affected documents as needed.', '');

  const reportPath = path.join(docDir, 'impact-scan.md');
  fs.writeFileSync(reportPath, lines.join('\n'));
  return reportPath;
}

export function runImpactScan(options: ImpactScanOptions): ImpactScanResult {
  if (!options.modifiedFiles || options.modifiedFiles.length === 0) {
    return { status: 'skipped', affectedDocs: [], reportPath: null };
  }

  const searchTerms = extractSearchTerms(options.modifiedFiles);
  if (searchTerms.length === 0) {
    return { status: 'skipped', affectedDocs: [], reportPath: null };
  }

  const docFiles = findDocFiles(options.projectPath, options.workflowId);
  const affectedDocs: ImpactScanResult['affectedDocs'] = [];

  for (const docPath of docFiles) {
    let content: string;
    try {
      content = fs.readFileSync(docPath, 'utf-8');
    } catch {
      continue;
    }

    const matched = findReferences(content, searchTerms);
    if (matched.length > 0) {
      affectedDocs.push({
        path: docPath,
        references: matched,
        description: `References to ${matched.join(', ')} — verify content is still accurate after unit changes`,
      });
    }
  }

  if (affectedDocs.length === 0) {
    return { status: 'skipped', affectedDocs: [], reportPath: null };
  }

  const outputDir = path.join(
    options.projectPath,
    'aidlc-docs',
    options.workflowId,
    'construction',
    options.unitId
  );

  const result: ImpactScanResult = {
    status: 'completed',
    affectedDocs,
    reportPath: null,
  };

  const reportPath = generateImpactReport(result, {
    unitId: options.unitId,
    workflowId: options.workflowId,
    outputDir,
  });

  result.reportPath = reportPath;
  return result;
}
