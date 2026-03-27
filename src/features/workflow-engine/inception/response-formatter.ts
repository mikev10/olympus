import type { InceptionStage } from '../phase-types.js';

const STAGE_LABELS: Record<InceptionStage, string> = {
  'workspace-detection': 'Workspace Detection',
  'reverse-engineering': 'Reverse Engineering',
  'requirements-analysis': 'Requirements Analysis',
  'workflow-planning': 'Workflow Planning',
  'units-generation': 'Units Generation',
  'user-stories': 'User Stories',
  'bolt-planning': 'Bolt Planning',
};

const STAGE_DESCRIPTIONS: Record<InceptionStage, string> = {
  'workspace-detection': 'Detected project type and pathway (greenfield/brownfield) and set up workspace configuration',
  'reverse-engineering': 'Analyzed existing codebase structure, components, and technology stack',
  'requirements-analysis': 'Captured structured requirements from Q&A interaction',
  'workflow-planning': 'Created execution plan with Mermaid workflow diagram',
  'units-generation': 'Decomposed requirements into implementation units with dependency mapping',
  'user-stories': 'Generated user personas and user stories per-unit with acceptance criteria',
  'bolt-planning': 'Decomposed units into executable bolts with dependency tracking',
};

const NEXT_STAGE_DESCRIPTIONS: Record<InceptionStage, string> = {
  'workspace-detection': 'Analyzes your existing codebase to understand current architecture and components',
  'reverse-engineering': 'Captures structured requirements from Q&A interaction with you',
  'requirements-analysis': 'Creates an execution plan with workflow diagram showing stage dependencies',
  'workflow-planning': 'Decomposes the intent into independent units of work with domain analysis and dependency mapping',
  'units-generation': 'Creates user stories per-unit from each unit\'s assigned requirements',
  'user-stories': 'Decomposes each unit\'s stories into executable bolts with dependency tracking',
  'bolt-planning': 'Bolts are planned — proceed to Construction phase to execute each bolt',
};

const STAGE_TIME_HINTS: Record<InceptionStage, Record<string, string>> = {
  'workspace-detection': { minimal: '< 1 min', standard: '< 1 min', comprehensive: '1-2 min' },
  'reverse-engineering': { minimal: '2-5 min', standard: '5-10 min', comprehensive: '10-20 min' },
  'requirements-analysis': { minimal: '5-10 min', standard: '10-20 min', comprehensive: '20-40 min' },
  'workflow-planning': { minimal: '1-3 min', standard: '3-5 min', comprehensive: '5-10 min' },
  'units-generation': { minimal: '2-5 min', standard: '5-10 min', comprehensive: '10-20 min' },
  'user-stories': { minimal: '2-5 min', standard: '5-10 min', comprehensive: '10-20 min' },
  'bolt-planning': { minimal: '2-5 min', standard: '5-10 min', comprehensive: '10-20 min' },
};

export function formatStageCompletion(
  stageName: string,
  artifacts: string[],
  reviewItems: string[],
  nextStage: string | null,
  nextStageDescription: string,
  depth: string = 'standard',
): string {
  const label = STAGE_LABELS[stageName as InceptionStage] ?? stageName;
  const description = STAGE_DESCRIPTIONS[stageName as InceptionStage]
    ?? `Stage '${stageName}' completed`;

  const artifactLines = artifacts.length > 0
    ? artifacts.map(a => `- \`${a}\``)
    : ['- _(no artifacts generated)_'];

  const reviewLines = reviewItems.length > 0
    ? reviewItems.map(item => `- [ ] ${item}`)
    : ['- [ ] Review the generated artifacts for accuracy and completeness'];

  const lines: string[] = [
    '---',
    '',
    '⚠️ **REVIEW REQUIRED**',
    '',
    '**What was completed**',
    `- **${label}**: ${description}`,
    '',
    '**Artifacts generated**',
    ...artifactLines,
    '',
    '> **What needs your review**',
    ...reviewLines.map(r => `> ${r}`),
    '',
    '---',
    '',
  ];

  if (nextStage) {
    const nextLabel = STAGE_LABELS[nextStage as InceptionStage] ?? nextStage;
    const effectiveNextDesc = nextStageDescription
      || NEXT_STAGE_DESCRIPTIONS[nextStage as InceptionStage]
      || `Execute the ${nextStage} stage`;
    const timeHints = STAGE_TIME_HINTS[nextStage as InceptionStage];
    const timeHint = timeHints ? timeHints[depth] ?? timeHints['standard'] : 'a few minutes';

    lines.push(
      "📋 **WHAT'S NEXT**",
      '',
      `After your review, proceed to: **${nextLabel}**`,
      `- ${effectiveNextDesc}`,
      `- Estimated time: ${timeHint}`,
      '',
      'To proceed: `continue` or `approve`',
      'To request changes: `revise [specific feedback]`',
    );
  } else {
    lines.push(
      "📋 **WHAT'S NEXT**",
      '',
      'Inception phase is complete.',
      '- All inception stages have been executed and artifacts are ready for construction',
      '- Review the execution plan at `aidlc-docs/{workflow-id}/inception/plans/execution-plan.md`',
      '',
      'To proceed to Construction: `continue` or `approve`',
    );
  }

  return lines.join('\n');
}

export function formatInceptionComplete(
  workflowId: string,
  totalStages: number,
  artifactCount: number,
): string {
  const artifactPath = `aidlc-docs/${workflowId}/inception/`;

  const lines: string[] = [
    '---',
    '',
    '✅ **INCEPTION COMPLETE**',
    '',
    `All ${totalStages} inception stage(s) completed successfully.`,
    `${artifactCount} artifact(s) generated in \`${artifactPath}\``,
    '',
    '**What was accomplished**',
    '- Requirements captured and structured',
    '- User stories and personas defined',
    '- Workflow execution plan created',
    '- Units of work defined and mapped',
    '',
    '---',
    '',
    '📋 **Next Phase: Construction**',
    '',
    'The Construction phase will execute design and implementation for each unit.',
    '',
    'To begin Construction: `continue` or `/ascent`',
  ];

  return lines.join('\n');
}
