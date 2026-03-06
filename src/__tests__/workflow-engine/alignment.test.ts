import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeVerification,
  generateValidationQuestions,
  runAlignmentCheck,
  runDualValidation,
  getConformanceThreshold,
  getAdaptiveThreshold,
  recordAlignmentResult,
  type TransitionType,
  type RootValidationType,
} from '../../features/workflow-engine/alignment.js';

vi.mock('../../features/workflow-engine/manifest.js', () => ({
  loadManifest: vi.fn(),
  saveManifest: vi.fn(),
}));

// Test fixtures for the 4-stage AIDLC pipeline

const INTENT_CONTENT = `---
type: intent
---
# Authentication System INTENT

## Problem Statement
- Users need secure authentication
- System must scale to enterprise use
- Must integrate with existing SSO providers
- Must comply with SOC2 requirements

## Business Requirements
- Users need secure authentication
- System must scale to enterprise use
- Must integrate with existing SSO providers
- Must comply with SOC2 requirements

## Implementation Plan
### Proposed UNITs
- UNIT-001: OAuth2 authentication module
- UNIT-002: SSO connector for enterprise providers
- UNIT-003: Session management and token validation

## Success Metrics
- 99.9% uptime SLA
- < 200ms authentication response time
- Support 10,000 concurrent users
- Launch within Q1 2026
`;

const UNIT_CONTENT = `---
type: unit
---
# UNIT-001: OAuth2 Authentication Module

This UNIT addresses:
- Users need secure authentication (INTENT requirement)
- System must scale to enterprise use (INTENT requirement)
- 99.9% uptime SLA (success metric)
- < 200ms authentication response time (success metric)
- Support 10,000 concurrent users (success metric)
- Must integrate with existing SSO providers (INTENT)
- Must comply with SOC2 requirements (INTENT)
- UNIT-001: OAuth2 authentication module (from Implementation Plan)
- UNIT-002: SSO connector for enterprise providers (from Implementation Plan)
- UNIT-003: Session management and token validation (from Implementation Plan)

## Acceptance Criteria
- [ ] Implement OAuth2 authorization code flow
- [ ] Support refresh token rotation
- [ ] Validate JWT tokens correctly
- [ ] Handle concurrent authentication requests

## Target Files
- [ ] src/auth/oauth2-handler.ts
- [ ] src/auth/token-validator.ts
- [ ] tests/auth/oauth2.test.ts
`;

const BOLT_CONTENT = `---
type: bolt
---
# BOLT-001: OAuth2 Core Implementation

## Implementation Details
Addresses the following from the INTENT:
- Users need secure authentication
- System must scale to enterprise use
- Must integrate with existing SSO providers
- Must comply with SOC2 requirements
- 99.9% uptime SLA
- < 200ms authentication response time
- Support 10,000 concurrent users
- Launch within Q1 2026

Implements OAuth2 authorization code flow with the following:
- Implement OAuth2 authorization code flow
- Support refresh token rotation for security
- Validate JWT tokens correctly using RS256
- Optimized to handle concurrent authentication requests

## Files Created
- src/auth/oauth2-handler.ts - main OAuth2 handler
- src/auth/token-validator.ts - JWT validation logic
- tests/auth/oauth2.test.ts - comprehensive test suite
`;

