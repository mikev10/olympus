import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
  generateQuestionFile,
  readAnsweredFile,
  detectContradictions,
  detectAmbiguities,
  generateClarificationFile,
  allQuestionsResolved,
  type Question,
  type AnsweredQuestion,
} from '../../features/workflow-engine/question-manager.js';

const TEST_DIR = '.test-question-manager';

describe('question-manager', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), TEST_DIR);
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  const sampleQuestions: Question[] = [
    {
      number: 1,
      text: 'What is the scope of this change?',
      options: [
        { label: 'Single file', description: 'Changes confined to one file' },
        { label: 'Multiple files', description: 'Changes across multiple files' },
        { label: 'Entire codebase', description: 'System-wide changes' },
      ],
      otherOption: true,
      category: 'functional',
    },
    {
      number: 2,
      text: 'What is the risk level?',
      options: [
        { label: 'Low risk', description: 'No breaking changes' },
        { label: 'Medium risk', description: 'Some breaking changes possible' },
        { label: 'High risk', description: 'Breaking changes expected' },
      ],
      otherOption: true,
      category: 'non-functional',
    },
  ];

  describe('generateQuestionFile', () => {
    it('writes question file to correct path', async () => {
      const filePath = await generateQuestionFile(testDir, 'wf-001', 'requirements', sampleQuestions);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('Verification Questions');
      expect(content).toContain('Q1:');
      expect(content).toContain('Q2:');
    });

    it('includes Other as last option on every question', async () => {
      const filePath = await generateQuestionFile(testDir, 'wf-001', 'requirements', sampleQuestions);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('Other');
      expect(content).toContain('[Answer]:');
    });

    it('includes all question options', async () => {
      const filePath = await generateQuestionFile(testDir, 'wf-001', 'requirements', sampleQuestions);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('Changes confined to one file');
      expect(content).toContain('Changes across multiple files');
      expect(content).toContain('System-wide changes');
    });
  });

  describe('readAnsweredFile', () => {
    it('parses answered questions from file', async () => {
      const filePath = await generateQuestionFile(testDir, 'wf-001', 'intent', sampleQuestions);
      let content = fs.readFileSync(filePath, 'utf-8');
      content = content.replace('[Answer]:\n\n---\n## Q2', '[Answer]: A\n\n---\n## Q2');
      content = content.replace(/\[Answer\]:(\s*\n---\n)$/, '[Answer]: B$1');
      fs.writeFileSync(filePath, content, 'utf-8');
      const answers = readAnsweredFile(filePath);
      expect(answers.length).toBe(2);
      expect(answers[0].answer).toBe('A');
      expect(answers[1].answer).toBe('B');
    });

    it('flags unanswered questions with empty answer', async () => {
      const filePath = await generateQuestionFile(testDir, 'wf-001', 'intent', sampleQuestions);
      const answers = readAnsweredFile(filePath);
      expect(answers.length).toBe(2);
      expect(answers[0].answer).toBe('');
      expect(answers[1].answer).toBe('');
    });
  });

  describe('detectContradictions', () => {
    it('detects scope contradictions', () => {
      const answers: AnsweredQuestion[] = [
        { ...sampleQuestions[0], answer: 'This is a small bug fix', timestamp: new Date().toISOString() },
        { ...sampleQuestions[1], answer: 'Affects entire codebase', timestamp: new Date().toISOString() },
      ];
      const contradictions = detectContradictions(answers);
      expect(contradictions.length).toBeGreaterThan(0);
      expect(contradictions[0].type).toBe('scope');
    });

    it('returns empty for consistent answers', () => {
      const answers: AnsweredQuestion[] = [
        { ...sampleQuestions[0], answer: 'Single file change', timestamp: new Date().toISOString() },
        { ...sampleQuestions[1], answer: 'Low risk, simple fix', timestamp: new Date().toISOString() },
      ];
      const contradictions = detectContradictions(answers);
      expect(contradictions.length).toBe(0);
    });
  });

  describe('detectAmbiguities', () => {
    it('detects ambiguity trigger phrases', () => {
      const answers: AnsweredQuestion[] = [
        { ...sampleQuestions[0], answer: 'It depends on the situation', timestamp: new Date().toISOString() },
      ];
      const ambiguities = detectAmbiguities(answers);
      expect(ambiguities.length).toBeGreaterThan(0);
      expect(ambiguities[0].triggerPhrase).toBe('depends');
    });

    it('returns empty for clear answers', () => {
      const answers: AnsweredQuestion[] = [
        { ...sampleQuestions[0], answer: 'Single file only', timestamp: new Date().toISOString() },
      ];
      const ambiguities = detectAmbiguities(answers);
      expect(ambiguities.length).toBe(0);
    });
  });

  describe('generateClarificationFile', () => {
    it('writes clarification file when contradictions exist', async () => {
      const contradictions = [{ questionNumbers: [1, 2], type: 'scope' as const, description: 'Scope mismatch' }];
      const filePath = await generateClarificationFile(testDir, 'wf-001', 'requirements', contradictions, []);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('Clarification');
      expect(content).toContain('[Answer]:');
    });
  });

  describe('allQuestionsResolved', () => {
    it('returns true when all answered and no issues', () => {
      const answers: AnsweredQuestion[] = [
        { ...sampleQuestions[0], answer: 'Single file', timestamp: new Date().toISOString() },
        { ...sampleQuestions[1], answer: 'Low risk', timestamp: new Date().toISOString() },
      ];
      expect(allQuestionsResolved(answers, [], [])).toBe(true);
    });

    it('returns false with unanswered questions', () => {
      const answers: AnsweredQuestion[] = [
        { ...sampleQuestions[0], answer: '', timestamp: new Date().toISOString() },
      ];
      expect(allQuestionsResolved(answers, [], [])).toBe(false);
    });

    it('returns false with contradictions', () => {
      const answers: AnsweredQuestion[] = [
        { ...sampleQuestions[0], answer: 'Yes', timestamp: new Date().toISOString() },
      ];
      const contradictions = [{ questionNumbers: [1], type: 'scope' as const, description: 'issue' }];
      expect(allQuestionsResolved(answers, contradictions, [])).toBe(false);
    });
  });
});
