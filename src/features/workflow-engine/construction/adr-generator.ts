import * as fs from 'fs';
import * as path from 'path';

export interface ADROptions {
  workflowId: string;
  unitId: string;
  projectPath: string;
  title: string;
  context: string;
  decision: string;
  consequences: string;
}

export interface ADRResult {
  number: number;
  path: string;
  title: string;
}

export function getNextADRNumber(decisionsDir: string): number {
  if (!fs.existsSync(decisionsDir)) return 1;
  const entries = fs.readdirSync(decisionsDir);
  const numbers = entries
    .map(name => {
      const match = /^ADR-(\d+)-/.exec(name);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(n => n > 0);
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

export function generateADR(options: ADROptions): ADRResult {
  const decisionsDir = path.join(options.projectPath, 'aidlc-docs', options.workflowId, 'decisions');
  fs.mkdirSync(decisionsDir, { recursive: true });

  const number = getNextADRNumber(decisionsDir);
  const slug = options.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const paddedNum = String(number).padStart(3, '0');
  const filename = `ADR-${paddedNum}-${slug}.md`;

  const content = [
    `# ADR-${paddedNum}: ${options.title}`,
    '',
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Status:** Accepted`,
    `**Unit:** ${options.unitId}`,
    '',
    '## Context',
    '',
    options.context,
    '',
    '## Decision',
    '',
    options.decision,
    '',
    '## Consequences',
    '',
    options.consequences,
    '',
  ].join('\n');

  const filePath = path.join(decisionsDir, filename);
  fs.writeFileSync(filePath, content);

  return { number, path: filePath, title: options.title };
}

export function detectSignificantDecisions(
  unitFiles: string[],
  projectPath: string
): Array<{ title: string; context: string; decision: string; consequences: string }> {
  const decisions: Array<{ title: string; context: string; decision: string; consequences: string }> = [];

  const packageJsonPath = path.join(projectPath, 'package.json');
  let existingDeps: Set<string> = new Set();
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      existingDeps = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]);
    } catch (_) {
    }
  }

  for (const filePath of unitFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const importMatches = content.matchAll(/from ['"]([^./][^'"]+)['"]/g);
    for (const match of importMatches) {
      const pkg = match[1].split('/')[0];
      if (pkg && !existingDeps.has(pkg) && !pkg.startsWith('@types/')) {
        decisions.push({
          title: `Added dependency: ${pkg}`,
          context: `Unit ${path.basename(filePath)} imports from '${pkg}', which was not present in the existing package.json dependencies.`,
          decision: `Include '${pkg}' as a dependency to support the new functionality introduced in this unit.`,
          consequences: `Build and runtime environments must have '${pkg}' available. Adds to bundle size and supply chain surface.`,
        });
        existingDeps.add(pkg);
      }
    }

    const modelMatches = content.matchAll(/export\s+(?:interface|type)\s+(\w+(?:Schema|Model|Entity|Record|Row|Document))\b/g);
    for (const match of modelMatches) {
      const modelName = match[1];
      decisions.push({
        title: `New data model: ${modelName}`,
        context: `A new exported type '${modelName}' with persistence-related naming was introduced in ${path.basename(filePath)}.`,
        decision: `Define '${modelName}' as the canonical data model for this domain concept, enforcing a consistent schema across the codebase.`,
        consequences: `Consumers must adopt this interface. Future migrations require updating this type and all its usages.`,
      });
    }

    const routeMatches = content.matchAll(/(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g);
    for (const match of routeMatches) {
      const method = match[1].toUpperCase();
      const endpoint = match[2];
      decisions.push({
        title: `API contract change: ${method} ${endpoint}`,
        context: `A new route '${method} ${endpoint}' was added in ${path.basename(filePath)}.`,
        decision: `Expose '${method} ${endpoint}' as a stable API endpoint for clients to consume.`,
        consequences: `This endpoint becomes part of the public contract. Breaking changes require versioning or deprecation notices.`,
      });
    }

    const basename = path.basename(filePath);
    if (basename === 'index.ts' || basename === 'index.js') {
      const moduleName = path.basename(path.dirname(filePath));
      if (moduleName && moduleName !== '.' && moduleName !== 'src') {
        decisions.push({
          title: `New module: ${moduleName}`,
          context: `A new module entry point was created at ${filePath}, establishing '${moduleName}' as an independent module.`,
          decision: `Structure '${moduleName}' as a dedicated module with its own public API surface via index.ts.`,
          consequences: `Other modules should import from this module's public API rather than reaching into internal files.`,
        });
      }
    }
  }

  return decisions;
}
