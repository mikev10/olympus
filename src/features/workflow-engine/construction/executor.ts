/**
 * Construction Phase Executor
 *
 * Orchestrates the complete Construction phase execution with a 2-phase pipeline:
 * 1. Decomposition phase: Parse intent.md, generate UNIT specs, generate BOLT specs per UNIT
 * 2. Design phase: Generate design artifacts (interfaces.json, data-flow.json, components.json)
 *
 * This is the main entry point for the Construction stage of the ODLC methodology.
 *
 * Supports three depth modes:
 * - SHALLOW: Single BOLT directly from INTENT, no UNITs or design
 * - MEDIUM: Full decomposition + design (default)
 * - DEEP: Full decomposition + design (same as MEDIUM in v1)
 */

import fs from 'fs-extra';
import path from 'path';
import type { HierarchicalNode } from '../phase-types.js';
import type { ValidationResult } from '../types.js';

type ConstructionStage = 'unit' | 'bolt' | 'design';

import {
  parseIntentsFromDisk,
  parseIntentFromFile,
  decomposeIntentToUnits,
  decomposeUnitToBolts,
  enforceGlobalBoltLimit,
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
import { runDualValidation } from '../alignment.js';
import { registerArtifact, linkArtifacts } from '../manifest.js';
import type { ArtifactLink } from '../phase-types.js';

/**
 * Agent map for Construction stages. v1: all stages use generic 'olympian' agent.
 * v2 follow-up: specialized unit-writer, design-writer, bolt-executor agents.
 */
export const CONSTRUCTION_STAGE_AGENT_MAP: Record<ConstructionStage, string> = {
  unit: 'olympian',
  bolt: 'olympian',
  design: 'olympian',
};


/**
 * Options for controlling Construction phase execution.
 */
export interface ConstructionOptions {
  /** Decomposition depth: SHALLOW skips UNITs, MEDIUM/DEEP run full pipeline */
  depth?: 'SHALLOW' | 'MEDIUM' | 'DEEP';
  /** Maximum number of UNITs to generate (default 10) */
  max_units?: number;
  /** Maximum BOLTs per UNIT (default 8) */
  max_bolts_per_unit?: number;
  /** Maximum total BOLTs across all UNITs (default 50) */
  max_total_bolts?: number;
  /** Current checkpoint status - blocks if 'awaiting_dev_review' */
  checkpointStatus?: string;
  /** Optional callback invoked after successful decomposition for checkpoint persistence */
  onCheckpointSave?: () => Promise<void>;
}

/**
 * Progress tracking for Construction execution
 */
export interface ConstructionProgress {
  current_stage: ConstructionStage;
  units_total: number;
  units_complete: number;
  bolts_total: number;
  bolts_complete: number;
  design_complete: boolean;
  overall_percentage: number;
}


/**
 * ConstructionExecutor orchestrates the full Construction phase of ODLC.
 *
 * The Construction phase takes the INTENT from the Inception phase and decomposes it into
 * executable work units:
 * - Units (architectural components)
 * - Design artifacts (interfaces, data flows, components)
 * - Bolts (atomic implementation tasks)
 *
 * @example
 * ```typescript
 * const executor = new ConstructionExecutor('/path/to/project', 'user-auth-workflow');
 * const result = await executor.execute(specContent);
 * if (result.passed) {
 *   console.log('Construction phase complete!');
 * }
 * ```
 */
export class ConstructionExecutor {
  private projectPath: string;
  private workflowId: string;
  private tree: DecompositionTree | null = null;
  private currentStage: ConstructionStage = 'unit';
  private totalUnits = 0;
  private totalBolts = 0;
  private totalEffort = 0;

  constructor(projectPath: string, workflowId: string) {
    this.projectPath = projectPath;
    this.workflowId = workflowId;
  }

  /**
   * Execute the Construction phase pipeline.
   *
   * For SHALLOW depth:
   *   - Creates a single BOLT directly from INTENT content
   *   - Skips UNIT generation and design artifacts
   *
   * For MEDIUM/DEEP depth:
   *   1. Decomposition phase: Parse intent, create UNITs, create BOLTs per UNIT
   *   2. Design phase: Generate interface contracts, DFDs, components
   *
   * @param specContent - Optional SPEC artifact content for design validation
   * @param options - Construction options (depth, limits, checkpoint)
   * @returns ValidationResult with overall pass/fail and blocking issues
   */
  async execute(specContent?: string, options: ConstructionOptions = {}): Promise<ValidationResult> {
    const {
      depth = 'MEDIUM',
      max_units = 10,
      max_bolts_per_unit = 8,
      max_total_bolts = 50,
      checkpointStatus,
      onCheckpointSave,
    } = options;

    // Block if awaiting developer review
    if (checkpointStatus === 'awaiting_dev_review') {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: [
          'Construction blocked: developer review of technical specification required (Risk Tier 3).',
        ],
        reviewer: 'construction-executor',
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[ConstructionExecutor] Starting Construction phase execution (depth: ${depth})`);

    // SHALLOW depth: single BOLT from INTENT, skip everything else
    if (depth === 'SHALLOW') {
      return this.executeShallow();
    }

    // MEDIUM / DEEP: full decomposition pipeline
    // Phase 1: Decomposition (units + bolts)
    this.currentStage = 'unit';
    const decompResult = await this.executeDecompositionPhase(max_units, max_bolts_per_unit, max_total_bolts);
    if (!decompResult.passed) {
      console.error('[ConstructionExecutor] Decomposition phase failed');
      return decompResult;
    }
    console.log('[ConstructionExecutor] Decomposition phase complete');

    // Invoke checkpoint callback if provided
    if (onCheckpointSave) {
      try {
        await onCheckpointSave();
      } catch (err) {
        console.error('[ConstructionExecutor] Checkpoint save callback failed:', err);
      }
    }

    // Phase 2: Design artifacts
    this.currentStage = 'design';
    const designResult = await this.executeDesignStage(specContent);
    if (!designResult.passed) {
      console.error('[ConstructionExecutor] Design stage failed validation');
      return designResult;
    }
    console.log('[ConstructionExecutor] Design stage complete');

    // Return aggregate success result
    return {
      passed: true,
      coverage_percentage: 100,
      blocking_issues: [],
      reviewer: 'construction-executor',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get current progress of Construction execution.
   */
  getProgress(): ConstructionProgress {
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
    if (this.currentStage === 'unit') {
      overallPercentage = unitsTotal > 0 ? Math.round((unitsComplete / unitsTotal) * 50) : 0;
    } else if (this.currentStage === 'bolt') {
      overallPercentage = 50 + (boltsTotal > 0 ? Math.round((boltsComplete / boltsTotal) * 25) : 0);
    } else if (this.currentStage === 'design') {
      overallPercentage = 75 + 25; // Decomposition complete + design done
    }

    return {
      current_stage: this.currentStage,
      units_total: unitsTotal,
      units_complete: unitsComplete,
      bolts_total: boltsTotal,
      bolts_complete: boltsComplete,
      design_complete: this.currentStage === 'design',
      overall_percentage: overallPercentage,
    };
  }

  /**
   * Returns a summary of the decomposition state.
   */
  getDecompositionSummary(): { units: number; bolts: number; totalEffort: number } {
    return {
      units: this.totalUnits,
      bolts: this.totalBolts,
      totalEffort: this.totalEffort,
    };
  }

  /**
   * Execute SHALLOW mode: create a single BOLT directly from INTENT content.
   * No UNITs, no design artifacts.
   *
   * @private
   */
  private async executeShallow(): Promise<ValidationResult> {
    const intentPath = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'inception', 'intent.md');
    const constructionDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'construction');

    // Try new-style intent.md first, fall back to old INTENT-*.md
    let intentTitle = 'Shallow Implementation';
    let intentEffort = 2;
    let intentContent = '';

    const parsed = await parseIntentFromFile(intentPath);
    if (parsed) {
      intentContent = parsed.content;
      // Extract title from frontmatter
      const titleMatch = intentContent.match(/^title:\s*(.+)$/m);
      if (titleMatch) {
        intentTitle = titleMatch[1].trim().replace(/^["']|["']$/g, '');
      }
      const effortMatch = intentContent.match(/^estimated_effort:\s*(\d+)/m);
      if (effortMatch) {
        intentEffort = Number(effortMatch[1]);
      }
    } else {
      // Fall back to old-style parsing
      const intentDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'inception');
      const intents = await parseIntentsFromDisk(intentDir);
      if (intents.length === 0) {
        return {
          passed: false,
          coverage_percentage: 0,
          blocking_issues: ['No intent found for SHALLOW construction'],
          reviewer: 'construction-executor',
          timestamp: new Date().toISOString(),
        };
      }
      intentTitle = intents[0].title;
      intentEffort = intents[0].estimated_effort;
    }

    // Create a single BOLT directly
    await fs.ensureDir(constructionDir);
    const boltId = 'BOLT-001';
    const now = new Date().toISOString();

    const boltContent = this.formatBoltMarkdown(
      {
        id: boltId,
        type: 'bolt',
        title: intentTitle,
        parent_id: null,
        children_ids: [],
        status: 'pending',
        assigned_agent: null,
        estimated_effort: intentEffort,
      },
      'none',
      intentContent
    );

    await fs.writeFile(path.join(constructionDir, `${boltId}.md`), boltContent, 'utf-8');

    // Register BOLT in manifest (no parent unit in SHALLOW mode)
    this.registerConstructionArtifact(boltId, 'bolt', 'bolt', path.join(constructionDir, `${boltId}.md`));

    this.totalBolts = 1;
    this.totalEffort = intentEffort;

    console.log('[ConstructionExecutor] SHALLOW mode: created single BOLT from INTENT');

    return {
      passed: true,
      coverage_percentage: 100,
      blocking_issues: [],
      reviewer: 'construction-executor',
      timestamp: now,
    };
  }

  /**
   * Execute the decomposition phase: parse intent, create UNITs, create BOLTs per UNIT.
   *
   * Reads from inception/intent.md (new-style) or falls back to INTENT-*.md (old-style).
   *
   * @private
   */
  private async executeDecompositionPhase(
    maxUnits: number,
    maxBoltsPerUnit: number,
    maxTotalBolts: number
  ): Promise<ValidationResult> {
    const intentDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'inception');
    const constructionDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'construction');

    await fs.ensureDir(constructionDir);

    // Try new-style intent.md first
    const intentPath = path.join(intentDir, 'intent.md');
    const parsed = await parseIntentFromFile(intentPath);

    // Read INTENT content for dual validation
    const intentFilePath = path.join(intentDir, 'intent.md');
    let intentContent = '';
    try {
      if (await fs.pathExists(intentFilePath)) {
        intentContent = await fs.readFile(intentFilePath, 'utf-8');
      }
    } catch {
      // intent.md is optional for validation
    }

    if (parsed) {
      return this.executeDecompositionFromIntent(
        parsed,
        intentDir,
        constructionDir,
        maxUnits,
        maxBoltsPerUnit,
        maxTotalBolts,
        intentContent
      );
    }

    // Fall back to old-style INTENT-*.md parsing
    return this.executeDecompositionFromLegacyIntents(
      intentDir,
      constructionDir,
      maxUnits,
      maxBoltsPerUnit,
      maxTotalBolts,
      intentContent
    );
  }

  /**
   * Decompose from a new-style single intent.md file.
   *
   * @private
   */
  private async executeDecompositionFromIntent(
    parsed: { content: string; proposedUnits: Array<{ id: string; title: string; description: string }> },
    intentDir: string,
    constructionDir: string,
    maxUnits: number,
    maxBoltsPerUnit: number,
    maxTotalBolts: number,
    rootIntentContent: string
  ): Promise<ValidationResult> {
    const intentContent = parsed.content;
    const titleMatch = intentContent.match(/^title:\s*(.+)$/m);
    const effortMatch = intentContent.match(/^estimated_effort:\s*(\d+)/m);
    const intentTitle = titleMatch
      ? titleMatch[1].trim().replace(/^["']|["']$/g, '')
      : 'Untitled Intent';
    const intentEffort = effortMatch ? Number(effortMatch[1]) : 0;

    // Use INTENT-001 as the canonical ID for the single intent (compatible with validator)
    const intentId = 'INTENT-001';
    const intentNode: HierarchicalNode = {
      id: intentId,
      type: 'intent',
      title: intentTitle,
      parent_id: null,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: intentEffort,
    };

    // Write a bridge INTENT-001.md file so the validator can find valid parent references
    const bridgeIntentContent = `---
id: ${intentId}
title: ${intentTitle}
status: pending
estimated_effort: ${intentEffort}
dependencies: []
---

# Task: ${intentTitle}

## Goal
${intentTitle}

## Component
Auto-generated

## Acceptance Criteria
- [ ] All units complete

## Implementation Steps
1. Execute construction pipeline

## Technical Notes
Generated from inception/intent.md
`;
    await fs.writeFile(
      path.join(intentDir, `${intentId}.md`),
      bridgeIntentContent,
      'utf-8'
    );

    // Build UnitSpecs from proposed units
    const unitSpecs: UnitSpec[] = parsed.proposedUnits.map(pu => ({
      title: pu.title,
      estimated_effort: Math.ceil(intentEffort / Math.max(parsed.proposedUnits.length, 1)),
      description: pu.description,
    }));

    // If no proposed units, create one unit from the intent itself
    if (unitSpecs.length === 0) {
      unitSpecs.push({
        title: intentTitle,
        estimated_effort: intentEffort,
        description: `Implementation unit for ${intentTitle}`,
      });
    }

    // Decompose intent to units with limit
    const allUnits = decomposeIntentToUnits(intentNode, unitSpecs, maxUnits);

    // Write UNIT files and create per-unit directories
    const allBolts: HierarchicalNode[] = [];
    const blockingIssues: string[] = [];

    for (const unit of allUnits) {
      const unitDir = path.join(constructionDir, unit.id);
      await fs.ensureDir(unitDir);

      // Write unit spec.md
      const unitContent = this.formatUnitMarkdown(unit, intentNode.id, intentContent);
      await fs.writeFile(path.join(unitDir, 'spec.md'), unitContent, 'utf-8');
      // Also write top-level UNIT-NNN.md for backward compat / validation
      await fs.writeFile(path.join(constructionDir, `${unit.id}.md`), unitContent, 'utf-8');

      // Register UNIT in manifest with parent-child link to intent
      this.registerConstructionArtifact(unit.id, 'unit', 'unit', path.join(unitDir, 'spec.md'));
      this.linkConstructionArtifacts(intentId, unit.id, 'derives');

      this.runUnitValidation(unitContent, intentContent, rootIntentContent, intentNode.id, unit.id);

      // Parse proposed BOLTs from the unit description or create default
      const matchingProposed = parsed.proposedUnits.find(
        pu => pu.title === unit.title || pu.id === unit.id
      );
      const boltSpecs: BoltSpec[] = [];

      // Check if the intent content has a "### Proposed BOLTs" section for this unit
      // For now, generate one bolt per unit (same as v1 default behavior)
      boltSpecs.push({
        title: unit.title,
        estimated_effort: unit.estimated_effort,
        description: matchingProposed?.description || `Implementation bolt for ${unit.title}`,
      });

      // Decompose unit to bolts with limit
      this.currentStage = 'bolt';
      const bolts = decomposeUnitToBolts(unit, boltSpecs, maxBoltsPerUnit);
      allBolts.push(...bolts);

      // Write bolt files inside per-unit directory
      for (const bolt of bolts) {
        const boltFilePath = path.join(unitDir, `${bolt.id}.md`);
        const boltContent = this.formatBoltMarkdown(bolt, unit.id);
        await fs.writeFile(boltFilePath, boltContent, 'utf-8');

        // Register BOLT in manifest with parent-child link to unit
        this.registerConstructionArtifact(bolt.id, 'bolt', 'bolt', boltFilePath);
        this.linkConstructionArtifacts(unit.id, bolt.id, 'derives');

        this.runBoltValidation(boltContent, unitContent, rootIntentContent, unit.id, bolt.id);

        // Validate bolt structure
        const boltResult = await validateBolt(boltFilePath);
        if (!boltResult.passed) {
          blockingIssues.push(`${bolt.id}: ${boltResult.blocking_issues.join(', ')}`);
        }
      }
    }

    // Enforce global bolt limit
    const cappedBolts = enforceGlobalBoltLimit(allBolts, maxTotalBolts);

    // Build tree
    this.tree = buildDecompositionTree([intentNode]);
    for (const unit of allUnits) {
      this.tree.nodes.set(unit.id, unit);
    }
    for (const bolt of cappedBolts) {
      this.tree.nodes.set(bolt.id, bolt);
    }

    // Track summary
    this.totalUnits = allUnits.length;
    this.totalBolts = cappedBolts.length;
    this.totalEffort = allUnits.reduce((sum, u) => sum + u.estimated_effort, 0);

    console.log(
      `[ConstructionExecutor] Created ${allUnits.length} units, ${cappedBolts.length} bolts`
    );

    // Validate units against intents
    const validationResult = await validateUnits(constructionDir, intentDir);
    if (!validationResult.passed) {
      return validationResult;
    }

    if (blockingIssues.length > 0) {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: blockingIssues,
        reviewer: 'construction-executor',
        timestamp: new Date().toISOString(),
      };
    }

    return {
      passed: true,
      coverage_percentage: 100,
      blocking_issues: [],
      reviewer: 'construction-executor',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Fall back to old-style INTENT-*.md decomposition for backward compatibility.
   *
   * @private
   */
  private async executeDecompositionFromLegacyIntents(
    intentDir: string,
    constructionDir: string,
    maxUnits: number,
    maxBoltsPerUnit: number,
    maxTotalBolts: number,
    rootIntentContent: string
  ): Promise<ValidationResult> {
    const intents = await parseIntentsFromDisk(intentDir);
    if (intents.length === 0) {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: ['No intents found in Inception phase'],
        reviewer: 'construction-executor',
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[ConstructionExecutor] Found ${intents.length} intents to decompose (legacy mode)`);

    // Read legacy intent content for validation
    let intentFileContent = '';
    try {
      const intentFiles = await fs.readdir(intentDir);
      const firstIntent = intentFiles.find(f => f.startsWith('INTENT-') && f.endsWith('.md'));
      if (firstIntent) {
        intentFileContent = await fs.readFile(path.join(intentDir, firstIntent), 'utf-8');
      }
    } catch {
      // Best effort
    }

    // Decompose each intent into units
    const allUnits: HierarchicalNode[] = [];
    const allBolts: HierarchicalNode[] = [];
    const blockingIssues: string[] = [];

    for (const intent of intents) {
      // v1: Auto-generate one unit per intent
      const unitSpecs: UnitSpec[] = [
        {
          title: intent.title,
          estimated_effort: intent.estimated_effort,
          description: `Implementation unit for ${intent.title}`,
        },
      ];

      const units = decomposeIntentToUnits(intent, unitSpecs, maxUnits);
      allUnits.push(...units);

      // Write unit files
      for (const unit of units) {
        const unitFilePath = path.join(constructionDir, `${unit.id}.md`);
        const unitContent = this.formatUnitMarkdown(unit, intent.id);
        await fs.writeFile(unitFilePath, unitContent, 'utf-8');

        // Create per-unit directory and write spec + bolts
        const unitDir = path.join(constructionDir, unit.id);
        await fs.ensureDir(unitDir);
        await fs.writeFile(path.join(unitDir, 'spec.md'), unitContent, 'utf-8');

        // Register UNIT in manifest with parent-child link to intent
        this.registerConstructionArtifact(unit.id, 'unit', 'unit', path.join(unitDir, 'spec.md'));
        this.linkConstructionArtifacts(intent.id, unit.id, 'derives');

        this.runUnitValidation(unitContent, intentFileContent, rootIntentContent, intent.id, unit.id);

        // Generate bolts per unit
        this.currentStage = 'bolt';
        const boltSpecs: BoltSpec[] = [
          {
            title: unit.title,
            estimated_effort: unit.estimated_effort,
            description: `Implementation bolt for ${unit.title}`,
          },
        ];

        const bolts = decomposeUnitToBolts(unit, boltSpecs, maxBoltsPerUnit);
        allBolts.push(...bolts);

        // Write bolt files inside per-unit directory
        for (const bolt of bolts) {
          const boltFilePath = path.join(unitDir, `${bolt.id}.md`);
          const boltContent = this.formatBoltMarkdown(bolt, unit.id);
          await fs.writeFile(boltFilePath, boltContent, 'utf-8');

          // Register BOLT in manifest with parent-child link to unit
          this.registerConstructionArtifact(bolt.id, 'bolt', 'bolt', boltFilePath);
          this.linkConstructionArtifacts(unit.id, bolt.id, 'derives');

          this.runBoltValidation(boltContent, unitContent, rootIntentContent, unit.id, bolt.id);

          // Validate bolt
          const boltResult = await validateBolt(boltFilePath);
          if (!boltResult.passed) {
            blockingIssues.push(`${bolt.id}: ${boltResult.blocking_issues.join(', ')}`);
          }
        }
      }
    }

    // Enforce global bolt limit
    const cappedBolts = enforceGlobalBoltLimit(allBolts, maxTotalBolts);

    console.log(
      `[ConstructionExecutor] Created ${allUnits.length} units, ${cappedBolts.length} bolts`
    );

    // Build decomposition tree
    this.tree = buildDecompositionTree(intents);
    for (const unit of allUnits) {
      this.tree.nodes.set(unit.id, unit);
    }
    for (const bolt of cappedBolts) {
      this.tree.nodes.set(bolt.id, bolt);
    }

    // Track summary
    this.totalUnits = allUnits.length;
    this.totalBolts = cappedBolts.length;
    this.totalEffort = allUnits.reduce((sum, u) => sum + u.estimated_effort, 0);

    // Validate units
    const validationResult = await validateUnits(constructionDir, intentDir);
    if (!validationResult.passed) {
      return validationResult;
    }

    if (blockingIssues.length > 0) {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: blockingIssues,
        reviewer: 'construction-executor',
        timestamp: new Date().toISOString(),
      };
    }

    return {
      passed: true,
      coverage_percentage: 100,
      blocking_issues: [],
      reviewer: 'construction-executor',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Execute the DESIGN stage of Construction.
   *
   * 1. Read units from disk
   * 2. Generate interface contracts
   * 3. Generate data flow diagrams
   * 4. Generate component designs
   * 5. Write design artifacts to construction/design/
   * 6. Validate design artifacts
   *
   * @private
   */
  private async executeDesignStage(specContent?: string): Promise<ValidationResult> {
    const constructionDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'construction');

    // Read units from disk
    const unitFiles = await fs.readdir(constructionDir);
    const units: HierarchicalNode[] = [];

    for (const file of unitFiles) {
      if (!file.startsWith('UNIT-') || !file.endsWith('.md')) {
        continue;
      }

      const filePath = path.join(constructionDir, file);
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
        reviewer: 'construction-executor',
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[ConstructionExecutor] Generating design artifacts for ${units.length} units`);

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

    // Register design artifacts in manifest
    const designDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'construction', 'design');
    this.registerConstructionArtifact('design-interfaces', 'interface-contracts', 'unit', path.join(designDir, 'interfaces.json'));
    this.registerConstructionArtifact('design-data-flow', 'data-flow-diagram', 'unit', path.join(designDir, 'data-flow.json'));
    this.registerConstructionArtifact('design-components', 'component-design', 'unit', path.join(designDir, 'components.json'));

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
      reviewer: 'construction-executor',
      timestamp: new Date().toISOString(),
    };
  }

  private runUnitValidation(
    unitContent: string,
    intentContent: string,
    rootIntentContent: string,
    intentId: string,
    unitId: string
  ): void {
    if (!intentContent || !rootIntentContent) {
      return;
    }

    try {
      const result = runDualValidation(
        unitContent,
        intentContent,
        rootIntentContent,
        'intent-to-unit',
        'unit-to-intent',
        intentId,
        unitId,
        `intent-${this.workflowId}`
      );

      if (!result.passed) {
        console.warn(
          `[ConstructionExecutor] Dual validation warning for ${unitId}: parent=${result.parentCheck.alignment_passed}, root=${result.rootCheck.alignment_passed}`
        );
      }
    } catch (err) {
      console.error(`[ConstructionExecutor] Dual validation error for ${unitId}:`, err);
    }
  }

  private runBoltValidation(
    boltContent: string,
    unitContent: string,
    rootIntentContent: string,
    unitId: string,
    boltId: string
  ): void {
    if (!unitContent || !rootIntentContent) {
      return;
    }

    try {
      const result = runDualValidation(
        boltContent,
        unitContent,
        rootIntentContent,
        'unit-to-bolt',
        'bolt-to-intent',
        unitId,
        boltId,
        `intent-${this.workflowId}`
      );

      if (!result.passed) {
        console.warn(
          `[ConstructionExecutor] Dual validation warning for ${boltId}: parent=${result.parentCheck.alignment_passed}, root=${result.rootCheck.alignment_passed}`
        );
      }
    } catch (err) {
      console.error(`[ConstructionExecutor] Dual validation error for ${boltId}:`, err);
    }
  }

  /**
   * Register a construction artifact in the manifest with proper metadata.
   * Silently handles errors to avoid blocking the construction pipeline.
   *
   * @private
   */
  private registerConstructionArtifact(
    artifactId: string,
    artifactType: string,
    stage: 'unit' | 'bolt',
    artifactPath: string
  ): void {
    try {
      const manifestPath = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'manifest.json');
      registerArtifact(manifestPath, {
        id: artifactId,
        type: artifactType,
        phase: 'construction',
        stage: stage,
        path: artifactPath,
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });
    } catch (err) {
      console.error(`[ConstructionExecutor] Failed to register artifact ${artifactId}:`, err);
    }
  }

  /**
   * Link two artifacts in the manifest (parent-child relationship).
   * Silently handles errors to avoid blocking the construction pipeline.
   *
   * @private
   */
  private linkConstructionArtifacts(
    sourceId: string,
    targetId: string,
    linkType: 'derives' | 'implements'
  ): void {
    try {
      const manifestPath = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'manifest.json');
      linkArtifacts(manifestPath, {
        source_id: sourceId,
        target_id: targetId,
        link_type: linkType,
      });
    } catch (err) {
      console.error(`[ConstructionExecutor] Failed to link ${sourceId} -> ${targetId}:`, err);
    }
  }

  /**
   * Format a unit as a markdown file with the new UNIT template format.
   *
   * Produces frontmatter compatible with the existing validation system
   * (unquoted values, required sections: Goal, Acceptance Criteria, Implementation Notes).
   *
   * @private
   */
  private formatUnitMarkdown(
    unit: HierarchicalNode,
    parentIntentId: string,
    _intentContent?: string
  ): string {
    const now = new Date().toISOString();
    return `---
id: ${unit.id}
title: ${unit.title}
parent_intent: ${parentIntentId}
status: ${unit.status}
estimated_effort: ${unit.estimated_effort}
created: ${now}
---

# ${unit.id}: ${unit.title}

## Goal

${unit.title}

## Scope & Responsibility
Implementation unit for ${unit.title}

## Interface Contracts

### Inputs
- To be defined during design phase

### Outputs
- To be defined during design phase

### API Surface
To be defined during design phase

## Dependencies
- **Internal**: None identified
- **External**: None identified

## Target Files
- [ ] To be identified during bolt decomposition

## Design Artifacts
See construction/design/ for generated artifacts

## Acceptance Criteria
- [ ] Unit implementation complete
- [ ] Tests passing

## Implementation Notes

Implementation details for ${unit.title}.

## Proposed BOLTs
- **BOLT-001**: Implementation bolt for ${unit.title}

## Traceability
- Parent INTENT: ${parentIntentId} (inception/intent.md)
- Root INTENT: intent-${this.workflowId} (inception/intent.md)
`;
  }

  /**
   * Format a bolt as a markdown file with the new BOLT template format.
   *
   * @private
   */
  private formatBoltMarkdown(
    bolt: HierarchicalNode,
    parentUnitId: string,
    domainContext?: string
  ): string {
    const now = new Date().toISOString();
    return `---
id: ${bolt.id}
title: ${bolt.title}
parent_unit: ${parentUnitId}
status: ${bolt.status}
estimated_effort: ${bolt.estimated_effort}
created: ${now}
---

# ${bolt.id}: ${bolt.title}

## Goal

${bolt.title}

## Domain Design
${domainContext ? 'See parent intent for business context' : 'Business context for ' + bolt.title}

## Logical Design
Technical approach for implementing ${bolt.title}

## Target Files
- [ ] To be identified during implementation

## Implementation Steps
- Implement ${bolt.title}
- Write tests
- Verify acceptance criteria

## Test Requirements
- [ ] Unit tests for core functionality
- [ ] Integration tests where applicable

## Acceptance Criteria
- [ ] Implementation complete
- [ ] Tests passing

## Audit Trail
- Created: ${now}
- Status: ${bolt.status}
- Executed by: pending
- Reviewed by: pending
- Gate 4 result: pending

## Traceability
- Parent UNIT: ${parentUnitId} (construction/${parentUnitId}/spec.md)
- Root INTENT: intent-${this.workflowId} (inception/intent.md)
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
          // Strip surrounding quotes
          const cleaned = value.trim().replace(/^["']|["']$/g, '');
          if (!isNaN(Number(cleaned))) {
            metadata[key] = Number(cleaned);
          } else {
            metadata[key] = cleaned;
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
