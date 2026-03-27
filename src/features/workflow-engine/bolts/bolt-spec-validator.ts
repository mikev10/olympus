import type { BoltSpec } from '../phase-types.js';
import { BoltValidationError } from '../phase-types.js';

const VALID_DOCS_IMPACT_VALUES = new Set([
  'none',
  'readme',
  'user-guide',
  'config-reference',
  'cli-reference',
  'migration-guide',
  'architecture',
  'code-comments',
]);

export interface ValidationContext {
  existing_bolts_in_unit: number;
  existing_bolts_total: number;
}

const BOLT_ID_PATTERN = /^BOLT-\d{3}-[a-z0-9-]+$/;
const MAX_BOLTS_PER_UNIT = 8;
const MAX_BOLTS_TOTAL = 50;

export class BoltSpecValidator {
  static validate(spec: BoltSpec, context: ValidationContext): string[] {
    if (context.existing_bolts_in_unit >= MAX_BOLTS_PER_UNIT) {
      throw new BoltValidationError(
        'MAX_PER_UNIT_EXCEEDED',
        `Unit ${spec.parent_unit_id} already has ${MAX_BOLTS_PER_UNIT} bolts. Maximum is ${MAX_BOLTS_PER_UNIT} per unit.`,
      );
    }

    if (context.existing_bolts_total >= MAX_BOLTS_TOTAL) {
      throw new BoltValidationError(
        'MAX_TOTAL_EXCEEDED',
        `Total bolt count is already ${MAX_BOLTS_TOTAL}. Maximum is ${MAX_BOLTS_TOTAL} across all units.`,
      );
    }

    if (!spec.scope || spec.scope.trim() === '') {
      throw new BoltValidationError(
        'MISSING_REQUIRED_FIELD',
        'BoltSpec.scope is required and must be a non-empty string.',
      );
    }

    if (!spec.acceptance_criteria || spec.acceptance_criteria.length < 1) {
      throw new BoltValidationError(
        'MISSING_REQUIRED_FIELD',
        'BoltSpec.acceptance_criteria must have at least 1 item.',
      );
    }

    if (!BOLT_ID_PATTERN.test(spec.id)) {
      throw new BoltValidationError(
        'INVALID_ID_FORMAT',
        'BoltSpec.id must match BOLT-NNN-slug format (e.g. BOLT-001-add-user-auth).',
      );
    }

    if (!spec.parent_unit_id || spec.parent_unit_id.trim() === '') {
      throw new BoltValidationError(
        'MISSING_REQUIRED_FIELD',
        'BoltSpec.parent_unit_id is required and must be a non-empty string.',
      );
    }

    if (!Number.isInteger(spec.sequence) || spec.sequence < 1) {
      throw new BoltValidationError(
        'INVALID_SEQUENCE',
        'BoltSpec.sequence must be a positive integer (>= 1).',
      );
    }

    // Validate dependency fields (v3.1.0)
    if (spec.requires_bolts && spec.requires_bolts.length > 0) {
      // Self-reference check
      if (spec.requires_bolts.includes(spec.id)) {
        throw new BoltValidationError(
          'MISSING_REQUIRED_FIELD',
          `Bolt ${spec.id} cannot depend on itself in requires_bolts.`,
        );
      }
    }

    if (spec.requires_units && spec.requires_units.length > 0) {
      // Cannot require own parent unit (that would be circular)
      if (spec.requires_units.includes(spec.parent_unit_id)) {
        throw new BoltValidationError(
          'MISSING_REQUIRED_FIELD',
          `Bolt ${spec.id} cannot require its own parent unit ${spec.parent_unit_id} in requires_units.`,
        );
      }
    }

    const warnings: string[] = [];

    if (spec.requirements !== undefined && spec.requirements.length === 0) {
      warnings.push('Bolt has no requirement traceability');
    }

    if (spec.stories !== undefined && spec.stories.length === 0) {
      warnings.push('Bolt has no story traceability');
    }

    if (spec.docs_impact !== undefined) {
      for (const value of spec.docs_impact) {
        if (!VALID_DOCS_IMPACT_VALUES.has(value)) {
          warnings.push(`docs_impact contains invalid value: "${value}". Valid values are: ${[...VALID_DOCS_IMPACT_VALUES].join(', ')}`);
        }
      }
    }

    return warnings;
  }

  /**
   * Validates that a set of bolts has no circular dependencies.
   * Uses depth-first search to detect cycles in the requires_bolts graph.
   *
   * @throws BoltValidationError with code MISSING_REQUIRED_FIELD if cycle detected
   */
  static validateNoCycles(bolts: BoltSpec[]): void {
    const graph = new Map<string, string[]>();
    for (const bolt of bolts) {
      graph.set(bolt.id, bolt.requires_bolts ?? []);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();

    function dfs(nodeId: string, path: string[]): void {
      if (inStack.has(nodeId)) {
        const cycleStart = path.indexOf(nodeId);
        const cycle = path.slice(cycleStart).concat(nodeId);
        throw new BoltValidationError(
          'CIRCULAR_DEPENDENCY',
          `Circular dependency detected: ${cycle.join(' → ')}`,
        );
      }
      if (visited.has(nodeId)) return;

      visited.add(nodeId);
      inStack.add(nodeId);

      const deps = graph.get(nodeId) ?? [];
      for (const dep of deps) {
        dfs(dep, [...path, nodeId]);
      }

      inStack.delete(nodeId);
    }

    for (const bolt of bolts) {
      if (!visited.has(bolt.id)) {
        dfs(bolt.id, []);
      }
    }
  }
}
