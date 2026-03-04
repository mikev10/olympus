import { join } from 'path';
import { ensureLearningDirs, getProjectLearningDir, readJsonFile, writeJsonFile } from './storage.js';
import { getProjectHash } from './storage.js';
import type { ProjectPatterns } from './types.js';
import type { WorkspaceScanResult } from '../features/workflow-engine/brownfield-scanner.js';

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java',
  '.c': 'C', '.cpp': 'C++', '.cs': 'C#', '.rb': 'Ruby', '.swift': 'Swift', '.kt': 'Kotlin',
  '.css': 'CSS', '.scss': 'SCSS', '.html': 'HTML', '.vue': 'Vue', '.svelte': 'Svelte',
};

const CONFIG_TO_FRAMEWORK: Record<string, string> = {
  'tsconfig.json': 'TypeScript', 'pyproject.toml': 'Python', 'Cargo.toml': 'Rust',
  'go.mod': 'Go', 'pom.xml': 'Java/Maven', 'build.gradle': 'Java/Gradle',
  'vite.config.ts': 'Vite', 'vite.config.js': 'Vite',
  'webpack.config.js': 'Webpack', 'webpack.config.ts': 'Webpack',
  'jest.config.js': 'Jest', 'jest.config.ts': 'Jest',
  'vitest.config.ts': 'Vitest', 'vitest.config.js': 'Vitest',
  'docker-compose.yml': 'Docker', 'docker-compose.yaml': 'Docker', 'Dockerfile': 'Docker',
  '.eslintrc.json': 'ESLint', '.eslintrc.js': 'ESLint',
};

export function deriveTechStack(scan: WorkspaceScanResult): string[] {
  const stack = new Set<string>();

  for (const ext of Object.keys(scan.languageDistribution)) {
    const lang = EXT_TO_LANGUAGE[ext];
    if (lang) {
      stack.add(lang);
    }
  }

  for (const configFile of scan.configFiles) {
    const framework = CONFIG_TO_FRAMEWORK[configFile];
    if (framework) {
      stack.add(framework);
    }
  }

  return Array.from(stack);
}

export function deriveConventions(scan: WorkspaceScanResult): string[] {
  const conventions: string[] = [];

  for (const node of scan.directoryTree) {
    const name = node.name;
    if (name === 'src') {
      conventions.push('Uses src/ directory for source code');
    } else if (name === '__tests__' || name === 'tests') {
      conventions.push('Has dedicated test directory');
    } else if (name === 'packages') {
      conventions.push('Monorepo with packages/ directory');
    } else if (name === 'docs') {
      conventions.push('Has documentation directory');
    } else if (name === 'lib') {
      conventions.push('Uses lib/ directory for library code');
    }
  }

  const significantLanguages = Object.entries(scan.languageDistribution)
    .filter(([, count]) => count > 5)
    .length;
  if (significantLanguages > 1) {
    conventions.push('Multi-language project');
  }

  return conventions;
}

export function writeProjectPatterns(projectPath: string, scan: WorkspaceScanResult): void {
  try {
    ensureLearningDirs(projectPath);

    const patternsPath = join(getProjectLearningDir(projectPath), 'patterns.json');
    const existing = readJsonFile<ProjectPatterns | null>(patternsPath, null);

    const newTechStack = deriveTechStack(scan);
    const newConventions = deriveConventions(scan);

    let patterns: ProjectPatterns;

    if (existing) {
      patterns = {
        ...existing,
        tech_stack: Array.from(new Set([...existing.tech_stack, ...newTechStack])),
        conventions: Array.from(new Set([...existing.conventions, ...newConventions])),
        learned_rules: existing.learned_rules || [],
        common_mistakes: existing.common_mistakes || [],
        last_updated: new Date().toISOString(),
      };
    } else {
      patterns = {
        project_hash: getProjectHash(projectPath),
        project_path: projectPath,
        tech_stack: newTechStack,
        conventions: newConventions,
        learned_rules: [],
        common_mistakes: [],
        last_updated: new Date().toISOString(),
      };
    }

    writeJsonFile(patternsPath, patterns);
  } catch (error) {
    console.error('[Olympus Learning] Failed to write project patterns:', error);
  }
}
