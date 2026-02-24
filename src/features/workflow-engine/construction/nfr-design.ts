import * as path from 'path';
import * as fs from 'fs-extra';
import { registerArtifact } from '../manifest.js';
import type { WorkflowPhase, UnitDefinition } from '../phase-types.js';

export interface LogicalDesignArtifact {
  nfrIntegration: string;
  architecturalPatterns: string;
  adrs: Array<{ id: string; title: string; content: string }>;
  logicalComponents: string;
}

export function buildNFRRequirementsPrompt(unit: UnitDefinition, functionalDesign: string): string {
  return `# NFR Requirements for Unit: ${unit.name}

## Unit Overview
**ID:** ${unit.id}
**Description:** ${unit.description}
**Scope:** ${unit.scope}

## Functional Design Reference
${functionalDesign}

## Task
Based on the functional design above, identify and document the non-functional requirements
for this unit across the following areas:

### Scalability
Describe throughput targets, horizontal/vertical scaling expectations, and load characteristics.

### Performance
Specify latency budgets, response time SLAs, and throughput benchmarks.

### Security
List authentication, authorisation, data protection, and compliance requirements.

### Tech Stack Decisions
Recommend technologies, frameworks, and libraries that best satisfy the NFRs above.
Justify each choice briefly.

Return each section under its exact heading as shown above.`;
}

export function buildNFRDesignPrompt(unit: UnitDefinition, nfrRequirements: string): string {
  return `# NFR Design for Unit: ${unit.name}

## Unit Overview
**ID:** ${unit.id}
**Description:** ${unit.description}
**Scope:** ${unit.scope}

## NFR Requirements Reference
${nfrRequirements}

## Task
Design the non-functional architecture for this unit based on the requirements above.

### Resilience Patterns
Describe fault tolerance strategies: circuit breakers, retries, bulkheads, timeouts,
fallback mechanisms, and chaos engineering considerations.

### Logical Components
Define the logical components of this unit — services, modules, adapters, ports —
and how they collaborate to satisfy both functional and non-functional requirements.
Include component responsibilities and inter-component contracts.

Return each section under its exact heading as shown above.`;
}

export function buildLogicalDesignPrompt(
  unit: UnitDefinition,
  domainDesign: string,
  nfrDesign: string
): string {
  return `# Logical Design for Unit: ${unit.name}

## Unit Overview
**ID:** ${unit.id}
**Description:** ${unit.description}
**Scope:** ${unit.scope}

## Domain Design Reference
${domainDesign}

## NFR Design Reference
${nfrDesign}

## Task
Synthesise the domain design and NFR design into a unified logical design.

### NFR Integration
Explain how the non-functional requirements are integrated into the domain model.
Show how each significant NFR affects the logical structure.

### Architectural Patterns
Identify the architectural patterns applied (e.g. CQRS, event sourcing, hexagonal,
saga, outbox). Justify why each pattern was chosen for this unit.

### Architecture Decision Records
For each significant decision, produce an ADR with the following structure:
**ADR-{n}: {Title}**
Context: ...
Decision: ...
Consequences: ...

### Logical Components
Provide a final, integrated view of the logical components after combining domain
design and NFR design. Show component interactions, data flows, and dependency
directions.

Return each section under its exact heading as shown above.`;
}

export function buildInfrastructureDesignPrompt(
  unit: UnitDefinition,
  logicalDesign: string
): string {
  return `# Infrastructure Design for Unit: ${unit.name}

## Unit Overview
**ID:** ${unit.id}
**Description:** ${unit.description}
**Scope:** ${unit.scope}

## Logical Design Reference
${logicalDesign}

## Task
Map the logical design to concrete infrastructure.

### Infrastructure Design
For each logical component, specify the infrastructure resource that will host it
(e.g. Kubernetes deployment, Lambda function, managed service). Include configuration
details relevant to NFR targets (instance sizes, auto-scaling policies, storage tiers).

### Deployment Architecture
Describe the deployment topology: environments (dev/staging/prod), network boundaries,
DNS, load balancers, CDN, secrets management, and CI/CD pipeline integration.
Include a textual diagram or structured description of the deployment graph.

Return each section under its exact heading as shown above.`;
}

export async function writeNFRRequirements(
  projectPath: string,
  workflowId: string,
  unitName: string,
  content: string
): Promise<string[]> {
  try {
    const safeName = sanitizeName(unitName);
    const outputDir = path.join(
      projectPath,
      'aidlc-docs',
      workflowId,
      'construction',
      safeName,
      'nfr-requirements'
    );
    await fs.ensureDir(outputDir);

    const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
    const written: string[] = [];

    const nfrPath = path.join(outputDir, 'nfr-requirements.md');
    await fs.writeFile(nfrPath, `# NFR Requirements: ${unitName}\n\n${content}\n`, 'utf8');
    registerArtifact(manifestPath, {
      id: `CONSTRUCTION-${safeName}-nfr-requirements`,
      type: 'NFR_REQUIREMENTS',
      phase: 'construction' as WorkflowPhase,
      stage: 'unit' as any,
      path: nfrPath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });
    written.push(nfrPath);

    const techStackContent = extractSection(content, 'Tech Stack Decisions');
    const techPath = path.join(outputDir, 'tech-stack-decisions.md');
    await fs.writeFile(
      techPath,
      `# Tech Stack Decisions: ${unitName}\n\n${techStackContent}\n`,
      'utf8'
    );
    registerArtifact(manifestPath, {
      id: `CONSTRUCTION-${safeName}-tech-stack-decisions`,
      type: 'TECH_STACK_DECISIONS',
      phase: 'construction' as WorkflowPhase,
      stage: 'unit' as any,
      path: techPath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });
    written.push(techPath);

    return written;
  } catch (error) {
    console.error(`Failed to write NFR requirements for unit '${unitName}':`, error);
    throw error;
  }
}

