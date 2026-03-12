import { describe, it, expect } from 'vitest';
import {
  VERSION,
  CLAUDE_CONFIG_DIR,
  AGENTS_DIR,
  SKILLS_DIR,
  HOOKS_DIR,
} from '../installer/index.js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONTENT_DIR = join(process.cwd(), 'resources');

function readContent(relPath: string): string {
  return readFileSync(join(CONTENT_DIR, relPath), 'utf-8').replace(/\r\n/g, '\n');
}

const agentFiles = readdirSync(join(CONTENT_DIR, 'agents')).filter(f => f.endsWith('.md'));
const AGENTS: Record<string, string> = {};
for (const file of agentFiles) {
  AGENTS[file] = readContent(`agents/${file}`);
}

const skillDirs = readdirSync(join(CONTENT_DIR, 'skills')).filter(entry => {
  try {
    readdirSync(join(CONTENT_DIR, 'skills', entry));
    return true;
  } catch {
    return false;
  }
});
const SKILLS: Record<string, string> = {};
for (const dir of skillDirs) {
  try {
    SKILLS[dir] = readContent(`skills/${dir}/SKILL.md`);
  } catch (_) {
    void _;
  }
}

const claudeMdContent = readContent('claude-md.md');

describe('Installer Constants', () => {
  describe('Agent Content', () => {
    it('should contain expected core agents', () => {
      const expectedAgents = [
        'oracle.md',
        'librarian.md',
        'explore.md',
        'frontend-engineer.md',
        'document-writer.md',
        'multimodal-looker.md',
        'momus.md',
        'metis.md',
        'olympian.md',
        'prometheus.md',
        'qa-tester.md',
      ];

      for (const agent of expectedAgents) {
        expect(AGENTS).toHaveProperty(agent);
        expect(typeof AGENTS[agent]).toBe('string');
        expect(AGENTS[agent].length).toBeGreaterThan(0);
      }
    });

    it('should contain tiered agent variants', () => {
      const tieredAgents = [
        'oracle-medium.md',
        'oracle-low.md',
        'olympian-high.md',
        'olympian-low.md',
        'librarian-low.md',
        'explore-medium.md',
        'frontend-engineer-low.md',
        'frontend-engineer-high.md',
      ];

      for (const agent of tieredAgents) {
        expect(AGENTS).toHaveProperty(agent);
        expect(typeof AGENTS[agent]).toBe('string');
      }
    });

    it('should have valid frontmatter for each agent', () => {
      for (const [_filename, content] of Object.entries(AGENTS)) {
        expect(content).toMatch(/^---\n/);
        expect(content).toMatch(/\n---\n/);

        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        expect(frontmatterMatch).toBeTruthy();

        const frontmatter = frontmatterMatch![1];

        expect(frontmatter).toMatch(/^name:\s+\S+/m);
        expect(frontmatter).toMatch(/^description:\s+.+/m);
        expect(frontmatter).toMatch(/^tools:\s+.+/m);
        expect(frontmatter).toMatch(/^model:\s+(haiku|sonnet|opus)/m);
      }
    });

    it('should have unique agent names', () => {
      const names = new Set<string>();

      for (const content of Object.values(AGENTS)) {
        const nameMatch = content.match(/^name:\s+(\S+)/m);
        expect(nameMatch).toBeTruthy();

        const name = nameMatch![1];
        expect(names.has(name)).toBe(false);
        names.add(name);
      }
    });

    it('should have consistent model assignments', () => {
      const modelExpectations: Record<string, string> = {
        'oracle.md': 'opus',
        'oracle-medium.md': 'sonnet',
        'oracle-low.md': 'haiku',
        'librarian.md': 'sonnet',
        'librarian-low.md': 'haiku',
        'explore.md': 'haiku',
        'explore-medium.md': 'sonnet',
        'olympian.md': 'sonnet',
        'olympian-high.md': 'opus',
        'olympian-low.md': 'haiku',
        'frontend-engineer.md': 'sonnet',
        'frontend-engineer-low.md': 'haiku',
        'frontend-engineer-high.md': 'opus',
        'document-writer.md': 'haiku',
        'multimodal-looker.md': 'sonnet',
        'momus.md': 'opus',
        'metis.md': 'opus',
        'prometheus.md': 'opus',
        'qa-tester.md': 'sonnet',
      };

      for (const [filename, expectedModel] of Object.entries(modelExpectations)) {
        const content = AGENTS[filename];
        expect(content).toBeTruthy();
        expect(content).toMatch(new RegExp(`^model:\\s+${expectedModel}`, 'm'));
      }
    });

    it('should not contain duplicate file names', () => {
      const filenames = Object.keys(AGENTS);
      const uniqueFilenames = new Set(filenames);
      expect(filenames.length).toBe(uniqueFilenames.size);
    });
  });

  describe('Skills Content', () => {
    it('should contain expected skills', () => {
      const expectedSkills = [
        'archive',
        'ultrawork',
        'deepsearch',
        'analyze',
        'olympus',
        'olympus-default',
        'plan',
        'review',
        'prometheus',
        'ascent',
        'cancel-ascent',
        'update',
      ];

      for (const skill of expectedSkills) {
        expect(SKILLS).toHaveProperty(skill);
        expect(typeof SKILLS[skill]).toBe('string');
        expect(SKILLS[skill].length).toBeGreaterThan(0);
      }
    });

    it('should have valid frontmatter for each skill', () => {
      for (const [_skillName, content] of Object.entries(SKILLS)) {
        expect(content).toMatch(/^---\n/);
        expect(content).toMatch(/\n---\n/);

        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        expect(frontmatterMatch).toBeTruthy();

        const frontmatter = frontmatterMatch![1];

        expect(frontmatter).toMatch(/^description:\s+.+/m);
      }
    });

    it('should not contain duplicate skill names', () => {
      const skillNames = Object.keys(SKILLS);
      const uniqueNames = new Set(skillNames);
      expect(skillNames.length).toBe(uniqueNames.size);
    });

    it('should contain $ARGUMENTS placeholder in skills that need it', () => {
      const skillsWithArgs = [
        'ultrawork',
        'deepsearch',
        'analyze',
        'olympus',
        'olympus-default',
        'plan',
        'review',
        'prometheus',
        'ascent',
        'update',
      ];

      for (const skill of skillsWithArgs) {
        const content = SKILLS[skill];
        expect(content).toContain('$ARGUMENTS');
      }
    });

    it('should have action skills with disable-model-invocation: true', () => {
      const actionSkills = ['ultrawork', 'ascent', 'cancel-ascent', 'plan'];

      for (const skill of actionSkills) {
        const content = SKILLS[skill];
        expect(content).toContain('disable-model-invocation: true');
      }
    });
  });

  describe('CLAUDE_MD_CONTENT', () => {
    it('should be valid markdown', () => {
      expect(typeof claudeMdContent).toBe('string');
      expect(claudeMdContent.length).toBeGreaterThan(100);
      expect(claudeMdContent).toMatch(/^#\s+/m);
    });

    it('should contain essential sections', () => {
      const essentialSections = [
        'Olympus Multi-Agent System',
        'DEFAULT OPERATING MODE',
        'Available Subagents',
        'Slash Commands',
        'CONTINUATION ENFORCEMENT',
      ];

      for (const section of essentialSections) {
        expect(claudeMdContent).toContain(section);
      }
    });

    it('should reference all core agents', () => {
      const coreAgents = [
        'oracle',
        'librarian',
        'explore',
        'frontend-engineer',
        'document-writer',
        'multimodal-looker',
        'momus',
        'metis',
        'olympian',
        'prometheus',
        'qa-tester',
      ];

      for (const agent of coreAgents) {
        expect(claudeMdContent).toMatch(new RegExp(`\`${agent}\``));
      }
    });

    it('should include tiered agent routing table', () => {
      expect(claudeMdContent).toContain('Smart Model Routing');
      expect(claudeMdContent).toContain('oracle-low');
      expect(claudeMdContent).toContain('oracle-medium');
      expect(claudeMdContent).toContain('olympian-low');
      expect(claudeMdContent).toContain('olympian-high');
    });

    it('should document all slash commands', () => {
      const commands = [
        '/ultrawork',
        '/deepsearch',
        '/analyze',
        '/plan',
        '/review',
        '/prometheus',
        '/ascent',
        '/cancel-ascent',
        '/update',
      ];

      for (const command of commands) {
        expect(claudeMdContent).toContain(command);
      }
    });

    it('should contain markdown tables', () => {
      expect(claudeMdContent).toMatch(/\|[^\n]+\|/);
      expect(claudeMdContent).toMatch(/\|[-\s]+\|/);
    });
  });

  describe('VERSION', () => {
    it('should be properly formatted', () => {
      expect(typeof VERSION).toBe('string');
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    });

    it('should match package.json version', () => {
      expect(VERSION).toBe('4.4.3');
    });
  });

  describe('File Paths', () => {
    it('should define valid directory paths', () => {
      const expectedBase = join(homedir(), '.claude');

      expect(CLAUDE_CONFIG_DIR).toBe(expectedBase);
      expect(AGENTS_DIR).toBe(join(expectedBase, 'agents'));
      expect(SKILLS_DIR).toBe(join(expectedBase, 'skills'));
      expect(HOOKS_DIR).toBe(join(expectedBase, 'hooks'));
    });

    it('should use absolute paths', () => {
      const paths = [CLAUDE_CONFIG_DIR, AGENTS_DIR, SKILLS_DIR, HOOKS_DIR];

      for (const p of paths) {
        const isAbsolute = /^[/~]/.test(p) || /^[A-Za-z]:[\\/]/.test(p);
        expect(isAbsolute).toBe(true);
      }
    });
  });

  describe('Content Directory', () => {
    it('should have readable agent files', () => {
      expect(Object.keys(AGENTS).length).toBeGreaterThan(0);
      for (const [filename, content] of Object.entries(AGENTS)) {
        expect(typeof content).toBe('string');
        expect(content.length).toBeGreaterThan(0);
        expect(filename).toMatch(/\.md$/);
      }
    });

    it('should have readable skill files', () => {
      expect(Object.keys(SKILLS).length).toBeGreaterThan(0);
      for (const [skillName, content] of Object.entries(SKILLS)) {
        expect(typeof content).toBe('string');
        expect(content.length).toBeGreaterThan(0);
        expect(skillName).toBeTruthy();
      }
    });

    it('should have readable claude-md.md', () => {
      expect(typeof claudeMdContent).toBe('string');
      expect(claudeMdContent.length).toBeGreaterThan(0);
    });
  });

  describe('Content Consistency', () => {
    it('should not have duplicate agent/skill definitions', () => {
      const agentKeys = Object.keys(AGENTS).map(k => `agents/${k}`);
      const skillKeys = Object.keys(SKILLS).map(k => `skills/${k}`);
      const allKeys = [...agentKeys, ...skillKeys];

      const uniqueKeys = new Set(allKeys);
      expect(allKeys.length).toBe(uniqueKeys.size);
    });

    it('should have agents referenced in CLAUDE.md exist in agent files', () => {
      const agentMatches = claudeMdContent.matchAll(/\`([a-z-]+)\`\s*\|\s*(Opus|Sonnet|Haiku)/g);

      for (const match of agentMatches) {
        const agentName = match[1];
        const agentFile = Object.keys(AGENTS).find(key => {
          const content = AGENTS[key];
          const nameMatch = content.match(/^name:\s+(\S+)/m);
          return nameMatch && nameMatch[1] === agentName;
        });

        expect(agentFile).toBeTruthy();
      }
    });

    it('should have all agent definitions contain role descriptions', () => {
      for (const [filename, content] of Object.entries(AGENTS)) {
        if (!filename.includes('-low') && !filename.includes('-medium') && !filename.includes('-high')) {
          const hasRoleSection = content.includes('<Role>') ||
                                 content.includes('You are a') ||
                                 content.includes('You are an') ||
                                 content.includes('You interpret') ||
                                 content.includes('Named after');
          expect(hasRoleSection).toBe(true);
        }
      }
    });

    it('should have read-only agents not include Edit/Write tools', () => {
      const readOnlyAgents = ['oracle.md', 'oracle-medium.md', 'oracle-low.md', 'momus.md', 'metis.md'];

      for (const agent of readOnlyAgents) {
        const content = AGENTS[agent];
        const toolsMatch = content.match(/^tools:\s+(.+)/m);
        expect(toolsMatch).toBeTruthy();

        const tools = toolsMatch![1];
        expect(tools).not.toMatch(/\bEdit\b/);
        expect(tools).not.toMatch(/\bWrite\b/);
      }
    });

    it('should have implementation agents include Edit/Write tools', () => {
      const implementationAgents = [
        'olympian.md',
        'olympian-high.md',
        'olympian-low.md',
        'frontend-engineer.md',
        'document-writer.md',
      ];

      for (const agent of implementationAgents) {
        const content = AGENTS[agent];
        const toolsMatch = content.match(/^tools:\s+(.+)/m);
        expect(toolsMatch).toBeTruthy();

        const tools = toolsMatch![1];
        expect(tools).toMatch(/\b(Edit|Write)\b/);
      }
    });
  });

  describe('Content Quality', () => {
    it('should not contain unintended placeholder text', () => {
      const allContent = [
        ...Object.values(AGENTS),
        ...Object.values(SKILLS),
        claudeMdContent,
      ];

      const placeholders = ['FIXME', 'XXX', '[placeholder]', 'TBD'];

      for (const content of allContent) {
        for (const placeholder of placeholders) {
          expect(content).not.toContain(placeholder);
        }

        const contentWithoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');
        const hasTodoPlaceholder = /TODO:\s+[a-z]/i.test(contentWithoutCodeBlocks);
        expect(hasTodoPlaceholder).toBe(false);
      }
    });

    it('should not contain excessive blank lines', () => {
      const allContent = [
        ...Object.values(AGENTS),
        ...Object.values(SKILLS),
      ];

      for (const content of allContent) {
        expect(content).not.toMatch(/\n\n\n\n+/);
      }
    });

    it('should have proper markdown formatting in frontmatter', () => {
      for (const content of Object.values(AGENTS)) {
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        expect(frontmatterMatch).toBeTruthy();

        const frontmatter = frontmatterMatch![1];
        const lines = frontmatter.split('\n').filter(line => line.trim());
        for (const line of lines) {
          expect(line).toMatch(/^[a-z]+:\s+.+/);
        }
      }
    });
  });
});
