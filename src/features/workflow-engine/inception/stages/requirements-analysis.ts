import * as fs from 'fs-extra';
import { join } from 'path';
import {
  generateQuestionFile,
  readAnsweredFile,
  detectContradictions,
  detectAmbiguities,
  generateClarificationFile,
  allQuestionsResolved,
} from '../../question-manager.js';
import type { Question, AnsweredQuestion } from '../../question-manager.js';
import {
  buildStakeholderMap,
  classifyConstraints,
  buildRequirementsTrace,
  getTraceabilitySummary,
} from '../../requirements.js';
import { registerStageHandler } from '../orchestrator.js';
import type { InceptionStageResult } from '../orchestrator.js';
import type { WorkflowCheckpointV3 } from '../../phase-types.js';

export const REQUIREMENTS_QUESTIONS: Question[] = [
  {
    number: 1,
    text: 'What are the primary functional requirements for this feature?',
    options: [
      { label: 'CRUD', description: 'Standard create/read/update/delete operations' },
      { label: 'Processing', description: 'Data processing or transformation pipeline' },
      { label: 'Integration', description: 'Third-party API or service integration' },
    ],
    otherOption: true,
    category: 'functional',
  },
  {
    number: 2,
    text: 'What non-functional requirements are most critical?',
    options: [
      { label: 'Performance', description: 'Response time, throughput, scalability targets' },
      { label: 'Security', description: 'Authentication, authorization, data protection' },
      { label: 'Reliability', description: 'Uptime, fault tolerance, disaster recovery' },
    ],
    otherOption: true,
    category: 'non-functional',
  },
  {
    number: 3,
    text: 'What are the known constraints or limitations?',
    options: [
      { label: 'Technical', description: 'Must integrate with existing tech stack or APIs' },
      { label: 'Timeline', description: 'Fixed deadline or sprint commitment' },
      { label: 'Budget', description: 'Cost or resource limitations' },
    ],
    otherOption: true,
    category: 'constraints',
  },
  {
    number: 4,
    text: 'How will success be measured for this feature?',
    options: [
      { label: 'Metrics', description: 'Specific KPIs or measurable outcomes' },
      { label: 'User feedback', description: 'User satisfaction or adoption rates' },
      { label: 'Business impact', description: 'Revenue, efficiency, or cost savings' },
    ],
    otherOption: true,
    category: 'success-metrics',
  },
];

export async function executeRequirementsAnalysis(
  projectPath: string,
  workflowId: string,
  checkpoint: WorkflowCheckpointV3
): Promise<InceptionStageResult> {
  const stageState = checkpoint.inception_stages?.['requirements-analysis'];
  const questionsFile = stageState?.questions_file ?? null;

  if (!questionsFile) {
    const filePath = await generateQuestionFile(
      projectPath,
      workflowId,
      'requirements-analysis',
      REQUIREMENTS_QUESTIONS
    );

    return {
      stage: 'requirements-analysis',
      status: 'awaiting_answers',
      requires_approval: true,
      artifacts_generated: [],
      questions_file: filePath,
      review_summary: 'Requirements questions generated. Please answer each question in the file.',
      whats_next: `Answer the questions in:\n${filePath}\nThen say "done" or "answers ready".`,
    };
  }

  const answers = readAnsweredFile(questionsFile);
  const contradictions = detectContradictions(answers);
  const ambiguities = detectAmbiguities(answers);

  if (!allQuestionsResolved(answers, contradictions, ambiguities)) {
    if (contradictions.length > 0 || ambiguities.length > 0) {
      const clarificationPath = await generateClarificationFile(
        projectPath,
        workflowId,
        'requirements-analysis',
        contradictions,
        ambiguities
      );
      return {
        stage: 'requirements-analysis',
        status: 'awaiting_answers',
        requires_approval: true,
        artifacts_generated: [],
        questions_file: clarificationPath,
        review_summary: `Found ${contradictions.length} contradictions and ${ambiguities.length} ambiguities. Clarification needed.`,
        whats_next: `Answer clarification questions in:\n${clarificationPath}`,
      };
    }
    return {
      stage: 'requirements-analysis',
      status: 'awaiting_answers',
      requires_approval: true,
      artifacts_generated: [],
      questions_file: questionsFile,
      review_summary: 'Some questions remain unanswered. Please complete all answers.',
      whats_next: `Complete the answers in:\n${questionsFile}`,
    };
  }

  const artifactsGenerated = await synthesizeRequirements(
    projectPath,
    workflowId,
    answers,
    checkpoint
  );

  return {
    stage: 'requirements-analysis',
    status: 'completed',
    requires_approval: true,
    artifacts_generated: artifactsGenerated,
    review_summary: `Requirements analysis complete. Generated ${artifactsGenerated.length} artifacts.`,
    whats_next: 'Requirements are ready. Next: user stories generation.',
  };
}

