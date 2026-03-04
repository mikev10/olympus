import type { ManifestSchema } from './phase-types.js';

export interface GatePresentation {
  gateNumber: number;        // 3, 4, or 5
  gateType: string;          // 'architecture-review' | 'code-review' | 'release-review'
  artifactId: string;        // What's being reviewed
  summary: string;           // Brief description of what was done
  reviewContent: string;     // What the reviewer should look at
  trustLevel: number;        // Current trust level
  trustBehavior: string;     // 'blocking' | 'summary-review' | 'notification-only' | 'auto-advance'
}

export function getGate3TrustBehavior(trustLevel: number, riskTier: number | null): string {
  if (riskTier === 3) return 'blocking';
  if (trustLevel <= 1) return 'blocking';
  return 'auto-advance';
}

export function getGate4TrustBehavior(trustLevel: number, riskTier: number): string {
  if (riskTier === 3) return 'blocking';
  if (trustLevel <= 1) return 'blocking';
  if (trustLevel === 2) return 'summary-review';
  return 'notification-only';
}

export function findParentUnit(manifest: ManifestSchema, boltId: string): string | null {
  const link = manifest.links.find(l => l.target_id === boltId && l.link_type === 'derives');
  return link ? link.source_id : null;
}

export function presentGate3(manifest: ManifestSchema, trustLevel: number): GatePresentation[] {
  const unitArtifacts = manifest.artifacts.filter(a => a.stage === 'unit');
  const riskTier = manifest.risk_tier?.tier ?? null;

  return unitArtifacts.map(artifact => {
    // Find child BOLTs
    const childBolts = manifest.links
      .filter(link => link.source_id === artifact.id && link.link_type === 'derives')
      .map(link => manifest.artifacts.find(a => a.id === link.target_id))
      .filter(a => a !== undefined);

    const childBoltsList = childBolts.length > 0
      ? `\n\nChild BOLTs:\n${childBolts.map(b => `  - ${b.id} (${b.path})`).join('\n')}`
      : '\n\nNo child BOLTs found.';

    let reviewContent = `UNIT Artifact: ${artifact.path}\nContract Status: ${artifact.contract_status}${childBoltsList}`;

    // Add Risk Tier 3 note if applicable
    if (riskTier === 3) {
      reviewContent += '\n\nNOTE: Risk Tier 3 - Momus review mandatory for architecture decisions.';
    }

    return {
      gateNumber: 3,
      gateType: 'architecture-review',
      artifactId: artifact.id,
      summary: `Architecture review for ${artifact.id}`,
      reviewContent,
      trustLevel,
      trustBehavior: getGate3TrustBehavior(trustLevel, riskTier),
    };
  });
}

export function presentGate4(
  manifest: ManifestSchema,
  boltId: string,
  trustLevel: number,
  riskTier: number
): GatePresentation {
  const boltArtifact = manifest.artifacts.find(a => a.id === boltId);

  if (!boltArtifact) {
    throw new Error(`BOLT artifact not found: ${boltId}`);
  }

  const trustBehavior = getGate4TrustBehavior(trustLevel, riskTier);

  let reviewInstructions = '';
  if (trustLevel <= 1) {
    reviewInstructions = '\n\nReview Instructions: Full code review required.';
  } else if (trustLevel === 2) {
    reviewInstructions = '\n\nReview Instructions: Summary review - verify major changes only.';
  } else {
    reviewInstructions = '\n\nReview Instructions: Notification only - AI proceeds automatically.';
  }

  let reviewContent = `BOLT Spec: ${boltArtifact.path}\nContract Status: ${boltArtifact.contract_status}${reviewInstructions}`;

  // Add Risk Tier 3 note if applicable
  if (riskTier === 3) {
    reviewContent += '\n\nNOTE: Risk Tier 3 - Developer review mandatory for every BOLT.';
  }

  return {
    gateNumber: 4,
    gateType: 'code-review',
    artifactId: boltId,
    summary: `Code review for ${boltId}`,
    reviewContent,
    trustLevel,
    trustBehavior,
  };
}

export function presentGate4Batch(
  manifest: ManifestSchema,
  boltIds: string[],
  trustLevel: number,
  riskTier: number
): GatePresentation[] {
  return boltIds.map(boltId => {
    const presentation = presentGate4(manifest, boltId, trustLevel, riskTier);

    // Find parent UNIT for context
    const parentUnitId = findParentUnit(manifest, boltId);
    if (parentUnitId) {
      presentation.summary = `Code review for ${boltId} (part of ${parentUnitId})`;
    }

    // Add summary view at Trust 2+
    if (trustLevel >= 2) {
      presentation.reviewContent = `[Summary View]\n\n${presentation.reviewContent}`;
    }

    return presentation;
  });
}

export function presentGate5(manifest: ManifestSchema, trustLevel: number): GatePresentation {
  const totalArtifacts = manifest.artifacts.length;
  const boltArtifacts = manifest.artifacts.filter(a => a.stage === 'code-generation');

  const approvals = manifest.gate_audit.filter(g => g.action === 'approved').length;
  const rejections = manifest.gate_audit.filter(g => g.action === 'rejected').length;

  const boltStatusList = boltArtifacts.length > 0
    ? boltArtifacts.map(b => `  - ${b.id}: ${b.contract_status}`).join('\n')
    : '  No BOLTs found.';

  const reviewContent = `Release Approval Review

Feature: ${manifest.feature_name}
Total Artifacts: ${totalArtifacts}

Gate Audit Summary:
  Approvals: ${approvals}
  Rejections: ${rejections}

BOLT Artifacts:
${boltStatusList}

NOTE: Gate 5 is always blocking - final release approval required.`;

  return {
    gateNumber: 5,
    gateType: 'release-review',
    artifactId: manifest.workflow_id,
    summary: `Release approval for ${manifest.feature_name}`,
    reviewContent,
    trustLevel,
    trustBehavior: 'blocking', // Gate 5 is ALWAYS blocking
  };
}
