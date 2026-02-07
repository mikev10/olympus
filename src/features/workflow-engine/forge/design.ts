/**
 * Forge Phase - Design Stage
 *
 * The design stage takes UNITs from the decomposition stage and generates functional
 * design artifacts: interface contracts, data flow diagrams, and component designs.
 * This stage bridges the gap between high-level decomposition and low-level construction.
 */

import fs from 'fs-extra';
import path from 'path';
import type { HierarchicalNode } from '../phase-types.js';
import type { ValidationResult } from '../types.js';

// ==================== TYPES ====================

export interface InterfaceContract {
  id: string; // e.g., "IFACE-001"
  unit_id: string; // which unit this interface belongs to
  name: string; // e.g., "AuthService"
  inputs: InterfaceField[];
  outputs: InterfaceField[];
  dependencies: string[]; // IDs of other interfaces this depends on
  description: string;
}

export interface InterfaceField {
  name: string;
  type: string; // TypeScript type string
  required: boolean;
  description: string;
}

export interface DataFlowDiagram {
  id: string; // e.g., "DFD-001"
  unit_id: string;
  components: DataFlowComponent[];
  flows: DataFlow[];
  description: string;
}

export interface DataFlowComponent {
  id: string;
  name: string;
  type: 'process' | 'store' | 'external' | 'interface';
}

export interface DataFlow {
  from: string; // component ID
  to: string; // component ID
  data: string; // description of data flowing
  direction: 'unidirectional' | 'bidirectional';
}

export interface ComponentDesign {
  id: string; // e.g., "COMP-001"
  unit_id: string;
  name: string;
  responsibilities: string[];
  interfaces_used: string[]; // interface contract IDs
  data_stores: string[];
  description: string;
}

export interface DesignArtifacts {
  interfaces: InterfaceContract[];
  dataFlows: DataFlowDiagram[];
  components: ComponentDesign[];
}

// ==================== FUNCTIONS ====================

/**
 * Generates interface contracts for each unit based on the spec.
 * Analyzes the spec for API endpoints, component boundaries, and data structures.
 *
 * @param units - Hierarchical units from decomposition stage
 * @param specContent - Markdown content of the technical spec
 * @returns Array of interface contracts
 */
export function generateInterfaceContracts(
  units: HierarchicalNode[],
  specContent: string
): InterfaceContract[] {
  const interfaces: InterfaceContract[] = [];
  let idCounter = 1;

  for (const unit of units) {
    // Extract relevant spec sections for this unit
    const unitKeywords = extractKeywords(unit.title);
    const relevantSections = extractRelevantSections(specContent, unitKeywords);

    // Parse inputs and outputs from spec
    const inputs = parseInterfaceFields(relevantSections, 'input');
    const outputs = parseInterfaceFields(relevantSections, 'output');

    // Determine dependencies based on other units
    const dependencies = determineDependencies(unit, units);

    interfaces.push({
      id: `IFACE-${String(idCounter++).padStart(3, '0')}`,
      unit_id: unit.id,
      name: formatInterfaceName(unit.title),
      inputs,
      outputs,
      dependencies,
      description: `Interface contract for ${unit.title}`,
    });
  }

  return interfaces;
}

/**
 * Generates data flow diagrams showing how data moves between components.
 * Creates one DFD per unit, mapping interfaces to data flows.
 *
 * @param units - Hierarchical units from decomposition stage
 * @param interfaces - Interface contracts generated for the units
 * @returns Array of data flow diagrams
 */
export function generateDataFlowDiagram(
  units: HierarchicalNode[],
  interfaces: InterfaceContract[]
): DataFlowDiagram[] {
  const dataFlows: DataFlowDiagram[] = [];
  let idCounter = 1;

  for (const unit of units) {
    const unitInterfaces = interfaces.filter((i) => i.unit_id === unit.id);

    // Generate components for this unit's DFD
    const components: DataFlowComponent[] = [];
    const flows: DataFlow[] = [];

    // Add interface as a component
    for (const iface of unitInterfaces) {
      components.push({
        id: `COMP-${iface.id}`,
        name: iface.name,
        type: 'interface',
      });

      // Create flows based on dependencies
      for (const depId of iface.dependencies) {
        const depInterface = interfaces.find((i) => i.id === depId);
        if (depInterface) {
          flows.push({
            from: `COMP-${depInterface.id}`,
            to: `COMP-${iface.id}`,
            data: `Data from ${depInterface.name}`,
            direction: 'unidirectional',
          });
        }
      }

      // Add data stores if inputs/outputs suggest persistence
      if (suggestsPersistence(iface)) {
        const storeId = `STORE-${iface.id}`;
        components.push({
          id: storeId,
          name: `${iface.name}Store`,
          type: 'store',
        });

        flows.push({
          from: `COMP-${iface.id}`,
          to: storeId,
          data: 'Persisted data',
          direction: 'bidirectional',
        });
      }
    }

    dataFlows.push({
      id: `DFD-${String(idCounter++).padStart(3, '0')}`,
      unit_id: unit.id,
      components,
      flows,
      description: `Data flow diagram for ${unit.title}`,
    });
  }

  return dataFlows;
}

