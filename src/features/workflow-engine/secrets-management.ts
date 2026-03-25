import * as fs from 'fs';
import * as path from 'path';

export interface EnvVarReference {
  name: string;
  file: string;
  line: number;
}

/**
 * Detects environment variable references in source files.
 * Supports: process.env.X, import.meta.env.X, Deno.env.get('X'),
 *           os.environ['X'], os.getenv('X')
 */
export function detectEnvVarReferences(filePaths: string[]): EnvVarReference[] {
  const patterns: Array<{ re: RegExp; groupIndex: number }> = [
    { re: /process\.env\.([A-Z_][A-Z0-9_]*)/g, groupIndex: 1 },
    { re: /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g, groupIndex: 1 },
    { re: /Deno\.env\.get\(['"]([^'"]+)['"]\)/g, groupIndex: 1 },
    { re: /os\.environ\[['"]([^'"]+)['"]\]/g, groupIndex: 1 },
    { re: /os\.getenv\(['"]([^'"]+)['"]\)/g, groupIndex: 1 },
  ];

  const seen = new Set<string>();
  const results: EnvVarReference[] = [];

  for (const filePath of filePaths) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineText = lines[lineIndex];
      for (const { re, groupIndex } of patterns) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(lineText)) !== null) {
          const name = match[groupIndex];
          const dedupKey = `${name}|${filePath}`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            results.push({ name, file: filePath, line: lineIndex + 1 });
          }
        }
      }
    }
  }

  return results;
}

export function getPlaceholderValue(name: string): string {
  const upper = name.toUpperCase();

  if (upper.endsWith('_URL') || upper.endsWith('_URI')) return 'https://example.com';
  if (upper.endsWith('_KEY') || upper.endsWith('_API_KEY')) return 'your-api-key-here';
  if (upper.endsWith('_SECRET') || upper.endsWith('_TOKEN')) return 'your-secret-here';
  if (upper.endsWith('_PORT')) return '3000';
  if (upper.endsWith('_HOST')) return 'localhost';
  if (upper.endsWith('_PASSWORD') || upper.endsWith('_PASS')) return 'your-password-here';
  if (upper.endsWith('_DATABASE') || upper.endsWith('_DB')) return 'your-database-name';

  return `your-${name.toLowerCase().replace(/_/g, '-')}-here`;
}

export function generateEnvExample(
  envVars: EnvVarReference[],
  projectPath: string
): { created: boolean; added: string[]; existing: string[] } {
  const targetPath = path.join(projectPath, '.env.example');

  let existingContent = '';
  let fileExisted = false;
  try {
    existingContent = fs.readFileSync(targetPath, 'utf-8');
    fileExisted = true;
  } catch (_) {
    fileExisted = false;
  }

  const existingKeys = new Set<string>();
  for (const line of existingContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex !== -1) existingKeys.add(trimmed.substring(0, eqIndex).trim());
    }
  }

  const uniqueNames = [...new Set(envVars.map((r) => r.name))];
  const toAdd: string[] = [];
  const alreadyExisting: string[] = [];

  for (const name of uniqueNames) {
    if (existingKeys.has(name)) {
      alreadyExisting.push(name);
    } else {
      toAdd.push(name);
    }
  }

  let newContent = existingContent;
  if (toAdd.length > 0) {
    const separator = newContent.length > 0 && !newContent.endsWith('\n') ? '\n' : '';
    const newLines = toAdd.map((name) => `${name}=${getPlaceholderValue(name)}`).join('\n');
    newContent = newContent + separator + newLines + '\n';
  }

  const tempPath = `${targetPath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, newContent, 'utf-8');
  fs.renameSync(tempPath, targetPath);

  return { created: !fileExisted, added: toAdd, existing: alreadyExisting };
}

export function ensureGitignore(projectPath: string): { created: boolean; added: boolean } {
  const gitignorePath = path.join(projectPath, '.gitignore');

  let existingContent = '';
  let fileExisted = false;
  try {
    existingContent = fs.readFileSync(gitignorePath, 'utf-8');
    fileExisted = true;
  } catch (_) {
    fileExisted = false;
  }

  const alreadyListed = existingContent
    .split('\n')
    .some((l) => l.trim() === '.env' || l.trim() === '/.env');

  if (alreadyListed) return { created: false, added: false };

  const separator = existingContent.length > 0 && !existingContent.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(gitignorePath, existingContent + separator + '.env\n', 'utf-8');

  return { created: !fileExisted, added: true };
}

export function runSecretsManagement(
  projectPath: string,
  unitFiles: string[]
): {
  envVarsDetected: EnvVarReference[];
  envExampleResult: { created: boolean; added: string[]; existing: string[] };
  gitignoreResult: { created: boolean; added: boolean };
} {
  const envVars = detectEnvVarReferences(unitFiles);

  if (envVars.length === 0) {
    return {
      envVarsDetected: [],
      envExampleResult: { created: false, added: [], existing: [] },
      gitignoreResult: { created: false, added: false },
    };
  }

  return {
    envVarsDetected: envVars,
    envExampleResult: generateEnvExample(envVars, projectPath),
    gitignoreResult: ensureGitignore(projectPath),
  };
}
