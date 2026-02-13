import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Hoisted mock
const mockHomedir = vi.hoisted(() => {
  return { value: '' };
});

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => mockHomedir.value,
  };
});

import {
  extractDiscovery,
  extractFirstSentence,
  stripFilePaths,
  extractActionSummary,
  isDuplicate,
  inferCategory,
  jaccardSimilarity,
} from '../../learning/discovery-detector.js';
import type { SessionState } from '../../learning/types.js';

describe('discovery-detector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'olympus-detector-test-'));
    mockHomedir.value = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('extractFirstSentence', () => {
    it('extracts first sentence ending with period', () => {
      const text = 'This is the first sentence. This is the second.';
      expect(extractFirstSentence(text)).toBe('This is the first sentence.');
    });

    it('stops at newline', () => {
      const text = 'First line\nSecond line';
      expect(extractFirstSentence(text)).toBe('First line');
    });

    it('truncates at max length', () => {
      const text = 'This is a very long sentence that goes on and on without ending with a period or newline';
      const result = extractFirstSentence(text, 50);
      // When truncated without period/newline, it stops at maxLength exactly
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('handles empty string', () => {
      expect(extractFirstSentence('')).toBe('');
    });

    it('preserves period at end', () => {
      const text = 'Short sentence.';
      expect(extractFirstSentence(text, 100)).toBe('Short sentence.');
    });
  });

  describe('stripFilePaths', () => {
    it('removes Windows paths', () => {
      const text = 'Create a file at C:\\Users\\Mike\\Projects\\olympus\\test.ts please';
      const result = stripFilePaths(text);
      expect(result).not.toContain('C:\\Users');
      expect(result).not.toContain('test.ts');
      expect(result).toContain('Create a file at');
      expect(result).toContain('please');
    });

    it('removes Unix paths', () => {
      const text = 'Deploy to /home/user/projects/app/dist directory';
      const result = stripFilePaths(text);
      expect(result).not.toContain('/home/user');
      expect(result).toContain('Deploy to');
      expect(result).toContain('directory');
    });

    it('removes backtick-wrapped paths', () => {
      const text = 'Update `src/components/Button.tsx` file';
      const result = stripFilePaths(text);
      expect(result).not.toContain('src/components');
      expect(result).toContain('Update');
      expect(result).toContain('file');
    });

    it('cleans up extra spaces', () => {
      const text = 'File at C:\\test\\path.txt   has   content';
      const result = stripFilePaths(text);
      expect(result).toBe('File at has content');
    });

    it('handles text without paths', () => {
      const text = 'No paths here';
      expect(stripFilePaths(text)).toBe('No paths here');
    });
  });

  describe('extractActionSummary', () => {
    it('converts "Create" to "Created"', () => {
      const task = 'Create a comprehensive markdown document for analysis';
      const result = extractActionSummary(task);
      expect(result).toBe('Created a comprehensive markdown document for analysis');
    });

    it('converts "Fix" to "Fixed"', () => {
      const task = 'Fix the test file to match the actual API signatures.';
      const result = extractActionSummary(task);
      expect(result).toBe('Fixed the test file to match the actual API signatures.');
    });

    it('converts "VERIFY" to "Verified"', () => {
      const task = 'VERIFY COMPLETION of Phase 3: Formal Artifact System (Tasks 8-11)';
      const result = extractActionSummary(task);
      expect(result).toContain('Verified');
      expect(result).toContain('Phase 3');
    });

    it('strips file paths from summary', () => {
      const task = 'Create a file at C:\\Users\\Mike\\Projects\\olympus\\docs\\analysis.md for comparison';
      const result = extractActionSummary(task);
      expect(result).not.toContain('C:\\Users');
      expect(result).not.toContain('analysis.md');
      expect(result).toContain('Created');
    });

    it('handles "In the X project, Y" pattern', () => {
      const task = 'In the Olympus project, I need to understand the workflow directory structure.';
      const result = extractActionSummary(task);
      expect(result).not.toContain('In the Olympus project');
      // Result will be capitalized ("Understand" not "understand")
      expect(result.toLowerCase()).toContain('understand');
    });

    it('truncates at 100 chars', () => {
      const task = 'Update the entire system configuration including all environment variables, database settings, API keys, authentication tokens, and deployment parameters across multiple environments';
      const result = extractActionSummary(task);
      expect(result.length).toBeLessThanOrEqual(103); // +3 for "..."
    });

    it('handles empty task description', () => {
      const result = extractActionSummary('');
      expect(result).toBe('Completed task');
    });

    it('handles task without action verb', () => {
      const task = 'The system needs better error handling';
      const result = extractActionSummary(task);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(103);
    });
  });

  describe('extractDiscovery', () => {
    it('produces meaningful summary instead of raw prompt', () => {
      const state: SessionState = {
        session_id: 'test-session',
        workflow_id: null,
        pending_completion: {
          task_description: 'Create a comprehensive markdown document at C:\\Users\\Mike\\Projects\\olympus\\docs\\analysis.md that compares systems',
          agent_used: 'test-agent',
        },
      };

      const discovery = extractDiscovery(state, 'praise');

      expect(discovery).not.toBeNull();
      expect(discovery!.summary).not.toContain('C:\\Users');
      expect(discovery!.summary).not.toContain('analysis.md');
      expect(discovery!.summary).toContain('Created');
      expect(discovery!.summary.length).toBeLessThanOrEqual(103);
    });

    it('produces concise details without code blocks', () => {
      const state: SessionState = {
        session_id: 'test-session',
        workflow_id: null,
        pending_completion: {
          task_description: 'Fix the error\n\n```typescript\nconst x = 1;\n```\n\nThis code has a bug',
          agent_used: 'test-agent',
        },
      };

      const discovery = extractDiscovery(state, 'problem_solved');

      expect(discovery).not.toBeNull();
      expect(discovery!.details).not.toContain('```typescript');
      expect(discovery!.details).not.toContain('const x = 1');
      expect(discovery!.details.length).toBeLessThanOrEqual(503);
    });

    it('preserves task_context for deduplication', () => {
      const state: SessionState = {
        session_id: 'test-session',
        workflow_id: null,
        pending_completion: {
          task_description: 'Create a test file for validation purposes',
          agent_used: 'test-agent',
        },
      };

      const discovery = extractDiscovery(state, 'praise');

      expect(discovery).not.toBeNull();
      expect(discovery!.task_context).toBe('Create a test file for validation purposes');
    });

    it('returns null when no pending_completion', () => {
      const state: SessionState = {
        session_id: 'test-session',
        workflow_id: null,
        pending_completion: null,
      };

      const discovery = extractDiscovery(state, 'praise');

      expect(discovery).toBeNull();
    });

    it('sets confidence based on detection method', () => {
      const state: SessionState = {
        session_id: 'test-session',
        workflow_id: null,
        pending_completion: {
          task_description: 'Fix the bug',
          agent_used: 'test-agent',
        },
      };

      const praiseDiscovery = extractDiscovery(state, 'praise');
      expect(praiseDiscovery!.confidence).toBe(0.85);

      const solvedDiscovery = extractDiscovery(state, 'problem_solved');
      expect(solvedDiscovery!.confidence).toBe(0.7);

      const topicDiscovery = extractDiscovery(state, 'topic_change');
      expect(topicDiscovery!.confidence).toBe(0.6);
    });

    it('infers category from task description', () => {
      const state: SessionState = {
        session_id: 'test-session',
        workflow_id: null,
        pending_completion: {
          task_description: 'Create a workaround for the broken API',
          agent_used: 'test-agent',
        },
      };

      const discovery = extractDiscovery(state, 'praise');

      expect(discovery!.category).toBe('workaround');
    });
  });

  describe('isDuplicate', () => {
    it('detects exact duplicates via details match', () => {
      const projectDir = join(tempDir, '.olympus', 'learning');
      const discoveriesPath = join(projectDir, 'discoveries.jsonl');

      // Create discoveries file with existing entry
      const existing = {
        id: 'test-1',
        timestamp: new Date().toISOString(),
        category: 'pattern',
        summary: 'First discovery',
        details: 'Exact details match',
        agent_name: 'test',
        session_id: 'test',
        confidence: 0.8,
        scope: 'project',
      };

      rmSync(projectDir, { recursive: true, force: true });
      require('fs').mkdirSync(projectDir, { recursive: true });
      writeFileSync(discoveriesPath, JSON.stringify(existing) + '\n');

      const candidate = {
        summary: 'Different summary',
        details: 'Exact details match',
      };

      expect(isDuplicate(candidate, tempDir)).toBe(true);
    });

    it('detects similar discoveries via Jaccard similarity', () => {
      const projectDir = join(tempDir, '.olympus', 'learning');
      const discoveriesPath = join(projectDir, 'discoveries.jsonl');

      const existing = {
        id: 'test-1',
        timestamp: new Date().toISOString(),
        category: 'pattern',
        summary: 'Uses kebab-case naming convention for all files',
        details: 'Details here',
        agent_name: 'test',
        session_id: 'test',
        confidence: 0.8,
        scope: 'project',
      };

      rmSync(projectDir, { recursive: true, force: true });
      require('fs').mkdirSync(projectDir, { recursive: true });
      writeFileSync(discoveriesPath, JSON.stringify(existing) + '\n');

      const candidate = {
        summary: 'Uses kebab-case naming convention for files',
        details: 'Different details',
      };

      expect(isDuplicate(candidate, tempDir)).toBe(true);
    });

    it('does not flag non-duplicates', () => {
      const projectDir = join(tempDir, '.olympus', 'learning');
      const discoveriesPath = join(projectDir, 'discoveries.jsonl');

      const existing = {
        id: 'test-1',
        timestamp: new Date().toISOString(),
        category: 'pattern',
        summary: 'Completely different topic',
        details: 'Completely different details',
        agent_name: 'test',
        session_id: 'test',
        confidence: 0.8,
        scope: 'project',
      };

      rmSync(projectDir, { recursive: true, force: true });
      require('fs').mkdirSync(projectDir, { recursive: true });
      writeFileSync(discoveriesPath, JSON.stringify(existing) + '\n');

      const candidate = {
        summary: 'A new and unique discovery',
        details: 'Fresh new details',
      };

      expect(isDuplicate(candidate, tempDir)).toBe(false);
    });

    it('handles missing discoveries file gracefully', () => {
      const candidate = {
        summary: 'Some discovery',
        details: 'Some details',
      };

      expect(isDuplicate(candidate, tempDir)).toBe(false);
    });
  });

  describe('inferCategory', () => {
    it('infers workaround from keyword', () => {
      expect(inferCategory('Need a workaround for the bug', 'test')).toBe('workaround');
    });

    it('infers gotcha from keyword', () => {
      expect(inferCategory('This is a gotcha with the API', 'test')).toBe('gotcha');
    });

    it('infers performance from keyword', () => {
      expect(inferCategory('Optimize the slow query', 'test')).toBe('performance');
      expect(inferCategory('Performance improvements needed', 'test')).toBe('performance');
    });

    it('infers dependency from keyword', () => {
      expect(inferCategory('Update package dependencies', 'test')).toBe('dependency');
    });

    it('infers configuration from keyword', () => {
      expect(inferCategory('Set environment variable', 'test')).toBe('configuration');
      expect(inferCategory('Configure the env settings', 'test')).toBe('configuration');
    });

    it('infers pattern from keyword', () => {
      expect(inferCategory('Follow the naming pattern', 'test')).toBe('pattern');
      expect(inferCategory('Convention for file structure', 'test')).toBe('pattern');
    });

    it('defaults to technical_insight', () => {
      expect(inferCategory('Some general task', 'test')).toBe('technical_insight');
    });
  });

  describe('jaccardSimilarity', () => {
    it('returns 1 for identical strings', () => {
      const similarity = jaccardSimilarity('hello world', 'hello world');
      expect(similarity).toBe(1);
    });

    it('returns 0 for completely different strings', () => {
      const similarity = jaccardSimilarity('apple banana', 'zebra elephant');
      expect(similarity).toBe(0);
    });

    it('returns value between 0 and 1 for similar strings', () => {
      const similarity = jaccardSimilarity(
        'uses kebab-case naming convention',
        'uses kebab-case for naming'
      );
      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(1);
    });

    it('filters words shorter than 3 chars', () => {
      const similarity = jaccardSimilarity('is a test', 'is a demo');
      // 'is' and 'a' are filtered out, only 'test' vs 'demo' matters
      expect(similarity).toBe(0);
    });

    it('handles empty strings', () => {
      expect(jaccardSimilarity('', '')).toBe(1);
      expect(jaccardSimilarity('test', '')).toBe(0);
      expect(jaccardSimilarity('', 'test')).toBe(0);
    });
  });
});
