import * as path from 'path';
import * as fs from 'fs-extra';
import { readFileSync } from 'fs';
import { registerArtifact } from './manifest.js';
import type { WorkspaceScanResult, DirectoryNode } from './brownfield-scanner.js';
import type { WorkflowPhase } from './phase-types.js';

export interface BrownfieldAnalysisOptions {
  projectPath: string;
  workflowId: string;
  featureName: string;
  scanResult: WorkspaceScanResult;
  keyFiles: string[];
  relevantFiles: string[];
  intentText: string;
}

export interface ModuleDescription {
  name: string;
  path: string;
  responsibility: string;
  publicInterface: string;
}

export interface DependencyEdge {
  source: string;
  target: string;
}

export interface DataModelDescription {
  name: string;
  fields: string[];
  location: string;
}

export interface StaticModel {
  modules: ModuleDescription[];
  dependencyGraph: DependencyEdge[];
  dataModels: DataModelDescription[];
  configSummary: string;
}

export interface UseCaseFlow {
  name: string;
  description: string;
  steps: string[];
}

export interface EventPattern {
  eventName: string;
  publisher: string;
  subscribers: string[];
}

export interface DynamicModel {
  useCases: UseCaseFlow[];
  eventPatterns: EventPattern[];
  stateManagement: string;
  errorHandling: string;
}

export const STATIC_MODEL_FORMAT_INSTRUCTIONS = `A Static Code Model must contain these markdown sections:
## Modules
| Name | Path | Responsibility | Public Interface |
|------|------|----------------|------------------|
(one row per module)

## Dependency Graph
- ModuleA -> ModuleB
(one edge per line)

## Data Models
| Name | Fields | Location |
|------|--------|----------|
(one row per data model)

## Configuration Summary
(paragraph describing configuration approach)`;

export const DYNAMIC_MODEL_FORMAT_INSTRUCTIONS = `A Dynamic Behavior Model must contain these markdown sections:
## Use Cases
### UseCaseName
Description of the use case.
1. Step one
2. Step two
(repeat for each use case)

## Event Patterns
| Event | Publisher | Subscribers |
|-------|-----------|-------------|
(one row per event)

## State Management
(paragraph describing state management approach)

## Error Handling
(paragraph describing error propagation patterns)`;

export function truncateContent(content: string, maxLines: number): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + '\n... (truncated)';
}

/**
 * Renders a DirectoryNode array as indented text for inclusion in prompts.
 *   src/ (42 files)
 *     features/ (20 files)
 */
export function flattenDirectoryTree(nodes: DirectoryNode[], indent: number): string {
  const lines: string[] = [];
  const padding = ' '.repeat(indent * 2);

  for (const node of nodes) {
    lines.push(`${padding}${node.name}/ (${node.fileCount} files)`);
    if (node.children.length > 0) {
      lines.push(flattenDirectoryTree(node.children, indent + 1));
    }
  }

  return lines.join('\n');
}

function readFileSafe(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '(unable to read)';
  }
}

function resolveFilePath(filePath: string, projectPath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(projectPath, filePath);
}

function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

export function buildStaticModelPrompt(options: BrownfieldAnalysisOptions): string {
  const { projectPath, featureName, scanResult, keyFiles } = options;

  const treeText = flattenDirectoryTree(scanResult.directoryTree, 0);

  const langLines = Object.entries(scanResult.languageDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([ext, count]) => `  ${ext}: ${count} files`)
    .join('\n');

  const importEdges = scanResult.importGraph
    .slice(0, 50)
    .map(e => `  ${toForwardSlashes(e.sourceFile)} -> ${e.importedModule}`)
    .join('\n');
  const importGraphNote =
    scanResult.importGraph.length > 50
      ? `\n  ... (${scanResult.importGraph.length - 50} more edges omitted)`
      : '';

  const keyFileSections = keyFiles
    .map(filePath => {
      const resolved = resolveFilePath(filePath, projectPath);
      const raw = readFileSafe(resolved);
      const truncated = truncateContent(raw, 200);
      return `### ${toForwardSlashes(filePath)}\n\`\`\`\n${truncated}\n\`\`\``;
    })
    .join('\n\n');

  const configList = scanResult.configFiles.length > 0
    ? scanResult.configFiles.map(f => `  - ${f}`).join('\n')
    : '  (none detected)';

  return `You are performing a static code analysis of an existing project to support the feature: "${featureName}".

## Project Directory Tree
${treeText || '  (empty)'}

## Language Distribution
${langLines || '  (none)'}

## Import Graph (first 50 edges)
${importEdges || '  (none)'}${importGraphNote}

## Configuration Files
${configList}

## Key Source Files

${keyFileSections || '(no key files provided)'}

---

Based on the above project structure and source files, produce a Static Code Model.

${STATIC_MODEL_FORMAT_INSTRUCTIONS}

Be precise and concise. Each module row should capture the real public exports or primary function signatures where visible. Use the actual file paths from the project.`;
}

