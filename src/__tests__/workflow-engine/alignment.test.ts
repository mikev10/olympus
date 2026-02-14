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

// Test fixtures for the new 4-stage ODLC pipeline
const IDEA_CONTENT = `---
risk_tier: 2
---
# Feature IDEA

## Problem Statement
- Users need secure authentication
- System must scale to enterprise use

## Success Metrics
- 99.9% uptime SLA
- < 200ms authentication response time
- Support 10,000 concurrent users

## Business Constraints
- Must integrate with existing SSO providers
- Must comply with SOC2 requirements
- Launch within Q1 2026
`;

const INTENT_CONTENT = `---
type: intent
---
# Authentication System INTENT

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

## Success Criteria
The system achieves:
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
- Users need secure authentication (IDEA requirement)
- System must scale to enterprise use (IDEA requirement)
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
Addresses the following from the IDEA:
- Users need secure authentication
- System must scale to enterprise use
- 99.9% uptime SLA
- < 200ms authentication response time
- Support 10,000 concurrent users

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
  describe('idea-to-intent transition', () => {
    it('passes when INTENT covers IDEA constraints and success metrics (>= 90%)', () => {
      const result = computeVerification(IDEA_CONTENT, INTENT_CONTENT, 'idea-to-intent');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBeGreaterThanOrEqual(90);
      expect(result.coverage_percentage).toBeGreaterThanOrEqual(90);
      expect(result.missing_items.length).toBeLessThanOrEqual(1);
    });

    it('fails when INTENT misses IDEA requirements (< 90%)', () => {
      const incompleteIntent = `# Intent

## Business Requirements
- Users need secure authentication
`;

      const result = computeVerification(IDEA_CONTENT, incompleteIntent, 'idea-to-intent');

      expect(result.passed).toBe(false);
      expect(result.conformance_score).toBeLessThan(90);
      expect(result.missing_items.length).toBeGreaterThan(0);
    });

    it('extracts requirements from Problem Statement, Success Metrics, and Business Constraints', () => {
      const ideaWithSections = `---
risk_tier: 1
---
# IDEA

## Problem Statement
- Critical requirement A
- Critical requirement B

## Success Metrics
- Metric 1
- Metric 2

## Business Constraints
- Constraint X
- Constraint Y
`;

      const intentCoveringAll = `# Intent

Critical requirement A and Critical requirement B are addressed.
Metric 1 and Metric 2 will be tracked.
Constraint X and Constraint Y are implemented.
`;

      const result = computeVerification(ideaWithSections, intentCoveringAll, 'idea-to-intent');

      expect(result.conformance_score).toBe(100);
      expect(result.missing_items).toEqual([]);
    });
  });

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
    describe('unit-to-idea', () => {
      it('passes when UNIT contributes to IDEA (>= 80%)', () => {
        const result = computeVerification(IDEA_CONTENT, UNIT_CONTENT, 'unit-to-idea');

        expect(result.passed).toBe(true);
        expect(result.conformance_score).toBeGreaterThanOrEqual(80);
      });

      it('extracts from Problem Statement and Success Metrics', () => {
        const idea = `# IDEA

## Problem Statement
- Problem A
- Problem B

## Success Metrics
- Metric X
- Metric Y
`;

        const unit = `# UNIT

Addresses Problem A, Problem B, Metric X, and Metric Y
`;

        const result = computeVerification(idea, unit, 'unit-to-idea');

        expect(result.conformance_score).toBe(100);
      });
    });

    describe('bolt-to-idea', () => {
      it('passes when BOLT aligns with IDEA (>= 70%)', () => {
        const result = computeVerification(IDEA_CONTENT, BOLT_CONTENT, 'bolt-to-idea');

        expect(result.passed).toBe(true);
        expect(result.conformance_score).toBeGreaterThanOrEqual(70);
      });

      it('extracts from Problem Statement and Success Metrics', () => {
        const idea = `# IDEA

## Problem Statement
- Core problem to solve

## Success Metrics
- Key metric to achieve
`;

        const bolt = `# BOLT

