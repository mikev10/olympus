import * as fs from 'fs-extra';
import { join } from 'path';
import { registerStageHandler } from '../orchestrator.js';
import type { InceptionStageResult } from '../orchestrator.js';
import type { WorkflowCheckpointV3 } from '../../phase-types.js';

async function executeUserStories(
  projectPath: string,
  workflowId: string,
  checkpoint: WorkflowCheckpointV3
): Promise<InceptionStageResult> {
  const pathwayType = checkpoint.pathway_type ?? 'greenfield';
  if (pathwayType === 'bugfix' || pathwayType === 'optimization') {
    return {
      stage: 'user-stories',
      status: 'skipped',
      requires_approval: true,
      artifacts_generated: [],
      review_summary: `Skipped: ${pathwayType} pathway does not require user stories.`,
    };
  }

  const inceptionDir = join(projectPath, 'aidlc-docs', workflowId, 'inception');
  await fs.ensureDir(inceptionDir);

  let intentContent = '';
  let requirementsContent = '';
  try {
    intentContent = await fs.readFile(join(inceptionDir, 'intent.md'), 'utf-8');
  } catch {}
  try {
    requirementsContent = await fs.readFile(join(inceptionDir, 'requirements', 'requirements.md'), 'utf-8');
  } catch {}

  const userStoriesDir = join(inceptionDir, 'user-stories');
  await fs.ensureDir(userStoriesDir);
  const storiesPath = join(userStoriesDir, 'stories.md');
  const personasPath = join(userStoriesDir, 'personas.md');
  const planPath = join(inceptionDir, 'user-stories-plan.md');

  const storiesExist = await fs.pathExists(storiesPath);
  const planExists = await fs.pathExists(planPath);

  if (!planExists) {
    const plan = generateUserStoriesPlan(intentContent, requirementsContent);
    await fs.writeFile(planPath, plan, 'utf-8');

    return {
      stage: 'user-stories',
      status: 'review_required',
      requires_approval: true,
      artifacts_generated: [planPath],
      review_summary: [
        '## REVIEW REQUIRED',
        '',
        'User stories plan generated. Review the plan before stories are generated.',
        '',
        `Plan file: ${planPath}`,
      ].join('\n'),
      whats_next: [
        "## WHAT'S NEXT",
        '',
        'Approve the user stories plan to proceed with persona and story generation.',
      ].join('\n'),
    };
  }

  if (!storiesExist) {
    const personas = generatePersonas(intentContent, requirementsContent);
    await fs.writeFile(personasPath, personas, 'utf-8');

    const stories = generateStories(intentContent, requirementsContent);
    await fs.writeFile(storiesPath, stories, 'utf-8');

    return {
      stage: 'user-stories',
      status: 'completed',
      requires_approval: true,
      artifacts_generated: [personasPath, storiesPath],
      review_summary: `User stories complete. Generated personas and ${countStories(stories)} user stories.`,
      whats_next: 'Proceed to workflow planning stage.',
    };
  }

  return {
    stage: 'user-stories',
    status: 'completed',
    requires_approval: true,
    artifacts_generated: [personasPath, storiesPath],
    review_summary: 'User stories already generated.',
  };
}

export function generateUserStoriesPlan(intentContent: string, requirementsContent: string): string {
  const lines: string[] = [];
  lines.push('# User Stories Plan\n');
  lines.push(`Generated: ${new Date().toISOString()}\n`);
  lines.push('## Approach\n');
  lines.push('1. Identify user personas from requirements and intent context');
  lines.push('2. Map each persona to their primary goals and pain points');
  lines.push('3. Generate user stories with acceptance criteria in Given/When/Then format');
  lines.push('4. Ensure traceability back to requirements\n');
  lines.push('## Input Context\n');
  lines.push(`- Intent: ${intentContent ? 'Available' : 'Not available'}`);
  lines.push(`- Requirements: ${requirementsContent ? 'Available' : 'Not available'}\n`);
  lines.push('## Planned Personas\n');

  const combinedContext = `${intentContent}\n${requirementsContent}`.toLowerCase();
  const personaHints: string[] = [];
  if (combinedContext.includes('user') || combinedContext.includes('customer')) {
    personaHints.push('- End User / Customer');
  }
  if (combinedContext.includes('admin') || combinedContext.includes('administrator')) {
    personaHints.push('- Administrator');
  }
  if (combinedContext.includes('developer') || combinedContext.includes('engineer')) {
    personaHints.push('- Developer / Engineer');
  }
  if (personaHints.length === 0) {
    personaHints.push('- Primary User (to be refined during generation)');
  }
  lines.push(personaHints.join('\n'));
  lines.push('');

  lines.push('## Estimated Stories\n');
  lines.push('Story count will be determined based on requirements complexity.');
  lines.push('');

  return lines.join('\n');
}