export async function synthesizeRequirements(
  projectPath: string,
  workflowId: string,
  answers: AnsweredQuestion[],
  _checkpoint: WorkflowCheckpointV3
): Promise<string[]> {
  const inceptionDir = join(projectPath, 'aidlc-docs', workflowId, 'inception');
  await fs.ensureDir(inceptionDir);
  const artifactPaths: string[] = [];

  const intentPath = join(inceptionDir, 'intent.md');
  let intentContent = '';
  try {
    intentContent = await fs.readFile(intentPath, 'utf-8');
  } catch {
    intentContent = '';
  }

  const answerContext = answers
    .map(a => `### ${a.category || 'general'}: ${a.text}\n${a.answer}`)
    .join('\n\n');

  const combinedContext = intentContent
    ? `${intentContent}\n\n## Requirements Analysis Answers\n\n${answerContext}`
    : `# Feature Requirements\n\n${answerContext}`;

  const stakeholderMap = buildStakeholderMap(combinedContext);
  const constraintClassification = classifyConstraints(combinedContext);
  const trace = buildRequirementsTrace(combinedContext, null, null, null);
  const traceabilitySummary = getTraceabilitySummary(trace);

  const requirementsContent = buildRequirementsMarkdown(
    answers,
    stakeholderMap,
    constraintClassification,
    traceabilitySummary
  );
  const requirementsPath = join(inceptionDir, 'requirements.md');
  await fs.writeFile(requirementsPath, requirementsContent, 'utf-8');
  artifactPaths.push(requirementsPath);

  if (intentContent) {
    const enrichedIntent = `${intentContent}\n\n## Requirements Summary\n\n${traceabilitySummary}\n`;
    await fs.writeFile(intentPath, enrichedIntent, 'utf-8');
  }

  return artifactPaths;
}

function buildRequirementsMarkdown(
  answers: AnsweredQuestion[],
  stakeholderMap: ReturnType<typeof buildStakeholderMap>,
  constraints: ReturnType<typeof classifyConstraints>,
  traceability: string
): string {
  const lines: string[] = [];
  lines.push('# Requirements Analysis\n');
  lines.push(`Generated: ${new Date().toISOString()}\n`);

  lines.push('## Functional Requirements\n');
  const functionalAnswers = answers.filter(a => a.category === 'functional');
  for (const a of functionalAnswers) {
    lines.push(`- ${a.answer}`);
  }
  if (functionalAnswers.length === 0) lines.push('(none specified)');
  lines.push('');

  lines.push('## Non-Functional Requirements\n');
  const nfrAnswers = answers.filter(a => a.category === 'non-functional');
  for (const a of nfrAnswers) {
    lines.push(`- ${a.answer}`);
  }
  if (nfrAnswers.length === 0) lines.push('(none specified)');
  lines.push('');

  lines.push('## Constraints\n');
  if (constraints.constraints.length > 0) {
    for (const c of constraints.constraints) {
      lines.push(`- [${c.category}/${c.severity}] ${c.text}`);
    }
  } else {
    const constraintAnswers = answers.filter(a => a.category === 'constraints');
    for (const a of constraintAnswers) {
      lines.push(`- ${a.answer}`);
    }
    if (constraintAnswers.length === 0) lines.push('(none specified)');
  }
  lines.push('');

  lines.push('## Success Metrics\n');
  const metricsAnswers = answers.filter(a => a.category === 'success-metrics');
  for (const a of metricsAnswers) {
    lines.push(`- ${a.answer}`);
  }
  if (metricsAnswers.length === 0) lines.push('(none specified)');
  lines.push('');

  lines.push('## Stakeholders\n');
  if (stakeholderMap.stakeholders.length > 0) {
    for (const s of stakeholderMap.stakeholders) {
      lines.push(`- **${s.name}** (${s.role}) — Interest: ${s.interest}, Influence: ${s.influence}`);
      for (const concern of s.concerns) {
        lines.push(`  - ${concern}`);
      }
    }
  } else {
    lines.push('(none identified)');
  }
  lines.push('');

  lines.push('## Traceability\n');
  lines.push(traceability);
  lines.push('');

  return lines.join('\n');
}

registerStageHandler('requirements-analysis', executeRequirementsAnalysis);