describe('computeVerification', () => {
  describe('intent-to-unit transition', () => {
    it('passes when UNIT covers INTENT scope (>= 95%)', () => {
      const result = computeVerification(INTENT_CONTENT, UNIT_CONTENT, 'intent-to-unit');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBeGreaterThanOrEqual(95);
    });

    it('fails when UNIT misses INTENT requirements (< 95%)', () => {
      const incompleteUnit = `# UNIT

## Acceptance Criteria
- [ ] Implement OAuth2 authorization code flow
`;

      const result = computeVerification(INTENT_CONTENT, incompleteUnit, 'intent-to-unit');

      expect(result.passed).toBe(false);
      expect(result.conformance_score).toBeLessThan(95);
    });

    it('extracts from Business Requirements and Implementation Plan (Proposed UNITs)', () => {
      const intentWithUnits = `# Intent

## Business Requirements
- Requirement A
- Requirement B

## Implementation Plan
### Proposed UNITs
- UNIT-001: Component A
- UNIT-002: Component B
`;

      const unitCoveringAll = `# UNIT

Covers Requirement A, Requirement B, UNIT-001: Component A, and UNIT-002: Component B
`;

      const result = computeVerification(intentWithUnits, unitCoveringAll, 'intent-to-unit');

      expect(result.conformance_score).toBe(100);
      expect(result.missing_items).toEqual([]);
    });
  });

  describe('unit-to-bolt transition', () => {
    it('passes when BOLT implements all UNIT acceptance criteria (>= 100%)', () => {
      const result = computeVerification(UNIT_CONTENT, BOLT_CONTENT, 'unit-to-bolt');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBe(100);
    });

    it('fails when BOLT misses acceptance criteria (< 100%)', () => {
      const incompleteBolt = `# BOLT

Implements OAuth2 authorization code flow
`;

      const result = computeVerification(UNIT_CONTENT, incompleteBolt, 'unit-to-bolt');

      expect(result.passed).toBe(false);
      expect(result.conformance_score).toBeLessThan(100);
      expect(result.missing_items.length).toBeGreaterThan(0);
    });

    it('extracts from Acceptance Criteria and Target Files', () => {
      const unitWithCriteria = `# UNIT

## Acceptance Criteria
- [ ] Feature X implemented
- [ ] Feature Y tested
- [ ] Performance optimized

## Target Files
- [ ] src/main.ts
- [ ] tests/main.test.ts
`;

      const boltCoveringAll = `# BOLT

Implemented Feature X implemented, Feature Y tested, and Performance optimized.
Created src/main.ts and tests/main.test.ts.
`;

      const result = computeVerification(unitWithCriteria, boltCoveringAll, 'unit-to-bolt');

      expect(result.conformance_score).toBe(100);
      expect(result.missing_items).toEqual([]);
    });

    it('handles checkbox formatting in acceptance criteria', () => {
      const unitWithCheckboxes = `# UNIT

## Acceptance Criteria
- [x] Already done
- [ ] To be done
- [x] Also done
`;

      const bolt = `# BOLT

Implemented: Already done, To be done, Also done
`;

      const result = computeVerification(unitWithCheckboxes, bolt, 'unit-to-bolt');

      expect(result.conformance_score).toBe(100);
    });
  });

  describe('Root validation types', () => {
    describe('unit-to-intent', () => {
      it('passes when UNIT contributes to INTENT (>= 80%)', () => {
        const result = computeVerification(INTENT_CONTENT, UNIT_CONTENT, 'unit-to-intent');

        expect(result.passed).toBe(true);
        expect(result.conformance_score).toBeGreaterThanOrEqual(80);
      });

      it('extracts from Business Requirements and Implementation Plan', () => {
        const intent = `# INTENT

## Business Requirements
- Problem A
- Problem B

## Implementation Plan
### Proposed UNITs
- Metric X
- Metric Y
`;

        const unit = `# UNIT

Addresses Problem A, Problem B, Metric X, and Metric Y
`;

        const result = computeVerification(intent, unit, 'unit-to-intent');

        expect(result.conformance_score).toBe(100);
      });
    });

    describe('bolt-to-intent', () => {
      it('passes when BOLT aligns with INTENT (>= 70%)', () => {
        const result = computeVerification(INTENT_CONTENT, BOLT_CONTENT, 'bolt-to-intent');

        expect(result.passed).toBe(true);
        expect(result.conformance_score).toBeGreaterThanOrEqual(70);
      });

      it('extracts from Business Requirements and Implementation Plan', () => {
        const intent = `# INTENT

## Business Requirements
- Core problem to solve

## Implementation Plan
### Proposed UNITs
- Key metric to achieve
`;

        const bolt = `# BOLT

Solves Core problem to solve and achieves Key metric to achieve
`;

        const result = computeVerification(intent, bolt, 'bolt-to-intent');

        expect(result.conformance_score).toBe(100);
      });

      it('lower threshold allows partial alignment', () => {
        const intent = `# INTENT

## Problem Statement
- Problem 1
- Problem 2
- Problem 3

## Success Metrics
- Metric A
- Metric B
`;

        const partialBolt = `# BOLT

Addresses Problem 1, Problem 2, and Metric A
`;

        const result = computeVerification(intent, partialBolt, 'bolt-to-intent');

        expect(result.conformance_score).toBe(60);
        expect(result.passed).toBe(false);
      });
    });
  });

  describe('Edge cases', () => {
    it('empty source content returns 100% score', () => {
      const result = computeVerification('', UNIT_CONTENT, 'intent-to-unit');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBe(100);
      expect(result.coverage_percentage).toBe(100);
      expect(result.missing_items).toEqual([]);
    });

    it('empty target content with non-empty source returns 0%', () => {
      const result = computeVerification(INTENT_CONTENT, '', 'intent-to-unit');

      expect(result.passed).toBe(false);
      expect(result.conformance_score).toBe(0);
      expect(result.missing_items.length).toBeGreaterThan(0);
    });

    it('handles content without frontmatter', () => {
      const noFrontmatter = `# INTENT

## Business Requirements
- Requirement A
- Requirement B
`;

      const target = `# UNIT

Covers Requirement A and Requirement B
`;

      const result = computeVerification(noFrontmatter, target, 'intent-to-unit');

      expect(result.conformance_score).toBe(100);
    });

    it('case-insensitive matching', () => {
      const source = `# INTENT

## Business Requirements
- OAuth2 Authentication
- SSO Integration
`;

      const target = `# UNIT

oauth2 authentication and sso integration are implemented
`;

      const result = computeVerification(source, target, 'intent-to-unit');

      expect(result.conformance_score).toBe(100);
      expect(result.missing_items).toEqual([]);
    });

    it('source with no extractable requirements returns 100%', () => {
      const noRequirements = `---
type: intent
---
# INTENT

## Business Requirements
Just plain text, no bullets
`;

      const result = computeVerification(noRequirements, UNIT_CONTENT, 'intent-to-unit');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBe(100);
      expect(result.coverage_percentage).toBe(100);
      expect(result.missing_items).toEqual([]);
    });
  });
});

