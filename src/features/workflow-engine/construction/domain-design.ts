import * as path from 'path';
import * as fs from 'fs-extra';
import { registerArtifact } from '../manifest.js';
import type { WorkflowPhase, UnitDefinition, UserStory } from '../phase-types.js';

export interface DomainDesignArtifact {
  entities: Array<{ name: string; attributes: string }>;
  valueObjects: Array<{ name: string; attributes: string }>;
  domainEvents: Array<{ name: string; payload: string }>;
  repositories: Array<{ name: string; methods: string }>;
  aggregates: Array<{ name: string; root: string; contains: string }>;
}

export function buildDomainDesignPrompt(
  unit: UnitDefinition,
  stories: UserStory[],
  intentText: string,
  depth: 'minimal' | 'standard' | 'comprehensive'
): string {
  const storiesSection = stories
    .map(
      (s) =>
        `### ${s.id}: ${s.title}\n${s.description}\n\n**Acceptance Criteria:**\n${s.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
    )
    .join('\n\n');

  const depthInstructions =
    depth === 'minimal'
      ? `Produce only the core DDD model sections:
- ## Entities — a markdown table with columns: Name | Attributes
- ## Repositories — a markdown table with columns: Name | Methods

Keep each section concise. Omit value objects, domain events, and aggregates.`
      : depth === 'standard'
      ? `Produce the following DDD model sections:
- ## Entities — a markdown table with columns: Name | Attributes
- ## Value Objects — a markdown table with columns: Name | Attributes
- ## Repositories — a markdown table with columns: Name | Methods
- ## Aggregates — a markdown table with columns: Name | Root | Contains

Include meaningful domain concepts. Omit domain events.`
      : `Produce a comprehensive DDD model with all five sections:
- ## Entities — a markdown table with columns: Name | Attributes
- ## Value Objects — a markdown table with columns: Name | Attributes
- ## Domain Events — a markdown table with columns: Name | Payload
- ## Repositories — a markdown table with columns: Name | Methods
- ## Aggregates — a markdown table with columns: Name | Root | Contains

Be thorough. Include all relevant domain concepts, bounded context boundaries,
aggregate roots, invariants, and event-driven interactions.`;

  return `# Domain Design for Unit: ${unit.name}

## Unit Overview
**ID:** ${unit.id}
**Description:** ${unit.description}
**Scope:** ${unit.scope}

## Intent Context
${intentText}

## User Stories
${storiesSection}

## Task
Analyse the unit definition, user stories, and intent above. ${depthInstructions}

Format each section as a standard markdown table. Use clear, domain-specific names.
Do not include code or implementation details — this is a pure domain model.`;
}

export function parseDomainDesignResponse(response: string): DomainDesignArtifact {
  return {
    entities: parseSection(response, 'Entities', ['name', 'attributes']),
    valueObjects: parseSection(response, 'Value Objects', ['name', 'attributes']),
    domainEvents: parseSection(response, 'Domain Events', ['name', 'payload']),
    repositories: parseSection(response, 'Repositories', ['name', 'methods']),
    aggregates: parseSection(response, 'Aggregates', ['name', 'root', 'contains']),
  } as DomainDesignArtifact;
}

function parseSection<T extends Record<string, string>>(
  text: string,
  heading: string,
  keys: (keyof T)[]
): T[] {
  try {
    // Regex: match from ## {heading} up to next ## heading or end-of-string
    const sectionRegex = new RegExp(
      `##\\s+${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`,
      'i'
    );
    const sectionMatch = sectionRegex.exec(text);
    if (!sectionMatch) return [];

    const sectionText = sectionMatch[1];
    const rows: T[] = [];

    const lines = sectionText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('|'));

    let dataStarted = false;
    for (const line of lines) {
      if (/^\|[\s\-|]+\|$/.test(line)) {
        dataStarted = true;
        continue;
      }
      if (!dataStarted) continue;

      const cells = line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());

      if (cells.length < keys.length) continue;

      const row = {} as T;
      for (let i = 0; i < keys.length; i++) {
        (row as Record<string, string>)[keys[i] as string] = cells[i] ?? '';
      }
      rows.push(row);
    }

    return rows;
  } catch {
    return [];
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function writeDomainDesignArtifact(
  projectPath: string,
  workflowId: string,
  unitName: string,
  artifact: DomainDesignArtifact
): Promise<string> {
  try {
    const safeName = sanitizeName(unitName);
    const outputDir = path.join(
      projectPath,
      'aidlc-docs',
      workflowId,
      'design',
      'artifacts',
      safeName
    );

    await fs.ensureDir(outputDir);

    const filePath = path.join(outputDir, 'domain-design.md');
    await fs.writeFile(filePath, buildDomainDesignMarkdown(unitName, artifact), 'utf8');

    const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
    registerArtifact(manifestPath, {
      id: `CONSTRUCTION-${safeName}-domain-design`,
      type: 'DOMAIN_DESIGN',
      phase: 'construction' as WorkflowPhase,
      stage: 'unit' as any,
      path: filePath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });

    return filePath;
  } catch (error) {
    console.error(`Failed to write domain design artifact for unit '${unitName}':`, error);
    throw error;
  }
}

function buildDomainDesignMarkdown(unitName: string, artifact: DomainDesignArtifact): string {
  const sections: string[] = [
    `# Domain Design: ${unitName}`,
    '',
    `_Generated: ${new Date().toISOString()}_`,
    '',
  ];

  sections.push('## Entities');
  if (artifact.entities.length > 0) {
    sections.push('| Name | Attributes |', '| --- | --- |');
    for (const e of artifact.entities) sections.push(`| ${e.name} | ${e.attributes} |`);
  } else {
    sections.push('_No entities defined._');
  }
  sections.push('');

  sections.push('## Value Objects');
  if (artifact.valueObjects.length > 0) {
    sections.push('| Name | Attributes |', '| --- | --- |');
    for (const v of artifact.valueObjects) sections.push(`| ${v.name} | ${v.attributes} |`);
  } else {
    sections.push('_No value objects defined._');
  }
  sections.push('');

  sections.push('## Domain Events');
  if (artifact.domainEvents.length > 0) {
    sections.push('| Name | Payload |', '| --- | --- |');
    for (const d of artifact.domainEvents) sections.push(`| ${d.name} | ${d.payload} |`);
  } else {
    sections.push('_No domain events defined._');
  }
  sections.push('');

  sections.push('## Repositories');
  if (artifact.repositories.length > 0) {
    sections.push('| Name | Methods |', '| --- | --- |');
    for (const r of artifact.repositories) sections.push(`| ${r.name} | ${r.methods} |`);
  } else {
    sections.push('_No repositories defined._');
  }
  sections.push('');

  sections.push('## Aggregates');
  if (artifact.aggregates.length > 0) {
    sections.push('| Name | Root | Contains |', '| --- | --- | --- |');
    for (const a of artifact.aggregates) sections.push(`| ${a.name} | ${a.root} | ${a.contains} |`);
  } else {
    sections.push('_No aggregates defined._');
  }
  sections.push('');

  return sections.join('\n');
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}
