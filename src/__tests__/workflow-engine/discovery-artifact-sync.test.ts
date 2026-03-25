import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import { DISCOVERY_ARTIFACTS } from '../../features/workflow-engine/discovery.js';

describe('discovery-artifact-sync', () => {
  /**
   * Verify that the reverse-engineering rule file defines all DISCOVERY_ARTIFACTS
   * and that they match the engine's artifact set exactly.
   *
   * This test catches drift between the rule file documentation and the TypeScript engine.
   */
  it('should have all DISCOVERY_ARTIFACTS defined in reverse-engineering rule file', async () => {
    // Read the rule file
    const ruleFilePath = path.resolve(process.cwd(), 'resources/rules/inception/reverse-engineering.md');
    const ruleFileContent = await fs.readFile(ruleFilePath, 'utf-8');

    // Extract all artifact names from the rule file (match artifact names in markdown)
    const artifactPattern = /Create `aidlc-docs\/\{workflowId\}\/discovery\/([\w-]+)\.(md|json)`:/g;
    const foundArtifacts = new Set<string>();
    let match;
    while ((match = artifactPattern.exec(ruleFileContent)) !== null) {
      foundArtifacts.add(match[1]);
    }

    // Verify every engine artifact is in the rule file
    for (const artifact of DISCOVERY_ARTIFACTS) {
      expect(
        foundArtifacts.has(artifact),
        `Engine artifact '${artifact}' not found in rule file`
      ).toBe(true);
    }

    // Verify no extra artifacts exist in the rule file beyond those in the engine
    for (const artifact of foundArtifacts) {
      expect(
        DISCOVERY_ARTIFACTS.includes(artifact as any),
        `Rule file contains artifact '${artifact}' not in DISCOVERY_ARTIFACTS`
      ).toBe(true);
    }
  });

  /**
   * Verify that the rule file uses correct paths with {workflowId}
   */
  it('should use correct artifact paths with {workflowId}', async () => {
    const ruleFilePath = path.resolve(process.cwd(), 'resources/rules/inception/reverse-engineering.md');
    const ruleFileContent = await fs.readFile(ruleFilePath, 'utf-8');

    // Should NOT have old paths
    const oldPathPattern = /aidlc-docs\/inception\/reverse-engineering\//g;
    const oldPathMatches = ruleFileContent.match(oldPathPattern);
    expect(oldPathMatches, 'Rule file contains old paths with aidlc-docs/inception/reverse-engineering/').toBe(null);

    // Should use new paths
    const newPathPattern = /aidlc-docs\/\{workflowId\}\/discovery\//g;
    const newPathMatches = ruleFileContent.match(newPathPattern);
    expect(newPathMatches, 'Rule file should use aidlc-docs/{workflowId}/discovery/ paths').not.toBe(null);
    expect(newPathMatches!.length, 'Should have correct number of artifact paths').toBeGreaterThanOrEqual(
      DISCOVERY_ARTIFACTS.length
    );
  });

  /**
   * Verify that Agent 2 is oracle-medium (not explore-medium)
   */
  it('should assign oracle-medium for dynamic behavior model agent', async () => {
    const ruleFilePath = path.resolve(process.cwd(), 'resources/rules/inception/reverse-engineering.md');
    const ruleFileContent = await fs.readFile(ruleFilePath, 'utf-8');

    // Find the Agent Delegation Strategy section and verify Agent 2
    const agent2Pattern = /\*\*Agent 2\*\*\s*\(`oracle-medium`\):\s*Dynamic behavior model/;
    expect(agent2Pattern.test(ruleFileContent), 'Agent 2 should be oracle-medium for dynamic behavior model').toBe(
      true
    );

    // Verify no old Agent 2 definition with explore-medium
    const oldAgent2Pattern = /\*\*Agent 2\*\*\s*\(`explore-medium`\):\s*Dynamic behavior model/;
    expect(oldAgent2Pattern.test(ruleFileContent), 'Agent 2 should not be explore-medium').toBe(false);
  });

  /**
   * Verify Agent 1 is still explore-medium (unchanged)
   */
  it('should keep explore-medium for static code model agent', async () => {
    const ruleFilePath = path.resolve(process.cwd(), 'resources/rules/inception/reverse-engineering.md');
    const ruleFileContent = await fs.readFile(ruleFilePath, 'utf-8');

    // Find the Agent Delegation Strategy section and verify Agent 1
    const agent1Pattern = /\*\*Agent 1\*\*\s*\(`explore-medium`\):\s*Static code model/;
    expect(agent1Pattern.test(ruleFileContent), 'Agent 1 should be explore-medium for static code model').toBe(true);
  });

  /**
   * Verify Multi-Package Discovery and approval sections are preserved
   */
  it('should preserve Step 1 Multi-Package Discovery section', async () => {
    const ruleFilePath = path.resolve(process.cwd(), 'resources/rules/inception/reverse-engineering.md');
    const ruleFileContent = await fs.readFile(ruleFilePath, 'utf-8');

    expect(ruleFileContent.includes('## Step 1: Multi-Package Discovery'), 'Multi-Package Discovery section should exist').toBe(
      true
    );
    expect(ruleFileContent.includes('### 1.1 Scan Workspace')).toBe(true);
    expect(ruleFileContent.includes('### 1.2 Understand the Business Context')).toBe(true);
  });

  /**
   * Verify state tracking and completion sections are preserved
   */
  it('should preserve Step 10-12 state tracking and approval sections', async () => {
    const ruleFilePath = path.resolve(process.cwd(), 'resources/rules/inception/reverse-engineering.md');
    const ruleFileContent = await fs.readFile(ruleFilePath, 'utf-8');

    expect(ruleFileContent.includes('## Step 10: MANDATORY: Update State Tracking')).toBe(true);
    expect(ruleFileContent.includes('## Step 11: Present Completion Message to User')).toBe(true);
    expect(ruleFileContent.includes('## Step 12: Wait for User Approval')).toBe(true);
  });

  const OLD_ARTIFACT_NAMES = [
    'architecture.md',
    'component-inventory.md',
    'technology-stack.md',
    'code-structure.md',
    'api-documentation.md',
    'dependencies.md',
    'business-overview.md',
    'code-quality-assessment.md',
  ];

  const DOWNSTREAM_RULE_FILES = [
    'resources/rules/inception/requirements-analysis.md',
    'resources/rules/inception/workflow-planning.md',
    'resources/rules/common/session-continuity.md',
    'resources/rules/construction/code-generation.md',
  ];

  for (const ruleFile of DOWNSTREAM_RULE_FILES) {
    it(`should not reference old artifact names in ${path.basename(ruleFile)}`, async () => {
      const filePath = path.resolve(process.cwd(), ruleFile);
      const content = await fs.readFile(filePath, 'utf-8');

      for (const oldName of OLD_ARTIFACT_NAMES) {
        const hasOldRef = new RegExp(`\\b${oldName.replace('.', '\\.')}\\b`).test(content);
        expect(hasOldRef, `${path.basename(ruleFile)} still references old artifact '${oldName}'`).toBe(false);
      }
    });

    it(`should not reference old inception/reverse-engineering/ path in ${path.basename(ruleFile)}`, async () => {
      const filePath = path.resolve(process.cwd(), ruleFile);
      const content = await fs.readFile(filePath, 'utf-8');

      expect(
        content.includes('inception/reverse-engineering/'),
        `${path.basename(ruleFile)} still uses old path inception/reverse-engineering/`
      ).toBe(false);
    });
  }
});
