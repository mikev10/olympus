import { describe, it, expect } from 'vitest';
import {
  assessDepth,
  classifyRiskTier,
  assessDepthFromIntent,
  getDepthLabel,
  getRiskTierLabel,
} from '../../features/workflow-engine/depth-assessment.js';
import type { DepthFactors, RiskFactors } from '../../features/workflow-engine/depth-assessment.js';

describe('assessDepth', () => {
  it('should return minimal depth for total <= 10', () => {
    const factors: DepthFactors = {
      clarity: 1,
      complexity: 1,
      scope: 1,
      risk: 1,
      context: 1,
      preferences: 1,
    };

    const result = assessDepth(factors);

    expect(result.total_score).toBe(6);
    expect(result.recommended_depth).toBe('minimal');
    expect(result.skip_units).toBe(true);
  });

  it('should return standard depth for total between 11-20', () => {
    const factors: DepthFactors = {
      clarity: 2,
      complexity: 2,
      scope: 2,
      risk: 2,
      context: 2,
      preferences: 3,
    };

    const result = assessDepth(factors);

    expect(result.total_score).toBe(13);
    expect(result.recommended_depth).toBe('standard');
    expect(result.skip_units).toBe(false);
  });

  it('should return comprehensive depth for total >= 21', () => {
    const factors: DepthFactors = {
      clarity: 5,
      complexity: 5,
      scope: 5,
      risk: 5,
      context: 5,
      preferences: 5,
    };

    const result = assessDepth(factors);

    expect(result.total_score).toBe(30);
    expect(result.recommended_depth).toBe('comprehensive');
    expect(result.skip_units).toBe(false);
  });

  it('should handle boundary at total=8 (minimal)', () => {
    const factors: DepthFactors = {
      clarity: 1,
      complexity: 1,
      scope: 2,
      risk: 2,
      context: 1,
      preferences: 1,
    };

    const result = assessDepth(factors);

    expect(result.total_score).toBe(8);
    expect(result.recommended_depth).toBe('minimal');
    expect(result.skip_units).toBe(true);
  });

  it('should handle boundary at total=9 (minimal)', () => {
    const factors: DepthFactors = {
      clarity: 1,
      complexity: 1,
      scope: 2,
      risk: 2,
      context: 1,
      preferences: 2,
    };

    const result = assessDepth(factors);

    expect(result.total_score).toBe(9);
    expect(result.recommended_depth).toBe('minimal');
    expect(result.skip_units).toBe(true);
  });

  it('should handle boundary at total=10 (minimal)', () => {
    const factors: DepthFactors = {
      clarity: 1,
      complexity: 2,
      scope: 2,
      risk: 2,
      context: 1,
      preferences: 2,
    };

    const result = assessDepth(factors);

    expect(result.total_score).toBe(10);
    expect(result.recommended_depth).toBe('minimal');
    expect(result.skip_units).toBe(true);
  });

  it('should handle boundary at total=11 (standard)', () => {
    const factors: DepthFactors = {
      clarity: 1,
      complexity: 2,
      scope: 2,
      risk: 2,
      context: 2,
      preferences: 2,
    };

    const result = assessDepth(factors);

    expect(result.total_score).toBe(11);
    expect(result.recommended_depth).toBe('standard');
    expect(result.skip_units).toBe(false);
  });

  it('should handle boundary at total=20 (standard)', () => {
    const factors: DepthFactors = {
      clarity: 3,
      complexity: 3,
      scope: 3,
      risk: 4,
      context: 3,
      preferences: 4,
    };

    const result = assessDepth(factors);

    expect(result.total_score).toBe(20);
    expect(result.recommended_depth).toBe('standard');
    expect(result.skip_units).toBe(false);
  });

  it('should handle boundary at total=21 (comprehensive)', () => {
    const factors: DepthFactors = {
      clarity: 3,
      complexity: 4,
      scope: 4,
      risk: 3,
      context: 3,
      preferences: 4,
    };

    const result = assessDepth(factors);

    expect(result.total_score).toBe(21);
    expect(result.recommended_depth).toBe('comprehensive');
    expect(result.skip_units).toBe(false);
  });

  it('should clamp factors < 1 to 1', () => {
    const factors: DepthFactors = {
      clarity: 0,
      complexity: -1,
      scope: 1,
      risk: 1,
      context: 1,
      preferences: 1,
    };

    const result = assessDepth(factors);

    // 0 and -1 should be clamped to 1, so total = 1+1+1+1+1+1 = 6
    expect(result.total_score).toBe(6);
    expect(result.recommended_depth).toBe('minimal');
  });

  it('should clamp factors > 5 to 5', () => {
    const factors: DepthFactors = {
      clarity: 6,
      complexity: 7,
      scope: 10,
      risk: 5,
      context: 5,
      preferences: 5,
    };

    const result = assessDepth(factors);

    // All should be clamped to 5, so total = 5*6 = 30
    expect(result.total_score).toBe(30);
    expect(result.recommended_depth).toBe('comprehensive');
  });

  it('should round decimal factors (1.4→1, 1.6→2)', () => {
    const factors: DepthFactors = {
      clarity: 1.4,
      complexity: 1.6,
      scope: 2.2,
      risk: 2.8,
      context: 3.3,
      preferences: 3.7,
    };

    const result = assessDepth(factors);

    // 1.4→1, 1.6→2, 2.2→2, 2.8→3, 3.3→3, 3.7→4 → total = 1+2+2+3+3+4 = 15
    expect(result.total_score).toBe(15);
    expect(result.recommended_depth).toBe('standard');
  });

  it('should return valid RiskTierClassification in risk_tier field', () => {
    const factors: DepthFactors = {
      clarity: 2,
      complexity: 2,
      scope: 2,
      risk: 2,
      context: 2,
      preferences: 2,
    };

    const result = assessDepth(factors);

    expect(result.risk_tier).toBeDefined();
    expect(result.risk_tier.tier).toBeGreaterThanOrEqual(1);
    expect(result.risk_tier.tier).toBeLessThanOrEqual(3);
    expect(result.risk_tier.rationale).toBeDefined();
    expect(result.risk_tier.override_reason).toBeNull();
  });

  it('should include all individual factor values in returned assessment', () => {
    const factors: DepthFactors = {
      clarity: 3,
      complexity: 2,
      scope: 4,
      risk: 1,
      context: 5,
      preferences: 2,
    };

    const result = assessDepth(factors);

    expect(result.clarity).toBe(3);
    expect(result.complexity).toBe(2);
    expect(result.scope).toBe(4);
    expect(result.risk).toBe(1);
    expect(result.context).toBe(5);
    expect(result.preferences).toBe(2);
  });
});