/**
 * Generates component designs for each unit.
 * Links components to their interfaces and data stores.
 *
 * @param units - Hierarchical units from decomposition stage
 * @param interfaces - Interface contracts generated for the units
 * @param dataFlows - Data flow diagrams generated for the units
 * @returns Array of component designs
 */
export function generateComponentDesign(
  units: HierarchicalNode[],
  interfaces: InterfaceContract[],
  dataFlows: DataFlowDiagram[]
): ComponentDesign[] {
  const components: ComponentDesign[] = [];
  let idCounter = 1;

  for (const unit of units) {
    const unitInterfaces = interfaces.filter((i) => i.unit_id === unit.id);
    const unitDfd = dataFlows.find((d) => d.unit_id === unit.id);

    // Extract data stores from DFD
    const dataStores = unitDfd
      ? unitDfd.components.filter((c) => c.type === 'store').map((c) => c.name)
      : [];

    // Determine responsibilities based on interfaces
    const responsibilities = deriveResponsibilities(unit, unitInterfaces);

    components.push({
      id: `COMP-${String(idCounter++).padStart(3, '0')}`,
      unit_id: unit.id,
      name: formatComponentName(unit.title),
      responsibilities,
      interfaces_used: unitInterfaces.map((i) => i.id),
      data_stores: dataStores,
      description: `Component design for ${unit.title}`,
    });
  }

  return components;
}

/**
 * Validates design artifacts against the spec.
 * Performs structural validation to ensure completeness and correctness.
 *
 * @param design - Design artifacts to validate
 * @param specContent - Markdown content of the technical spec
 * @returns ValidationResult indicating pass/fail and any issues
 */
export function validateDesign(design: DesignArtifacts, specContent: string): ValidationResult {
  const issues: string[] = [];

  // Check 1: All interfaces have at least one input or output
  for (const iface of design.interfaces) {
    if (iface.inputs.length === 0 && iface.outputs.length === 0) {
      issues.push(`Interface ${iface.id} (${iface.name}) has no inputs or outputs`);
    }
  }

  // Check 2: All data flows reference valid components
  for (const dfd of design.dataFlows) {
    const componentIds = new Set(dfd.components.map((c) => c.id));
    for (const flow of dfd.flows) {
      if (!componentIds.has(flow.from)) {
        issues.push(`DFD ${dfd.id}: Flow references invalid source component ${flow.from}`);
      }
      if (!componentIds.has(flow.to)) {
        issues.push(`DFD ${dfd.id}: Flow references invalid target component ${flow.to}`);
      }
    }
  }

  // Check 3: All components reference valid interfaces
  const interfaceIds = new Set(design.interfaces.map((i) => i.id));
  for (const comp of design.components) {
    for (const ifaceId of comp.interfaces_used) {
      if (!interfaceIds.has(ifaceId)) {
        issues.push(`Component ${comp.id} (${comp.name}) references invalid interface ${ifaceId}`);
      }
    }
  }

  // Check 4: All components have at least one responsibility
  for (const comp of design.components) {
    if (comp.responsibilities.length === 0) {
      issues.push(`Component ${comp.id} (${comp.name}) has no defined responsibilities`);
    }
  }

  // Calculate coverage based on spec keywords
  const specKeywords = extractAllKeywords(specContent);
  const designKeywords = extractDesignKeywords(design);
  const coverage = calculateCoverage(specKeywords, designKeywords);

  return {
    passed: issues.length === 0,
    coverage_percentage: coverage,
    blocking_issues: issues,
    reviewer: 'design-validator',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Writes design artifacts to disk.
 * Creates directory structure and writes JSON files for each artifact type.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Workflow identifier
 * @param design - Design artifacts to write
 */
export async function writeDesignArtifacts(
  projectPath: string,
  workflowId: string,
  design: DesignArtifacts
): Promise<void> {
  const designDir = path.join(projectPath, '.olympus', 'workflow', workflowId, 'forge', 'design');

  try {
    await fs.ensureDir(designDir);

    await fs.writeJson(path.join(designDir, 'interfaces.json'), design.interfaces, { spaces: 2 });
    await fs.writeJson(path.join(designDir, 'data-flow.json'), design.dataFlows, { spaces: 2 });
    await fs.writeJson(path.join(designDir, 'components.json'), design.components, { spaces: 2 });

    // Write validation result
    const validationResult = validateDesign(design, '');
    await fs.writeJson(path.join(designDir, 'validation.json'), validationResult, { spaces: 2 });
  } catch (error) {
    console.error('Failed to write design artifacts:', error);
    throw error;
  }
}

/**
 * Loads design artifacts from disk.
 * Reads JSON files and reconstructs the DesignArtifacts object.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Workflow identifier
 * @returns DesignArtifacts or null if not found
 */
export async function loadDesignArtifacts(
  projectPath: string,
  workflowId: string
): Promise<DesignArtifacts | null> {
  const designDir = path.join(projectPath, '.olympus', 'workflow', workflowId, 'forge', 'design');

  try {
    const interfacesPath = path.join(designDir, 'interfaces.json');
    const dataFlowPath = path.join(designDir, 'data-flow.json');
    const componentsPath = path.join(designDir, 'components.json');

    const [interfacesExist, dataFlowExist, componentsExist] = await Promise.all([
      fs.pathExists(interfacesPath),
      fs.pathExists(dataFlowPath),
      fs.pathExists(componentsPath),
    ]);

    if (!interfacesExist || !dataFlowExist || !componentsExist) {
      return null;
    }

    const [interfaces, dataFlows, components] = await Promise.all([
      fs.readJson(interfacesPath),
      fs.readJson(dataFlowPath),
      fs.readJson(componentsPath),
    ]);

    return { interfaces, dataFlows, components };
  } catch (error) {
    console.error('Failed to load design artifacts:', error);
    return null;
  }
}

// ==================== HELPER FUNCTIONS ====================

function extractKeywords(text: string): string[] {
  // Extract meaningful keywords from text (remove common words)
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2 && !commonWords.has(word));
}

function extractRelevantSections(specContent: string, keywords: string[]): string {
  const lines = specContent.split('\n');
  const relevantLines: string[] = [];

  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (keywords.some((keyword) => lowerLine.includes(keyword))) {
      relevantLines.push(line);
    }
  }

  return relevantLines.join('\n');
}

