import * as fs from 'fs-extra';
import { join } from 'path';

export async function updateExecutionPlanCheckbox(
  projectPath: string,
  workflowId: string,
  stageName: string,
  status: 'completed' | 'skipped'
): Promise<void> {
  const planPath = join(
    projectPath, 'aidlc-docs', workflowId, 'inception', 'plans', 'execution-plan.md'
  );

  try {
    if (!(await fs.pathExists(planPath))) return;

    let content = await fs.readFile(planPath, 'utf-8');
    const displayName = stageKeyToDisplayName(stageName);
    const uncheckedPattern = new RegExp(
      `^(- \\[ \\] ${escapeRegex(displayName)}.*)$`, 'm'
    );

    if (uncheckedPattern.test(content)) {
      if (status === 'completed') {
        content = content.replace(uncheckedPattern, `- [x] ${displayName}`);
      } else if (status === 'skipped') {
        content = content.replace(uncheckedPattern, `- [x] ${displayName} *(skipped)*`);
      }
      await fs.writeFile(planPath, content, 'utf-8');
    }
  } catch (error) {
    console.error(`[ExecutionPlanUpdater] Failed to update checkbox for ${stageName}:`, (error as Error).message);
  }
}

function stageKeyToDisplayName(key: string): string {
  const map: Record<string, string> = {
    'workspace-detection': 'Workspace Detection',
    'reverse-engineering': 'Reverse Engineering',
    'requirements-analysis': 'Requirements Analysis',
    'user-stories': 'User Stories',
    'workflow-planning': 'Workflow Planning',
    'units-generation': 'Units Generation',
    'code-generation': 'Code Generation',
    'build-and-test': 'Build and Test',
    'domain-design': 'Domain Design',
    'functional-design': 'Functional Design',
    'nfr-requirements': 'NFR Requirements',
    'nfr-design': 'NFR Design',
    'infrastructure-design': 'Infrastructure Design',
  };
  return map[key] ?? key;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
