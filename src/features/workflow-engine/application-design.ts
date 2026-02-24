import * as path from 'path';
import * as fs from 'fs-extra';
import { registerArtifact } from './manifest.js';
import type { WorkflowPhase } from './phase-types.js';

export interface ComponentDefinition {
  name: string;
  type: 'ui' | 'service' | 'data' | 'infrastructure' | 'shared';
  responsibility: string;
  publicMethods: string[];
}

export interface ServiceDefinition {
  name: string;
  endpoints: string[];
  dependencies: string[];
}

export interface ComponentDependency {
  source: string;
  target: string;
  type: 'uses' | 'depends-on' | 'implements' | 'extends';
}

export interface ApplicationDesignArtifacts {
  components: ComponentDefinition[];
  services: ServiceDefinition[];
  dependencies: ComponentDependency[];
}

export const APPLICATION_DESIGN_FORMAT_INSTRUCTIONS = `An Application Design document must contain these markdown sections:

## Components
| Name | Type | Responsibility | Public Methods |
|------|------|----------------|----------------|
(one row per component; Type must be one of: ui, service, data, infrastructure, shared;
 Public Methods is a comma-separated list of high-level method signatures)

## Services
| Name | Endpoints | Dependencies |
|------|-----------|--------------|
(one row per service; Endpoints and Dependencies are comma-separated lists)

## Component Dependencies
- SourceComponent -> TargetComponent (type)
(one edge per line; type must be one of: uses, depends-on, implements, extends)

## Component Methods
### ComponentName
- methodName(params): returnType — brief description
(one sub-section per component; list every public method with a one-line description)`;

