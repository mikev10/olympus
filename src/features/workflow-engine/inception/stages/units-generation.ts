import * as fs from 'fs-extra';
import { join } from 'path';
import { registerStageHandler } from '../orchestrator.js';
import type { InceptionStageResult } from '../orchestrator.js';
import type { WorkflowCheckpointV3 } from '../../phase-types.js';

async function executeUnitsGeneration(
  projectPath: string,
  workflowId: string,
  checkpoint: WorkflowCheckpointV3
): Promise<InceptionStageResult> {
  const depthScore = checkpoint.depth_score ?? 18;
  const recommendedDepth = depthScore <= 12 ? 'minimal' : depthScore <= 24 ? 'standard' : 'comprehensive';

  if (recommendedDepth === 'minimal') {
    return {
      stage: 'units-generation',
      status: 'skipped',
      requires_approval: true,
      artifacts_generated: [],
      review_summary: 'Skipped: minimal depth does not require unit decomposition at inception.',
    };
  }

  const inceptionDir = join(projectPath, 'aidlc-docs', workflowId, 'inception');
  const appDesignDir = join(inceptionDir, 'application-design');
  await fs.ensureDir(appDesignDir);

  let intentContent = '';
  let requirementsContent = '';
  let storiesContent = '';
  let componentsContent = '';

  try { intentContent = await fs.readFile(join(inceptionDir, 'intent.md'), 'utf-8'); } catch {}
  try { requirementsContent = await fs.readFile(join(inceptionDir, 'requirements', 'requirements.md'), 'utf-8'); } catch {}
  try { storiesContent = await fs.readFile(join(inceptionDir, 'user-stories', 'stories.md'), 'utf-8'); } catch {}
  try { componentsContent = await fs.readFile(join(inceptionDir, 'application-design', 'components.md'), 'utf-8'); } catch {}

  const unitDefinitions = generateUnitDefinitions(intentContent, requirementsContent, componentsContent);
  const unitPath = join(appDesignDir, 'unit-of-work.md');
  await fs.writeFile(unitPath, unitDefinitions, 'utf-8');

  const dependencies = generateUnitDependencies(unitDefinitions);
  const depPath = join(appDesignDir, 'unit-of-work-dependency.md');
  await fs.writeFile(depPath, dependencies, 'utf-8');

  const storyMap = generateStoryMap(unitDefinitions, storiesContent);
  const storyMapPath = join(appDesignDir, 'unit-of-work-story-map.md');
  await fs.writeFile(storyMapPath, storyMap, 'utf-8');

  const artifactPaths = [unitPath, depPath, storyMapPath];
  const unitCount = countUnits(unitDefinitions);

  return {
    stage: 'units-generation',
    status: 'review_required',
    requires_approval: true,
    artifacts_generated: artifactPaths,
    review_summary: [
      '## REVIEW REQUIRED',
      '',
      `Units generation complete. ${unitCount} units defined:`,
      ...artifactPaths.map(p => `  - ${p}`),
      '',
      'Review unit definitions, dependencies, and story mapping.',
    ].join('\n'),
    whats_next: [
      "## WHAT'S NEXT",
      '',
      'Once units are approved, inception is complete.',
      'The construction phase will create UNIT-NNN directories from these definitions.',
    ].join('\n'),
  };
}

export function generateUnitDefinitions(
  intentContent: string,
  requirementsContent: string,
  componentsContent: string
): string {
  const lines: string[] = [];
  lines.push('# Unit of Work Definitions\n');
  lines.push(`Generated: ${new Date().toISOString()}\n`);

  const components = parseComponentNames(componentsContent);

  if (components.length > 0) {
    components.forEach((component, index) => {
      const unitId = `UNIT-${String(index + 1).padStart(3, '0')}`;
      lines.push(`## ${unitId}: ${component}\n`);
      lines.push(`- **Scope**: Implementation of ${component} component`);
      lines.push(`- **Estimated Effort**: Standard`);
      lines.push(`- **Dependencies**: See dependency matrix`);
      lines.push(`- **Status**: Pending`);
      lines.push('');
    });
  } else {
    lines.push('## UNIT-001: Core Implementation\n');
    lines.push('- **Scope**: Full feature implementation');
    lines.push('- **Estimated Effort**: Standard');
    lines.push('- **Dependencies**: None');
    lines.push('- **Status**: Pending');
    lines.push('');
  }

  return lines.join('\n');
}

