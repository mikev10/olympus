/**
 * Construction Phase: Hierarchical Decomposition
 *
 * Decomposes high-level INTENTs from the Inception phase into hierarchical execution units:
 * - INTENT (from Inception phase) → UNIT (architectural components) → BOLT (atomic tasks)
 *
 * This module provides the core decomposition logic for the Construction phase of ODLC,
 * transforming strategic intents into executable work items.
 */

import fs from 'fs-extra';
import path from 'path';
import type { HierarchicalNode } from '../phase-types.js';

// Helper types for decomposition specifications
export interface UnitSpec {
  title: string;
  estimated_effort: number;
  description?: string;
}

export interface BoltSpec {
  title: string;
  estimated_effort: number;
  description?: string;
}

export interface DecompositionTree {
  roots: HierarchicalNode[];  // intent-level nodes
  nodes: Map<string, HierarchicalNode>;  // all nodes by ID
}

/**
 * Parses INTENT-*.md files from disk and returns HierarchicalNode array.
 *
 * Reads markdown files with frontmatter containing:
 * - id: INTENT-NNN
 * - title: Intent description
 * - estimated_effort: numeric value
 * - dependencies: array of intent IDs
 * - status: pending | in_progress | complete | blocked
 *
 * @param intentsDir - Directory containing INTENT-*.md files
 * @returns Array of HierarchicalNode objects with type='intent'
 */
