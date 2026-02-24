import * as path from 'path';
import * as fs from 'fs-extra';

export interface Question {
  number: number;
  text: string;
  options: { label: string; description: string }[];
  otherOption: true; // MANDATORY — "Other" is ALWAYS the last option
  category: string; // e.g., "functional", "non-functional", "business-context"
}

export interface AnsweredQuestion extends Question {
  answer: string; // user's response from [Answer]: tag
  timestamp: string; // ISO 8601 — when the file was read back
}

export interface Contradiction {
  questionNumbers: number[];
  type: 'scope' | 'risk' | 'timeline';
  description: string;
}

export interface Ambiguity {
  questionNumber: number;
  triggerPhrase: string;
  description: string;
}

export const AMBIGUITY_TRIGGER_PHRASES = [
  'depends', 'maybe', 'not sure', 'mix of', 'somewhere between',
  'probably', 'standard', 'typical',
];

function stageToPhase(stage: string): string {
  const lower = stage.toLowerCase();
  if (
    lower.startsWith('intent') ||
    lower.startsWith('requirements') ||
    lower.startsWith('stories') ||
    lower.startsWith('app-design')
  ) {
    return 'inception';
  }
  if (
    lower.startsWith('brownfield') ||
    lower.startsWith('workspace') ||
    lower.startsWith('discovery')
  ) {
    return 'discovery';
  }
  return 'construction';
}

