import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getAgentPerformanceForRouting } from '../../learning/efficiency.js';

export function buildCodePlanPath(
  projectPath: string,
  workflowId: string,
  unitName: string
): string {
  return join(projectPath, 'aidlc-docs', workflowId, 'construction', unitName, 'code-plan.md');
}

export interface CodeGenerationDispatchResult {
  unitName: string;
  agentType: string;
  prompt: string;
  context: {
    unitSpec: string;
    intentSummary: string;
    intentSummary2: string;
    targetFiles: string[];
    architectureContext?: string;
  };
}

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
        const sectionLines = [line];
        const headingLevel = line.match(/^(#+)/)?.[1].length || 2;

        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          const nextHeading = nextLine.match(/^(#+)\s/);

          if (nextHeading && nextHeading[1].length <= headingLevel) {
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

export function extractTargetFiles(spec: string): string[] {
  const targetFiles: string[] = [];
  const lines = spec.split('\n');
  let inTargetFilesSection = false;

  for (const line of lines) {
    if (line.match(/^##\s+Target Files/i) || line.match(/^###\s+Target Files/i)) {
      inTargetFilesSection = true;
      continue;
    }

    if (inTargetFilesSection && line.match(/^##\s+/)) {
      break;
    }

    if (inTargetFilesSection) {
      const fileMatch = line.match(/^-\s+(.+)$/);
      if (fileMatch) {
        targetFiles.push(fileMatch[1].trim());
      }
    }
  }

  return targetFiles;
}

export function selectAgentForCodeGeneration(unitSpec: string): string {
  const targetFiles = extractTargetFiles(unitSpec);

  const candidates = ['olympian-low', 'frontend-engineer-low', 'oracle-low'];
  for (const candidate of candidates) {
    const perf = getAgentPerformanceForRouting(candidate);
    if (perf && perf.success_rate > 0.8 && perf.total_invocations > 10) {
      if (isUIWork(targetFiles, unitSpec)) {
        return candidate.startsWith('frontend') ? candidate : 'frontend-engineer-low';
      }
      if (isDebugWork(unitSpec)) {
        return candidate.startsWith('oracle') ? candidate : 'oracle-low';
      }
      return candidate.startsWith('olympian') ? candidate : 'olympian-low';
    }
  }

  if (isUIWork(targetFiles, unitSpec)) {
    return 'frontend-engineer';
  }

  if (isDebugWork(unitSpec)) {
    return 'oracle';
  }

  return 'olympian';
}

function isUIWork(targetFiles: string[], spec: string): boolean {
  const uiPatterns = ['.tsx', '.jsx', '.css', '.scss', '/ui/', '/component', '/page', '/layout'];

  for (const file of targetFiles) {
    const lowerFile = file.toLowerCase();
    if (uiPatterns.some((pattern) => lowerFile.includes(pattern))) {
      return true;
    }
  }

  return false;
}

function isDebugWork(spec: string): boolean {
  const debugKeywords = ['debug', 'fix', 'investigate', 'diagnose'];
  const lowerSpec = spec.toLowerCase();

  return debugKeywords.some((keyword) => lowerSpec.includes(keyword));
}

export function buildCodeGenerationPrompt(
  intentProblemSummary: string,
  intentSummary: string,
  unitSpec: string,
  codePlanPath?: string,
  additionalContext?: string
): string {
  const planInstructions = codePlanPath ? `
## Execution Protocol (Two-Part Code Generation)
PART 1 - PLAN:
1. Create an execution plan in a markdown file with checkboxes for each step
2. Save the plan to: ${codePlanPath}
3. STOP and request review of the plan

PART 2 - GENERATE (after approval):
4. Execute the plan step by step, checking off each item
5. Implement all code changes described in the plan

Do NOT begin implementation until the plan is approved.

` : '';

  const contextSection = additionalContext ? `\n## Architecture Context\n${additionalContext}\n` : '';

  return `You are executing code generation as part of a structured workflow.

## Context
**Problem**: ${intentProblemSummary}
**Technical Plan**: ${intentSummary}
**Module**: ${unitSpec}
${planInstructions}${contextSection}## Your Task
Generate code for this unit according to the spec above.

## Instructions
- Implement all items in "Implementation Steps"
- Create/modify files listed in "Target Files"
- Write tests per "Test Requirements"
- Meet all "Acceptance Criteria"
- Do NOT modify files outside the target list without justification`;
}

export async function dispatchCodeGeneration(
  projectPath: string,
  workflowId: string,
  unitName: string
): Promise<CodeGenerationDispatchResult> {
  const docsDir = join(projectPath, 'aidlc-docs', workflowId);
  const constructionDir = join(docsDir, 'construction');

  const unitSpecPath = join(constructionDir, unitName, 'spec.md');
  const unitSpec = existsSync(unitSpecPath)
    ? readFileSync(unitSpecPath, 'utf-8')
    : '';

  const intentPath = join(docsDir, 'inception', 'intent.md');
  const intentContent = existsSync(intentPath)
    ? readFileSync(intentPath, 'utf-8')
    : '';
  const intentSummary = extractSections(intentContent, [
    'Business Requirements',
    'Technical Specification',
  ]);

  const intentSummary2 = extractSections(intentContent, [
    'Problem Statement',
    'Success Metrics',
  ]);

  const targetFiles = extractTargetFiles(unitSpec);

  let architectureContext = '';
  try {
    const { getArchitectureContext } = await import('./architecture-model.js');
    const touchedComponents = [...new Set(targetFiles.map(f => {
      const parts = f.replace(/\\/g, '/').split('/').filter(Boolean);
      if (parts[0] === 'src' && parts.length > 1) return parts[1];
      return parts[0] || '';
    }).filter(Boolean))];
    if (touchedComponents.length > 0) {
      architectureContext = await getArchitectureContext(projectPath, touchedComponents);
    }
  } catch {}

  let pathwayRulesContext = '';
  try {
    const { loadPathwayBehaviors } = await import('./workflow-routing.js');
    const { loadCheckpoint } = await import('./checkpoint.js');
    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (checkpoint?.pathway_type) {
      const behaviors = await loadPathwayBehaviors(checkpoint.pathway_type);
      if (behaviors) {
        const rulesText = behaviors.rules.map(r => `- **${r.name}**: ${r.description}`).join('\n');
        const checklistText = behaviors.qualityGateChecklist.map(c => `- [ ] ${c}`).join('\n');
        pathwayRulesContext = `\n## Pathway Rules (${checkpoint.pathway_type})\n${rulesText}\n\n### Quality Checklist\n${checklistText}`;
      }
    }
  } catch {}

  let designSystemRule = '';
  try {
    const { loadArchitectureModel } = await import('./architecture-model.js');
    const archModel = await loadArchitectureModel(projectPath);
    if (archModel?.designSystem?.detected && archModel.designSystem.systems.length > 0) {
      const systemNames = archModel.designSystem.systems.map(s => s.name).join(', ');
      designSystemRule = `\n## Design System Enforcement\nThis project uses: ${systemNames}. You MUST:\n- Use existing components from the detected design system before creating new ones\n- If you must create a new component, include a justification comment explaining why no existing component suffices\n- Do NOT duplicate functionality already provided by ${systemNames}`;
    }
  } catch {}

  const combinedContext = [architectureContext, pathwayRulesContext, designSystemRule].filter(Boolean).join('\n\n');

  const agentType = selectAgentForCodeGeneration(unitSpec);

  const prompt = buildCodeGenerationPrompt(intentSummary2, intentSummary, unitSpec, undefined, combinedContext || undefined);

  return {
    unitName,
    agentType,
    prompt,
    context: {
      unitSpec,
      intentSummary,
      intentSummary2,
      targetFiles,
      architectureContext: combinedContext || undefined,
    },
  };
}

export const CODE_PLAN_FORMAT_INSTRUCTIONS = `A code generation plan must contain:
1. A title line: "# Code Plan: {unitName}"
2. A checklist of implementation steps using markdown checkboxes (- [ ] step)
3. Each step should be specific and actionable
4. Steps should be ordered by dependency (prerequisites first)
5. Include a "## Verification" section with test/validation checkboxes
The plan file is saved at: aidlc-docs/{workflowId}/construction/{unitName}/code-plan.md`;