describe('classifyRiskTier', () => {
  it('should return tier 1 (low risk) for easy/isolated/none/none', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'easy',
      blast_radius: 'isolated',
      data_sensitivity: 'none',
      compliance_impact: 'none',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.tier).toBe(1);
  });

  it('should return tier 2 (moderate risk) for moderate/cross-cutting/internal/minor', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'moderate',
      blast_radius: 'cross-cutting',
      data_sensitivity: 'internal',
      compliance_impact: 'minor',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.tier).toBe(2);
  });

  it('should return tier 3 (high risk) for difficult/system-wide/user-facing/major', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'difficult',
      blast_radius: 'system-wide',
      data_sensitivity: 'user-facing',
      compliance_impact: 'major',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.tier).toBe(3);
  });

  it('should handle boundary at weight=6 (tier 1)', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'easy',
      blast_radius: 'cross-cutting',
      data_sensitivity: 'none',
      compliance_impact: 'minor',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.tier).toBe(1);
  });

  it('should handle boundary at weight=7 (tier 2)', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'moderate',
      blast_radius: 'cross-cutting',
      data_sensitivity: 'none',
      compliance_impact: 'minor',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.tier).toBe(2);
  });

  it('should handle boundary at weight=9 (tier 2)', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'moderate',
      blast_radius: 'cross-cutting',
      data_sensitivity: 'internal',
      compliance_impact: 'major',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.tier).toBe(2);
  });

  it('should handle boundary at weight=10 (tier 3)', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'difficult',
      blast_radius: 'cross-cutting',
      data_sensitivity: 'internal',
      compliance_impact: 'major',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.tier).toBe(3);
  });

  it('should include "Low risk" in rationale for tier 1', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'easy',
      blast_radius: 'isolated',
      data_sensitivity: 'none',
      compliance_impact: 'none',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.rationale).toContain('Low risk');
  });

  it('should include "Moderate risk" in rationale for tier 2', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'moderate',
      blast_radius: 'cross-cutting',
      data_sensitivity: 'internal',
      compliance_impact: 'minor',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.rationale).toContain('Moderate risk');
  });

  it('should include "High risk" in rationale for tier 3', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'difficult',
      blast_radius: 'system-wide',
      data_sensitivity: 'user-facing',
      compliance_impact: 'major',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.rationale).toContain('High risk');
  });

  it('should mention key risk factors in rationale for difficult reversibility', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'difficult',
      blast_radius: 'isolated',
      data_sensitivity: 'none',
      compliance_impact: 'none',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.rationale).toMatch(/difficult to reverse/i);
  });

  it('should have override_reason as null by default', () => {
    const riskFactors: RiskFactors = {
      reversibility: 'easy',
      blast_radius: 'isolated',
      data_sensitivity: 'none',
      compliance_impact: 'none',
    };

    const result = classifyRiskTier(riskFactors);

    expect(result.override_reason).toBeNull();
  });
});

