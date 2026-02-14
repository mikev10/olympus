import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { getAgentPerformanceForRouting } from '../../learning/efficiency.js';

export interface BoltDispatchResult {
  boltId: string;
  agentType: string; // 'olympian' | 'frontend-engineer' | 'oracle'
  prompt: string;
  context: {
    boltSpec: string; // Full BOLT spec content
    unitSpec: string; // Parent UNIT spec for context
    intentSummary: string; // Relevant sections of INTENT
    ideaSummary: string; // Problem statement from root IDEA
    targetFiles: string[]; // Files the BOLT should modify
  };
}

/**
 * Find a BOLT file in the construction directory structure.
 */
export function findBoltFile(
  constructionDir: string,
  boltId: string
): { parentUnit: string; boltSpec: string } {
  if (!existsSync(constructionDir)) {
    throw new Error(`Construction directory not found: ${constructionDir}`);
  }

  const units = readdirSync(constructionDir).filter((dir) =>
    dir.startsWith('UNIT-')
  );

  for (const unit of units) {
    const boltPath = join(constructionDir, unit, `${boltId}.md`);
    if (existsSync(boltPath)) {
      const boltSpec = readFileSync(boltPath, 'utf-8');
      return { parentUnit: unit, boltSpec };
    }
  }

  throw new Error(
    `BOLT ${boltId} not found in any UNIT under ${constructionDir}`
  );
}

/**
 * Extract specific sections from markdown content by heading names.
 */
