import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
  buildApplicationDesignPrompt,
  parseApplicationDesignResponse,
  writeApplicationDesignArtifacts,
  APPLICATION_DESIGN_FORMAT_INSTRUCTIONS,
} from '../../features/workflow-engine/application-design.js';
import { createManifest } from '../../features/workflow-engine/manifest.js';

const TEST_DIR = '.test-application-design';

describe('application-design', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), TEST_DIR);
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('buildApplicationDesignPrompt', () => {
    it('includes intent, stories, and requirements', () => {
      const prompt = buildApplicationDesignPrompt('Build a todo app', 'User stories here', 'Requirements here');
      expect(prompt).toContain('todo app');
      expect(prompt).toContain('User stories');
      expect(prompt).toContain('Requirements');
      expect(prompt).toContain('Components');
    });
  });

  describe('parseApplicationDesignResponse', () => {
    it('parses components from table', () => {
      const response = `## Components\n| Name | Type | Responsibility | Public Methods |\n|------|------|----------------|----------------|\n| AuthService | service | Handle auth | login(), logout() |\n\n## Services\n| Name | Endpoints | Dependencies |\n|------|-----------|-------------|\n| UserAPI | /users, /auth | AuthService |\n\n## Component Dependencies\n- AuthService -> UserStore (uses)`;
      const result = parseApplicationDesignResponse(response);
      expect(result.components.length).toBeGreaterThan(0);
      expect(result.components[0].name).toBe('AuthService');
      expect(result.services.length).toBeGreaterThan(0);
      expect(result.dependencies.length).toBeGreaterThan(0);
    });

    it('handles missing sections gracefully', () => {
      const result = parseApplicationDesignResponse('Just some text');
      expect(result.components).toHaveLength(0);
      expect(result.services).toHaveLength(0);
      expect(result.dependencies).toHaveLength(0);
    });
  });

  describe('writeApplicationDesignArtifacts', () => {
    it('writes 4 artifact files', async () => {
      const wfDir = join(testDir, 'aidlc-docs', 'wf-001');
      fs.ensureDirSync(wfDir);
      createManifest('wf-001', 'test', testDir);
      const artifacts = {
        components: [{ name: 'Auth', type: 'service' as const, responsibility: 'Auth', publicMethods: ['login()'] }],
        services: [{ name: 'UserAPI', endpoints: ['/users'], dependencies: ['Auth'] }],
        dependencies: [{ source: 'Auth', target: 'DB', type: 'uses' as const }],
      };
      const paths = await writeApplicationDesignArtifacts(testDir, 'wf-001', artifacts);
      expect(paths.length).toBe(4);
      for (const p of paths) {
        expect(fs.existsSync(p)).toBe(true);
      }
      expect(paths.some(p => p.includes('components.md'))).toBe(true);
      expect(paths.some(p => p.includes('services.md'))).toBe(true);
    });
  });

  describe('APPLICATION_DESIGN_FORMAT_INSTRUCTIONS', () => {
    it('exports format instructions', () => {
      expect(APPLICATION_DESIGN_FORMAT_INSTRUCTIONS).toContain('Components');
      expect(APPLICATION_DESIGN_FORMAT_INSTRUCTIONS).toContain('Services');
    });
  });
});