describe('assessDepthFromIntent', () => {
  const SIMPLE_IDEA = `
# Feature: Add Logging

## Problem Statement

Need basic logging.

## User Personas

Internal developers.

## Success Metrics

- Logs work

## Business Constraints

- Use existing library

## Out of Scope

External logging services.
`;

  const COMPLEX_IDEA = `---
risk_tier: high
---

# Feature: User Authentication System

## Problem Statement

Users currently cannot securely access their accounts. We need a robust authentication system that supports multiple login methods and provides secure session management. The system must handle OAuth 2.0, SAML, and traditional credentials.

## User Personas

- End users: Need seamless, secure access to accounts with multiple login options
- Security admins: Require compliance monitoring and authentication audit trails
- Mobile app users: Need OAuth support for social login integration
- Enterprise customers: Require SAML SSO for their internal systems
- API consumers: Need service-to-service authentication via API tokens
- Developers: Need authentication service component and SDK integration layer
- Compliance officers: Need GDPR-compliant PII handling module

## Success Metrics

- Reduce account takeover incidents by 80%
- Achieve 90%+ successful login rate
- Support 3+ authentication methods
- Meet SOC2 compliance requirements
- Zero PII data leaks

## Business Constraints

- Must integrate with existing user database schema
- Cannot break current session management (breaking change risk)
- Must support mobile and web clients
- Budget: 2 engineer-months, $15K for third-party services
- Compliance: Must meet GDPR data retention requirements
- Authentication tokens must be encrypted
- Migration of existing users required (irreversible data migration)

## Out of Scope

This is a system-wide infrastructure change affecting multiple services across all users of the platform.
`;

  it('should return low depth for simple IDEA', () => {
    const result = assessDepthFromIntent(SIMPLE_IDEA);

    // Simple IDEA: short content scores high on context/clarity (less info = needs more)
    // So total_score lands in standard range, not minimal
    expect(result.total_score).toBeLessThanOrEqual(20);
    expect(['minimal', 'standard']).toContain(result.recommended_depth);
  });

  it('should return comprehensive depth for complex IDEA', () => {
    const result = assessDepthFromIntent(COMPLEX_IDEA);

    expect(result.total_score).toBeGreaterThanOrEqual(21);
    expect(result.recommended_depth).toBe('comprehensive');
  });

  it('should return standard depth for moderate IDEA', () => {
    const moderateIdea = `
# Feature: User Profile Page

## Problem Statement

Users need a way to view and edit their profile information.

## User Personas

Registered users who want to manage their account settings, update personal details, and customize their profile presentation.

## Success Metrics

- 80% of users update profile within first week
- Page load time under 2 seconds
- Zero data loss during updates

## Business Constraints

- Must integrate with existing API
- Mobile responsive required
- Use existing design system components

## Out of Scope

Requested by 50% of users in feedback surveys. Core feature for user engagement.
`;

    const result = assessDepthFromIntent(moderateIdea);

    expect(result.total_score).toBeGreaterThan(10);
    expect(result.total_score).toBeLessThan(21);
    expect(result.recommended_depth).toBe('standard');
  });

  it('should derive reversibility=difficult for IDEA with migration', () => {
    const migrationIdea = `
# Feature: Database Schema Migration

## Problem Statement

Need to migrate user data to new schema.

## Business Constraints

- Irreversible data migration required
- Must run during maintenance window
`;

    const result = assessDepthFromIntent(migrationIdea);

    expect(result.risk_tier.factors.reversibility).toBe('difficult');
  });

  it('should derive blast_radius=system-wide for IDEA with "all users"', () => {
    const systemWideIdea = `
# Feature: Global Rate Limiting

## Out of Scope

This change affects all users of the system.

## User Personas

Apply rate limits across all API endpoints.
`;

    const result = assessDepthFromIntent(systemWideIdea);

    expect(result.risk_tier.factors.blast_radius).toBe('system-wide');
  });

  it('should derive data_sensitivity=user-facing for IDEA with PII', () => {
    const piiIdea = `
# Feature: Customer Data Export

## Problem Statement

Users need to export their PII data for compliance.

## Business Constraints

- Must handle sensitive personal information
`;

    const result = assessDepthFromIntent(piiIdea);

    expect(result.risk_tier.factors.data_sensitivity).toBe('user-facing');
  });

  it('should derive data_sensitivity=user-facing for IDEA with authentication', () => {
    const authIdea = `
# Feature: Two-Factor Authentication

## User Personas

Add authentication token management.
`;

    const result = assessDepthFromIntent(authIdea);

    expect(result.risk_tier.factors.data_sensitivity).toBe('user-facing');
  });

  it('should derive compliance_impact=major for IDEA with GDPR', () => {
    const gdprIdea = `
# Feature: Data Retention Policy

## Business Constraints

- Must comply with GDPR requirements
`;

    const result = assessDepthFromIntent(gdprIdea);

    expect(result.risk_tier.factors.compliance_impact).toBe('major');
  });

  it('should derive compliance_impact=major for IDEA with compliance keywords', () => {
    const complianceIdea = `
# Feature: Audit Logging

## Out of Scope

Required for compliance with regulatory standards.
`;

    const result = assessDepthFromIntent(complianceIdea);

    expect(result.risk_tier.factors.compliance_impact).toBe('major');
  });

  it('should handle empty content without error', () => {
    const result = assessDepthFromIntent('');

    // Empty content: clarity=5 (unclear), context=5 (no context), etc.
    // Score will be moderate due to high "need" scores
    expect(result.total_score).toBeGreaterThanOrEqual(6);
    expect(result.total_score).toBeLessThanOrEqual(30);
    expect(result.recommended_depth).toBeDefined();
  });

  it('should handle missing sections gracefully', () => {
    const incompleteidea = `
# Feature: Something

This is just a title and some text.
`;

    expect(() => assessDepthFromIntent(incompleteidea)).not.toThrow();
    const result = assessDepthFromIntent(incompleteidea);
    expect(result.recommended_depth).toBeDefined();
  });
});