describe('generateValidationQuestions', () => {
  const allTypes: Array<TransitionType | RootValidationType> = [
    'intent-to-unit',
    'unit-to-bolt',
    'unit-to-intent',
    'bolt-to-intent',
  ];

  allTypes.forEach((transition) => {
    describe(`for ${transition}`, () => {
      it('returns 2 questions', () => {
        const questions = generateValidationQuestions(transition);
        expect(questions).toHaveLength(2);
      });

      it('all questions start unanswered', () => {
        const questions = generateValidationQuestions(transition);

        questions.forEach((q) => {
          expect(q.answer).toBeNull();
          expect(q.passed).toBeNull();
          expect(q.answered_by).toBeNull();
        });
      });

      it('contains correct verification question text', () => {
        const questions = generateValidationQuestions(transition);
        expect(questions[0].question).toBeTruthy();
        expect(questions[0].question.length).toBeGreaterThan(0);
      });

      it('contains correct validation question text', () => {
        const questions = generateValidationQuestions(transition);
        expect(questions[1].question).toBeTruthy();
        expect(questions[1].question.length).toBeGreaterThan(0);
      });
    });
  });

  describe('question content validation', () => {
    it('intent-to-unit asks about INTENT scope and working module', () => {
      const questions = generateValidationQuestions('intent-to-unit');
      expect(questions[0].question).toContain('UNIT');
      expect(questions[0].question).toContain('INTENT');
      expect(questions[1].question).toContain('working module');
    });

    it('unit-to-bolt asks about acceptance criteria and progress', () => {
      const questions = generateValidationQuestions('unit-to-bolt');
      expect(questions[0].question).toContain('BOLT');
      expect(questions[0].question).toContain('acceptance criteria');
      expect(questions[1].question).toContain('testable progress');
    });

    it('unit-to-intent asks about INTENT contribution', () => {
      const questions = generateValidationQuestions('unit-to-intent');
      expect(questions[0].question).toContain('UNIT');
      expect(questions[0].question).toContain('INTENT');
      expect(questions[1].question).toContain('success metrics');
    });

    it('bolt-to-intent asks about INTENT alignment', () => {
      const questions = generateValidationQuestions('bolt-to-intent');
      expect(questions[0].question).toContain('BOLT');
      expect(questions[0].question).toContain('INTENT');
      expect(questions[1].question).toContain('goals');
    });
  });
});

