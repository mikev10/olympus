import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
  buildDomainDesignPrompt,
  parseDomainDesignResponse,
  writeDomainDesignArtifact,
} from '../../features/workflow-engine/construction/domain-design.js';
import {
  buildFunctionalDesignPrompt,
  parseFunctionalDesignResponse,
  writeFunctionalDesignArtifacts,
} from '../../features/workflow-engine/construction/functional-design.js';
import {
  buildNFRRequirementsPrompt,
  buildNFRDesignPrompt,
  buildLogicalDesignPrompt,
  buildInfrastructureDesignPrompt,
} from '../../features/workflow-engine/construction/nfr-design.js';
import type { UnitDefinition, UserStory } from '../../features/workflow-engine/phase-types.js';
import { createManifest } from '../../features/workflow-engine/manifest.js';

const TEST_DIR = '.test-functional-design';

const sampleUnit: UnitDefinition = {
  id: 'UNIT-001',
  name: 'UserAuth',
  description: 'User authentication module',
  scope: 'Login, registration, password reset',
};

const sampleStories: UserStory[] = [
  {
    id: 'US-001',
    title: 'User Login',
    description: 'As a user I want to login',
    acceptanceCriteria: ['Email/password auth', 'JWT token returned'],
  },
];

describe('functional-design', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), TEST_DIR);
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('domain-design', () => {
    it('buildDomainDesignPrompt includes unit context and stories', () => {
      const prompt = buildDomainDesignPrompt(sampleUnit, sampleStories, 'Build auth system', 'standard');
      expect(prompt).toContain('UserAuth');
      expect(prompt).toContain('User Login');
      expect(prompt).toContain('Entities');
    });

    it('minimal depth only asks for entities and repositories', () => {
      const prompt = buildDomainDesignPrompt(sampleUnit, sampleStories, 'Build auth', 'minimal');
      expect(prompt).toContain('Entities');
      expect(prompt).toContain('Repositories');
    });

    it('parseDomainDesignResponse extracts sections', () => {
      const response = `## Entities\n| Name | Attributes |\n|------|------------|\n| User | id: string, email: string |\n\n## Value Objects\n| Name | Attributes |\n|------|------------|\n| Email | value: string |\n\n## Domain Events\n| Name | Payload |\n|------|--------|\n| UserCreated | userId, email |\n\n## Repositories\n| Name | Methods |\n|------|--------|\n| UserRepo | findById(), save() |\n\n## Aggregates\n| Name | Root | Contains |\n|------|------|---------|\n| UserAggregate | User | Email |`;
      const artifact = parseDomainDesignResponse(response);
      expect(artifact.entities.length).toBeGreaterThan(0);
      expect(artifact.repositories.length).toBeGreaterThan(0);
    });

    it('writeDomainDesignArtifact creates file in correct directory', async () => {
      const wfDir = join(testDir, 'aidlc-docs', 'wf-001');
      await fs.ensureDir(wfDir);
      createManifest('wf-001', 'test', testDir);
      const artifact = { entities: [{ name: 'User', attributes: 'id, email' }], valueObjects: [], domainEvents: [], repositories: [], aggregates: [] };
      const filePath = await writeDomainDesignArtifact(testDir, 'wf-001', 'UserAuth', artifact);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath.toLowerCase().replace(/\\/g, '/')).toContain('design/artifacts/userauth/domain-design.md');
    });
  });

  describe('functional-design prompts', () => {
    it('buildFunctionalDesignPrompt includes unit and domain design context', () => {
      const prompt = buildFunctionalDesignPrompt(sampleUnit, sampleStories, '## Domain Design content');
      expect(prompt).toContain('UserAuth');
      expect(prompt).toContain('Domain Design content');
    });

    it('parseFunctionalDesignResponse splits into 3 sections', () => {
      const response = `### Business Logic Model\nLogic here\n\n### Business Rules\nRules here\n\n### Domain Entities\nEntities here`;
      const artifacts = parseFunctionalDesignResponse(response);
      expect(artifacts.businessLogicModel).toContain('Logic');
      expect(artifacts.businessRules).toContain('Rules');
      expect(artifacts.domainEntities).toContain('Entities');
    });

    it('writeFunctionalDesignArtifacts creates 3 files', async () => {
      const wfDir = join(testDir, 'aidlc-docs', 'wf-001');
      await fs.ensureDir(wfDir);
      createManifest('wf-001', 'test', testDir);
      const artifacts = { businessLogicModel: '# Model', businessRules: '# Rules', domainEntities: '# Entities' };
      const paths = await writeFunctionalDesignArtifacts(testDir, 'wf-001', 'UserAuth', artifacts);
      expect(paths.length).toBe(3);
      for (const p of paths) {
        expect(fs.existsSync(p)).toBe(true);
      }
    });
  });

  describe('nfr-design prompts', () => {
    it('buildNFRRequirementsPrompt includes functional design', () => {
      const prompt = buildNFRRequirementsPrompt(sampleUnit, 'functional design content');
      expect(prompt).toContain('UserAuth');
      expect(prompt).toContain('functional design content');
    });

    it('buildNFRDesignPrompt includes NFR requirements', () => {
      const prompt = buildNFRDesignPrompt(sampleUnit, 'nfr requirements');
      expect(prompt).toContain('nfr requirements');
    });

    it('buildLogicalDesignPrompt includes domain design and NFR', () => {
      const prompt = buildLogicalDesignPrompt(sampleUnit, 'domain design', 'nfr design');
      expect(prompt).toContain('domain design');
      expect(prompt).toContain('nfr design');
    });

    it('buildInfrastructureDesignPrompt includes logical design', () => {
      const prompt = buildInfrastructureDesignPrompt(sampleUnit, 'logical design');
      expect(prompt).toContain('logical design');
    });
  });
});
