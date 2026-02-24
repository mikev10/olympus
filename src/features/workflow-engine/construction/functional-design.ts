import * as path from 'path';
import * as fs from 'fs-extra';
import { registerArtifact } from '../manifest.js';
import type { WorkflowPhase, UnitDefinition, UserStory } from '../phase-types.js';

export interface FunctionalDesignArtifacts {
  businessLogicModel: string;
  businessRules: string;
  domainEntities: string;
}

export function buildFunctionalDesignPrompt(
  unit: UnitDefinition,
  stories: UserStory[],
  domainDesign: string
): string {
  const storiesSection = stories
    .map(
      (s) =>
        `### ${s.id}: ${s.title}\n${s.description}\n\n**Acceptance Criteria:**\n${s.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
    )
    .join('\n\n');

  return `# Functional Design for Unit: ${unit.name}

## Unit Overview
**ID:** ${unit.id}
**Description:** ${unit.description}
**Scope:** ${unit.scope}

## Domain Design Reference
${domainDesign}

## User Stories
${storiesSection}

## Task
Using the domain design and user stories above, produce a functional design with three sections:

### Business Logic Model
Describe the core business logic flows, use case sequences, and decision points for this unit.
Format as numbered steps or flow descriptions per use case.

### Business Rules
List all business rules, constraints, and invariants that govern this unit's behaviour.
Format as a numbered list with each rule clearly stated.

### Domain Entities
Describe how the domain entities interact within the business logic. Include state transitions,
lifecycle events, and entity relationships relevant to the use cases.
Format as prose or structured descriptions per entity.

Return each section under its exact heading as shown above.`;
}

export function parseFunctionalDesignResponse(response: string): FunctionalDesignArtifacts {
  return {
    businessLogicModel: extractSection(response, 'Business Logic Model'),
    businessRules: extractSection(response, 'Business Rules'),
    domainEntities: extractSection(response, 'Domain Entities'),
  };
}

function extractSection(text: string, heading: string): string {
  try {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Regex: match content under ### {heading} up to next ### heading or end-of-string
    const match = new RegExp(`###\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n###|$)`, 'i').exec(text);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

export async function writeFunctionalDesignArtifacts(
  projectPath: string,
  workflowId: string,
  unitName: string,
  artifacts: FunctionalDesignArtifacts
): Promise<string[]> {
  try {
    const safeName = sanitizeName(unitName);
    const outputDir = path.join(
      projectPath,
      'aidlc-docs',
      workflowId,
      'construction',
      safeName,
      'functional-design'
    );

    await fs.ensureDir(outputDir);

    const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
    const written: string[] = [];

    const files: Array<{ filename: string; content: string; id: string; type: string }> = [
      {
        filename: 'business-logic-model.md',
        content: `# Business Logic Model: ${unitName}\n\n${artifacts.businessLogicModel}\n`,
        id: `CONSTRUCTION-${safeName}-business-logic-model`,
        type: 'FUNCTIONAL_DESIGN_BUSINESS_LOGIC',
      },
      {
        filename: 'business-rules.md',
        content: `# Business Rules: ${unitName}\n\n${artifacts.businessRules}\n`,
        id: `CONSTRUCTION-${safeName}-business-rules`,
        type: 'FUNCTIONAL_DESIGN_BUSINESS_RULES',
      },
      {
        filename: 'domain-entities.md',
        content: `# Domain Entities: ${unitName}\n\n${artifacts.domainEntities}\n`,
        id: `CONSTRUCTION-${safeName}-domain-entities`,
        type: 'FUNCTIONAL_DESIGN_DOMAIN_ENTITIES',
      },
    ];

    for (const file of files) {
      const filePath = path.join(outputDir, file.filename);
      await fs.writeFile(filePath, file.content, 'utf8');
      registerArtifact(manifestPath, {
        id: file.id,
        type: file.type,
        phase: 'construction' as WorkflowPhase,
        stage: 'unit' as any,
        path: filePath,
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });
      written.push(filePath);
    }

    return written;
  } catch (error) {
    console.error(`Failed to write functional design artifacts for unit '${unitName}':`, error);
    throw error;
  }
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}