Solves Core problem to solve and achieves Key metric to achieve
`;

        const result = computeVerification(idea, bolt, 'bolt-to-idea');

        expect(result.conformance_score).toBe(100);
      });

      it('lower threshold allows partial alignment', () => {
        const idea = `# IDEA

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

        const result = computeVerification(idea, partialBolt, 'bolt-to-idea');

        // Should pass at 70% threshold with 3/5 = 60% coverage
        // Actually covers 3 out of 5 = 60%, which is below 70%
        expect(result.conformance_score).toBe(60);
        expect(result.passed).toBe(false);
      });
    });
  });

  describe('Edge cases', () => {
    it('empty source content returns 100% score', () => {
      const result = computeVerification('', INTENT_CONTENT, 'idea-to-intent');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBe(100);
      expect(result.coverage_percentage).toBe(100);
      expect(result.missing_items).toEqual([]);
    });

    it('empty target content with non-empty source returns 0%', () => {
      const result = computeVerification(IDEA_CONTENT, '', 'idea-to-intent');

      expect(result.passed).toBe(false);
      expect(result.conformance_score).toBe(0);
      expect(result.missing_items.length).toBeGreaterThan(0);
    });

    it('handles content without frontmatter', () => {
      const noFrontmatter = `# IDEA

## Problem Statement
- Requirement A
- Requirement B
`;

      const target = `# Intent

Covers Requirement A and Requirement B
`;

      const result = computeVerification(noFrontmatter, target, 'idea-to-intent');

      expect(result.conformance_score).toBe(100);
    });

    it('case-insensitive matching', () => {
      const source = `# Source

## Problem Statement
- OAuth2 Authentication
- SSO Integration
`;

      const target = `# Target

oauth2 authentication and sso integration are implemented
`;

      const result = computeVerification(source, target, 'idea-to-intent');

      expect(result.conformance_score).toBe(100);
      expect(result.missing_items).toEqual([]);
    });

    it('source with no extractable requirements returns 100%', () => {
      const noRequirements = `---
risk_tier: 1
---
# IDEA

## Problem Statement
Just plain text, no bullets
`;

      const result = computeVerification(noRequirements, INTENT_CONTENT, 'idea-to-intent');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBe(100);
      expect(result.coverage_percentage).toBe(100);
      expect(result.missing_items).toEqual([]);
    });
  });
});

describe('generateValidationQuestions', () => {
  const allTypes: Array<TransitionType | RootValidationType> = [
    'idea-to-intent',
    'intent-to-unit',
    'unit-to-bolt',
    'unit-to-idea',
    'bolt-to-idea',
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
    it('idea-to-intent asks about IDEA constraints and problem', () => {
      const questions = generateValidationQuestions('idea-to-intent');
      expect(questions[0].question).toContain('INTENT');
      expect(questions[0].question).toContain('IDEA');
      expect(questions[1].question).toContain('business problem');
    });

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

    it('unit-to-idea asks about IDEA contribution', () => {
      const questions = generateValidationQuestions('unit-to-idea');
      expect(questions[0].question).toContain('UNIT');
      expect(questions[0].question).toContain('IDEA');
      expect(questions[1].question).toContain('success metrics');
    });

    it('bolt-to-idea asks about IDEA alignment', () => {
      const questions = generateValidationQuestions('bolt-to-idea');
      expect(questions[0].question).toContain('BOLT');
      expect(questions[0].question).toContain('IDEA');
      expect(questions[1].question).toContain('goals');
    });
  });
});

