import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { recordDiscovery } from './discovery.js';
import type { DiscoveryCategory } from './types.js';

/**
 * Migrate existing notepad content to discoveries.
 * This is a one-time migration utility.
 */
export async function migrateNotepads(projectPath: string): Promise<number> {
  const notepadsDir = join(projectPath, '.olympus', 'notepads');

  if (!existsSync(notepadsDir)) {
    return 0;
  }

  let migratedCount = 0;

  // Recursively find all .md files
  const planDirs = readdirSync(notepadsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const planDir of planDirs) {
    const planPath = join(notepadsDir, planDir);
    const files = readdirSync(planPath).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const content = readFileSync(join(planPath, file), 'utf-8');

      // Parse markdown sections into discoveries
      const discoveries = parseNotepadContent(content, planDir);

      for (const d of discoveries) {
        recordDiscovery({
          ...d,
          session_id: 'migration',
          project_path: projectPath,
          agent_name: 'migration',
          confidence: 0.7, // Lower confidence for migrated content
          scope: 'project',
        });
        migratedCount++;
      }
    }
  }

  return migratedCount;
}

interface PartialDiscovery {
  category: DiscoveryCategory;
  summary: string;
  details: string;
  task_context?: string;
}

function parseNotepadContent(content: string, taskContext: string): PartialDiscovery[] {
  // Simple parsing: each H3 (###) becomes a discovery
  const sections = content.split(/^### /m).slice(1);

  return sections.map(section => {
    const lines = section.split('\n');
    const summary = lines[0].trim().slice(0, 100);
    const details = lines.slice(1).join('\n').trim();

    return {
      category: inferCategory(summary, details),
      summary,
      details: details || summary,
      task_context: taskContext,
    };
  }).filter(d => d.summary.length >= 10 && d.details.length >= 20);
}

function inferCategory(summary: string, details: string): DiscoveryCategory {
  const text = (summary + ' ' + details).toLowerCase();

  if (text.includes('performance') || text.includes('slow') || text.includes('optimize')) {
    return 'performance';
  }
  if (text.includes('workaround') || text.includes('hack') || text.includes('fix')) {
    return 'workaround';
  }
  if (text.includes('pattern') || text.includes('convention') || text.includes('style')) {
    return 'pattern';
  }
  if (text.includes('gotcha') || text.includes('careful') || text.includes('warning')) {
    return 'gotcha';
  }
  if (text.includes('dependency') || text.includes('package') || text.includes('install')) {
    return 'dependency';
  }
  if (text.includes('config') || text.includes('environment') || text.includes('setting')) {
    return 'configuration';
  }

  return 'technical_insight';
}