describe('runAlignmentCheck', () => {
  it('returns AlignmentCheck with both verification and validation', () => {
    const result = runAlignmentCheck(INTENT_CONTENT, UNIT_CONTENT, 'intent-1', 'unit-1', 'intent-to-unit');

    expect(result).toHaveProperty('verification');
    expect(result).toHaveProperty('validation');
    expect(result.verification).toHaveProperty('conformance_score');
    expect(result.validation).toHaveProperty('alignment_score');
    expect(result.validation).toHaveProperty('alignment_questions');
  });

  it('alignment_passed is false when validation questions are unanswered', () => {
    const result = runAlignmentCheck(INTENT_CONTENT, UNIT_CONTENT, 'intent-1', 'unit-1', 'intent-to-unit');

    expect(result.validation.passed).toBe(false);
    expect(result.alignment_passed).toBe(false);
  });

  it('alignment_passed is false when verification fails', () => {
    const incompleteUnit = `# UNIT\n\nNo requirements covered`;

    const result = runAlignmentCheck(INTENT_CONTENT, incompleteUnit, 'intent-1', 'unit-1', 'intent-to-unit');

    expect(result.verification.passed).toBe(false);
    expect(result.alignment_passed).toBe(false);
  });

  it('returns correct sourceId and targetId', () => {
    const result = runAlignmentCheck(
      INTENT_CONTENT,
      UNIT_CONTENT,
      'source-123',
      'target-456',
      'intent-to-unit'
    );

    expect(result.source_artifact_id).toBe('source-123');
    expect(result.target_artifact_id).toBe('target-456');
  });

  it('checked_at is a valid ISO timestamp', () => {
    const result = runAlignmentCheck(INTENT_CONTENT, UNIT_CONTENT, 'intent-1', 'unit-1', 'intent-to-unit');

    expect(result.checked_at).toBeTruthy();
    const date = new Date(result.checked_at);
    expect(date.toISOString()).toBe(result.checked_at);
  });

  it('works with root validation types', () => {
    const result = runAlignmentCheck(INTENT_CONTENT, UNIT_CONTENT, 'intent-1', 'unit-1', 'unit-to-intent');

    expect(result.verification).toBeDefined();
    expect(result.validation).toBeDefined();
    expect(result.verification.conformance_score).toBeGreaterThanOrEqual(0);
  });
});

