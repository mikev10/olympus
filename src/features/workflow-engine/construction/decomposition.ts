/**
 * Construction Phase: Hierarchical Decomposition
 *
 * Decomposes high-level INTENTs from the Inception phase into named construction units:
 * - INTENT (from Inception phase) -> UNIT (named architectural components) -> code generation
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

export interface DecompositionTree {
  roots: HierarchicalNode[];  // intent-level nodes
  nodes: Map<string, HierarchicalNode>;  // all nodes by ID
}

/** Default limit for units per intent */
const DEFAULT_MAX_UNITS = 10;

/**
 * Converts a unit title into a human-readable slug suitable for directory names.
 *
 * Examples:
 *   "Auth Service"       -> "auth-service"
 *   "API Gateway"        -> "api-gateway"
 *   "User Onboarding"    -> "user-onboarding"
 *   ""                   -> "unit-0" (fallback with index)
 *
 * @param title - The human-readable unit title
 * @param index - Zero-based index used as fallback when title is empty
 * @returns A lowercase, hyphen-separated slug
 */
export function slugifyUnitName(title: string, index: number): string {
  if (!title || !title.trim()) {
    return `unit-${index}`;
  }

  const slug = title
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!slug) {
    return `unit-${index}`;
  }

  // Truncate overly long slugs
  if (slug.length > 60) {
    return slug.substring(0, 60).replace(/-$/, '');
  }

  return slug;
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
 * Parses a single intent.md file from disk and returns its content plus proposed UNITs.
 *
 * This is the new-style parser for the unified intent.md file format used by the
 * Construction pipeline (one INTENT per workflow, not INTENT-*.md files).
 *
 * @param intentPath - Absolute path to the intent.md file
 * @returns Parsed content and proposed units, or null if file not found / unparseable
 */
export async function parseIntentFromFile(intentPath: string): Promise<{
  content: string;
  proposedUnits: Array<{ id: string; title: string; description: string }>;
} | null> {
  try {
    const exists = await fs.pathExists(intentPath);
    if (!exists) {
      return null;
    }

    const content = await fs.readFile(intentPath, 'utf-8');

    // Parse "### Proposed UNITs" section
    const proposedUnits: Array<{ id: string; title: string; description: string }> = [];

    const unitsMatch = content.match(/### Proposed UNITs\s*\n([\s\S]*?)(?=\n##[^#]|\n---|\Z|$)/);
    if (unitsMatch) {
      const unitsSection = unitsMatch[1];
      const bulletRegex = /^-\s+\*\*([^*]+)\*\*:\s*(.+)$/gm;
      let bulletMatch;
      let index = 0;
      while ((bulletMatch = bulletRegex.exec(unitsSection)) !== null) {
        const rawTitle = bulletMatch[1].trim();
        const description = bulletMatch[2].trim();
        const id = slugifyUnitName(rawTitle, index);
        proposedUnits.push({
          id,
          title: rawTitle,
          description,
        });
        index++;
      }
    }

    return {
      content,
      proposedUnits,
    };
  } catch (error) {
    console.error(`Failed to parse intent from ${intentPath}:`, error);
    return null;
  }
}

/**
 * Decomposes an INTENT node into named UNIT nodes.
 *
 * Creates child UNIT nodes under the given intent with human-readable slugified IDs
 * derived from each unit's title (e.g., "auth-service", "api-gateway").
 *
 * If more unit specs are provided than maxUnits allows, the list is truncated.
 */
export function decomposeIntentToUnits(
  intent: HierarchicalNode,
  unitSpecs: UnitSpec[],
  maxUnits: number = DEFAULT_MAX_UNITS
): HierarchicalNode[] {
  let specs = unitSpecs;
  if (specs.length > maxUnits) {
    console.warn(
      `[decomposition] Unit specs (${specs.length}) exceed maxUnits limit (${maxUnits}). Truncating to ${maxUnits}.`
    );
    specs = specs.slice(0, maxUnits);
  }

  const units: HierarchicalNode[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const unitId = slugifyUnitName(spec.title, i);

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
 * Builds a complete decomposition tree from intent nodes.
 *
 * Takes an array of intent nodes (which should already have their children
 * populated via decomposeIntentToUnits) and creates a tree structure with
 * lookup capabilities.
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
 * Returns all unit nodes from the decomposition tree.
 *
 * @param tree - The decomposition tree
 * @returns Array of unit nodes
 */
export function getUnits(tree: DecompositionTree): HierarchicalNode[] {
  const units: HierarchicalNode[] = [];

  for (const node of tree.nodes.values()) {
    if (node.type === 'unit') {
      units.push(node);
    }
  }

  return units;
}