export function buildDynamicModelPrompt(
  options: BrownfieldAnalysisOptions,
  staticModel: string
): string {
  const { projectPath, featureName, relevantFiles, intentText } = options;

  const relevantFileSections = relevantFiles
    .map(filePath => {
      const resolved = resolveFilePath(filePath, projectPath);
      const raw = readFileSafe(resolved);
      const truncated = truncateContent(raw, 200);
      return `### ${toForwardSlashes(filePath)}\n\`\`\`\n${truncated}\n\`\`\``;
    })
    .join('\n\n');

  return `You are performing a dynamic behavior analysis of an existing project to support the feature: "${featureName}".

## Feature Intent
${intentText}

## Static Code Model (previously generated)
${staticModel}

## Intent-Relevant Source Files

${relevantFileSections || '(no intent-relevant files provided)'}

---

Based on the static model and the intent-relevant source files above, produce a Dynamic Behavior Model.

${DYNAMIC_MODEL_FORMAT_INSTRUCTIONS}

Focus on runtime behavior: how requests flow, how events are emitted and consumed, how state is mutated, and how errors propagate. Ground your analysis in the actual code shown above.`;
}

function extractSection(markdown: string, sectionTitle: string): string {
  // Regex matches "## SectionTitle" up to the next "##" heading or end of string.
  // The negative lookahead on \n## prevents consuming the next section's content.
  const pattern = new RegExp(
    `##\\s+${escapeRegex(sectionTitle)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    'i'
  );
  const m = pattern.exec(markdown);
  return m ? m[1].trim() : '';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTableRows(text: string): string[][] {
  const rows: string[][] = [];
  let headerSkipped = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    // Skip separator rows like |---|---|
    if (/^\|[\s\-|]+\|$/.test(trimmed)) {
      headerSkipped = true;
      continue;
    }
    // Skip the header row (first pipe-row before the separator)
    if (!headerSkipped) continue;
    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map(c => c.trim());
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

export function parseStaticModelResponse(response: string): StaticModel {
  const model: StaticModel = {
    modules: [],
    dependencyGraph: [],
    dataModels: [],
    configSummary: '',
  };

  try {
    const modulesSection = extractSection(response, 'Modules');
    for (const row of parseTableRows(modulesSection)) {
      if (row.length >= 4) {
        model.modules.push({
          name: row[0],
          path: row[1],
          responsibility: row[2],
          publicInterface: row[3],
        });
      }
    }
  } catch (err) {
    console.error('[brownfield-analysis] Error parsing Modules section:', err);
  }

  try {
    const depSection = extractSection(response, 'Dependency Graph');
    for (const line of depSection.split('\n')) {
      // Matches "- SourceModule -> TargetModule" dependency edge lines
      const m = /^[-*]\s+(.+?)\s*->\s*(.+)$/.exec(line.trim());
      if (m) {
        model.dependencyGraph.push({ source: m[1].trim(), target: m[2].trim() });
      }
    }
  } catch (err) {
    console.error('[brownfield-analysis] Error parsing Dependency Graph section:', err);
  }

  try {
    const dataSection = extractSection(response, 'Data Models');
    for (const row of parseTableRows(dataSection)) {
      if (row.length >= 3) {
        const fields = row[1]
          .split(',')
          .map(f => f.trim())
          .filter(f => f.length > 0);
        model.dataModels.push({
          name: row[0],
          fields,
          location: row[2],
        });
      }
    }
  } catch (err) {
    console.error('[brownfield-analysis] Error parsing Data Models section:', err);
  }

  try {
    model.configSummary = extractSection(response, 'Configuration Summary');
  } catch (err) {
    console.error('[brownfield-analysis] Error parsing Configuration Summary section:', err);
  }

  return model;
}

export function parseDynamicModelResponse(response: string): DynamicModel {
  const model: DynamicModel = {
    useCases: [],
    eventPatterns: [],
    stateManagement: '',
    errorHandling: '',
  };

  try {
    const useCasesSection = extractSection(response, 'Use Cases');
    const ucBlocks = useCasesSection.split(/\n(?=###\s)/);
    for (const block of ucBlocks) {
      const nameMatch = /^###\s+(.+)/.exec(block.trim());
      if (!nameMatch) continue;
      const name = nameMatch[1].trim();

      const rest = block.slice(block.indexOf('\n') + 1).trim();
      const lines = rest.split('\n');
      const descLines: string[] = [];
      const steps: string[] = [];

      for (const line of lines) {
        // Matches numbered step lines like "1. Do something"
        const stepMatch = /^\d+\.\s+(.+)/.exec(line.trim());
        if (stepMatch) {
          steps.push(stepMatch[1].trim());
        } else if (steps.length === 0 && line.trim().length > 0) {
          descLines.push(line.trim());
        }
      }

      model.useCases.push({
        name,
        description: descLines.join(' ').trim(),
        steps,
      });
    }
  } catch (err) {
    console.error('[brownfield-analysis] Error parsing Use Cases section:', err);
  }

  try {
    const eventSection = extractSection(response, 'Event Patterns');
    for (const row of parseTableRows(eventSection)) {
      if (row.length >= 3) {
        const subscribers = row[2]
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
        model.eventPatterns.push({
          eventName: row[0],
          publisher: row[1],
          subscribers,
        });
      }
    }
  } catch (err) {
    console.error('[brownfield-analysis] Error parsing Event Patterns section:', err);
  }

  try {
    model.stateManagement = extractSection(response, 'State Management');
  } catch (err) {
    console.error('[brownfield-analysis] Error parsing State Management section:', err);
  }

  try {
    model.errorHandling = extractSection(response, 'Error Handling');
  } catch (err) {
    console.error('[brownfield-analysis] Error parsing Error Handling section:', err);
  }

  return model;
}

export function buildBusinessOverviewPrompt(options: BrownfieldAnalysisOptions): string {
  const { projectPath, featureName, scanResult, keyFiles, intentText } = options;

  const treeText = flattenDirectoryTree(scanResult.directoryTree, 0);

  const keyFileSections = keyFiles
    .map(filePath => {
      const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
      const raw = readFileSafe(resolved);
      const truncated = truncateContent(raw, 100);
      return `### ${toForwardSlashes(filePath)}\n\`\`\`\n${truncated}\n\`\`\``;
    })
    .join('\n\n');

  return `You are analyzing an existing project to produce a business context document for the feature: "${featureName}".

## Project Intent
${intentText}

## Project Directory Tree
${treeText || '  (empty)'}

## Key Source Files

${keyFileSections || '(no key files provided)'}

---

Based on the above, produce a Business Overview with these markdown sections:

## Business Context
A concise description of what the application does and who uses it.

## Business Transactions
A list of major user-facing workflows or operations the system supports.

## Business Dictionary
A glossary of key domain terms used in the codebase.

Be precise and grounded in the actual code shown above.`;
}