export function buildApplicationDesignPrompt(
  intentContent: string,
  stories: string,
  requirements: string
): string {
  return `You are producing a HIGH-LEVEL Application Design for the feature described below.

This is the Application Design stage of the Inception phase. Focus on component identification,
service boundaries, and inter-component relationships. Detailed implementation logic is intentionally
deferred to Functional Design in the Construction phase — do NOT include algorithm internals,
database schemas, or implementation details here.

## Feature Intent
${intentContent}

## User Stories
${stories}

## Requirements
${requirements}

---

Based on the above context, produce an Application Design document.

Your output must define:
1. **Components** — name, architectural type (ui | service | data | infrastructure | shared),
   single-sentence responsibility, and comma-separated list of high-level public method signatures.
2. **Services** — service name, REST/RPC endpoint paths (comma-separated), and runtime dependencies
   (comma-separated component or service names).
3. **Component Dependencies** — directed edges showing which components call or depend on others.
4. **Component Methods** — one subsection per component listing each public method with a one-line
   description. Signatures should be high-level (e.g. \`fetchUser(id: string): Promise<User>\`);
   no implementation details.

${APPLICATION_DESIGN_FORMAT_INSTRUCTIONS}

Be precise and concise. Every component in the Components table must appear in the Component Methods
section. Dependency types must be exactly one of: uses, depends-on, implements, extends.`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSection(markdown: string, sectionTitle: string): string {
  const pattern = new RegExp(
    `##\\s+${escapeRegex(sectionTitle)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    'i'
  );
  const m = pattern.exec(markdown);
  return m ? m[1].trim() : '';
}

function parseTableRows(text: string): string[][] {
  const rows: string[][] = [];
  let headerSkipped = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|[\s\-|]+\|$/.test(trimmed)) {
      headerSkipped = true;
      continue;
    }
    if (!headerSkipped) continue;
    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map(c => c.trim());
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

const VALID_COMPONENT_TYPES = new Set(['ui', 'service', 'data', 'infrastructure', 'shared']);
const VALID_DEP_TYPES = new Set(['uses', 'depends-on', 'implements', 'extends']);

function normalizeComponentType(raw: string): ComponentDefinition['type'] {
  const lower = raw.toLowerCase().trim();
  return VALID_COMPONENT_TYPES.has(lower)
    ? (lower as ComponentDefinition['type'])
    : 'shared';
}

function normalizeDependencyType(raw: string): ComponentDependency['type'] {
  const lower = raw.toLowerCase().trim();
  return VALID_DEP_TYPES.has(lower)
    ? (lower as ComponentDependency['type'])
    : 'uses';
}

export function parseApplicationDesignResponse(response: string): ApplicationDesignArtifacts {
  const artifacts: ApplicationDesignArtifacts = {
    components: [],
    services: [],
    dependencies: [],
  };

  try {
    const componentsSection = extractSection(response, 'Components');
    for (const row of parseTableRows(componentsSection)) {
      if (row.length >= 4) {
        const publicMethods = row[3]
          .split(',')
          .map(m => m.trim())
          .filter(m => m.length > 0);
        artifacts.components.push({
          name: row[0],
          type: normalizeComponentType(row[1]),
          responsibility: row[2],
          publicMethods,
        });
      }
    }
  } catch (err) {
    console.error('[application-design] Error parsing Components section:', err);
  }

  try {
    const servicesSection = extractSection(response, 'Services');
    for (const row of parseTableRows(servicesSection)) {
      if (row.length >= 3) {
        const endpoints = row[1]
          .split(',')
          .map(e => e.trim())
          .filter(e => e.length > 0);
        const dependencies = row[2]
          .split(',')
          .map(d => d.trim())
          .filter(d => d.length > 0);
        artifacts.services.push({
          name: row[0],
          endpoints,
          dependencies,
        });
      }
    }
  } catch (err) {
    console.error('[application-design] Error parsing Services section:', err);
  }

  try {
    const depSection = extractSection(response, 'Component Dependencies');
    for (const line of depSection.split('\n')) {
      // Regex: "- Source -> Target (type)" — captures name, name, and parenthesized type token
      const m = /^[-*]\s+(.+?)\s*->\s*(.+?)\s+\((.+?)\)\s*$/.exec(line.trim());
      if (m) {
        artifacts.dependencies.push({
          source: m[1].trim(),
          target: m[2].trim(),
          type: normalizeDependencyType(m[3]),
        });
      }
    }
  } catch (err) {
    console.error('[application-design] Error parsing Component Dependencies section:', err);
  }

  return artifacts;
}

function buildComponentsMarkdown(components: ComponentDefinition[]): string {
  const header = `# Application Design — Components\n\n`;
  if (components.length === 0) {
    return `${header}(no components defined)\n`;
  }
  const tableHeader = `| Name | Type | Responsibility | Public Methods |\n|------|------|----------------|----------------|\n`;
  const rows = components
    .map(c => `| ${c.name} | ${c.type} | ${c.responsibility} | ${c.publicMethods.join(', ')} |`)
    .join('\n');
  return `${header}${tableHeader}${rows}\n`;
}

function buildComponentMethodsMarkdown(components: ComponentDefinition[]): string {
  const lines: string[] = ['# Application Design — Component Methods\n'];
  if (components.length === 0) {
    lines.push('(no components defined)');
    return lines.join('\n') + '\n';
  }
  for (const component of components) {
    lines.push(`## ${component.name}\n`);
    if (component.publicMethods.length === 0) {
      lines.push('(no public methods defined)\n');
    } else {
      for (const method of component.publicMethods) {
        lines.push(`- ${method}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}

function buildServicesMarkdown(services: ServiceDefinition[]): string {
  const header = `# Application Design — Services\n\n`;
  if (services.length === 0) {
    return `${header}(no services defined)\n`;
  }
  const tableHeader = `| Name | Endpoints | Dependencies |\n|------|-----------|-------------- |\n`;
  const rows = services
    .map(s => `| ${s.name} | ${s.endpoints.join(', ')} | ${s.dependencies.join(', ')} |`)
    .join('\n');
  return `${header}${tableHeader}${rows}\n`;
}

function buildDependencyMarkdown(dependencies: ComponentDependency[]): string {
  const lines: string[] = ['# Application Design — Component Dependencies\n'];

  if (dependencies.length === 0) {
    lines.push('(no dependencies defined)\n');
    return lines.join('\n');
  }

  lines.push('## Dependency List\n');
  for (const dep of dependencies) {
    lines.push(`- ${dep.source} -> ${dep.target} (${dep.type})`);
  }

  lines.push('\n## Dependency Diagram\n');
  lines.push('```mermaid');
  lines.push('graph TD');
  for (const dep of dependencies) {
    const edgeLabel = dep.type === 'uses' ? '--uses-->' : `--${dep.type}-->`;
    // Mermaid node IDs cannot contain spaces or hyphens — replace with underscores
    const src = dep.source.replace(/[\s\-]/g, '_');
    const tgt = dep.target.replace(/[\s\-]/g, '_');
    lines.push(`  ${src}["${dep.source}"] ${edgeLabel} ${tgt}["${dep.target}"]`);
  }
  lines.push('```\n');

  return lines.join('\n');
}

export async function writeApplicationDesignArtifacts(
  projectPath: string,
  workflowId: string,
  artifacts: ApplicationDesignArtifacts
): Promise<string[]> {
  const outputDir = path.join(
    projectPath,
    'aidlc-docs',
    workflowId,
    'inception',
    'application-design'
  );

  await fs.ensureDir(outputDir);

  const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
  const written: string[] = [];

  const componentsPath = path.join(outputDir, 'components.md');
  await fs.writeFile(componentsPath, buildComponentsMarkdown(artifacts.components), 'utf8');
  registerArtifact(manifestPath, {
    id: 'INCEPTION-app-design-components',
    type: 'APP_DESIGN_COMPONENTS',
    phase: 'inception' as WorkflowPhase,
    stage: 'intent' as any,
    path: componentsPath,
    validation_passed: null,
    write_complete: true,
    checksum: null,
  });
  written.push(componentsPath);

  const methodsPath = path.join(outputDir, 'component-methods.md');
  await fs.writeFile(methodsPath, buildComponentMethodsMarkdown(artifacts.components), 'utf8');
  registerArtifact(manifestPath, {
    id: 'INCEPTION-app-design-methods',
    type: 'APP_DESIGN_METHODS',
    phase: 'inception' as WorkflowPhase,
    stage: 'intent' as any,
    path: methodsPath,
    validation_passed: null,
    write_complete: true,
    checksum: null,
  });
  written.push(methodsPath);

  const servicesPath = path.join(outputDir, 'services.md');
  await fs.writeFile(servicesPath, buildServicesMarkdown(artifacts.services), 'utf8');
  registerArtifact(manifestPath, {
    id: 'INCEPTION-app-design-services',
    type: 'APP_DESIGN_SERVICES',
    phase: 'inception' as WorkflowPhase,
    stage: 'intent' as any,
    path: servicesPath,
    validation_passed: null,
    write_complete: true,
    checksum: null,
  });
  written.push(servicesPath);

  const dependencyPath = path.join(outputDir, 'component-dependency.md');
  await fs.writeFile(dependencyPath, buildDependencyMarkdown(artifacts.dependencies), 'utf8');
  registerArtifact(manifestPath, {
    id: 'INCEPTION-app-design-dependencies',
    type: 'APP_DESIGN_DEPENDENCIES',
    phase: 'inception' as WorkflowPhase,
    stage: 'intent' as any,
    path: dependencyPath,
    validation_passed: null,
    write_complete: true,
    checksum: null,
  });
  written.push(dependencyPath);

  return written;
}
