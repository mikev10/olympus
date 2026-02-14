/**
 * Depth Assessment and Risk Tier Classification
 *
 * Scores 6 factors (1-5 each) to determine workflow depth:
 * - SHALLOW (1-10): skip UNIT decomposition, INTENT → single BOLT
 * - MEDIUM (11-20): full Inception + Construction pipeline
 * - DEEP (21-30): deep analysis + rigorous Construction + Metis consultation
 *
 * Also classifies risk tier (1-3) based on reversibility, blast radius,
 * data sensitivity, and compliance impact.
 */

import type { DepthAssessment, RiskTier, RiskTierClassification } from './phase-types.js';

export interface DepthFactors {
  clarity: number;       // 1-5: how clear are requirements?
  complexity: number;    // 1-5: how complex is the solution?
  scope: number;         // 1-5: how large is the scope?
  risk: number;          // 1-5: how risky is this?
  context: number;       // 1-5: how much context is needed?
  preferences: number;   // 1-5: how many user preferences/choices?
}

export interface RiskFactors {
  reversibility: 'easy' | 'moderate' | 'difficult';
  blast_radius: 'isolated' | 'cross-cutting' | 'system-wide';
  data_sensitivity: 'none' | 'internal' | 'user-facing';
  compliance_impact: 'none' | 'minor' | 'major';
}

/**
 * Clamp a value to the range 1-5
 */
function clampFactor(value: number): number {
  return Math.max(1, Math.min(5, Math.round(value)));
}

/**
 * Assess workflow depth from 6 factors (1-5 each)
 *
 * @param factors - The 6 depth factors to assess
 * @returns Complete depth assessment with recommendations
 */
export function assessDepth(factors: DepthFactors): DepthAssessment {
  // Clamp all factors to 1-5
  const clarity = clampFactor(factors.clarity);
  const complexity = clampFactor(factors.complexity);
  const scope = clampFactor(factors.scope);
  const risk = clampFactor(factors.risk);
  const context = clampFactor(factors.context);
  const preferences = clampFactor(factors.preferences);

  // Calculate total score (6-30)
  const total_score = clarity + complexity + scope + risk + context + preferences;

  // Determine recommended depth
  let recommended_depth: 'minimal' | 'standard' | 'comprehensive';
  if (total_score <= 10) {
    recommended_depth = 'minimal';
  } else if (total_score <= 20) {
    recommended_depth = 'standard';
  } else {
    recommended_depth = 'comprehensive';
  }

  // Skip UNIT decomposition if SHALLOW depth
  const skip_units = total_score <= 10;

  // Derive risk factors from the assessment
  const riskFactors = deriveRiskFactors(risk, complexity, scope);
  const risk_tier = classifyRiskTier(riskFactors);

  return {
    clarity,
    complexity,
    scope,
    risk,
    context,
    preferences,
    total_score,
    recommended_depth,
    skip_units,
    risk_tier,
  };
}

/**
 * Derive risk factors from depth assessment scores
 */
function deriveRiskFactors(risk: number, complexity: number, scope: number): RiskFactors {
  // Reversibility: based on risk score
  let reversibility: 'easy' | 'moderate' | 'difficult';
  if (risk >= 4) {
    reversibility = 'difficult';
  } else if (risk >= 3) {
    reversibility = 'moderate';
  } else {
    reversibility = 'easy';
  }

  // Blast radius: based on scope
  let blast_radius: 'isolated' | 'cross-cutting' | 'system-wide';
  if (scope >= 4) {
    blast_radius = 'system-wide';
  } else if (scope >= 3) {
    blast_radius = 'cross-cutting';
  } else {
    blast_radius = 'isolated';
  }

  // Data sensitivity: based on risk and complexity
  let data_sensitivity: 'none' | 'internal' | 'user-facing';
  if (risk >= 4 && complexity >= 3) {
    data_sensitivity = 'user-facing';
  } else if (risk >= 3) {
    data_sensitivity = 'internal';
  } else {
    data_sensitivity = 'none';
  }

  // Compliance impact: based on risk score
  let compliance_impact: 'none' | 'minor' | 'major';
  if (risk >= 5) {
    compliance_impact = 'major';
  } else if (risk >= 4) {
    compliance_impact = 'minor';
  } else {
    compliance_impact = 'none';
  }

  return {
    reversibility,
    blast_radius,
    data_sensitivity,
    compliance_impact,
  };
}

