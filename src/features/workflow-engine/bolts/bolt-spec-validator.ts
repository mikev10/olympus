import type { BoltSpec } from '../phase-types.js';
import { BoltValidationError } from '../phase-types.js';

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

    const warnings: string[] = [];

    if (spec.requirements !== undefined && spec.requirements.length === 0) {
      warnings.push('Bolt has no requirement traceability');
    }

    if (spec.stories !== undefined && spec.stories.length === 0) {
      warnings.push('Bolt has no story traceability');
    }

    return warnings;
  }
}
