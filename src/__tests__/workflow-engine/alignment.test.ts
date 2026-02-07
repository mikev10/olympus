import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeVerification,
  generateValidationQuestions,
  runAlignmentCheck,
  getConformanceThreshold,
  recordAlignmentResult,
  type TransitionType,
} from '../../features/workflow-engine/alignment.js';

vi.mock('../../features/workflow-engine/manifest.js', () => ({
  loadManifest: vi.fn(),
  saveManifest: vi.fn(),
}));

const IDEA_CONTENT = `---
risk_tier: 2
---
# Feature IDEA

## Problem Statement
Users need authentication

## Constraints
- Must support OAuth2
- Must support SSO
- Must handle 1000 concurrent users

## Success Metrics
- 99.9% uptime
- < 200ms response time
`;

const PRD_CONTENT = `---
type: prd
---
# PRD

## User Stories
### US-001 Login Flow
Users can log in via OAuth2

### US-002 SSO Integration
Support SSO for enterprise customers

## Requirement Coverage
- Must support OAuth2 - covered by US-001
- Must support SSO - covered by US-002
- Must handle 1000 concurrent users - covered by US-001
- 99.9% uptime - covered by US-001 SLA
- < 200ms response time - covered by US-001 perf
`;

const SPEC_CONTENT = `---
type: spec
---
# Technical Spec

## Components
### AuthService
Handles authentication logic

### SSOConnector
Enterprise SSO integration

## Requirement Coverage
US-001 is implemented by AuthService
US-002 is implemented by SSOConnector
`;

const INTENTS_CONTENT = `## Intents

- Implement AuthService module
- Implement SSOConnector module
- Write integration tests
`;