function parseInterfaceFields(content: string, fieldType: 'input' | 'output'): InterfaceField[] {
  const fields: InterfaceField[] = [];

  // Simple heuristic: look for field-like patterns
  const fieldPattern = /(\w+):\s*(\w+)/g;
  let match;

  while ((match = fieldPattern.exec(content)) !== null) {
    fields.push({
      name: match[1],
      type: match[2],
      required: true,
      description: `${fieldType} field ${match[1]}`,
    });
  }

  return fields;
}

function determineDependencies(unit: HierarchicalNode, allUnits: HierarchicalNode[]): string[] {
  // Simple heuristic: units with similar keywords may depend on each other
  const unitKeywords = new Set(extractKeywords(unit.title));
  const dependencies: string[] = [];

  for (const otherUnit of allUnits) {
    if (otherUnit.id === unit.id) continue;

    const otherKeywords = extractKeywords(otherUnit.title);
    const overlap = otherKeywords.filter((kw) => unitKeywords.has(kw));

    if (overlap.length > 0) {
      dependencies.push(otherUnit.id);
    }
  }

  return dependencies;
}

function formatInterfaceName(title: string): string {
  // Convert "user authentication" -> "UserAuthenticationInterface"
  return (
    title
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('') + 'Interface'
  );
}

function formatComponentName(title: string): string {
  // Convert "user authentication" -> "UserAuthenticationComponent"
  return (
    title
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('') + 'Component'
  );
}

function suggestsPersistence(iface: InterfaceContract): boolean {
  // Check if interface name or fields suggest data persistence
  const persistenceKeywords = ['store', 'save', 'persist', 'database', 'repository'];
  const name = iface.name.toLowerCase();

  return persistenceKeywords.some((keyword) => name.includes(keyword));
}

function deriveResponsibilities(unit: HierarchicalNode, interfaces: InterfaceContract[]): string[] {
  const responsibilities: string[] = [];

  // Base responsibility from unit title
  responsibilities.push(`Implement ${unit.title}`);

  // Add responsibilities based on interfaces
  for (const iface of interfaces) {
    if (iface.inputs.length > 0) {
      responsibilities.push(`Process inputs for ${iface.name}`);
    }
    if (iface.outputs.length > 0) {
      responsibilities.push(`Generate outputs for ${iface.name}`);
    }
  }

  return responsibilities;
}

function extractAllKeywords(specContent: string): Set<string> {
  return new Set(extractKeywords(specContent));
}

function extractDesignKeywords(design: DesignArtifacts): Set<string> {
  const keywords = new Set<string>();

  for (const iface of design.interfaces) {
    extractKeywords(iface.name).forEach((kw) => keywords.add(kw));
    extractKeywords(iface.description).forEach((kw) => keywords.add(kw));
  }

  for (const comp of design.components) {
    extractKeywords(comp.name).forEach((kw) => keywords.add(kw));
    extractKeywords(comp.description).forEach((kw) => keywords.add(kw));
  }

  return keywords;
}

function calculateCoverage(specKeywords: Set<string>, designKeywords: Set<string>): number {
  if (specKeywords.size === 0) return 100;

  let covered = 0;
  for (const keyword of specKeywords) {
    if (designKeywords.has(keyword)) {
      covered++;
    }
  }

  return Math.round((covered / specKeywords.size) * 100);
}