export async function writeNFRDesign(
  projectPath: string,
  workflowId: string,
  unitName: string,
  content: string
): Promise<string[]> {
  try {
    const safeName = sanitizeName(unitName);
    const outputDir = path.join(
      projectPath,
      'aidlc-docs',
      workflowId,
      'construction',
      safeName,
      'nfr-design'
    );
    await fs.ensureDir(outputDir);

    const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
    const written: string[] = [];

    const patternsContent = extractSection(content, 'Resilience Patterns');
    const patternsPath = path.join(outputDir, 'nfr-design-patterns.md');
    await fs.writeFile(
      patternsPath,
      `# NFR Design Patterns: ${unitName}\n\n${patternsContent}\n`,
      'utf8'
    );
    registerArtifact(manifestPath, {
      id: `CONSTRUCTION-${safeName}-nfr-design-patterns`,
      type: 'NFR_DESIGN_PATTERNS',
      phase: 'construction' as WorkflowPhase,
      stage: 'unit' as any,
      path: patternsPath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });
    written.push(patternsPath);

    const componentsContent = extractSection(content, 'Logical Components');
    const componentsPath = path.join(outputDir, 'logical-components.md');
    await fs.writeFile(
      componentsPath,
      `# Logical Components: ${unitName}\n\n${componentsContent}\n`,
      'utf8'
    );
    registerArtifact(manifestPath, {
      id: `CONSTRUCTION-${safeName}-nfr-logical-components`,
      type: 'NFR_LOGICAL_COMPONENTS',
      phase: 'construction' as WorkflowPhase,
      stage: 'unit' as any,
      path: componentsPath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });
    written.push(componentsPath);

    return written;
  } catch (error) {
    console.error(`Failed to write NFR design for unit '${unitName}':`, error);
    throw error;
  }
}

export async function writeLogicalDesignArtifact(
  projectPath: string,
  workflowId: string,
  unitName: string,
  artifact: LogicalDesignArtifact
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

    const filePath = path.join(outputDir, 'logical-design.md');
    await fs.writeFile(filePath, buildLogicalDesignMarkdown(unitName, artifact), 'utf8');

    const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
    registerArtifact(manifestPath, {
      id: `CONSTRUCTION-${safeName}-logical-design`,
      type: 'LOGICAL_DESIGN',
      phase: 'construction' as WorkflowPhase,
      stage: 'unit' as any,
      path: filePath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });

    return filePath;
  } catch (error) {
    console.error(`Failed to write logical design artifact for unit '${unitName}':`, error);
    throw error;
  }
}

export async function writeInfrastructureDesign(
  projectPath: string,
  workflowId: string,
  unitName: string,
  content: string
): Promise<string[]> {
  try {
    const safeName = sanitizeName(unitName);
    const outputDir = path.join(
      projectPath,
      'aidlc-docs',
      workflowId,
      'construction',
      safeName,
      'infrastructure-design'
    );
    await fs.ensureDir(outputDir);

    const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
    const written: string[] = [];

    const infraContent = extractSection(content, 'Infrastructure Design');
    const infraPath = path.join(outputDir, 'infrastructure-design.md');
    await fs.writeFile(
      infraPath,
      `# Infrastructure Design: ${unitName}\n\n${infraContent}\n`,
      'utf8'
    );
    registerArtifact(manifestPath, {
      id: `CONSTRUCTION-${safeName}-infrastructure-design`,
      type: 'INFRASTRUCTURE_DESIGN',
      phase: 'construction' as WorkflowPhase,
      stage: 'unit' as any,
      path: infraPath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });
    written.push(infraPath);

    const deployContent = extractSection(content, 'Deployment Architecture');
    const deployPath = path.join(outputDir, 'deployment-architecture.md');
    await fs.writeFile(
      deployPath,
      `# Deployment Architecture: ${unitName}\n\n${deployContent}\n`,
      'utf8'
    );
    registerArtifact(manifestPath, {
      id: `CONSTRUCTION-${safeName}-deployment-architecture`,
      type: 'DEPLOYMENT_ARCHITECTURE',
      phase: 'construction' as WorkflowPhase,
      stage: 'unit' as any,
      path: deployPath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });
    written.push(deployPath);

    return written;
  } catch (error) {
    console.error(`Failed to write infrastructure design for unit '${unitName}':`, error);
    throw error;
  }
}

function buildLogicalDesignMarkdown(unitName: string, artifact: LogicalDesignArtifact): string {
  const adrSection =
    artifact.adrs.length > 0
      ? artifact.adrs
          .map((adr) => `### ${adr.id}: ${adr.title}\n\n${adr.content}`)
          .join('\n\n')
      : '_No ADRs recorded._';

  return [
    `# Logical Design: ${unitName}`,
    '',
    `_Generated: ${new Date().toISOString()}_`,
    '',
    '## NFR Integration',
    '',
    artifact.nfrIntegration || '_Not specified._',
    '',
    '## Architectural Patterns',
    '',
    artifact.architecturalPatterns || '_Not specified._',
    '',
    '## Architecture Decision Records',
    '',
    adrSection,
    '',
    '## Logical Components',
    '',
    artifact.logicalComponents || '_Not specified._',
    '',
  ].join('\n');
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

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}