describe('computeVerification', () => {
  describe('IDEA to PRD transition', () => {
    it('passes when PRD references all IDEA constraints (>= 90%)', () => {
      const result = computeVerification(IDEA_CONTENT, PRD_CONTENT, 'idea-to-prd');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBeGreaterThanOrEqual(90);
      expect(result.coverage_percentage).toBeGreaterThanOrEqual(90);
      expect(result.missing_items.length).toBeLessThanOrEqual(0);
    });

    it('fails when PRD misses IDEA constraints (< 90%)', () => {
      const incompletePrd = `# PRD

## User Stories
### US-001 Login Flow
Users can log in via OAuth2
`;

      const result = computeVerification(IDEA_CONTENT, incompletePrd, 'idea-to-prd');

      expect(result.passed).toBe(false);
      expect(result.conformance_score).toBeLessThan(90);
      expect(result.missing_items.length).toBeGreaterThan(0);
    });

    it('returns 100% for source with no extractable requirements', () => {
      const noRequirements = `---
risk_tier: 1
---
# IDEA

## Problem Statement
No bullet points here
`;

      const result = computeVerification(noRequirements, PRD_CONTENT, 'idea-to-prd');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBe(100);
      expect(result.coverage_percentage).toBe(100);
      expect(result.missing_items).toEqual([]);
    });

    it('correctly handles YAML frontmatter removal', () => {
      const result = computeVerification(IDEA_CONTENT, PRD_CONTENT, 'idea-to-prd');

      // Should not fail due to frontmatter
      expect(result.conformance_score).toBeGreaterThan(0);
    });
  });

  describe('PRD to SPEC transition (user stories)', () => {
    it('passes when SPEC references all user stories (>= 95%)', () => {
      const result = computeVerification(PRD_CONTENT, SPEC_CONTENT, 'prd-to-spec');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBeGreaterThanOrEqual(95);
    });

    it('fails when SPEC misses user stories', () => {
      const incompleteSpec = `# Technical Spec

## Components
### AuthService
Implements US-001
`;

      const result = computeVerification(PRD_CONTENT, incompleteSpec, 'prd-to-spec');

      expect(result.passed).toBe(false);
      expect(result.conformance_score).toBeLessThan(95);
      expect(result.missing_items.length).toBeGreaterThan(0);
    });

    it('extracts US-NNN patterns from ### US-001 and ## US-001 headings', () => {
      const prdWithUserStories = `# PRD

### US-001 First Story
Content

## US-002 Second Story
Content

### US-003 Third Story
Content
`;

      const specWithAllStories = `# Spec

Implements US-001, US-002, and US-003
`;

      const result = computeVerification(prdWithUserStories, specWithAllStories, 'prd-to-spec');

      expect(result.conformance_score).toBe(100);
      expect(result.missing_items).toEqual([]);
    });
  });

  describe('SPEC to INTENTS transition', () => {
    it('extracts from Components and Architecture sections', () => {
      const specWithSections = `# Spec

## Components
- ComponentA
- ComponentB

## Architecture
- Microservices pattern
- Event-driven design
`;

      const intentsWithAll = `# Intents

- ComponentA is the core module
- ComponentB handles data
- Microservices pattern used throughout
- Event-driven design for async workflows
`;

      const result = computeVerification(specWithSections, intentsWithAll, 'spec-to-intents');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBe(100);
    });

    it('passes at 100% threshold', () => {
      const specWithRequirement = `# Spec

## Components
- Critical component
`;

      const intentsIncomplete = `# Intents

Some other content
`;

      const result = computeVerification(specWithRequirement, intentsIncomplete, 'spec-to-intents');

      expect(result.passed).toBe(false);
      expect(result.conformance_score).toBeLessThan(100);
    });
  });

  describe('Intents/Units/Design to next (all bullets extraction)', () => {
    it('extracts all bullet points from content - intents-to-units', () => {
      const intentsDoc = `# Intents

- First task
- Second task
- Third task
`;

      const unitsDoc = `# Units

Covers first task, second task, and third task
`;

      const result = computeVerification(intentsDoc, unitsDoc, 'intents-to-units');

      expect(result.conformance_score).toBe(100);
      expect(result.missing_items).toEqual([]);
    });

    it('extracts all bullet points from content - units-to-design', () => {
      const unitsDoc = `# Units

- Unit A requirement
- Unit B requirement
`;

      const designDoc = `# Design

Addresses Unit A requirement and Unit B requirement
`;

      const result = computeVerification(unitsDoc, designDoc, 'units-to-design');

      expect(result.conformance_score).toBe(100);
    });

    it('extracts all bullet points from content - design-to-build', () => {
      const designDoc = `# Design

- API endpoint /users
- Database schema User
`;

      const buildDoc = `# Build

Implements API endpoint /users and Database schema User
`;

      const result = computeVerification(designDoc, buildDoc, 'design-to-build');

      expect(result.conformance_score).toBe(100);
    });

    it('case-insensitive matching', () => {
      const source = `# Source

- OAuth2 Authentication
- SSO Integration
`;

      const target = `# Target

oauth2 authentication and sso integration are implemented
`;

      const result = computeVerification(source, target, 'design-to-build');

      expect(result.conformance_score).toBe(100);
      expect(result.missing_items).toEqual([]);
    });
  });

  describe('Edge cases', () => {
    it('empty source content returns 100% score', () => {
      const result = computeVerification('', PRD_CONTENT, 'idea-to-prd');

      expect(result.passed).toBe(true);
      expect(result.conformance_score).toBe(100);
      expect(result.coverage_percentage).toBe(100);
      expect(result.missing_items).toEqual([]);
    });

    it('empty target content with non-empty source returns 0%', () => {
      const result = computeVerification(IDEA_CONTENT, '', 'idea-to-prd');

      expect(result.passed).toBe(false);
      expect(result.conformance_score).toBe(0);
      expect(result.missing_items.length).toBeGreaterThan(0);
    });

    it('handles content without frontmatter', () => {
      const noFrontmatter = `# IDEA

## Constraints
- Requirement A
- Requirement B
`;

      const target = `# PRD

Covers Requirement A and Requirement B
`;

      const result = computeVerification(noFrontmatter, target, 'idea-to-prd');

      expect(result.conformance_score).toBe(100);
    });
  });
});

