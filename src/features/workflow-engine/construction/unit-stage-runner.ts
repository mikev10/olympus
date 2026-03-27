import fs from 'fs-extra';
import path from 'path';
import type { ConstructionDesignStage, ConstructionUnitProgress } from '../phase-types.js';
import { executeNFRRequirementsStage } from './nfr-requirements.js';

export type ConstructionDepth = 'SHALLOW' | 'MEDIUM' | 'DEEP';

const DEPTH_STAGES: Record<ConstructionDepth, ConstructionDesignStage[]> = {
  SHALLOW: [],
  MEDIUM: ['functional-design', 'nfr-requirements'],
  DEEP: ['functional-design', 'nfr-requirements', 'nfr-design', 'infrastructure-design'],
};

export class UnitStageRunner {
  private projectPath: string;
  private workflowId: string;

  constructor(projectPath: string, workflowId: string) {
    this.projectPath = projectPath;
    this.workflowId = workflowId;
  }

  /**
   * Execute per-unit design stages based on depth assessment.
   * SHALLOW = 0 stages, MEDIUM = 2 stages, DEEP = 4 stages.
   */
  async executeForUnit(
    unitId: string,
    depth: ConstructionDepth,
    intentContent: string,
    nfrContent?: string,
    onProgress?: (unitId: string, progress: ConstructionUnitProgress) => Promise<void>
  ): Promise<ConstructionUnitProgress> {
    const stages = DEPTH_STAGES[depth];
    const unitDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'construction', unitId);

    const allStages: ConstructionDesignStage[] = [
      'functional-design', 'nfr-requirements',
      'nfr-design', 'infrastructure-design', 'code-generation', 'test-generation'
    ];

    const progress: ConstructionUnitProgress = {
      unitId,
      stages: {} as Record<ConstructionDesignStage, { status: 'not_started' | 'in_progress' | 'completed' | 'skipped' | 'failed'; artifact_path: string | null; completed_at: string | null; failure_count: number; last_error: string | null }>,
      code_plan_path: null,
      code_generation_status: 'not_started',
    };

    for (const stage of allStages) {
      progress.stages[stage] = {
        status: stages.includes(stage) ? 'not_started' : 'skipped',
        artifact_path: null,
        completed_at: null,
        failure_count: 0,
        last_error: null,
      };
    }

    if (stages.length === 0) {
      console.log(`[UnitStageRunner] SHALLOW depth: skipping all design stages for ${unitId}`);
      return progress;
    }

    console.log(`[UnitStageRunner] Running ${stages.length} design stages for ${unitId} (${depth})`);

    let unitSpec = '';
    try {
      const specPath = path.join(unitDir, 'spec.md');
      if (await fs.pathExists(specPath)) {
        unitSpec = await fs.readFile(specPath, 'utf-8');
      }
    } catch {
      // Best effort - spec may not exist yet
    }

    for (const stage of stages) {
      progress.stages[stage].status = 'in_progress';

      try {
        const artifactPath = await this.executeStage(stage, unitId, unitDir, unitSpec, intentContent, nfrContent);
        progress.stages[stage].status = 'completed';
        progress.stages[stage].artifact_path = artifactPath;
        progress.stages[stage].completed_at = new Date().toISOString();

        console.log(`[UnitStageRunner] ${unitId}/${stage} completed -> ${artifactPath}`);
        if (onProgress) {
          try { await onProgress(unitId, progress); } catch { /* best effort */ }
        }
      } catch (err) {
        progress.stages[stage].failure_count += 1;
        progress.stages[stage].last_error = err instanceof Error ? err.message : String(err);
        if (progress.stages[stage].failure_count >= 2) {
          progress.stages[stage].status = 'failed';
          console.error(`[UnitStageRunner] ${unitId}/${stage} failed after ${progress.stages[stage].failure_count} attempts — escalating`);
          if (onProgress) {
            try { await onProgress(unitId, progress); } catch { /* best effort */ }
          }
          break;
        } else {
          progress.stages[stage].status = 'not_started';
          console.warn(`[UnitStageRunner] ${unitId}/${stage} failed (attempt ${progress.stages[stage].failure_count}/2), will retry`);
        }
      }
    }

    await this.appendAudit(unitId, stages, progress);

