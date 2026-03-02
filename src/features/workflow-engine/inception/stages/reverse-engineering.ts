import { join } from 'path';
import { executeDiscoveryPhase } from '../../discovery.js';
import { registerStageHandler } from '../orchestrator.js';
import type { InceptionStageResult } from '../orchestrator.js';
import type { WorkflowCheckpointV3 } from '../../phase-types.js';

async function executeReverseEngineering(
  projectPath: string,
  workflowId: string,
  checkpoint: WorkflowCheckpointV3
): Promise<InceptionStageResult> {
  const pathwayType = checkpoint.pathway_type ?? 'greenfield';
  if (pathwayType === 'greenfield') {
    return {
      stage: 'reverse-engineering',
      status: 'skipped',
      requires_approval: true,
      artifacts_generated: [],
      review_summary: 'Skipped: greenfield project has no existing codebase to reverse-engineer.',
    };
  }

  const manifestPath = join(projectPath, 'aidlc-docs', workflowId, checkpoint.manifest_path);

  let result;
  try {
    result = await executeDiscoveryPhase({
      projectPath,
      workflowId,
      featureName: checkpoint.feature_name,
      manifestPath,
    });
  } catch (error) {
    const err = error as Error;
    return {
      stage: 'reverse-engineering',
      status: 'review_required',
      requires_approval: true,
      artifacts_generated: [],
      review_summary: `Reverse engineering failed: ${err.message}`,
      whats_next: 'Fix the error above and retry the reverse-engineering stage.',
    };
  }

  const artifactList = result.artifactsGenerated.map(a => `  - ${a}`).join('\n');
  const reviewLines = [
    '## REVIEW REQUIRED',
    '',
    `Reverse engineering generated ${result.artifactsGenerated.length} artifacts:`,
    artifactList,
    '',
    `Source files analyzed: ${result.sourceFileCount}`,
  ];

  if (result.brownfieldData) {
    reviewLines.push(`Key files identified: ${result.brownfieldData.keyFiles.length}`);
  }

  const reviewSummary = reviewLines.filter(line => line !== undefined).join('\n');

  const whatsNext = [
    "## WHAT'S NEXT",
    '',
    'Review the generated discovery artifacts above.',
    'Once approved, the requirements analysis stage will begin.',
  ].join('\n');

  return {
    stage: 'reverse-engineering',
    status: 'review_required',
    requires_approval: true,
    artifacts_generated: result.artifactsGenerated,
    review_summary: reviewSummary,
    whats_next: whatsNext,
  };
}

registerStageHandler('reverse-engineering', executeReverseEngineering);

export { executeReverseEngineering };