describe('generateValidationQuestions', () => {
  const transitions: TransitionType[] = [
    'idea-to-prd',
    'prd-to-spec',
    'spec-to-intents',
    'intents-to-units',
    'units-to-design',
    'design-to-build',
  ];

  transitions.forEach((transition) => {
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
});

describe('runAlignmentCheck', () => {
  it('returns AlignmentCheck with both verification and validation', () => {
    const result = runAlignmentCheck(IDEA_CONTENT, PRD_CONTENT, 'idea-1', 'prd-1', 'idea-to-prd');

    expect(result).toHaveProperty('verification');
    expect(result).toHaveProperty('validation');
    expect(result.verification).toHaveProperty('conformance_score');
    expect(result.validation).toHaveProperty('alignment_score');
    expect(result.validation).toHaveProperty('alignment_questions');
  });

  it('alignment_passed is false when validation questions are unanswered', () => {
    const result = runAlignmentCheck(IDEA_CONTENT, PRD_CONTENT, 'idea-1', 'prd-1', 'idea-to-prd');

    // Validation questions start unanswered, so validation.passed should be false
    expect(result.validation.passed).toBe(false);
    expect(result.alignment_passed).toBe(false);
  });

  it('alignment_passed is false when verification fails even if questions were answered', () => {
    const incompletePrd = `# PRD\n\nNo requirements covered`;

    const result = runAlignmentCheck(IDEA_CONTENT, incompletePrd, 'idea-1', 'prd-1', 'idea-to-prd');

    expect(result.verification.passed).toBe(false);
    expect(result.alignment_passed).toBe(false);
  });

  it('returns correct sourceId and targetId', () => {
    const result = runAlignmentCheck(IDEA_CONTENT, PRD_CONTENT, 'source-123', 'target-456', 'idea-to-prd');

    expect(result.source_artifact_id).toBe('source-123');
    expect(result.target_artifact_id).toBe('target-456');
  });

  it('checked_at is a valid ISO timestamp', () => {
    const result = runAlignmentCheck(IDEA_CONTENT, PRD_CONTENT, 'idea-1', 'prd-1', 'idea-to-prd');

    expect(result.checked_at).toBeTruthy();
    const date = new Date(result.checked_at);
    expect(date.toISOString()).toBe(result.checked_at);
  });
});

describe('getConformanceThreshold', () => {
  it('returns 90 for idea-to-prd', () => {
    expect(getConformanceThreshold('idea-to-prd')).toBe(90);
  });

  it('returns 95 for prd-to-spec', () => {
    expect(getConformanceThreshold('prd-to-spec')).toBe(95);
  });

  it('returns 100 for spec-to-intents', () => {
    expect(getConformanceThreshold('spec-to-intents')).toBe(100);
  });

  it('returns 100 for intents-to-units', () => {
    expect(getConformanceThreshold('intents-to-units')).toBe(100);
  });

  it('returns 90 for units-to-design', () => {
    expect(getConformanceThreshold('units-to-design')).toBe(90);
  });

  it('returns 90 for design-to-build', () => {
    expect(getConformanceThreshold('design-to-build')).toBe(90);
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

    const check = runAlignmentCheck(IDEA_CONTENT, PRD_CONTENT, 'idea-1', 'prd-1', 'idea-to-prd');
    recordAlignmentResult('/path/to/manifest.json', check);

    expect(loadManifest).toHaveBeenCalledWith('/path/to/manifest.json');
    expect(saveManifest).toHaveBeenCalledWith('/path/to/manifest.json', expect.objectContaining({
      alignment_checks: expect.arrayContaining([check]),
    }));
  });

  it('returns silently when manifest is null', () => {
    loadManifest.mockReturnValue(null);

    const check = runAlignmentCheck(IDEA_CONTENT, PRD_CONTENT, 'idea-1', 'prd-1', 'idea-to-prd');

    // Should not throw
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

    const check = runAlignmentCheck(IDEA_CONTENT, PRD_CONTENT, 'idea-1', 'prd-1', 'idea-to-prd');

    // Should not throw
    expect(() => {
      recordAlignmentResult('/path/to/manifest.json', check);
    }).not.toThrow();

    expect(saveManifest).not.toHaveBeenCalled();
  });
});