describe('runDualValidation', () => {
  it('runs both parent check and root check', () => {
    const result = runDualValidation(
      UNIT_CONTENT,
      INTENT_CONTENT,
      INTENT_CONTENT,
      'intent-to-unit',
      'unit-to-intent',
      'intent-1',
      'unit-1',
      'intent-root-1'
    );

    expect(result).toHaveProperty('parentCheck');
    expect(result).toHaveProperty('rootCheck');
    expect(result).toHaveProperty('passed');

    expect(result.parentCheck.source_artifact_id).toBe('intent-1');
    expect(result.parentCheck.target_artifact_id).toBe('unit-1');

    expect(result.rootCheck.source_artifact_id).toBe('intent-root-1');
    expect(result.rootCheck.target_artifact_id).toBe('unit-1');
  });

  it('passed is true only when both checks pass verification', () => {
    const result = runDualValidation(
      UNIT_CONTENT,
      INTENT_CONTENT,
      INTENT_CONTENT,
      'intent-to-unit',
      'unit-to-intent',
      'intent-1',
      'unit-1',
      'intent-root-1'
    );

    expect(result.parentCheck.verification.passed).toBe(true);
    expect(result.rootCheck.verification.passed).toBe(true);

    expect(result.parentCheck.alignment_passed).toBe(false);
    expect(result.rootCheck.alignment_passed).toBe(false);

    expect(result.passed).toBe(false);
  });

  it('passed is false when parent check fails', () => {
    const incompleteBolt = `# BOLT\n\nPartial implementation`;

    const result = runDualValidation(
      incompleteBolt,
      UNIT_CONTENT,
      INTENT_CONTENT,
      'unit-to-bolt',
      'bolt-to-intent',
      'unit-1',
      'bolt-1',
      'intent-1'
    );

    expect(result.parentCheck.verification.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('passed is false when root check fails', () => {
    const unrelatedUnit = `# UNIT

## Acceptance Criteria
- [ ] Something completely unrelated to the INTENT
`;

    const result = runDualValidation(
      unrelatedUnit,
      INTENT_CONTENT,
      INTENT_CONTENT,
      'intent-to-unit',
      'unit-to-intent',
      'intent-1',
      'unit-1',
      'intent-root-1'
    );

    expect(result.rootCheck.verification.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('returns combined results for downstream analysis', () => {
    const result = runDualValidation(
      UNIT_CONTENT,
      INTENT_CONTENT,
      INTENT_CONTENT,
      'intent-to-unit',
      'unit-to-intent',
      'intent-1',
      'unit-1',
      'intent-root-1'
    );

    expect(result.parentCheck.verification.conformance_score).toBeGreaterThan(0);
    expect(result.rootCheck.verification.conformance_score).toBeGreaterThan(0);
    expect(result.parentCheck.validation.alignment_questions.length).toBe(2);
    expect(result.rootCheck.validation.alignment_questions.length).toBe(2);
  });
});

describe('getAdaptiveThreshold', () => {
  it('Trust 0-1: returns base threshold', () => {
    expect(getAdaptiveThreshold(90, 0)).toBe(90);
    expect(getAdaptiveThreshold(90, 1)).toBe(90);
    expect(getAdaptiveThreshold(100, 0)).toBe(100);
    expect(getAdaptiveThreshold(100, 1)).toBe(100);
  });

  it('Trust 2: returns base - 10', () => {
    expect(getAdaptiveThreshold(90, 2)).toBe(80);
    expect(getAdaptiveThreshold(100, 2)).toBe(90);
    expect(getAdaptiveThreshold(70, 2)).toBe(60);
  });

  it('Trust 3: returns base - 20', () => {
    expect(getAdaptiveThreshold(90, 3)).toBe(70);
    expect(getAdaptiveThreshold(100, 3)).toBe(80);
    expect(getAdaptiveThreshold(70, 3)).toBe(50);
  });

  it('minimum threshold is 0', () => {
    expect(getAdaptiveThreshold(10, 2)).toBe(0);
    expect(getAdaptiveThreshold(15, 3)).toBe(0);
    expect(getAdaptiveThreshold(0, 3)).toBe(0);
  });

  it('handles edge cases', () => {
    expect(getAdaptiveThreshold(0, 0)).toBe(0);
    expect(getAdaptiveThreshold(0, 3)).toBe(0);
    expect(getAdaptiveThreshold(100, 0)).toBe(100);
  });
});

describe('getConformanceThreshold', () => {
  describe('transition types', () => {
    it('returns 95 for intent-to-unit', () => {
      expect(getConformanceThreshold('intent-to-unit')).toBe(95);
    });

    it('returns 100 for unit-to-bolt', () => {
      expect(getConformanceThreshold('unit-to-bolt')).toBe(100);
    });
  });

  describe('root validation types', () => {
    it('returns 80 for unit-to-intent', () => {
      expect(getConformanceThreshold('unit-to-intent')).toBe(80);
    });

    it('returns 70 for bolt-to-intent', () => {
      expect(getConformanceThreshold('bolt-to-intent')).toBe(70);
    });
  });
});

describe('recordAlignmentResult', () => {
  let loadManifest: ReturnType<typeof vi.fn>;
  let saveManifest: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const manifestModule = await import('../../features/workflow-engine/manifest.js');
    loadManifest = manifestModule.loadManifest as ReturnType<typeof vi.fn>;
    saveManifest = manifestModule.saveManifest as ReturnType<typeof vi.fn>;
    loadManifest.mockReset();
    saveManifest.mockReset();
  });

  it('calls loadManifest and saveManifest correctly', () => {
    const mockManifest = {
      artifacts: [],
      alignment_checks: [],
      metadata: { created_at: '2024-01-01', last_updated: '2024-01-01' },
    };
    loadManifest.mockReturnValue(mockManifest);

    const check = runAlignmentCheck(INTENT_CONTENT, UNIT_CONTENT, 'intent-1', 'unit-1', 'intent-to-unit');
    recordAlignmentResult('/path/to/manifest.json', check);

    expect(loadManifest).toHaveBeenCalledWith('/path/to/manifest.json');
    expect(saveManifest).toHaveBeenCalledWith(
      '/path/to/manifest.json',
      expect.objectContaining({
        alignment_checks: expect.arrayContaining([check]),
      })
    );
  });

  it('returns silently when manifest is null', () => {
    loadManifest.mockReturnValue(null);

    const check = runAlignmentCheck(INTENT_CONTENT, UNIT_CONTENT, 'intent-1', 'unit-1', 'intent-to-unit');

    expect(() => {
      recordAlignmentResult('/path/to/manifest.json', check);
    }).not.toThrow();

    expect(loadManifest).toHaveBeenCalled();
    expect(saveManifest).not.toHaveBeenCalled();
  });

  it('handles errors silently', () => {
    loadManifest.mockImplementation(() => {
      throw new Error('File read error');
    });

    const check = runAlignmentCheck(INTENT_CONTENT, UNIT_CONTENT, 'intent-1', 'unit-1', 'intent-to-unit');

    expect(() => {
      recordAlignmentResult('/path/to/manifest.json', check);
    }).not.toThrow();

    expect(saveManifest).not.toHaveBeenCalled();
  });
});