export function extractSections(
  content: string,
  sectionNames: string[]
): string {
  if (!content) return '';

  const sections: string[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^##\s+(.+)$/) || line.match(/^###\s+(.+)$/);

    if (heading) {
      const headingText = heading[1].trim();
      if (sectionNames.some((name) => headingText.includes(name))) {
        // Found a matching section, capture until next heading of same or higher level
        const sectionLines = [line];
        const headingLevel = line.match(/^(#+)/)?.[1].length || 2;

        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          const nextHeading = nextLine.match(/^(#+)\s/);

          if (nextHeading && nextHeading[1].length <= headingLevel) {
            // Found next section at same or higher level
            break;
          }

          sectionLines.push(nextLine);
        }

        sections.push(sectionLines.join('\n'));
      }
    }
  }

  return sections.length > 0 ? sections.join('\n\n') : content;
}

/**
 * Extract target files from BOLT spec.
 */
export function extractTargetFiles(boltSpec: string): string[] {
  const targetFiles: string[] = [];
  const lines = boltSpec.split('\n');
  let inTargetFilesSection = false;

  for (const line of lines) {
    // Check for Target Files heading
    if (line.match(/^##\s+Target Files/i) || line.match(/^###\s+Target Files/i)) {
      inTargetFilesSection = true;
      continue;
    }

    // Stop at next section heading
    if (inTargetFilesSection && line.match(/^##\s+/)) {
      break;
    }

    // Extract file paths
    if (inTargetFilesSection) {
      const fileMatch = line.match(/^-\s+(.+)$/);
      if (fileMatch) {
        targetFiles.push(fileMatch[1].trim());
      }
    }
  }

  return targetFiles;
}

/**
 * Select the appropriate agent for executing a BOLT.
 */
export function selectAgentForBolt(boltSpec: string): string {
  const targetFiles = extractTargetFiles(boltSpec);

  // Check efficiency data for lower-tier agents
  const candidates = ['olympian-low', 'frontend-engineer-low', 'oracle-low'];
  for (const candidate of candidates) {
    const perf = getAgentPerformanceForRouting(candidate);
    if (perf && perf.success_rate > 0.8 && perf.total_invocations > 10) {
      // Lower-tier agent has proven track record
      // Still apply content-based routing to pick the right type
      if (isUIWork(targetFiles, boltSpec)) {
        return candidate.startsWith('frontend') ? candidate : 'frontend-engineer-low';
      }
      if (isDebugWork(boltSpec)) {
        return candidate.startsWith('oracle') ? candidate : 'oracle-low';
      }
      return candidate.startsWith('olympian') ? candidate : 'olympian-low';
    }
  }

  // Fallback to content-based routing with standard agents
  if (isUIWork(targetFiles, boltSpec)) {
    return 'frontend-engineer';
  }

  if (isDebugWork(boltSpec)) {
    return 'oracle';
  }

  return 'olympian';
}

function isUIWork(targetFiles: string[], boltSpec: string): boolean {
  const uiPatterns = ['.tsx', '.jsx', '.css', '.scss', '/ui/', '/component', '/page', '/layout'];

  for (const file of targetFiles) {
    const lowerFile = file.toLowerCase();
    if (uiPatterns.some((pattern) => lowerFile.includes(pattern))) {
      return true;
    }
  }

  return false;
}

function isDebugWork(boltSpec: string): boolean {
  const debugKeywords = ['debug', 'fix', 'investigate', 'diagnose'];
  const lowerSpec = boltSpec.toLowerCase();

  return debugKeywords.some((keyword) => lowerSpec.includes(keyword));
}

/**
 * Build the execution prompt for a BOLT.
 */
export function buildBoltPrompt(
  ideaSummary: string,
  intentSummary: string,
  unitSpec: string,
  boltSpec: string
): string {
  return `You are executing a coding task as part of a structured workflow.

## Context
**Problem**: ${ideaSummary}
**Technical Plan**: ${intentSummary}
**Module**: ${unitSpec}

## Your Task
${boltSpec}

## Instructions
- Implement all items in "Implementation Steps"
- Create/modify files listed in "Target Files"
- Write tests per "Test Requirements"
- Meet all "Acceptance Criteria"
- Do NOT modify files outside the target list without justification`;
}

/**
 * Read a BOLT spec and construct the dispatch result for agent execution.
 */
export async function dispatchBolt(
  projectPath: string,
  workflowId: string,
  boltId: string
): Promise<BoltDispatchResult> {
  // 1. Derive parent UNIT from boltId (e.g., BOLT-001 -> UNIT-001, BOLT-003 -> need to search)
  const docsDir = join(projectPath, 'aidlc-docs');

  // Find the BOLT file by searching construction subdirectories
  const constructionDir = join(docsDir, 'construction');
  const { parentUnit, boltSpec } = findBoltFile(constructionDir, boltId);

  // 2. Read parent UNIT spec
  const unitSpecPath = join(constructionDir, parentUnit, 'spec.md');
  const unitSpec = existsSync(unitSpecPath)
    ? readFileSync(unitSpecPath, 'utf-8')
    : '';

  // 3. Read INTENT summary (Business Requirements + Technical Specification sections)
  const intentPath = join(docsDir, 'inception', 'intent.md');
  const intentContent = existsSync(intentPath)
    ? readFileSync(intentPath, 'utf-8')
    : '';
  const intentSummary = extractSections(intentContent, [
    'Business Requirements',
    'Technical Specification',
  ]);

  // 4. Read IDEA summary (Problem Statement + Success Metrics)
  const ideaPath = join(docsDir, 'inception', 'idea.md');
  const ideaContent = existsSync(ideaPath)
    ? readFileSync(ideaPath, 'utf-8')
    : '';
  const ideaSummary = extractSections(ideaContent, [
    'Problem Statement',
    'Success Metrics',
  ]);

  // 5. Extract target files from BOLT spec
  const targetFiles = extractTargetFiles(boltSpec);

  // 6. Select agent
  const agentType = selectAgentForBolt(boltSpec);

  // 7. Construct prompt
  const prompt = buildBoltPrompt(ideaSummary, intentSummary, unitSpec, boltSpec);

  return {
    boltId,
    agentType,
    prompt,
    context: {
      boltSpec,
      unitSpec,
      intentSummary,
      ideaSummary,
      targetFiles,
    },
  };
}