/**
 * Classify risk tier from 4 factors
 *
 * @param factors - The 4 risk factors
 * @returns Risk tier classification with rationale
 */
export function classifyRiskTier(factors: RiskFactors): RiskTierClassification {
  // Map each factor to numeric weight
  const reversibilityWeight = factors.reversibility === 'easy' ? 1 : factors.reversibility === 'moderate' ? 2 : 3;
  const blastRadiusWeight = factors.blast_radius === 'isolated' ? 1 : factors.blast_radius === 'cross-cutting' ? 2 : 3;
  const dataSensitivityWeight = factors.data_sensitivity === 'none' ? 1 : factors.data_sensitivity === 'internal' ? 2 : 3;
  const complianceImpactWeight = factors.compliance_impact === 'none' ? 1 : factors.compliance_impact === 'minor' ? 2 : 3;

  // Sum weights (4-12)
  const totalWeight = reversibilityWeight + blastRadiusWeight + dataSensitivityWeight + complianceImpactWeight;

  // Classify tier
  let tier: RiskTier;
  if (totalWeight <= 6) {
    tier = 1;
  } else if (totalWeight <= 9) {
    tier = 2;
  } else {
    tier = 3;
  }

  // Generate rationale
  const rationale = generateRiskRationale(tier, factors);

  return {
    tier,
    rationale,
    factors,
    override_reason: null,
  };
}

/**
 * Generate human-readable rationale for risk tier
 */
function generateRiskRationale(tier: RiskTier, factors: RiskFactors): string {
  const parts: string[] = [];

  if (tier === 1) {
    parts.push('Low risk change');
  } else if (tier === 2) {
    parts.push('Moderate risk change');
  } else {
    parts.push('High risk change');
  }

  // Add key factors
  if (factors.reversibility === 'difficult') {
    parts.push('difficult to reverse');
  }
  if (factors.blast_radius === 'system-wide') {
    parts.push('system-wide impact');
  } else if (factors.blast_radius === 'cross-cutting') {
    parts.push('cross-cutting concerns');
  }
  if (factors.data_sensitivity === 'user-facing') {
    parts.push('affects user data');
  }
  if (factors.compliance_impact === 'major') {
    parts.push('major compliance implications');
  } else if (factors.compliance_impact === 'minor') {
    parts.push('minor compliance considerations');
  }

  return parts.join(', ') + '.';
}

/**
 * Assess depth from IDEA artifact content
 *
 * Parses markdown sections and heuristically scores the 6 factors.
 *
 * @param ideaContent - The IDEA artifact markdown content
 * @returns Complete depth assessment
 */
export function assessDepthFromIdea(ideaContent: string): DepthAssessment {
  const sections = parseIdeaSections(ideaContent);

  // Score each factor heuristically
  const clarity = scoreClarity(sections);
  const complexity = scoreComplexity(sections);
  const scope = scoreScope(sections);
  const risk = scoreRisk(sections);
  const context = scoreContext(sections);
  const preferences = scorePreferences(sections);

  // Derive risk factors from content
  const riskFactors = deriveRiskFactorsFromIdea(ideaContent, sections);

  const factors: DepthFactors = {
    clarity,
    complexity,
    scope,
    risk,
    context,
    preferences,
  };

  const assessment = assessDepth(factors);

  // Override risk tier with content-derived factors
  const contentRiskTier = classifyRiskTier(riskFactors);
  assessment.risk_tier = contentRiskTier;

  return assessment;
}

/**
 * Parse IDEA markdown into sections
 */
interface IdeaSections {
  problemStatement: string;
  userPersonas: string;
  successMetrics: string;
  businessConstraints: string;
  outOfScope: string;
}

