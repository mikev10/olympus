/**
 * Forge Phase Executor
 *
 * Orchestrates the complete Forge phase execution: units → design → build.
 * This is the main entry point for the Forge stage of the ODLC methodology.
 *
 * Phase pipeline:
 * 1. UNITS stage: Parse intents, decompose to units, write UNIT-*.md, validate
 * 2. DESIGN stage: Generate interface contracts, DFDs, components, validate
 * 3. BUILD stage: Decompose units to bolts, write BOLT-*.md, validate
 */

import fs from 'fs-extra';
import path from 'path';
import type { ForgeStage, HierarchicalNode } from '../phase-types.js';
import type { ValidationResult } from '../types.js';
import {
  parseIntentsFromDisk,
  decomposeIntentToUnits,
  decomposeUnitToBolts,
  buildDecompositionTree,
} from './decomposition.js';
import type { DecompositionTree, UnitSpec, BoltSpec } from './decomposition.js';
import {
  generateInterfaceContracts,
  generateDataFlowDiagram,
  generateComponentDesign,
  validateDesign,
  writeDesignArtifacts,
} from './design.js';
import { validateUnits, validateBolt } from './validation.js';

/**
 * Agent map for Forge stages. v1: all stages use generic 'olympian' agent.
 * v2 follow-up: specialized unit-writer, design-writer, bolt-executor agents.
 */
export const FORGE_STAGE_AGENT_MAP: Record<ForgeStage, string> = {
  units: 'olympian',
  design: 'olympian',
  build: 'olympian',
};

/**
 * Progress tracking for Forge execution
 */
export interface ForgeProgress {
  current_stage: ForgeStage;
  units_total: number;
  units_complete: number;
  bolts_total: number;
  bolts_complete: number;
  design_complete: boolean;
  overall_percentage: number;
}

/**
 * ForgeExecutor orchestrates the full Forge phase of ODLC.
 *
 * The Forge phase takes INTENTs from the Vision phase and decomposes them into
 * executable work units:
 * - Units (architectural components)
 * - Design artifacts (interfaces, data flows, components)
 * - Bolts (atomic implementation tasks)
 *
 * @example
 * ```typescript
 * const executor = new ForgeExecutor('/path/to/project', 'user-auth-workflow');
 * const result = await executor.execute(specContent);
 * if (result.passed) {
 *   console.log('Forge phase complete!');
 * }
 * ```
 */
export class ForgeExecutor {
  private projectPath: string;
  private workflowId: string;
  private tree: DecompositionTree | null = null;
  private currentStage: ForgeStage = 'units';

  constructor(projectPath: string, workflowId: string) {
    this.projectPath = projectPath;
    this.workflowId = workflowId;
  }