function stageName(stage: string): string {
  return stage
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function indexToLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function renderQuestionBlock(question: Question): string {
  const lines: string[] = [];
  lines.push(`## Q${question.number}: ${question.text}`);

  question.options.forEach((opt, i) => {
    lines.push(`${indexToLetter(i)}) ${opt.description}`);
  });

  // "Other" is always appended as the mandatory last option
  const otherLetter = indexToLetter(question.options.length);
  lines.push(`${otherLetter}) Other: please specify`);
  lines.push('');
  lines.push('[Answer]:');
  lines.push('');

  return lines.join('\n');
}

function resolveQuestionsDir(projectPath: string, workflowId: string, stage: string): string {
  const phase = stageToPhase(stage);
  return path.join(projectPath, 'aidlc-docs', workflowId, phase);
}

export async function generateQuestionFile(
  projectPath: string,
  workflowId: string,
  stage: string,
  questions: Question[]
): Promise<string> {
  try {
    const dir = resolveQuestionsDir(projectPath, workflowId, stage);
    await fs.ensureDir(dir);

    const filePath = path.join(dir, `${stage}-questions.md`);
    const displayName = stageName(stage);

    const lines: string[] = [];
    lines.push(`# ${displayName} — Verification Questions`);
    lines.push('');
    lines.push('Please answer each question below by filling in the [Answer]: tag.');
    lines.push('When finished, say "done" or "answers ready".');
    lines.push('');

    for (const question of questions) {
      lines.push('---');
      lines.push(renderQuestionBlock(question));
    }

    lines.push('---');
    lines.push('');

    await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
    return filePath;
  } catch (error) {
    console.error(`Failed to generate question file for stage ${stage}:`, error);
    return path.join(
      resolveQuestionsDir(projectPath, workflowId, stage),
      `${stage}-questions.md`
    );
  }
}

export function readAnsweredFile(filePath: string): AnsweredQuestion[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const timestamp = new Date().toISOString();

    // Split on '---' separators; the first block is the header, skip it
    const blocks = raw.split(/\n---\n/);

    const answered: AnsweredQuestion[] = [];

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      // Must contain a question header
      const headerMatch = trimmed.match(/^##\s+Q(\d+):\s+(.+)/m);
      if (!headerMatch) continue;

      const questionNumber = parseInt(headerMatch[1], 10);
      const questionText = headerMatch[2].trim();

      // Parse option lines: lines starting with a single letter followed by )
      const optionLines = [...trimmed.matchAll(/^([A-Z])\)\s+(.+)/gm)];
      const options: { label: string; description: string }[] = [];

      for (const opt of optionLines) {
        const label = opt[1];
        const description = opt[2].trim();
        // The "Other: please specify" option is the mandatory otherOption — skip adding to options array
        if (description.startsWith('Other:')) continue;
        options.push({ label, description });
      }

      // Extract text after [Answer]:
      const answerMatch = trimmed.match(/\[Answer\]:\s*([\s\S]*?)(?:\n---|\n##|$)/);
      const answer = answerMatch ? answerMatch[1].trim() : '';

      answered.push({
        number: questionNumber,
        text: questionText,
        options,
        otherOption: true,
        category: '', // category is not stored in the markdown; callers can re-merge if needed
        answer,
        timestamp,
      });
    }

    return answered;
  } catch (error) {
    console.error(`Failed to read answered file at ${filePath}:`, error);
    return [];
  }
}

export function detectContradictions(answers: AnsweredQuestion[]): Contradiction[] {
  const contradictions: Contradiction[] = [];

  const scopeSmallPhrases = ['bug fix', 'small fix'];
  const scopeLargePhrases = ['entire codebase', 'multiple subsystems'];
  const riskLowPhrases = ['low risk', 'simple'];
  const riskHighPhrases = ['breaking changes', 'migration required'];
  const timelineShortPhrases = ['quick', 'hours'];
  const timelineLongPhrases = ['multiple subsystems', 'extensive testing'];

  const withPhraseMatch = (text: string, phrases: string[]): boolean =>
    phrases.some(p => text.toLowerCase().includes(p));

  const smallScopeNums = answers
    .filter(a => withPhraseMatch(a.answer, scopeSmallPhrases))
    .map(a => a.number);
  const largeScopeNums = answers
    .filter(a => withPhraseMatch(a.answer, scopeLargePhrases))
    .map(a => a.number);

  if (smallScopeNums.length > 0 && largeScopeNums.length > 0) {
    contradictions.push({
      questionNumbers: [...smallScopeNums, ...largeScopeNums],
      type: 'scope',
      description:
        `Scope mismatch: answers in Q${smallScopeNums.join(', Q')} suggest a small/targeted change ` +
        `while answers in Q${largeScopeNums.join(', Q')} suggest broad codebase impact.`,
    });
  }

  const lowRiskNums = answers
    .filter(a => withPhraseMatch(a.answer, riskLowPhrases))
    .map(a => a.number);
  const highRiskNums = answers
    .filter(a => withPhraseMatch(a.answer, riskHighPhrases))
    .map(a => a.number);

  if (lowRiskNums.length > 0 && highRiskNums.length > 0) {
    contradictions.push({
      questionNumbers: [...lowRiskNums, ...highRiskNums],
      type: 'risk',
      description:
        `Risk mismatch: answers in Q${lowRiskNums.join(', Q')} indicate low risk ` +
        `while answers in Q${highRiskNums.join(', Q')} indicate high-impact changes.`,
    });
  }

  const shortTimelineNums = answers
    .filter(a => withPhraseMatch(a.answer, timelineShortPhrases))
    .map(a => a.number);
  const longTimelineNums = answers
    .filter(a => withPhraseMatch(a.answer, timelineLongPhrases))
    .map(a => a.number);

  if (shortTimelineNums.length > 0 && longTimelineNums.length > 0) {
    contradictions.push({
      questionNumbers: [...shortTimelineNums, ...longTimelineNums],
      type: 'timeline',
      description:
        `Timeline mismatch: answers in Q${shortTimelineNums.join(', Q')} suggest a quick turnaround ` +
        `while answers in Q${longTimelineNums.join(', Q')} imply significant scope or testing requirements.`,
    });
  }

  return contradictions;
}

export function detectAmbiguities(answers: AnsweredQuestion[]): Ambiguity[] {
  const ambiguities: Ambiguity[] = [];

  for (const answer of answers) {
    const lowerAnswer = answer.answer.toLowerCase();
    for (const phrase of AMBIGUITY_TRIGGER_PHRASES) {
      if (lowerAnswer.includes(phrase.toLowerCase())) {
        ambiguities.push({
          questionNumber: answer.number,
          triggerPhrase: phrase,
          description:
            `Answer to Q${answer.number} contains ambiguous language ("${phrase}"). ` +
            `Please clarify the intent more precisely.`,
        });
        break; // one ambiguity per question is sufficient
      }
    }
  }

  return ambiguities;
}

export async function generateClarificationFile(
  projectPath: string,
  workflowId: string,
  stage: string,
  contradictions: Contradiction[],
  ambiguities: Ambiguity[]
): Promise<string> {
  try {
    const dir = resolveQuestionsDir(projectPath, workflowId, stage);
    await fs.ensureDir(dir);

    const filePath = path.join(dir, `${stage}-clarification-questions.md`);
    const displayName = stageName(stage);

    const lines: string[] = [];
    lines.push(`# ${displayName} — Clarification Questions`);
    lines.push('');
    lines.push(
      'Some answers require clarification before proceeding. ' +
      'Please fill in each [Answer]: tag below.'
    );
    lines.push('When finished, say "done" or "answers ready".');
    lines.push('');

    let questionCounter = 1;

    for (const contradiction of contradictions) {
      lines.push('---');
      lines.push(
        `## Q${questionCounter}: Contradiction in Q${contradiction.questionNumbers.join(', Q')} (${contradiction.type})`
      );
      lines.push('');
      lines.push(contradiction.description);
      lines.push('');
      lines.push('Please clarify which interpretation is correct:');
      lines.push('A) Confirm the smaller/lower-impact interpretation');
      lines.push('B) Confirm the larger/higher-impact interpretation');
      lines.push('C) Both apply in different contexts (explain below)');
      lines.push('D) Other: please specify');
      lines.push('');
      lines.push('[Answer]:');
      lines.push('');
      questionCounter++;
    }

    for (const ambiguity of ambiguities) {
      lines.push('---');
      lines.push(
        `## Q${questionCounter}: Ambiguity in Q${ambiguity.questionNumber} ("${ambiguity.triggerPhrase}")`
      );
      lines.push('');
      lines.push(ambiguity.description);
      lines.push('');
      lines.push('Please provide a more precise answer:');
      lines.push('A) Define the specific condition or criteria');
      lines.push('B) Provide a concrete example');
      lines.push('C) Indicate it varies by case (explain the rule)');
      lines.push('D) Other: please specify');
      lines.push('');
      lines.push('[Answer]:');
      lines.push('');
      questionCounter++;
    }

    lines.push('---');
    lines.push('');

    await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
    return filePath;
  } catch (error) {
    console.error(`Failed to generate clarification file for stage ${stage}:`, error);
    return path.join(
      resolveQuestionsDir(projectPath, workflowId, stage),
      `${stage}-clarification-questions.md`
    );
  }
}

export function allQuestionsResolved(
  answers: AnsweredQuestion[],
  contradictions: Contradiction[],
  ambiguities: Ambiguity[]
): boolean {
  if (contradictions.length > 0) return false;
  if (ambiguities.length > 0) return false;
  if (answers.length === 0) return false;
  return answers.every(a => a.answer.trim().length > 0);
}