function parseIdeaSections(content: string): IdeaSections {
  const sections: IdeaSections = {
    problemStatement: '',
    userPersonas: '',
    businessConstraints: '',
    successMetrics: '',
    outOfScope: '',
  };

  // Split by h2 headers (## Heading)
  const headerPattern = /^## (.+)$/gm;
  const parts: Array<{ title: string; content: string }> = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = headerPattern.exec(content)) !== null) {
    if (parts.length > 0) {
      parts[parts.length - 1].content = content.substring(lastIndex, match.index).trim();
    }
    parts.push({ title: match[1].trim(), content: '' });
    lastIndex = match.index + match[0].length;
  }

  if (parts.length > 0) {
    parts[parts.length - 1].content = content.substring(lastIndex).trim();
  }

  // Map sections to known fields
  for (const part of parts) {
    const title = part.title.toLowerCase();
    if (title.includes('problem') || title.includes('statement')) {
      sections.problemStatement = part.content;
    } else if (title.includes('persona') || title.includes('user persona')) {
      sections.userPersonas = part.content;
    } else if (title.includes('business constraint') || title.includes('constraint')) {
      sections.businessConstraints = part.content;
    } else if (title.includes('success') || title.includes('metric')) {
      sections.successMetrics = part.content;
    } else if (title.includes('out of scope') || title.includes('scope')) {
      sections.outOfScope = part.content;
    }
  }

  return sections;
}

/**
 * Score clarity (1-5, lower = clearer)
 * More detail in problem/personas = higher clarity = LOWER score
 */
function scoreClarity(sections: IdeaSections): number {
  const totalLength = sections.problemStatement.length + sections.userPersonas.length;

  // More detail = clearer = lower score
  if (totalLength > 1000) return 1; // Very clear
  if (totalLength > 500) return 2;
  if (totalLength > 250) return 3;
  if (totalLength > 100) return 4;
  return 5; // Very unclear
}

/**
 * Score complexity (1-5)
 * More bullet points and components = higher complexity
 */
function scoreComplexity(sections: IdeaSections): number {
  const bulletPoints = (sections.userPersonas.match(/^[-*+]\s/gm) || []).length;
  const componentKeywords = ['component', 'service', 'module', 'layer', 'system', 'integration', 'api'];
  const componentCount = componentKeywords.filter(kw => sections.userPersonas.toLowerCase().includes(kw)).length;

  const complexityScore = bulletPoints + componentCount;

  if (complexityScore >= 10) return 5;
  if (complexityScore >= 7) return 4;
  if (complexityScore >= 4) return 3;
  if (complexityScore >= 2) return 2;
  return 1;
}

/**
 * Score scope (1-5)
 * More constraints and metrics = larger scope
 */
function scoreScope(sections: IdeaSections): number {
  const constraintBullets = (sections.businessConstraints.match(/^[-*+]\s/gm) || []).length;
  const metricBullets = (sections.successMetrics.match(/^[-*+]\s/gm) || []).length;

  const scopeScore = constraintBullets + metricBullets;

  if (scopeScore >= 10) return 5;
  if (scopeScore >= 7) return 4;
  if (scopeScore >= 4) return 3;
  if (scopeScore >= 2) return 2;
  return 1;
}

/**
 * Score risk (1-5)
 * More risk keywords = higher risk
 */
function scoreRisk(sections: IdeaSections): number {
  const riskKeywords = [
    'security', 'compliance', 'data', 'migration', 'breaking',
    'irreversible', 'pii', 'gdpr', 'authentication', 'payment',
    'infrastructure', 'system-wide', 'critical'
  ];

  const allText = sections.businessConstraints + sections.userPersonas;
  const lowerText = allText.toLowerCase();

  const riskCount = riskKeywords.filter(kw => lowerText.includes(kw)).length;

  if (riskCount >= 5) return 5;
  if (riskCount >= 3) return 4;
  if (riskCount >= 2) return 3;
  if (riskCount >= 1) return 2;
  return 1;
}

/**
 * Score context (1-5)
 * More "out of scope" items = LESS context needed = LOWER score
 */
function scoreContext(sections: IdeaSections): number {
  const contextLength = sections.outOfScope.length;

  // More out-of-scope content = LOWER context score (less context needed)
  if (contextLength > 500) return 1; // Lots of scope exclusions = low context needed
  if (contextLength > 300) return 2;
  if (contextLength > 150) return 3;
  if (contextLength > 50) return 4;
  return 5; // No scope exclusions = high context needed
}