    return progress;
  }

  private async executeStage(
    stage: ConstructionDesignStage,
    unitId: string,
    unitDir: string,
    unitSpec: string,
    intentContent: string,
    nfrContent?: string
  ): Promise<string> {
    await fs.ensureDir(unitDir);

    switch (stage) {
      case 'functional-design': {
        const artifactPath = path.join(unitDir, 'functional-design.md');
        const content = this.buildFunctionalDesignContent(unitId, unitSpec, intentContent);
        await fs.writeFile(artifactPath, content, 'utf-8');
        return artifactPath;
      }

      case 'nfr-requirements': {
        const result = await executeNFRRequirementsStage(this.projectPath, this.workflowId, unitId);
        return result.artifactPath;
      }

      case 'nfr-design': {
        const artifactPath = path.join(unitDir, 'nfr-design.md');
        const nfrReqPath = path.join(unitDir, 'nfr-requirements.md');
        let nfrReqContent = nfrContent || '';
        try {
          if (await fs.pathExists(nfrReqPath)) {
            nfrReqContent = await fs.readFile(nfrReqPath, 'utf-8');
          }
        } catch {
          // Use provided nfrContent as fallback
        }
        const content = this.buildNFRDesignContent(unitId, unitSpec, nfrReqContent);
        await fs.writeFile(artifactPath, content, 'utf-8');
        return artifactPath;
      }

      case 'infrastructure-design': {
        const artifactPath = path.join(unitDir, 'infrastructure-design.md');
        const nfrDesignPath = path.join(unitDir, 'nfr-design.md');
        let nfrDesignContent = '';
        try {
          if (await fs.pathExists(nfrDesignPath)) {
            nfrDesignContent = await fs.readFile(nfrDesignPath, 'utf-8');
          }
        } catch {
          // Best effort
        }
        const content = this.buildInfrastructureDesignContent(unitId, unitSpec, nfrDesignContent);
        await fs.writeFile(artifactPath, content, 'utf-8');
        return artifactPath;
      }

      default:
        throw new Error(`Stage '${stage}' not handled by UnitStageRunner`);
    }
  }

  private buildFunctionalDesignContent(unitId: string, unitSpec: string, intentContent: string): string {
    const titleMatch = unitSpec.match(/^title:\s*(.+)$/m);
    const unitTitle = titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, '') : unitId;
    const now = new Date().toISOString();

    return `---
id: ${unitId}-functional-design
parent_unit: ${unitId}
stage: functional-design
generated_at: ${now}
---

# Functional Design: ${unitTitle}

## Business Logic Model
Derived from intent and unit specification.

${this.extractSection(intentContent, 'Goal') || this.extractSection(unitSpec, 'Goal') || 'See intent.md for business logic context.'}

## Business Rules
Constraints and invariants governing this unit's behavior.

${this.extractSection(unitSpec, 'Acceptance Criteria') || '- See unit spec for acceptance criteria.'}

## Domain Entities
Entity interactions and state transitions relevant to this unit.

${this.extractSection(unitSpec, 'Scope & Responsibility') || 'See unit spec for scope details.'}
`;
  }

  private buildNFRDesignContent(unitId: string, unitSpec: string, nfrRequirements: string): string {
    const titleMatch = unitSpec.match(/^title:\s*(.+)$/m);
    const unitTitle = titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, '') : unitId;
    const now = new Date().toISOString();

    return `---
id: ${unitId}-nfr-design
parent_unit: ${unitId}
stage: nfr-design
generated_at: ${now}
---

# NFR Design: ${unitTitle}

## NFR Requirements Reference
${nfrRequirements || 'No NFR requirements available.'}

## Resilience Patterns
Fault tolerance strategies for this unit.

## Logical Components
Component definitions satisfying functional and non-functional requirements.
`;
  }

  private buildInfrastructureDesignContent(unitId: string, unitSpec: string, nfrDesign: string): string {
    const titleMatch = unitSpec.match(/^title:\s*(.+)$/m);
    const unitTitle = titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, '') : unitId;
    const now = new Date().toISOString();

    return `---
id: ${unitId}-infrastructure-design
parent_unit: ${unitId}
stage: infrastructure-design
generated_at: ${now}
---

# Infrastructure Design: ${unitTitle}

## NFR Design Reference
${nfrDesign || 'No NFR design available.'}

## Infrastructure Components
Infrastructure resource mapping for this unit.

## Deployment Architecture
Deployment topology and environment configuration.
`;
  }

  private extractSection(text: string, heading: string): string {
    try {
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i').exec(text);
      return match ? match[1].trim() : '';
    } catch {
      return '';
    }
  }

  private async appendAudit(
    unitId: string,
    stages: ConstructionDesignStage[],
    progress: ConstructionUnitProgress
  ): Promise<void> {
    try {
      const auditPath = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'audit.md');
      const now = new Date().toISOString();

      const completedStages = stages.filter(s => progress.stages[s]?.status === 'completed');
      const entry = `\n## ${unitId} Design Stages — ${now}\n\n` +
        completedStages.map(s => `- [x] ${s}: ${progress.stages[s].artifact_path}`).join('\n') +
        '\n';

      if (await fs.pathExists(auditPath)) {
        await fs.appendFile(auditPath, entry, 'utf-8');
      } else {
        await fs.writeFile(auditPath, `# Audit Trail\n${entry}`, 'utf-8');
      }
    } catch (err) {
      console.error(`[UnitStageRunner] Failed to update audit for ${unitId}:`, err);
    }
  }
}
