import { describe, it, expect } from 'vitest';
import type { BoltSpec } from '../../../features/workflow-engine/phase-types.js';
import { BoltValidationError } from '../../../features/workflow-engine/phase-types.js';
import { BoltSpecValidator } from '../../../features/workflow-engine/bolts/bolt-spec-validator.js';
import type { ValidationContext } from '../../../features/workflow-engine/bolts/bolt-spec-validator.js';

function makeValidBoltSpec(overrides?: Partial<BoltSpec>): BoltSpec {
  return {
    id: 'BOLT-001-test-bolt',
    type: 'bolt',
    title: 'Test Bolt',
    parent_id: 'UNIT-001',
    children_ids: [],
    status: 'pending',
    assigned_agent: null,
    estimated_effort: 2,
    parent_unit_id: 'UNIT-001',
    sequence: 1,
    scope: 'Test scope',
    acceptance_criteria: ['Criterion 1'],
    target_files: ['src/test.ts'],
    dependencies: [],
    depth_target: 5,
    express_mode: false,
    estimated_effort_hours: 2,
    requirements: ['FR-1'],
    stories: ['S-001'],
    docs_impact: ['none'],
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ValidationContext>): ValidationContext {
  return {
    existing_bolts_in_unit: 0,
    existing_bolts_total: 0,
    ...overrides,
  };
}

describe('BoltSpecValidator', () => {
  it('valid spec passes without throwing', () => {
    expect(() =>
      BoltSpecValidator.validate(makeValidBoltSpec(), makeContext()),
    ).not.toThrow();
  });

  it('throws MAX_PER_UNIT_EXCEEDED when existing_bolts_in_unit >= 8', () => {
    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec(),
        makeContext({ existing_bolts_in_unit: 8 }),
      ),
    ).toThrow(BoltValidationError);

    try {
      BoltSpecValidator.validate(
        makeValidBoltSpec(),
        makeContext({ existing_bolts_in_unit: 8 }),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(BoltValidationError);
      expect((err as BoltValidationError).code).toBe('MAX_PER_UNIT_EXCEEDED');
    }
  });

  it('throws MAX_TOTAL_EXCEEDED when existing_bolts_total >= 50', () => {
    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec(),
        makeContext({ existing_bolts_total: 50 }),
      ),
    ).toThrow(BoltValidationError);

    try {
      BoltSpecValidator.validate(
        makeValidBoltSpec(),
        makeContext({ existing_bolts_total: 50 }),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(BoltValidationError);
      expect((err as BoltValidationError).code).toBe('MAX_TOTAL_EXCEEDED');
    }
  });

  it('throws MISSING_REQUIRED_FIELD for empty scope', () => {
    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec({ scope: '' }),
        makeContext(),
      ),
    ).toThrow(BoltValidationError);

    try {
      BoltSpecValidator.validate(
        makeValidBoltSpec({ scope: '   ' }),
        makeContext(),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(BoltValidationError);
      expect((err as BoltValidationError).code).toBe('MISSING_REQUIRED_FIELD');
      expect((err as BoltValidationError).message).toContain('scope');
    }
  });

  it('throws MISSING_REQUIRED_FIELD for empty acceptance_criteria', () => {
    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec({ acceptance_criteria: [] }),
        makeContext(),
      ),
    ).toThrow(BoltValidationError);

    try {
      BoltSpecValidator.validate(
        makeValidBoltSpec({ acceptance_criteria: [] }),
        makeContext(),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(BoltValidationError);
      expect((err as BoltValidationError).code).toBe('MISSING_REQUIRED_FIELD');
      expect((err as BoltValidationError).message).toContain('acceptance_criteria');
    }
  });

  it('throws INVALID_ID_FORMAT for malformed bolt IDs', () => {
    const invalidIds = [
      'BOLT-1-foo',
      'bolt-001-bar',
      'BOLT-001',
      'BOLT-0001-too-many-digits',
      'UNIT-001-wrong-prefix',
      'BOLT-001-UPPERCASE',
      'BOLT-001-special_chars',
      '',
    ];

    for (const id of invalidIds) {
      expect(
        () => BoltSpecValidator.validate(makeValidBoltSpec({ id }), makeContext()),
        `expected INVALID_ID_FORMAT for id="${id}"`,
      ).toThrow(BoltValidationError);
    }
  });

  it('throws MISSING_REQUIRED_FIELD for empty parent_unit_id', () => {
    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec({ parent_unit_id: '' }),
        makeContext(),
      ),
    ).toThrow(BoltValidationError);

    try {
      BoltSpecValidator.validate(
        makeValidBoltSpec({ parent_unit_id: '   ' }),
        makeContext(),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(BoltValidationError);
      expect((err as BoltValidationError).code).toBe('MISSING_REQUIRED_FIELD');
      expect((err as BoltValidationError).message).toContain('parent_unit_id');
    }
  });

  it('throws INVALID_SEQUENCE for non-positive sequence', () => {
    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec({ sequence: 0 }),
        makeContext(),
      ),
    ).toThrow(BoltValidationError);

    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec({ sequence: -1 }),
        makeContext(),
      ),
    ).toThrow(BoltValidationError);

    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec({ sequence: 1.5 }),
        makeContext(),
      ),
    ).toThrow(BoltValidationError);

    try {
      BoltSpecValidator.validate(
        makeValidBoltSpec({ sequence: 0 }),
        makeContext(),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(BoltValidationError);
      expect((err as BoltValidationError).code).toBe('INVALID_SEQUENCE');
    }
  });

  it('error is instance of BoltValidationError with correct code', () => {
    try {
      BoltSpecValidator.validate(
        makeValidBoltSpec({ scope: '' }),
        makeContext(),
      );
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BoltValidationError);
      expect(err).toBeInstanceOf(Error);
      expect((err as BoltValidationError).name).toBe('BoltValidationError');
      expect((err as BoltValidationError).code).toBe('MISSING_REQUIRED_FIELD');
      expect((err as BoltValidationError).message).toBeTruthy();
    }
  });

  it('valid bolt IDs pass validation', () => {
    const validIds = ['BOLT-001-foo', 'BOLT-099-bar-baz', 'BOLT-123-a-b-c-d', 'BOLT-000-x'];

    for (const id of validIds) {
      expect(
        () => BoltSpecValidator.validate(makeValidBoltSpec({ id }), makeContext()),
        `expected no error for id="${id}"`,
      ).not.toThrow();
    }
  });

  it('returns warning for invalid docs_impact value', () => {
    const warnings = BoltSpecValidator.validate(
      makeValidBoltSpec({ docs_impact: ['invalid-type'] }),
      makeContext(),
    );
    expect(warnings.some((w) => w.includes('docs_impact') && w.includes('invalid-type'))).toBe(true);
  });

  it('passes without warning for valid docs_impact values', () => {
    const validValues = ['none', 'readme', 'user-guide', 'config-reference', 'cli-reference', 'migration-guide', 'architecture', 'code-comments'];
    for (const value of validValues) {
      const warnings = BoltSpecValidator.validate(
        makeValidBoltSpec({ docs_impact: [value] }),
        makeContext(),
      );
      expect(warnings.some((w) => w.includes('docs_impact'))).toBe(false);
    }
  });

  it('returns multiple warnings for multiple invalid docs_impact values', () => {
    const warnings = BoltSpecValidator.validate(
      makeValidBoltSpec({ docs_impact: ['bad-one', 'bad-two'] }),
      makeContext(),
    );
    expect(warnings.filter((w) => w.includes('docs_impact'))).toHaveLength(2);
  });

  it('passes when docs_impact is undefined', () => {
    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec({ docs_impact: undefined }),
        makeContext(),
      ),
    ).not.toThrow();
  });

  it('boundary cases: exactly 8 bolts blocks, 7 passes; exactly 50 total blocks, 49 passes', () => {
    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec(),
        makeContext({ existing_bolts_in_unit: 7 }),
      ),
    ).not.toThrow();

    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec(),
        makeContext({ existing_bolts_in_unit: 8 }),
      ),
    ).toThrow(BoltValidationError);

    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec(),
        makeContext({ existing_bolts_total: 49 }),
      ),
    ).not.toThrow();

    expect(() =>
      BoltSpecValidator.validate(
        makeValidBoltSpec(),
        makeContext({ existing_bolts_total: 50 }),
      ),
    ).toThrow(BoltValidationError);
  });
});