describe('runAlignmentCheck', () => {
  it('returns AlignmentCheck with both verification and validation', () => {
    const result = runAlignmentCheck(IDEA_CONTENT, INTENT_CONTENT, 'idea-1', 'intent-1', 'idea-to-intent');

    expect(result).toHaveProperty('verification');
    expect(result).toHaveProperty('validation');
    expect(result.verification).toHaveProperty('conformance_score');
    expect(result.validation).toHaveProperty('alignment_score');
    expect(result.validation).toHaveProperty('alignment_questions');
  });

  it('alignment_passed is false when validation questions are unanswered', () => {
    const result = runAlignmentCheck(IDEA_CONTENT, INTENT_CONTENT, 'idea-1', 'intent-1', 'idea-to-intent');

    expect(result.validation.passed).toBe(false);
    expect(result.alignment_passed).toBe(false);
  });

  it('alignment_passed is false when verification fails', () => {
    const incompleteIntent = `# Intent\n\nNo requirements covered`;

    const result = runAlignmentCheck(IDEA_CONTENT, incompleteIntent, 'idea-1', 'intent-1', 'idea-to-intent');

    expect(result.verification.passed).toBe(false);
    expect(result.alignment_passed).toBe(false);
  });

  it('returns correct sourceId and targetId', () => {
    const result = runAlignmentCheck(
      IDEA_CONTENT,
      INTENT_CONTENT,
      'source-123',
      'target-456',
      'idea-to-intent'
    );

    expect(result.source_artifact_id).toBe('source-123');
    expect(result.target_artifact_id).toBe('target-456');
  });

  it('checked_at is a valid ISO timestamp', () => {
    const result = runAlignmentCheck(IDEA_CONTENT, INTENT_CONTENT, 'idea-1', 'intent-1', 'idea-to-intent');

    expect(result.checked_at).toBeTruthy();
    const date = new Date(result.checked_at);
    expect(date.toISOString()).toBe(result.checked_at);
  });

  it('works with root validation types', () => {
    const result = runAlignmentCheck(IDEA_CONTENT, UNIT_CONTENT, 'idea-1', 'unit-1', 'unit-to-idea');

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
      IDEA_CONTENT,
      'intent-to-unit',
      'unit-to-idea',
      'intent-1',
      'unit-1',
      'idea-1'
    );

    expect(result).toHaveProperty('parentCheck');
    expect(result).toHaveProperty('rootCheck');
    expect(result).toHaveProperty('passed');

    expect(result.parentCheck.source_artifact_id).toBe('intent-1');
    expect(result.parentCheck.target_artifact_id).toBe('unit-1');

    expect(result.rootCheck.source_artifact_id).toBe('idea-1');
    expect(result.rootCheck.target_artifact_id).toBe('unit-1');
  });

  it('passed is true only when both checks pass verification', () => {
    const result = runDualValidation(
      UNIT_CONTENT,
      INTENT_CONTENT,
      IDEA_CONTENT,
      'intent-to-unit',
      'unit-to-idea',
      'intent-1',
      'unit-1',
      'idea-1'
    );

    // Both verifications should pass, but validations are unanswered
    expect(result.parentCheck.verification.passed).toBe(true);
    expect(result.rootCheck.verification.passed).toBe(true);

    // But alignment_passed requires both verification AND validation
    expect(result.parentCheck.alignment_passed).toBe(false);
    expect(result.rootCheck.alignment_passed).toBe(false);

    // So overall passed should be false
    expect(result.passed).toBe(false);
  });

  it('passed is false when parent check fails', () => {
    const incompleteBolt = `# BOLT\n\nPartial implementation`;

    const result = runDualValidation(
      incompleteBolt,
      UNIT_CONTENT,
      IDEA_CONTENT,
      'unit-to-bolt',
      'bolt-to-idea',
      'unit-1',
      'bolt-1',
      'idea-1'
    );

    expect(result.parentCheck.verification.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('passed is false when root check fails', () => {
    const unrelatedUnit = `# UNIT

## Acceptance Criteria
- [ ] Something completely unrelated to the IDEA
`;

    const result = runDualValidation(
      unrelatedUnit,
      INTENT_CONTENT,
      IDEA_CONTENT,
      'intent-to-unit',
      'unit-to-idea',
      'intent-1',
      'unit-1',
      'idea-1'
    );

    expect(result.rootCheck.verification.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('returns combined results for downstream analysis', () => {
    const result = runDualValidation(
      UNIT_CONTENT,
      INTENT_CONTENT,
      IDEA_CONTENT,
      'intent-to-unit',
      'unit-to-idea',
      'intent-1',
      'unit-1',
      'idea-1'
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
    it('returns 90 for idea-to-intent', () => {
      expect(getConformanceThreshold('idea-to-intent')).toBe(90);
    });

    it('returns 95 for intent-to-unit', () => {
      expect(getConformanceThreshold('intent-to-unit')).toBe(95);
    });

    it('returns 100 for unit-to-bolt', () => {
      expect(getConformanceThreshold('unit-to-bolt')).toBe(100);
    });
  });

  describe('root validation types', () => {
    it('returns 80 for unit-to-idea', () => {
      expect(getConformanceThreshold('unit-to-idea')).toBe(80);
    });

    it('returns 70 for bolt-to-idea', () => {
      expect(getConformanceThreshold('bolt-to-idea')).toBe(70);
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

    const check = runAlignmentCheck(IDEA_CONTENT, INTENT_CONTENT, 'idea-1', 'intent-1', 'idea-to-intent');
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

    const check = runAlignmentCheck(IDEA_CONTENT, INTENT_CONTENT, 'idea-1', 'intent-1', 'idea-to-intent');

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

    const check = runAlignmentCheck(IDEA_CONTENT, INTENT_CONTENT, 'idea-1', 'intent-1', 'idea-to-intent');

    expect(() => {
      recordAlignmentResult('/path/to/manifest.json', check);
    }).not.toThrow();

    expect(saveManifest).not.toHaveBeenCalled();
  });
});
