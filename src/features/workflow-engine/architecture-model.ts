import * as path from 'path';
import * as fs from 'fs-extra';
import type { WorkspaceScanResult, DirectoryNode } from './brownfield-scanner.js';
import type { DesignSystemInfo } from './design-system-detection.js';

export interface ComponentEntry {
  name: string;
  path: string;
  description: string;
  type: 'module' | 'service' | 'package';
  fileCount: number;
}

export interface DataModelEntry {
  name: string;
  path: string;
  fields: Array<{ name: string; type: string }>;
  exported: boolean;
}

export interface ApiEntry {
  name: string;
  path: string;
  signature: string;
  exported: boolean;
  description: string;
}

export interface ArchDependencyEdge {
  source: string;
  target: string;
  type: 'import' | 'runtime' | 'dev';
}

export interface PatternEntry {
  name: string;
  description: string;
  locations: string[];
}

export interface TechStackEntry {
  category: 'language' | 'framework' | 'tool' | 'test';
  name: string;
  version?: string;
}

export interface ProjectArchitecture {
  schemaVersion: string;
  generatedAt: string;
  updatedAt: string;
  componentInventory: ComponentEntry[];
  dataModels: DataModelEntry[];
  apiSurface: ApiEntry[];
  dependencyGraph: ArchDependencyEdge[];
  designPatterns: PatternEntry[];
  technologyStack: TechStackEntry[];
  designSystem?: DesignSystemInfo;
}

const SCHEMA_VERSION = '1.0';
const ARCHITECTURE_FILE = '.olympus/project-architecture.json';
const MAX_CONTEXT_CHARS = 2000;

function extractDataModels(filePath: string, content: string): DataModelEntry[] {
  const models: DataModelEntry[] = [];
  const interfaceRegex = /export\s+interface\s+(\w+)\s*(?:<[^{]*>)?\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = interfaceRegex.exec(content)) !== null) {
    models.push({ name: match[1], path: filePath, fields: extractFields(match[2]), exported: true });
  }
  const typeRegex = /export\s+type\s+(\w+)\s*(?:<[^=]*>)?\s*=\s*\{([^}]*)\}/g;
  while ((match = typeRegex.exec(content)) !== null) {
    models.push({ name: match[1], path: filePath, fields: extractFields(match[2]), exported: true });
  }
  return models;
}

function extractFields(body: string): Array<{ name: string; type: string }> {
  const fields: Array<{ name: string; type: string }> = [];
  const fieldRegex = /(\w+)\??:\s*([^;,\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRegex.exec(body)) !== null) {
    fields.push({ name: m[1].trim(), type: m[2].trim() });
  }
  return fields;
}