export function buildAPIDocumentationPrompt(options: BrownfieldAnalysisOptions): string {
  const { projectPath, featureName, scanResult, keyFiles, relevantFiles } = options;

  const routeAndControllerFiles = [...keyFiles, ...relevantFiles].filter(f => {
    const lower = f.toLowerCase().replace(/\\/g, '/');
    return (
      lower.includes('route') ||
      lower.includes('controller') ||
      lower.includes('handler') ||
      lower.includes('api') ||
      lower.includes('endpoint')
    );
  });

  const filesToShow = routeAndControllerFiles.length > 0 ? routeAndControllerFiles : keyFiles;

  const fileSections = filesToShow
    .slice(0, 15)
    .map(filePath => {
      const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
      const raw = readFileSafe(resolved);
      const truncated = truncateContent(raw, 150);
      return `### ${toForwardSlashes(filePath)}\n\`\`\`\n${truncated}\n\`\`\``;
    })
    .join('\n\n');

  const configList = scanResult.configFiles.length > 0
    ? scanResult.configFiles.map(f => `  - ${f}`).join('\n')
    : '  (none detected)';

  return `You are analyzing an existing project to produce API documentation for the feature: "${featureName}".

## Configuration Files
${configList}

## Route / Controller / Handler Files

${fileSections || '(no route or controller files found)'}

---

Based on the above, produce API Documentation with these markdown sections:

## REST APIs
| Method | Path | Description |
|--------|------|-------------|
(one row per endpoint)

## Internal APIs
| Module | Interface | Description |
|--------|-----------|-------------|
(one row per significant module interface)

## Data Models
| Model | Fields | Used In |
|-------|--------|---------|
(one row per request/response shape or data model)

Be precise and grounded in the actual code shown above.`;
}

