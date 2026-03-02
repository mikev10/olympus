import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  executeNFRRequirementsStage,
  filterNFRsForUnit,
} from '../../../features/workflow-engine/construction/nfr-requirements.js';

describe('nfr-requirements.ts', () => {
  const testDir = path.join(process.cwd(), '.test-nfr-requirements');
  const workflowId = 'wf-test-001';

  function aidlcPath(...parts: string[]): string {
    return path.join(testDir, 'aidlc-docs', workflowId, ...parts);
  }

  async function writeInceptionNfr(content: string): Promise<void> {
    const nfrPath = aidlcPath('inception', 'nfr.md');
    await fs.ensureDir(path.dirname(nfrPath));
    await fs.writeFile(nfrPath, content, 'utf-8');
  }

  async function writeUnitSpec(unitId: string, content: string): Promise<void> {
    const specPath = aidlcPath('construction', unitId, 'spec.md');
    await fs.ensureDir(path.dirname(specPath));
    await fs.writeFile(specPath, content, 'utf-8');
  }

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('executeNFRRequirementsStage', () => {
    it('generates nfr-requirements.md at the correct path', async () => {
      const unitId = 'UNIT-001';
      const result = await executeNFRRequirementsStage(testDir, workflowId, unitId);

      const expectedPath = aidlcPath('construction', unitId, 'nfr-requirements.md');
      expect(result.artifactPath).toBe(expectedPath);
      const exists = await fs.pathExists(expectedPath);
      expect(exists).toBe(true);
    });

    it('works when inception NFR file exists', async () => {
      const unitId = 'UNIT-002';
      await writeInceptionNfr('## Performance\nRespond within 200ms.\n');
      await writeUnitSpec(unitId, `---\nid: ${unitId}\ntitle: Performance Monitor\n---\n\n## Goal\nMonitor performance metrics.\n`);

      const result = await executeNFRRequirementsStage(testDir, workflowId, unitId);

      const content = await fs.readFile(result.artifactPath, 'utf-8');
      expect(content).toContain(`id: ${unitId}-nfr-requirements`);
      expect(content).toContain(`parent_unit: ${unitId}`);
    });

    it('works gracefully when inception NFR file does not exist', async () => {
      const unitId = 'UNIT-003';

      const result = await executeNFRRequirementsStage(testDir, workflowId, unitId);

      const exists = await fs.pathExists(result.artifactPath);
      expect(exists).toBe(true);
      const content = await fs.readFile(result.artifactPath, 'utf-8');
      expect(content).toContain('_No specific NFRs identified');
    });

    it('works gracefully when unit spec does not exist', async () => {
      const unitId = 'UNIT-004';
      await writeInceptionNfr('## Security\nAll data must be encrypted.\n');

      const result = await executeNFRRequirementsStage(testDir, workflowId, unitId);

      const content = await fs.readFile(result.artifactPath, 'utf-8');
      expect(content).toContain(`# NFR Requirements: ${unitId}`);
    });

    it('generated content has frontmatter with correct id', async () => {
      const unitId = 'UNIT-005';

      const result = await executeNFRRequirementsStage(testDir, workflowId, unitId);

      const content = await fs.readFile(result.artifactPath, 'utf-8');
      expect(content).toContain(`id: ${unitId}-nfr-requirements`);
    });

    it('generated content has frontmatter with correct parent_unit', async () => {
      const unitId = 'UNIT-006';

      const result = await executeNFRRequirementsStage(testDir, workflowId, unitId);

      const content = await fs.readFile(result.artifactPath, 'utf-8');
      expect(content).toContain(`parent_unit: ${unitId}`);
    });

    it('generated content has generated_at timestamp in frontmatter', async () => {
      const unitId = 'UNIT-007';
      const before = new Date();

      const result = await executeNFRRequirementsStage(testDir, workflowId, unitId);

      const after = new Date();
      const content = await fs.readFile(result.artifactPath, 'utf-8');
      const tsMatch = content.match(/generated_at:\s*(.+)/);
      expect(tsMatch).not.toBeNull();
      const ts = new Date(tsMatch![1].trim());
      expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });

    it('returns artifactPath pointing to the written file', async () => {
      const unitId = 'UNIT-008';

      const result = await executeNFRRequirementsStage(testDir, workflowId, unitId);

      expect(result.artifactPath).toContain(unitId);
      expect(result.artifactPath).toContain('nfr-requirements.md');
    });

    it('returns nfrContent string (empty when no inception NFRs and no keyword matches)', async () => {
      const unitId = 'UNIT-009';

      const result = await executeNFRRequirementsStage(testDir, workflowId, unitId);

      expect(typeof result.nfrContent).toBe('string');
      expect(result.nfrContent).toBe('');
    });

    it('uses unit title from spec frontmatter in the heading', async () => {
      const unitId = 'UNIT-010';
      await writeUnitSpec(unitId, `---\nid: ${unitId}\ntitle: Authentication Service\n---\n\n## Goal\nHandle auth.\n`);

      const result = await executeNFRRequirementsStage(testDir, workflowId, unitId);

      const content = await fs.readFile(result.artifactPath, 'utf-8');
      expect(content).toContain('# NFR Requirements: Authentication Service');
    });
  });

  describe('filterNFRsForUnit', () => {
    it('returns empty string when inceptionNfrs is empty', () => {
      const result = filterNFRsForUnit('', 'some spec content', 'Unit Title');
      expect(result).toBe('');
    });

    it('returns empty string when inceptionNfrs is only whitespace', () => {
      const result = filterNFRsForUnit('   \n\t  ', 'some spec', 'Unit Title');
      expect(result).toBe('');
    });

    it('returns all NFRs when no sections can be parsed (no ## headings)', () => {
      const nfrs = 'Some performance requirements without section headings.';
      const result = filterNFRsForUnit(nfrs, 'unit spec content', 'Unit Title');
      expect(result).toBe(nfrs);
    });

    it('returns all NFRs when no unit keywords match any section', () => {
      const nfrs = '## Security\nEncrypt all data in transit.\n\n## Compliance\nMust meet GDPR requirements.\n';
      const unitSpec = 'Notification sender for email delivery';
      const result = filterNFRsForUnit(nfrs, unitSpec, 'Email Notification');
      expect(result).toBe(nfrs);
    });

    it('filters to relevant sections when keywords match', () => {
      const nfrs = [
        '## Performance\nThe authentication system must respond within 200ms.',
        '## Security\nAll endpoints must use TLS encryption.',
        '## Availability\nSystem uptime must be 99.9%.',
      ].join('\n\n');

      // Unit spec focused on authentication/performance
      const unitSpec = '---\ntitle: Auth Performance\n---\n\nHandle authentication performance monitoring.';
      const result = filterNFRsForUnit(nfrs, unitSpec, 'Auth Performance');

      expect(result).toContain('Performance');
      expect(result.length).toBeLessThan(nfrs.length);
    });

    it('handles multiple sections with varying relevance and returns only matching ones', () => {
      const nfrs = [
        '## Database Performance\nDatabase queries must complete within 100ms.',
        '## Security\nOAuth tokens must be validated.',
        '## Scalability\nSystem must scale to 10000 concurrent users.',
      ].join('\n\n');

      const unitSpec = 'Database query optimization and caching layer';
      const result = filterNFRsForUnit(nfrs, unitSpec, 'Database Cache');

      expect(result).toContain('Database');
    });

    it('returns all sections when unitSpec is empty but NFRs have sections', () => {
      const nfrs = '## Performance\nRespond fast.\n\n## Security\nBe secure.\n';
      const result = filterNFRsForUnit(nfrs, '', 'x');
      expect(result).toBe(nfrs);
    });
  });
});