  /**
   * Execute the full Forge phase: units → design → build.
   *
   * 1. Parse intents from Vision phase
   * 2. UNITS stage: Decompose intents into units, write UNIT-*.md files, validate
   * 3. DESIGN stage: Generate interface contracts, DFDs, components, validate
   * 4. BUILD stage: Decompose units into bolts, write BOLT-*.md files, validate
   *
   * @param specContent - SPEC artifact content for design validation
   * @returns ValidationResult with overall pass/fail and blocking issues
   */
  async execute(specContent?: string): Promise<ValidationResult> {
    console.log('[ForgeExecutor] Starting Forge phase execution');

    // Execute units stage
    this.currentStage = 'units';
    const unitsResult = await this.executeUnitsStage();
    if (!unitsResult.passed) {
      console.error('[ForgeExecutor] Units stage failed validation');
      return unitsResult;
    }
    console.log('[ForgeExecutor] Units stage complete');

    // Execute design stage
    this.currentStage = 'design';
    const designResult = await this.executeDesignStage(specContent);
    if (!designResult.passed) {
      console.error('[ForgeExecutor] Design stage failed validation');
      return designResult;
    }
    console.log('[ForgeExecutor] Design stage complete');

    // Execute build stage
    this.currentStage = 'build';
    const buildResult = await this.executeBuildStage();
    if (!buildResult.passed) {
      console.error('[ForgeExecutor] Build stage failed validation');
      return buildResult;
    }
    console.log('[ForgeExecutor] Build stage complete');

    // Return aggregate success result
    return {
      passed: true,
      coverage_percentage: 100,
      blocking_issues: [],
      reviewer: 'forge-executor',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get current progress of Forge execution.
   */
  getProgress(): ForgeProgress {
    let unitsTotal = 0;
    let unitsComplete = 0;
    let boltsTotal = 0;
    let boltsComplete = 0;

    if (this.tree) {
      for (const node of this.tree.nodes.values()) {
        if (node.type === 'unit') {
          unitsTotal++;
          if (node.status === 'complete') {
            unitsComplete++;
          }
        } else if (node.type === 'bolt') {
          boltsTotal++;
          if (node.status === 'complete') {
            boltsComplete++;
          }
        }
      }
    }

    // Calculate overall percentage based on stage
    let overallPercentage = 0;
    if (this.currentStage === 'units') {
      overallPercentage = unitsTotal > 0 ? Math.round((unitsComplete / unitsTotal) * 33) : 0;
    } else if (this.currentStage === 'design') {
      overallPercentage = 33 + 33; // Units complete + design in progress
    } else if (this.currentStage === 'build') {
      overallPercentage =
        66 + (boltsTotal > 0 ? Math.round((boltsComplete / boltsTotal) * 34) : 0);
    }

    return {
      current_stage: this.currentStage,
      units_total: unitsTotal,
      units_complete: unitsComplete,
      bolts_total: boltsTotal,
      bolts_complete: boltsComplete,
      design_complete: this.currentStage === 'build' || this.currentStage === 'design',
      overall_percentage: overallPercentage,
    };
  }

  /**
   * Execute the UNITS stage of Forge.
   *
   * 1. Parse intents from Vision phase
   * 2. Auto-generate unit specs (one unit per intent in v1)
   * 3. Decompose intents to units
   * 4. Write UNIT-*.md files to forge/units/
   * 5. Validate units
   *
   * @private
   */
  private async executeUnitsStage(): Promise<ValidationResult> {
    const intentsDir = path.join(this.projectPath, '.olympus', 'workflow', this.workflowId, 'intents');
    const unitsDir = path.join(this.projectPath, '.olympus', 'workflow', this.workflowId, 'forge', 'units');

    // Ensure units directory exists
    await fs.ensureDir(unitsDir);

    // Parse intents from disk
    const intents = await parseIntentsFromDisk(intentsDir);
    if (intents.length === 0) {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: ['No intents found in Vision phase'],
        reviewer: 'forge-executor',
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[ForgeExecutor] Found ${intents.length} intents to decompose`);

    // Decompose each intent into units
    const allUnits: HierarchicalNode[] = [];
    for (const intent of intents) {
      // v1: Auto-generate one unit per intent
      const unitSpecs: UnitSpec[] = [
        {
          title: intent.title,
          estimated_effort: intent.estimated_effort,
          description: `Implementation unit for ${intent.title}`,
        },
      ];

      const units = decomposeIntentToUnits(intent, unitSpecs);
      allUnits.push(...units);

      // Write unit files
      for (const unit of units) {
        const unitFilePath = path.join(unitsDir, `${unit.id}.md`);
        const unitContent = this.formatUnitMarkdown(unit, intent.id);
        await fs.writeFile(unitFilePath, unitContent, 'utf-8');
      }
    }

    console.log(`[ForgeExecutor] Created ${allUnits.length} units`);

    // Build decomposition tree
    this.tree = buildDecompositionTree(intents);
    // Add units to tree
    for (const unit of allUnits) {
      this.tree.nodes.set(unit.id, unit);
    }

    // Validate units
    const validationResult = await validateUnits(unitsDir, intentsDir);
    return validationResult;
  }

  /**
   * Execute the DESIGN stage of Forge.
   *
   * 1. Read units from disk
   * 2. Generate interface contracts
   * 3. Generate data flow diagrams
   * 4. Generate component designs
   * 5. Write design artifacts to forge/design/
   * 6. Validate design artifacts
   *
   * @private
   */
  private async executeDesignStage(specContent?: string): Promise<ValidationResult> {
    const unitsDir = path.join(this.projectPath, '.olympus', 'workflow', this.workflowId, 'forge', 'units');

    // Read units from disk
    const unitFiles = await fs.readdir(unitsDir);
    const units: HierarchicalNode[] = [];

    for (const file of unitFiles) {
      if (!file.startsWith('UNIT-') || !file.endsWith('.md')) {
        continue;
      }

      const filePath = path.join(unitsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const unit = this.parseUnitFromMarkdown(content, file.replace('.md', ''));
      if (unit) {
        units.push(unit);
      }
    }

    if (units.length === 0) {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: ['No units found to generate design artifacts'],
        reviewer: 'forge-executor',
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[ForgeExecutor] Generating design artifacts for ${units.length} units`);

    // Generate design artifacts
    const interfaces = generateInterfaceContracts(units, specContent || '');
    const dataFlows = generateDataFlowDiagram(units, interfaces);
    const components = generateComponentDesign(units, interfaces, dataFlows);

    // Write design artifacts
    await writeDesignArtifacts(this.projectPath, this.workflowId, {
      interfaces,
      dataFlows,
      components,
    });

    // Validate design
    if (specContent) {
      const validationResult = validateDesign(
        {
          interfaces,
          dataFlows,
          components,
        },
        specContent
      );
      return validationResult;
    }

    // No spec provided, return passing result
    return {
      passed: true,
      coverage_percentage: 100,
      blocking_issues: [],
      reviewer: 'forge-executor',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Execute the BUILD stage of Forge.
   *
   * 1. For each unit in the tree, auto-generate bolt specs
   * 2. Decompose units to bolts
   * 3. Write BOLT-*.md files to forge/bolts/
   * 4. Validate each bolt
   *
   * @private
   */
  private async executeBuildStage(): Promise<ValidationResult> {
    const unitsDir = path.join(this.projectPath, '.olympus', 'workflow', this.workflowId, 'forge', 'units');
    const boltsDir = path.join(this.projectPath, '.olympus', 'workflow', this.workflowId, 'forge', 'bolts');

    // Ensure bolts directory exists
    await fs.ensureDir(boltsDir);

    // Read units from disk
    const unitFiles = await fs.readdir(unitsDir);
    const units: HierarchicalNode[] = [];

    for (const file of unitFiles) {
      if (!file.startsWith('UNIT-') || !file.endsWith('.md')) {
        continue;
      }

      const filePath = path.join(unitsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const unit = this.parseUnitFromMarkdown(content, file.replace('.md', ''));
      if (unit) {
        units.push(unit);
      }
    }

    if (units.length === 0) {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: ['No units found to decompose into bolts'],
        reviewer: 'forge-executor',
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[ForgeExecutor] Decomposing ${units.length} units into bolts`);

    // Decompose each unit into bolts
    const allBolts: HierarchicalNode[] = [];
    const blockingIssues: string[] = [];

    for (const unit of units) {
      // v1: Auto-generate one bolt per unit
      const boltSpecs: BoltSpec[] = [
        {
          title: unit.title,
          estimated_effort: unit.estimated_effort,
          description: `Implementation bolt for ${unit.title}`,
        },
      ];

      const bolts = decomposeUnitToBolts(unit, boltSpecs);
      allBolts.push(...bolts);

      // Write bolt files
      for (const bolt of bolts) {
        const boltFilePath = path.join(boltsDir, `${bolt.id}.md`);
        const boltContent = this.formatBoltMarkdown(bolt, unit.id);
        await fs.writeFile(boltFilePath, boltContent, 'utf-8');

        // Validate bolt
        const boltResult = await validateBolt(boltFilePath);
        if (!boltResult.passed) {
          blockingIssues.push(`${bolt.id}: ${boltResult.blocking_issues.join(', ')}`);
        }
      }

      // Update tree
      if (this.tree) {
        for (const bolt of bolts) {
          this.tree.nodes.set(bolt.id, bolt);
        }
      }
    }

    console.log(`[ForgeExecutor] Created ${allBolts.length} bolts`);

    // Return validation result
    return {
      passed: blockingIssues.length === 0,
      coverage_percentage: blockingIssues.length === 0 ? 100 : 0,
      blocking_issues: blockingIssues,
      reviewer: 'forge-executor',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Format a unit as a markdown file with frontmatter.
   *
   * @private
   */
  private formatUnitMarkdown(unit: HierarchicalNode, parentIntentId: string): string {
    return `---
id: ${unit.id}
title: ${unit.title}
parent_intent: ${parentIntentId}
status: ${unit.status}
estimated_effort: ${unit.estimated_effort}
---

## Goal

${unit.title}

## Acceptance Criteria

- [ ] Unit implementation complete
- [ ] Tests passing

## Implementation Notes

Implementation details for ${unit.title}.
`;
  }

  /**
   * Format a bolt as a markdown file with frontmatter.
   *
   * @private
   */
  private formatBoltMarkdown(bolt: HierarchicalNode, parentUnitId: string): string {
    return `---
id: ${bolt.id}
title: ${bolt.title}
parent_unit: ${parentUnitId}
status: ${bolt.status}
estimated_effort: ${bolt.estimated_effort}
---

## Goal

${bolt.title}

## Implementation Steps

- Implement ${bolt.title}
- Write tests

## Acceptance Criteria

- [ ] Implementation complete
- [ ] Tests passing
`;
  }

  /**
   * Parse a unit from markdown content.
   *
   * @private
   */
  private parseUnitFromMarkdown(content: string, unitId: string): HierarchicalNode | null {
    try {
      // Parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        return null;
      }

      const frontmatter = frontmatterMatch[1];
      const lines = frontmatter.split('\n');
      const metadata: Record<string, any> = {};

      for (const line of lines) {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
          const [, key, value] = match;
          if (!isNaN(Number(value))) {
            metadata[key] = Number(value);
          } else {
            metadata[key] = value.trim();
          }
        }
      }

      return {
        id: unitId,
        type: 'unit',
        title: metadata.title || 'Untitled Unit',
        parent_id: metadata.parent_intent || null,
        children_ids: [],
        status: metadata.status || 'pending',
        assigned_agent: metadata.assigned_agent || null,
        estimated_effort: metadata.estimated_effort || 0,
      };
    } catch (error) {
      console.error(`Failed to parse unit from markdown:`, error);
      return null;
    }
  }
}