export function generateUnitDependencies(unitDefinitions: string): string {
  const lines: string[] = [];
  lines.push('# Unit Dependencies\n');
  lines.push(`Generated: ${new Date().toISOString()}\n`);

  const units = extractUnitIds(unitDefinitions);

  lines.push('## Dependency Matrix\n');
  if (units.length <= 1) {
    lines.push('No inter-unit dependencies (single unit).\n');
  } else {
    lines.push('| Unit | Depends On | Blocks |');
    lines.push('|------|-----------|--------|');
    units.forEach((unit, index) => {
      const dependsOn = index > 0 ? units[index - 1] : 'None';
      const blocks = index < units.length - 1 ? units[index + 1] : 'None';
      lines.push(`| ${unit} | ${dependsOn} | ${blocks} |`);
    });
    lines.push('');
  }

  lines.push('## Dependency Graph\n');
  lines.push('```mermaid');
  lines.push('graph TD');
  if (units.length > 1) {
    for (let i = 0; i < units.length - 1; i++) {
      lines.push(`  ${units[i]} --> ${units[i + 1]}`);
    }
  } else if (units.length === 1) {
    lines.push(`  ${units[0]}`);
  }
  lines.push('```\n');

  return lines.join('\n');
}

export function generateStoryMap(unitDefinitions: string, storiesContent: string): string {
  const lines: string[] = [];
  lines.push('# Unit-Story Mapping\n');
  lines.push(`Generated: ${new Date().toISOString()}\n`);

  const units = extractUnitIds(unitDefinitions);
  const stories = extractStoryIds(storiesContent);

  lines.push('## Mapping\n');
  lines.push('| Unit | Stories | Coverage |');
  lines.push('|------|---------|----------|');

  if (units.length > 0 && stories.length > 0) {
    const storiesPerUnit = Math.max(1, Math.ceil(stories.length / units.length));
    units.forEach((unit, index) => {
      const start = index * storiesPerUnit;
      const end = Math.min(start + storiesPerUnit, stories.length);
      const assignedStories = stories.slice(start, end);
      const storyList = assignedStories.length > 0 ? assignedStories.join(', ') : 'None';
      const coverage = assignedStories.length > 0 ? 'Mapped' : 'Unmapped';
      lines.push(`| ${unit} | ${storyList} | ${coverage} |`);
    });
  } else if (units.length > 0) {
    units.forEach(unit => {
      lines.push(`| ${unit} | No stories available | Unmapped |`);
    });
  }
  lines.push('');

  lines.push('## Traceability\n');
  if (stories.length > 0) {
    lines.push(`Total stories: ${stories.length}`);
    lines.push(`Total units: ${units.length}`);
    lines.push(`Mapped: ${Math.min(stories.length, units.length > 0 ? stories.length : 0)}`);
    lines.push(`Unmapped: 0`);
  } else {
    lines.push('No user stories available for mapping.');
  }
  lines.push('');

  return lines.join('\n');
}

export function parseComponentNames(componentsContent: string): string[] {
  if (!componentsContent) return [];
  const names: string[] = [];
  const lines = componentsContent.split('\n');
  let headerPassed = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|[\s\-|]+\|$/.test(trimmed)) { headerPassed = true; continue; }
    if (!headerPassed) continue;
    const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length > 0 && cells[0]) {
      names.push(cells[0]);
    }
  }
  return names;
}

export function extractUnitIds(content: string): string[] {
  const matches = content.match(/^## (UNIT-\d+)/gm) || [];
  return matches.map(m => m.replace('## ', ''));
}

export function extractStoryIds(content: string): string[] {
  if (!content) return [];
  const matches = content.match(/^## (US-\d+)/gm) || [];
  return matches.map(m => m.replace('## ', ''));
}

export function countUnits(content: string): number {
  return extractUnitIds(content).length;
}

registerStageHandler('units-generation', executeUnitsGeneration);
export { executeUnitsGeneration };