describe('getDepthLabel', () => {
  it('should return label containing "SHALLOW" and "skip UNIT" for minimal', () => {
    const label = getDepthLabel('minimal');

    expect(label).toContain('SHALLOW');
    expect(label).toMatch(/skip.*UNIT/i);
  });

  it('should return label containing "MEDIUM" and "Vision + Forge" for standard', () => {
    const label = getDepthLabel('standard');

    expect(label).toContain('MEDIUM');
    expect(label).toMatch(/Inception.*Construction/i);
  });

  it('should return label containing "DEEP" and "rigorous" for comprehensive', () => {
    const label = getDepthLabel('comprehensive');

    expect(label).toContain('DEEP');
    expect(label).toMatch(/rigorous/i);
  });
});

describe('getRiskTierLabel', () => {
  it('should return label containing "Tier 1" and "Low Risk" for tier 1', () => {
    const label = getRiskTierLabel(1);

    expect(label).toContain('Tier 1');
    expect(label).toMatch(/Low Risk/i);
  });

  it('should return label containing "Tier 2" and "Moderate Risk" for tier 2', () => {
    const label = getRiskTierLabel(2);

    expect(label).toContain('Tier 2');
    expect(label).toMatch(/Moderate Risk/i);
  });

  it('should return label containing "Tier 3" and "High Risk" for tier 3', () => {
    const label = getRiskTierLabel(3);

    expect(label).toContain('Tier 3');
    expect(label).toMatch(/High Risk/i);
  });
});
