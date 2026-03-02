import * as fs from 'fs-extra';
import { join } from 'path';
import {
  buildApplicationDesignPrompt,
  writeApplicationDesignArtifacts,
} from '../../application-design.js';
import type { ApplicationDesignArtifacts } from '../../application-design.js';
import { registerStageHandler } from '../orchestrator.js';
import type { InceptionStageResult } from '../orchestrator.js';
import type { WorkflowCheckpointV3 } from '../../phase-types.js';

export async function executeApplicationDesign(
  projectPath: string,
  workflowId: string,
  checkpoint: WorkflowCheckpointV3
): Promise<InceptionStageResult> {
  const pathwayType = checkpoint.pathway_type ?? 'greenfield';
  if (pathwayType === 'bugfix' || pathwayType === 'optimization') {
    return {
      stage: 'application-design',
      status: 'skipped',
      requires_approval: true,
      artifacts_generated: [],
      review_summary: `Skipped: ${pathwayType} pathway does not require application design.`,
    };
  }

  const inceptionDir = join(projectPath, 'aidlc-docs', workflowId, 'inception');

  let intentContent = '';
  let requirementsContent = '';
  let storiesContent = '';

  try {
    intentContent = await fs.readFile(join(inceptionDir, 'intent.md'), 'utf-8');
  } catch { /* context files are optional */ }

  try {
    requirementsContent = await fs.readFile(join(inceptionDir, 'requirements.md'), 'utf-8');
  } catch { /* context files are optional */ }

  try {
    storiesContent = await fs.readFile(join(inceptionDir, 'stories.md'), 'utf-8');
  } catch { /* context files are optional */ }

  const designPrompt = buildApplicationDesignPrompt(
    intentContent, storiesContent, requirementsContent
  );

  // Scaffold artifacts are intentionally empty: the /plan skill uses designPrompt
  // to drive an LLM interaction, then calls parseApplicationDesignResponse() +
  // writeApplicationDesignArtifacts() with real data. This stage only bootstraps
  // the directory structure and prompt file for that flow.
  const scaffoldArtifacts: ApplicationDesignArtifacts = {
    components: [],
    services: [],
    dependencies: [],
  };

  const writtenPaths = await writeApplicationDesignArtifacts(
    projectPath, workflowId, scaffoldArtifacts
  );

  const promptPath = join(inceptionDir, 'application-design', 'design-prompt.md');
  await fs.ensureDir(join(inceptionDir, 'application-design'));
  await fs.writeFile(promptPath, designPrompt, 'utf-8');
  writtenPaths.push(promptPath);

  return {
    stage: 'application-design',
    status: 'review_required',
    requires_approval: true,
    artifacts_generated: writtenPaths,
    review_summary: [
      '## REVIEW REQUIRED',
      '',
      `Application design scaffolds generated (${writtenPaths.length} artifacts):`,
      ...writtenPaths.map(p => `  - ${p}`),
      '',
      'The design prompt has been generated for AI-assisted completion.',
      'Review and populate the design artifacts with actual component definitions.',
    ].join('\n'),
    whats_next: [
      "## WHAT'S NEXT",
      '',
      'Use the design prompt to generate detailed component definitions.',
      'Once design artifacts are populated, proceed to units generation.',
    ].join('\n'),
  };
}

registerStageHandler('application-design', executeApplicationDesign);