export function generatePersonas(intentContent: string, requirementsContent: string): string {
  const lines: string[] = [];
  lines.push('# User Personas\n');
  lines.push(`Generated: ${new Date().toISOString()}\n`);

  const combinedContext = `${intentContent}\n${requirementsContent}`.toLowerCase();

  lines.push('## Primary User\n');
  lines.push('- **Role**: End user of the feature');
  lines.push('- **Goals**: Accomplish their primary task efficiently');
  lines.push('- **Pain Points**: Current workflow gaps or inefficiencies');
  lines.push('- **Technical Level**: Varies');
  lines.push('');

  if (combinedContext.includes('admin') || combinedContext.includes('administrator')) {
    lines.push('## Administrator\n');
    lines.push('- **Role**: System administrator');
    lines.push('- **Goals**: Manage and configure the system');
    lines.push('- **Pain Points**: Manual configuration overhead');
    lines.push('- **Technical Level**: High');
    lines.push('');
  }

  if (combinedContext.includes('developer') || combinedContext.includes('api')) {
    lines.push('## Developer\n');
    lines.push('- **Role**: Developer integrating with the feature');
    lines.push('- **Goals**: Integrate quickly with clear APIs');
    lines.push('- **Pain Points**: Lack of documentation, unclear contracts');
    lines.push('- **Technical Level**: High');
    lines.push('');
  }

  return lines.join('\n');
}

export function generateStories(intentContent: string, requirementsContent: string): string {
  const lines: string[] = [];
  lines.push('# User Stories\n');
  lines.push(`Generated: ${new Date().toISOString()}\n`);

  lines.push('## US-001: Core Feature Usage\n');
  lines.push('**As a** Primary User');
  lines.push('**I want to** use the core feature');
  lines.push('**So that** I can accomplish my primary goal\n');
  lines.push('### Acceptance Criteria\n');
  lines.push('```gherkin');
  lines.push('Given the user has access to the feature');
  lines.push('When they initiate the primary action');
  lines.push('Then the expected result is produced');
  lines.push('And the user receives confirmation');
  lines.push('```\n');

  const combinedContext = `${intentContent}\n${requirementsContent}`.toLowerCase();

  if (combinedContext.includes('error') || combinedContext.includes('validation')) {
    lines.push('## US-002: Error Handling\n');
    lines.push('**As a** Primary User');
    lines.push('**I want to** receive clear error messages when something goes wrong');
    lines.push('**So that** I can correct my input and retry\n');
    lines.push('### Acceptance Criteria\n');
    lines.push('```gherkin');
    lines.push('Given the user provides invalid input');
    lines.push('When the system validates the input');
    lines.push('Then a clear error message is displayed');
    lines.push('And the user can correct and resubmit');
    lines.push('```\n');
  }

  if (combinedContext.includes('performance') || combinedContext.includes('scalab')) {
    lines.push('## US-003: Performance\n');
    lines.push('**As a** Primary User');
    lines.push('**I want** the feature to respond quickly');
    lines.push('**So that** my workflow is not interrupted\n');
    lines.push('### Acceptance Criteria\n');
    lines.push('```gherkin');
    lines.push('Given the system is under normal load');
    lines.push('When the user performs the primary action');
    lines.push('Then the response time is under the defined threshold');
    lines.push('```\n');
  }

  return lines.join('\n');
}

export function countStories(storiesContent: string): number {
  return (storiesContent.match(/^## US-\d+/gm) || []).length;
}

registerStageHandler('user-stories', executeUserStories);
export { executeUserStories };