function extractApiEntries(filePath: string, content: string): ApiEntry[] {
  const entries: ApiEntry[] = [];
  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*(<[^(]*)?\(([^)]*)\)\s*(?::\s*([^\n{]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(content)) !== null) {
    const name = match[1];
    const params = match[3] ? match[3].trim() : '';
    const returnType = match[4] ? match[4].trim() : 'void';
    const isAsync = /export\s+async\s+function/.test(match[0]);
    const signature = `${isAsync ? 'async ' : ''}function ${name}(${params}): ${returnType}`;
    entries.push({ name, path: filePath, signature, exported: true, description: '' });
  }
  return entries;
}

function directoryNodeToComponent(node: DirectoryNode): ComponentEntry {
  let type: ComponentEntry['type'] = 'module';
  if (node.name === 'services' || node.name.endsWith('-service')) {
    type = 'service';
  } else if (node.name === 'packages' || node.children.length > 3) {
    type = 'package';
  }
  return {
    name: node.name,
    path: node.path,
    description: `${node.name} module (${node.fileCount} files)`,
    type,
    fileCount: node.fileCount,
  };
}

function aggregateToArchDependencyEdges(
  importGraph: WorkspaceScanResult['importGraph']
): ArchDependencyEdge[] {
  const edgeSet = new Set<string>();
  const edges: ArchDependencyEdge[] = [];
  for (const edge of importGraph) {
    const srcModule = getModuleName(edge.sourceFile);
    const targetModule = getModuleName(edge.importedModule);
    if (!srcModule || !targetModule || srcModule === targetModule) continue;
    const key = `${srcModule}→${targetModule}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      const type: ArchDependencyEdge['type'] =
        targetModule.includes('test') || targetModule.includes('spec') ? 'dev' : 'import';
      edges.push({ source: srcModule, target: targetModule, type });
    }
  }
  return edges;
}

function getModuleName(filePath: string): string {
  const normalised = filePath.replace(/\\/g, '/');
  const parts = normalised.split('/').filter(Boolean);
  const meaningful = parts.filter(p => p !== '.' && p !== '..');
  if (meaningful.length === 0) return '';
  if (meaningful[0] === 'src' && meaningful.length > 1) return meaningful[1];
  return meaningful[0];
}

function collectDirNames(nodes: DirectoryNode[]): string[] {
  const names: string[] = [];
  for (const node of nodes) {
    names.push(node.name);
    names.push(...collectDirNames(node.children));
  }
  return names;
}

function collectDirPaths(nodes: DirectoryNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    paths.push(node.path);
    paths.push(...collectDirPaths(node.children));
  }
  return paths;
}

function detectDesignPatterns(
  directoryTree: DirectoryNode[],
  sourceFiles: number
): PatternEntry[] {
  const patterns: PatternEntry[] = [];
  const allDirNames = collectDirNames(directoryTree);
  const allPaths = collectDirPaths(directoryTree);

  if (allDirNames.some(n => n === 'hooks' || n.endsWith('-hook') || n.endsWith('-hooks'))) {
    patterns.push({
      name: 'Hook Pattern',
      description: 'Functions/modules registered as hooks for lifecycle events.',
      locations: allPaths.filter(p => p.includes('hooks')).slice(0, 5),
    });
  }

  if (allDirNames.some(n => n === 'middleware' || n === 'middlewares')) {
    patterns.push({
      name: 'Middleware Chain',
      description: 'Layered middleware processing pipeline.',
      locations: allPaths.filter(p => p.includes('middleware')).slice(0, 5),
    });
  }

  if (allDirNames.some(n => n === 'factories' || n === 'factory')) {
    patterns.push({
      name: 'Factory Pattern',
      description: 'Factory functions or classes for object creation.',
      locations: allPaths.filter(p => p.includes('factor')).slice(0, 5),
    });
  }

  if (allDirNames.some(n => n === 'plugins' || n === 'registry' || n === 'registries')) {
    patterns.push({
      name: 'Registry / Plugin Pattern',
      description: 'Central registry enabling pluggable extension points.',
      locations: allPaths.filter(p => p.includes('plugin') || p.includes('registr')).slice(0, 5),
    });
  }

  if (sourceFiles > 50) {
    patterns.push({
      name: 'Modular Architecture',
      description: 'Code organized into distinct feature modules with clear boundaries.',
      locations: directoryTree.slice(0, 3).map(n => n.path),
    });
  }

  return patterns;
}

async function deriveTechnologyStack(
  projectPath: string,
  languageDistribution: Record<string, number>,
  configFiles: string[]
): Promise<TechStackEntry[]> {
  const stack: TechStackEntry[] = [];

  const langMap: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript (React)',
    '.js': 'JavaScript', '.jsx': 'JavaScript (React)',
    '.py': 'Python', '.go': 'Go', '.rs': 'Rust',
    '.java': 'Java', '.cs': 'C#', '.rb': 'Ruby',
    '.swift': 'Swift', '.kt': 'Kotlin',
  };
  for (const [ext, count] of Object.entries(languageDistribution)) {
    if (count > 0 && langMap[ext]) {
      stack.push({ category: 'language', name: langMap[ext] });
    }
  }

  if (configFiles.some(f => f.endsWith('package.json'))) {
    try {
      const raw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

      const frameworkMap: Record<string, string> = {
        react: 'React', vue: 'Vue.js', '@angular/core': 'Angular',
        svelte: 'Svelte', express: 'Express', fastify: 'Fastify',
        next: 'Next.js', nuxt: 'Nuxt.js',
      };
      for (const [dep, name] of Object.entries(frameworkMap)) {
        if (deps[dep]) stack.push({ category: 'framework', name, version: deps[dep] });
      }

      const testMap: Record<string, string> = {
        vitest: 'Vitest', jest: 'Jest', mocha: 'Mocha', pytest: 'Pytest',
      };
      for (const [dep, name] of Object.entries(testMap)) {
        if (deps[dep]) stack.push({ category: 'test', name, version: deps[dep] });
      }

      const toolMap: Record<string, string> = {
        typescript: 'TypeScript Compiler', esbuild: 'esbuild',
        webpack: 'Webpack', vite: 'Vite', rollup: 'Rollup', turbo: 'Turborepo',
      };
      for (const [dep, name] of Object.entries(toolMap)) {
        if (deps[dep]) stack.push({ category: 'tool', name, version: deps[dep] });
      }
    } catch {
      // package.json not readable
    }
  }

  if (configFiles.some(f => f.endsWith('Cargo.toml'))) {
    stack.push({ category: 'tool', name: 'Cargo' });
  }
  if (configFiles.some(f => f.endsWith('go.mod'))) {
    stack.push({ category: 'tool', name: 'Go Modules' });
  }

  return stack;
}

async function scanSourceFilesForModelsAndApi(
  projectPath: string,
  scanResult: WorkspaceScanResult
): Promise<{ dataModels: DataModelEntry[]; apiSurface: ApiEntry[] }> {
  const dataModels: DataModelEntry[] = [];
  const apiSurface: ApiEntry[] = [];

  const candidateSet = new Set<string>();
  for (const ep of scanResult.entryPoints) candidateSet.add(ep);
  for (const files of Object.values(scanResult.largestFilesByDirectory)) {
    for (const f of files) candidateSet.add(f);
  }

  const candidates = [...candidateSet]
    .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
    .slice(0, 20);

  for (const relPath of candidates) {
    const absPath = path.isAbsolute(relPath) ? relPath : path.join(projectPath, relPath);
    try {
      const content = await fs.readFile(absPath, 'utf-8');
      dataModels.push(...extractDataModels(relPath, content));
      apiSurface.push(...extractApiEntries(relPath, content));
    } catch {
      // unreadable file
    }
  }

  return { dataModels, apiSurface };
}

export async function initializeGreenfieldArchitectureModel(
  projectPath: string,
  projectName: string,
  technologyStack?: TechStackEntry[],
  designSystem?: DesignSystemInfo
): Promise<ProjectArchitecture> {
  const now = new Date().toISOString();

  const model: ProjectArchitecture = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now,
    updatedAt: now,
    componentInventory: [],
    dataModels: [],
    apiSurface: [],
    dependencyGraph: [],
    designPatterns: [],
    technologyStack: technologyStack ?? [],
    designSystem,
  };

  await saveArchitectureModel(projectPath, model);
  return model;
}

export async function generateArchitectureModel(
  projectPath: string,
  scanResult: WorkspaceScanResult,
  designSystem?: DesignSystemInfo
): Promise<ProjectArchitecture> {
  const now = new Date().toISOString();

  const componentInventory = scanResult.directoryTree.map(directoryNodeToComponent);
  const dependencyGraph = aggregateToArchDependencyEdges(scanResult.importGraph);
  const technologyStack = await deriveTechnologyStack(
    projectPath,
    scanResult.languageDistribution,
    scanResult.configFiles
  );
  const designPatterns = detectDesignPatterns(scanResult.directoryTree, scanResult.sourceFiles);
  const { dataModels, apiSurface } = await scanSourceFilesForModelsAndApi(projectPath, scanResult);

  if (scanResult.agentsMdEntries && scanResult.agentsMdEntries.length > 0) {
    for (const entry of scanResult.agentsMdEntries) {
      for (const pair of entry.pathDescriptionPairs) {
        const match = componentInventory.find(c =>
          pair.path.startsWith(c.path) || c.path.includes(pair.path)
        );
        if (match && pair.description) {
          match.description = pair.description;
        }
        const dirPath = path.dirname(pair.path);
        if (dirPath !== '.' && !componentInventory.some(c => c.path === dirPath)) {
          componentInventory.push({
            name: path.basename(dirPath),
            path: dirPath,
            description: pair.description || `Key file from AGENTS.md`,
            type: 'module',
            fileCount: 1,
          });
        }
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now,
    updatedAt: now,
    componentInventory,
    dataModels,
    apiSurface,
    dependencyGraph,
    designPatterns,
    technologyStack,
    designSystem,
  };
}

export async function saveArchitectureModel(
  projectPath: string,
  model: ProjectArchitecture
): Promise<void> {
  await fs.ensureDir(path.join(projectPath, '.olympus'));
  await fs.writeFile(
    path.join(projectPath, ARCHITECTURE_FILE),
    JSON.stringify(model, null, 2),
    'utf-8'
  );
}

export async function loadArchitectureModel(
  projectPath: string
): Promise<ProjectArchitecture | null> {
  try {
    const raw = await fs.readFile(path.join(projectPath, ARCHITECTURE_FILE), 'utf-8');
    return JSON.parse(raw) as ProjectArchitecture;
  } catch {
    return null;
  }
}

export async function updateArchitectureModel(
  projectPath: string,
  affectedPaths: string[]
): Promise<ProjectArchitecture | null> {
  const existing = await loadArchitectureModel(projectPath);
  if (!existing) return null;

  const updatedDataModels: DataModelEntry[] = [];
  const updatedApiSurface: ApiEntry[] = [];

  for (const relPath of affectedPaths) {
    const absPath = path.isAbsolute(relPath) ? relPath : path.join(projectPath, relPath);
    try {
      const content = await fs.readFile(absPath, 'utf-8');
      updatedDataModels.push(...extractDataModels(relPath, content));
      updatedApiSurface.push(...extractApiEntries(relPath, content));
    } catch {
      // unreadable file
    }
  }

  const affectedSet = new Set(affectedPaths);
  const updated: ProjectArchitecture = {
    ...existing,
    updatedAt: new Date().toISOString(),
    dataModels: [
      ...existing.dataModels.filter(m => !affectedSet.has(m.path)),
      ...updatedDataModels,
    ],
    apiSurface: [
      ...existing.apiSurface.filter(a => !affectedSet.has(a.path)),
      ...updatedApiSurface,
    ],
  };

  await saveArchitectureModel(projectPath, updated);
  return updated;
}

export async function getArchitectureContext(
  projectPath: string,
  touchedComponents: string[]
): Promise<string> {
  const model = await loadArchitectureModel(projectPath);
  if (!model || touchedComponents.length === 0) return '';

  const touchedSet = new Set(touchedComponents.map(c => c.toLowerCase()));
  const depTargets = new Set<string>();
  for (const edge of model.dependencyGraph) {
    if (touchedSet.has(edge.source.toLowerCase())) {
      depTargets.add(edge.target.toLowerCase());
    }
  }
  const relevantNames = new Set([...touchedSet, ...depTargets]);

  const relevantComponents = model.componentInventory.filter(c =>
    relevantNames.has(c.name.toLowerCase())
  );
  const relevantApi = model.apiSurface.filter(a =>
    relevantNames.has(getModuleName(a.path).toLowerCase())
  );
  const relevantModels = model.dataModels.filter(m =>
    relevantNames.has(getModuleName(m.path).toLowerCase())
  );
  const relevantEdges = model.dependencyGraph.filter(
    e => relevantNames.has(e.source.toLowerCase())
  );

  const lines: string[] = ['## Architecture Context', ''];

  if (relevantComponents.length > 0) {
    lines.push('### Components');
    for (const c of relevantComponents) {
      lines.push(`- **${c.name}** (${c.type}, ${c.fileCount} files): ${c.description}`);
    }
    lines.push('');
  }

  if (relevantApi.length > 0) {
    lines.push('### API Surface');
    for (const a of relevantApi.slice(0, 10)) {
      lines.push(`- \`${a.signature}\` in \`${a.path}\``);
    }
    lines.push('');
  }

  if (relevantModels.length > 0) {
    lines.push('### Data Models');
    for (const m of relevantModels.slice(0, 10)) {
      const fieldSummary = m.fields.slice(0, 3).map(f => `${f.name}: ${f.type}`).join(', ');
      lines.push(`- **${m.name}**: { ${fieldSummary}${m.fields.length > 3 ? ', ...' : ''} }`);
    }
    lines.push('');
  }

  if (relevantEdges.length > 0) {
    lines.push('### Dependencies');
    for (const e of relevantEdges.slice(0, 10)) {
      lines.push(`- ${e.source} → ${e.target} (${e.type})`);
    }
    lines.push('');
  }

  if (model.designSystem && model.designSystem.detected && model.designSystem.systems.length > 0) {
    lines.push('### Design System');
    for (const sys of model.designSystem.systems) {
      lines.push(`- **${sys.name}** (${sys.type}): ${sys.path}`);
    }
    lines.push('');
  }

  let result = lines.join('\n');
  if (result.length > MAX_CONTEXT_CHARS) {
    result = result.slice(0, MAX_CONTEXT_CHARS) + '\n...(truncated)';
  }
  return result;
}