export function buildCodeQualityPrompt(options: BrownfieldAnalysisOptions): string {
  const { projectPath, featureName, scanResult, keyFiles } = options;

  const totalSourceFiles = Object.values(scanResult.languageDistribution).reduce((a, b) => a + b, 0);
  const langSummary = Object.entries(scanResult.languageDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([ext, count]) => `  ${ext}: ${count} files`)
    .join('\n');

  const configList = scanResult.configFiles.length > 0
    ? scanResult.configFiles.map(f => `  - ${f}`).join('\n')
    : '  (none detected)';

  const sampleFileSections = keyFiles
    .slice(0, 10)
    .map(filePath => {
      const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
      const raw = readFileSafe(resolved);
      const truncated = truncateContent(raw, 80);
      return `### ${toForwardSlashes(filePath)}\n\`\`\`\n${truncated}\n\`\`\``;
    })
    .join('\n\n');

  return `You are performing a code quality assessment of an existing project for the feature: "${featureName}".

## Scan Statistics
Total files: ${scanResult.totalFiles}
Source files: ${totalSourceFiles}
Entry points: ${scanResult.entryPoints.length}
Import edges: ${scanResult.importGraph.length}

## Language Distribution
${langSummary || '  (none)'}

## Configuration Files
${configList}

## Sample Source Files

${sampleFileSections || '(no sample files provided)'}

---

Based on the above, produce a Code Quality Assessment with these markdown sections:

## Test Coverage
Describe what is tested, identify obvious gaps in test coverage.

## Code Quality Indicators
Assess naming conventions, code structure, and observable patterns.

## Technical Debt
List known issues, TODOs, or areas requiring significant refactoring.

## Patterns and Anti-patterns
Identify good patterns being applied and any anti-patterns observed.

Be specific and grounded in the actual code shown above.`;
}

export async function writeModelsToArtifacts(
  projectPath: string,
  workflowId: string,
  staticModel: string,
  dynamicModel: string
): Promise<void> {
  try {
    const discoveryDir = path.join(projectPath, 'aidlc-docs', workflowId, 'discovery');
    await fs.ensureDir(discoveryDir);

    const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');

    const staticPath = path.join(discoveryDir, 'static-model.md');
    await fs.writeFile(staticPath, staticModel, 'utf8');

    registerArtifact(manifestPath, {
      id: 'DISCOVERY-static-model',
      type: 'static-model',
      phase: 'discovery' as WorkflowPhase,
      stage: 'intent' as any,
      path: staticPath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });

    const dynamicPath = path.join(discoveryDir, 'dynamic-model.md');
    await fs.writeFile(dynamicPath, dynamicModel, 'utf8');

    registerArtifact(manifestPath, {
      id: 'DISCOVERY-dynamic-model',
      type: 'dynamic-model',
      phase: 'discovery' as WorkflowPhase,
      stage: 'intent' as any,
      path: dynamicPath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });
  } catch (err) {
    console.error('[brownfield-analysis] Error writing model artifacts:', err);
    throw new Error(
      `Failed to write brownfield model artifacts: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