/**
 * Score preferences (1-5)
 * More must/should/could keywords = more choices = higher score
 */
function scorePreferences(sections: IdeaSections): number {
  const preferenceKeywords = ['must', 'should', 'could', 'prefer', 'optional', 'required', 'nice to have'];
  const allText = sections.businessConstraints + sections.userPersonas;
  const lowerText = allText.toLowerCase();

  const preferenceCount = preferenceKeywords.filter(kw => lowerText.includes(kw)).length;

  if (preferenceCount >= 8) return 5;
  if (preferenceCount >= 5) return 4;
  if (preferenceCount >= 3) return 3;
  if (preferenceCount >= 2) return 2;
  return 1;
}

/**
 * Derive risk factors from IDEA content
 */
function deriveRiskFactorsFromIdea(content: string, sections: IdeaSections): RiskFactors {
  const lowerContent = content.toLowerCase();

  // Reversibility
  let reversibility: 'easy' | 'moderate' | 'difficult' = 'moderate';
  if (lowerContent.includes('irreversible') || lowerContent.includes('migration') ||
      lowerContent.includes('data loss') || lowerContent.includes('breaking change')) {
    reversibility = 'difficult';
  } else if (lowerContent.includes('refactor') || lowerContent.includes('new feature') ||
             lowerContent.includes('additive')) {
    reversibility = 'easy';
  }

  // Blast radius
  let blast_radius: 'isolated' | 'cross-cutting' | 'system-wide' = 'isolated';
  if (lowerContent.includes('system-wide') || lowerContent.includes('all users') ||
      lowerContent.includes('infrastructure') || lowerContent.includes('platform')) {
    blast_radius = 'system-wide';
  } else if (lowerContent.includes('cross-cutting') || lowerContent.includes('multiple') ||
             lowerContent.includes('shared')) {
    blast_radius = 'cross-cutting';
  }

  // Data sensitivity
  let data_sensitivity: 'none' | 'internal' | 'user-facing' = 'none';
  if (lowerContent.includes('pii') || lowerContent.includes('personal') ||
      lowerContent.includes('authentication') || lowerContent.includes('payment') ||
      lowerContent.includes('user data') || lowerContent.includes('sensitive')) {
    data_sensitivity = 'user-facing';
  } else if (lowerContent.includes('internal') || lowerContent.includes('logging') ||
             lowerContent.includes('metrics') || lowerContent.includes('telemetry')) {
    data_sensitivity = 'internal';
  }

  // Compliance impact
  let compliance_impact: 'none' | 'minor' | 'major' = 'none';
  if (lowerContent.includes('gdpr') || lowerContent.includes('soc') ||
      lowerContent.includes('hipaa') || lowerContent.includes('compliance') ||
      lowerContent.includes('regulatory')) {
    compliance_impact = 'major';
  } else if (lowerContent.includes('audit') || lowerContent.includes('policy')) {
    compliance_impact = 'minor';
  }

  return {
    reversibility,
    blast_radius,
    data_sensitivity,
    compliance_impact,
  };
}

/**
 * Get human-readable label for depth level
 *
 * @param depth - The workflow depth level
 * @returns Descriptive label
 */
export function getDepthLabel(depth: 'minimal' | 'standard' | 'comprehensive'): string {
  switch (depth) {
    case 'minimal':
      return 'SHALLOW (skip UNIT decomposition, INTENT → single BOLT)';
    case 'standard':
      return 'MEDIUM (full Inception + Construction pipeline)';
    case 'comprehensive':
      return 'DEEP (deep analysis + rigorous Construction + Metis consultation)';
  }
}

/**
 * Get human-readable label for risk tier
 *
 * @param tier - The risk tier (1-3)
 * @returns Descriptive label
 */
export function getRiskTierLabel(tier: RiskTier): string {
  switch (tier) {
    case 1:
      return 'Tier 1: Low Risk';
    case 2:
      return 'Tier 2: Moderate Risk';
    case 3:
      return 'Tier 3: High Risk';
  }
}
