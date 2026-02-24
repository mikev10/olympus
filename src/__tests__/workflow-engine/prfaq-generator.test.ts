import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
  buildPRFAQPrompt,
  parsePRFAQResponse,
  writePRFAQArtifact,
  attemptPRFAQGeneration,
  PRFAQ_FORMAT_INSTRUCTIONS,
  type PRFAQOptions,
} from '../../features/workflow-engine/prfaq-generator.js';
import { createManifest, loadManifest } from '../../features/workflow-engine/manifest.js';

const testDir = join(process.cwd(), '.test-prfaq-generator');
const workflowId = 'wf-prfaq-test-001';

beforeEach(async () => {
  await fs.ensureDir(testDir);
});

afterEach(async () => {
  await fs.rmSync(testDir, { recursive: true, force: true });
});

describe('buildPRFAQPrompt', () => {
  it('includes feature name in prompt', () => {
    const options: PRFAQOptions = {
      projectPath: testDir,
      workflowId,
      featureName: 'Smart Auto-Complete',
      intentContent: 'Some intent content.',
      nfrContent: 'Some NFR content.',
    };
    const result = buildPRFAQPrompt(options);
    expect(result).toContain('Smart Auto-Complete');
  });

  it('includes INTENT document content', () => {
    const options: PRFAQOptions = {
      projectPath: testDir,
      workflowId,
      featureName: 'My Feature',
      intentContent: 'This is the detailed intent document.',
      nfrContent: 'Some NFR content.',
    };
    const result = buildPRFAQPrompt(options);
    expect(result).toContain('This is the detailed intent document.');
  });

  it('includes NFR content', () => {
    const options: PRFAQOptions = {
      projectPath: testDir,
      workflowId,
      featureName: 'My Feature',
      intentContent: 'Intent content.',
      nfrContent: 'Response time must be under 200ms.',
    };
    const result = buildPRFAQPrompt(options);
    expect(result).toContain('Response time must be under 200ms.');
  });

  it('includes PRFAQ format instructions', () => {
    const options: PRFAQOptions = {
      projectPath: testDir,
      workflowId,
      featureName: 'My Feature',
      intentContent: 'Intent content.',
      nfrContent: 'NFR content.',
    };
    const result = buildPRFAQPrompt(options);
    expect(result).toContain('Press Release');
    expect(result).toContain('Customer FAQs');
    expect(result).toContain('Internal FAQs');
  });
});

describe('parsePRFAQResponse', () => {
  it('accepts well-formed PRFAQ', () => {
    const response = `## Press Release\n\nThe feature is great.\n\n## Customer FAQs\n\nQ: How does it work?\n\n## Internal FAQs\n\nQ: What is the risk?`;
    const result = parsePRFAQResponse(response);
    expect(result).toBe(response);
  });

  it('wraps response missing Press Release section', () => {
    const response = `## Customer FAQs\n\nQ: How does it work?\n\n## Internal FAQs\n\nQ: What is the risk?`;
    const result = parsePRFAQResponse(response);
    expect(result).toContain('## Press Release');
    expect(result).toContain('[Section not generated]');
  });

  it('wraps response missing Customer FAQ section', () => {
    const response = `## Press Release\n\nThe feature is great.\n\n## Internal FAQs\n\nQ: What is the risk?`;
    const result = parsePRFAQResponse(response);
    expect(result).toContain('## Customer FAQs');
    expect(result).toContain('[Section not generated]');
  });

  it('handles completely empty response', () => {
    const result = parsePRFAQResponse('');
    expect(result).toContain('## Press Release');
    expect(result).toContain('## Customer FAQs');
    expect(result).toContain('## Internal FAQs');
  });
});

describe('writePRFAQArtifact', () => {
  it('writes to correct path', async () => {
    createManifest(workflowId, 'Test Feature', testDir);
    const content = '## Press Release\n\nContent here.\n\n## Customer FAQs\n\nFAQ.\n\n## Internal FAQs\n\nInternal.';
    await writePRFAQArtifact(testDir, workflowId, content);
    const expectedPath = join(testDir, 'aidlc-docs', workflowId, 'inception', 'prfaq.md');
    expect(await fs.pathExists(expectedPath)).toBe(true);
  });

  it('registers PRFAQ artifact in manifest', async () => {
    createManifest(workflowId, 'Test Feature', testDir);
    const content = '## Press Release\n\nContent.\n\n## Customer FAQs\n\nFAQ.\n\n## Internal FAQs\n\nInternal.';
    await writePRFAQArtifact(testDir, workflowId, content);
    const manifestPath = join(testDir, 'aidlc-docs', workflowId, 'manifest.json');
    const manifest = loadManifest(manifestPath);
    expect(manifest).not.toBeNull();
    const artifact = manifest!.artifacts.find((a) => a.type === 'PRFAQ');
    expect(artifact).toBeDefined();
    expect(artifact!.id).toBe(`prfaq-${workflowId}`);
  });

  it('content matches input', async () => {
    createManifest(workflowId, 'Test Feature', testDir);
    const content = '## Press Release\n\nThis is my PRFAQ.\n\n## Customer FAQs\n\nFAQ.\n\n## Internal FAQs\n\nInternal.';
    await writePRFAQArtifact(testDir, workflowId, content);
    const filePath = join(testDir, 'aidlc-docs', workflowId, 'inception', 'prfaq.md');
    const saved = await fs.readFile(filePath, 'utf-8');
    expect(saved).toBe(content);
  });
});

describe('attemptPRFAQGeneration', () => {
  it('returns success with expected path', async () => {
    createManifest(workflowId, 'Test Feature', testDir);
    const options: PRFAQOptions = {
      projectPath: testDir,
      workflowId,
      featureName: 'Test Feature',
      intentContent: 'Intent document content.',
      nfrContent: 'NFR content.',
    };
    const result = await attemptPRFAQGeneration(options);
    expect(result.success).toBe(true);
    expect(result.artifactPath).toContain(join('aidlc-docs', workflowId, 'inception', 'prfaq.md'));
  });

  it('returns failure without throwing on error', async () => {
    const options = {
      get projectPath(): string {
        throw new Error('Simulated failure for testing');
      },
      workflowId,
      featureName: 'Test',
      intentContent: 'Intent.',
      nfrContent: 'NFR.',
    } as unknown as PRFAQOptions;

    const result = await attemptPRFAQGeneration(options);
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});

describe('PRFAQ_FORMAT_INSTRUCTIONS', () => {
  it('is a non-empty string', () => {
    expect(typeof PRFAQ_FORMAT_INSTRUCTIONS).toBe('string');
    expect(PRFAQ_FORMAT_INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  it('contains expected section headers', () => {
    expect(PRFAQ_FORMAT_INSTRUCTIONS).toContain('Press Release');
    expect(PRFAQ_FORMAT_INSTRUCTIONS).toContain('Customer FAQs');
    expect(PRFAQ_FORMAT_INSTRUCTIONS).toContain('Internal FAQs');
  });
});