export async function parseIntentsFromDisk(intentsDir: string): Promise<HierarchicalNode[]> {
  try {
    // Check if directory exists
    const exists = await fs.pathExists(intentsDir);
    if (!exists) {
      return [];
    }

    const files = await fs.readdir(intentsDir);
    const intentFiles = files.filter(f => f.startsWith('INTENT-') && f.endsWith('.md'));

    const intents: HierarchicalNode[] = [];

    for (const file of intentFiles) {
      try {
        const filePath = path.join(intentsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');

        // Parse frontmatter (simple YAML-style parsing)
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
          console.error(`No frontmatter found in ${file}`);
          continue;
        }

        const frontmatter = frontmatterMatch[1];
        const lines = frontmatter.split('\n');
        const metadata: Record<string, any> = {};

        for (const line of lines) {
          const match = line.match(/^(\w+):\s*(.+)$/);
          if (match) {
            const [, key, value] = match;
            // Handle arrays (dependencies)
            if (value.startsWith('[')) {
              metadata[key] = JSON.parse(value.replace(/'/g, '"'));
            } else if (!isNaN(Number(value))) {
              metadata[key] = Number(value);
            } else {
              metadata[key] = value.trim();
            }
          }
        }

        // Build HierarchicalNode
        const node: HierarchicalNode = {
          id: metadata.id || file.replace('.md', ''),
          type: 'intent',
          title: metadata.title || 'Untitled Intent',
          parent_id: null,  // Intents are roots
          children_ids: [],  // Will be populated during decomposition
          status: metadata.status || 'pending',
          assigned_agent: metadata.assigned_agent || null,
          estimated_effort: metadata.estimated_effort || 0,
        };

        intents.push(node);
      } catch (error) {
        console.error(`Failed to parse ${file}:`, error);
      }
    }

    return intents;
  } catch (error) {
    console.error(`Failed to read intents from ${intentsDir}:`, error);
    return [];
  }
}

/**
 * Decomposes an INTENT node into UNIT nodes.
 *
 * Creates child UNIT nodes under the given intent, auto-generating IDs
 * in the format UNIT-001, UNIT-002, etc.
 *
 * @param intent - The parent intent node
 * @param unitSpecs - Specifications for the units to create
 * @returns Array of created unit nodes
 */
export function decomposeIntentToUnits(
  intent: HierarchicalNode,
  unitSpecs: UnitSpec[]
): HierarchicalNode[] {
  const units: HierarchicalNode[] = [];

  for (let i = 0; i < unitSpecs.length; i++) {
    const spec = unitSpecs[i];
    const unitId = `UNIT-${String(i + 1).padStart(3, '0')}`;

    const unit: HierarchicalNode = {
      id: unitId,
      type: 'unit',
      title: spec.title,
      parent_id: intent.id,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: spec.estimated_effort,
    };

    units.push(unit);
    intent.children_ids.push(unitId);
  }

  return units;
}

/**
 * Decomposes a UNIT node into BOLT nodes.
 *
 * Creates child BOLT nodes under the given unit, auto-generating IDs
 * in the format BOLT-001, BOLT-002, etc.
 *
 * @param unit - The parent unit node
 * @param boltSpecs - Specifications for the bolts to create
 * @returns Array of created bolt nodes
 */
export function decomposeUnitToBolts(
  unit: HierarchicalNode,
  boltSpecs: BoltSpec[]
): HierarchicalNode[] {
  const bolts: HierarchicalNode[] = [];

  for (let i = 0; i < boltSpecs.length; i++) {
    const spec = boltSpecs[i];
    const boltId = `BOLT-${String(i + 1).padStart(3, '0')}`;

    const bolt: HierarchicalNode = {
      id: boltId,
      type: 'bolt',
      title: spec.title,
      parent_id: unit.id,
      children_ids: [],  // Bolts are leaf nodes
      status: 'pending',
      assigned_agent: null,
      estimated_effort: spec.estimated_effort,
    };

    bolts.push(bolt);
    unit.children_ids.push(boltId);
  }

  return bolts;
}

/**
 * Builds a complete decomposition tree from intent nodes.
 *
 * Takes an array of intent nodes (which should already have their children
 * populated via decomposeIntentToUnits and decomposeUnitToBolts) and creates
 * a tree structure with lookup capabilities.
 *
 * @param intents - Array of intent nodes with their decomposed children
 * @returns DecompositionTree with roots and node map
 */
export function buildDecompositionTree(intents: HierarchicalNode[]): DecompositionTree {
  const nodes = new Map<string, HierarchicalNode>();

  // Recursive function to add node and all children to map
  function addNodeAndChildren(node: HierarchicalNode, allNodes: HierarchicalNode[]) {
    nodes.set(node.id, node);

    // Find and add children
    for (const childId of node.children_ids) {
      const child = allNodes.find(n => n.id === childId);
      if (child) {
        addNodeAndChildren(child, allNodes);
      }
    }
  }

  // Collect all nodes from intents (needs to be passed in or built externally)
  // For now, we'll just add the intents to the map
  for (const intent of intents) {
    nodes.set(intent.id, intent);
  }

  return {
    roots: intents,
    nodes,
  };
}

/**
 * Retrieves all leaf-level BOLT nodes from the tree.
 *
 * Leaf bolts are nodes with type='bolt' and no children.
 * These represent the atomic, executable work items.
 *
 * @param tree - The decomposition tree
 * @returns Array of leaf bolt nodes
 */
export function getLeafBolts(tree: DecompositionTree): HierarchicalNode[] {
  const leafBolts: HierarchicalNode[] = [];

  for (const node of tree.nodes.values()) {
    if (node.type === 'bolt' && node.children_ids.length === 0) {
      leafBolts.push(node);
    }
  }

  return leafBolts;
}

/**
 * Returns bolts in executable order, respecting dependencies and parent status.
 *
 * Bolts are ordered such that:
 * 1. Bolts whose parent units are not blocked come first
 * 2. Bolts within the same unit maintain their creation order
 * 3. Blocked bolts come last
 *
 * @param tree - The decomposition tree
 * @returns Array of bolt nodes in topological execution order
 */
export function getExecutableOrder(tree: DecompositionTree): HierarchicalNode[] {
  const leafBolts = getLeafBolts(tree);

  // Separate bolts by their parent unit status
  const executableBolts: HierarchicalNode[] = [];
  const blockedBolts: HierarchicalNode[] = [];

  for (const bolt of leafBolts) {
    const parentUnit = tree.nodes.get(bolt.parent_id || '');

    if (!parentUnit || parentUnit.status === 'blocked') {
      blockedBolts.push(bolt);
    } else {
      executableBolts.push(bolt);
    }
  }

  // Sort executable bolts by ID to maintain creation order
  executableBolts.sort((a, b) => a.id.localeCompare(b.id));
  blockedBolts.sort((a, b) => a.id.localeCompare(b.id));

  return [...executableBolts, ...blockedBolts];
}
