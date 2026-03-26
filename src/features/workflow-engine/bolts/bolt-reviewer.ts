import fs from 'fs-extra';
import { join } from 'path';
import type { BoltSpec, WorkflowCheckpointV3 } from '../phase-types.js';
import { loadTrustState } from '../trust.js';
import { saveCheckpoint } from '../checkpoint.js';

export interface AgentReviewResult {
  score: number;
  feedback: string;
  concerns: string[];
}

export interface EscalationEvent {
  bolt_id: string;
  failure_count: number;
  last_errors: string[];
  recommended_actions: ('re-scope' | 'split')[];
}

export interface ReviewDecision {
  approved: boolean;
  score: number;
  tier: 'auto_approve' | 'advisory_ack' | 'hard_block';
  feedback: string;
  concerns: string[];
  /** True only when tier is advisory_ack (trust < 2). Caller must surface acknowledgment prompt. */
  requiresAcknowledgment: boolean;
  escalation?: EscalationEvent;
  artifact_path: string;
}

export function applyTierLogic(score: number): 'auto_approve' | 'advisory_ack' | 'hard_block' {
  if (score >= 70) return 'auto_approve';
  if (score >= 50) return 'advisory_ack';
  return 'hard_block';
}

export class BoltReviewer {
  async review(
    boltSpec: BoltSpec,
    codePaths: string[],
    projectPath: string,
    workflowId: string,
    checkpoint: WorkflowCheckpointV3,
    reviewCallback: (bolt: BoltSpec, codePaths: string[], projectPath: string) => Promise<AgentReviewResult>,
  ): Promise<ReviewDecision> {
    const result = await reviewCallback(boltSpec, codePaths, projectPath);

    let tier = applyTierLogic(result.score);

    const trustState = loadTrustState(projectPath);
    if (trustState.current_level >= 2 && tier === 'advisory_ack') {
      tier = 'auto_approve';
    }

    const approved = tier !== 'hard_block';
    const requiresAcknowledgment = tier === 'advisory_ack';

    let escalation: EscalationEvent | undefined;
    const boltProgress = checkpoint.construction_bolts?.[boltSpec.id];
    if (boltProgress) {
      const reviewStage = boltProgress.stages.review;
      if (reviewStage.failure_count >= 2) {
        const lastErrors: string[] = [];
        if (reviewStage.last_error) {
          lastErrors.push(reviewStage.last_error);
        }
        escalation = {
          bolt_id: boltSpec.id,
          failure_count: reviewStage.failure_count,
          last_errors: lastErrors,
          recommended_actions: ['re-scope', 'split'],
        };
      }
    }

    const artifactPath = await this.writeReviewArtifact(
      boltSpec.id,
      { score: result.score, tier, approved, feedback: result.feedback, concerns: result.concerns, escalation },
      projectPath,
      workflowId,
    );

    if (checkpoint.construction_bolts?.[boltSpec.id]) {
      checkpoint.construction_bolts[boltSpec.id].review_score = result.score;
    }
    await saveCheckpoint(projectPath, checkpoint);

    return {
      approved,
      score: result.score,
      tier,
      feedback: result.feedback,
      concerns: result.concerns,
      requiresAcknowledgment,
      escalation,
      artifact_path: artifactPath,
    };
  }

  async writeReviewArtifact(
    boltId: string,
    reviewData: {
      score: number;
      tier: string;
      approved: boolean;
      feedback: string;
      concerns: string[];
      escalation?: EscalationEvent;
    },
    projectPath: string,
    workflowId: string,
  ): Promise<string> {
    const relativePath = join('aidlc-docs', workflowId, 'construction', 'bolts', boltId, 'review.md');
    const absolutePath = join(projectPath, relativePath);

    const lines: string[] = [];

    lines.push('---');
    lines.push(`bolt_id: "${boltId}"`);
    lines.push(`score: ${reviewData.score}`);
    lines.push(`tier: "${reviewData.tier}"`);
    lines.push(`approved: ${reviewData.approved}`);
    lines.push(`reviewed_at: "${new Date().toISOString()}"`);
    lines.push('---');
    lines.push('');

    lines.push('## Score');
    lines.push('');
    lines.push(`${reviewData.score}/100 (${reviewData.tier})`);
    lines.push('');

    lines.push('## Decision');
    lines.push('');
    if (reviewData.approved && reviewData.tier === 'auto_approve') {
      lines.push('Approved — score meets auto-approve threshold.');
    } else if (reviewData.approved && reviewData.tier === 'advisory_ack') {
      lines.push('Approved with advisory — acknowledgment required before proceeding.');
    } else {
      lines.push('Blocked — score below minimum threshold. Review feedback and re-submit.');
    }
    lines.push('');

    lines.push('## Feedback');
    lines.push('');
    lines.push(reviewData.feedback);
    lines.push('');

    if (reviewData.concerns.length > 0) {
      lines.push('## Concerns');
      lines.push('');
      for (const concern of reviewData.concerns) {
        lines.push(`- ${concern}`);
      }
      lines.push('');
    }

    if (reviewData.escalation) {
      lines.push('## Recommended Actions');
      lines.push('');
      for (const action of reviewData.escalation.recommended_actions) {
        lines.push(`- ${action}`);
      }
      lines.push('');
    }

    await fs.ensureDir(join(absolutePath, '..'));
    await fs.writeFile(absolutePath, lines.join('\n'), 'utf-8');

    return relativePath;
  }
}
