import * as path from 'path';
import * as fs from 'fs/promises';
import { readFileSync, type Dirent } from 'fs';
import { SOURCE_EXTENSIONS } from './discovery.js';

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.olympus',
  'aidlc-docs',
  '.next',
  '__pycache__',
  '.venv',
  'vendor',
  'target',
]);

const CONFIG_FILE_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'go.sum',
  'Makefile',
  'makefile',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.eslintrc.json',
  '.eslintrc.js',
  'jest.config.js',
  'jest.config.ts',
  'vite.config.ts',
  'vite.config.js',
  'webpack.config.js',
  'webpack.config.ts',
  'rollup.config.js',
  'rollup.config.ts',
  'babel.config.js',
  'babel.config.json',
  '.babelrc',
  'vitest.config.ts',
  'vitest.config.js',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'CMakeLists.txt',
  'Gemfile',
  'composer.json',
]);

const ENTRY_POINT_NAMES = new Set([
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'main.ts',
  'main.tsx',
  'main.js',
  'main.jsx',
  'app.ts',
  'app.tsx',
  'app.js',
  'app.jsx',
  'server.ts',
  'server.js',
]);

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all',
  'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day',
  'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new',
  'now', 'old', 'see', 'two', 'who', 'boy', 'did', 'she',
  'use', 'way', 'add', 'any', 'big', 'end', 'few', 'got',
  'let', 'man', 'own', 'say', 'set', 'put', 'too', 'try',
  'this', 'that', 'with', 'have', 'from', 'they', 'will',
  'been', 'each', 'into', 'many', 'more', 'must', 'need',
  'over', 'same', 'such', 'than', 'them', 'then', 'there',
  'time', 'very', 'what', 'when', 'where', 'which', 'while',
  'also', 'back', 'been', 'call', 'come', 'does', 'even',
  'find', 'give', 'good', 'here', 'just', 'know', 'like',
  'look', 'make', 'most', 'move', 'only', 'open', 'some',
  'take', 'tell', 'than', 'them', 'thing', 'think', 'those',
  'through', 'want', 'well', 'were', 'your',
]);

export interface DirectoryNode {
  name: string;
  path: string;
  fileCount: number;
  children: DirectoryNode[];
}

export interface ImportEdge {
  sourceFile: string;
  importedModule: string;
}

export interface WorkspaceScanResult {
  totalFiles: number;
  sourceFiles: number;
  directoryTree: DirectoryNode[];
  languageDistribution: Record<string, number>;
  importGraph: ImportEdge[];
  entryPoints: string[];
  largestFilesByDirectory: Record<string, string[]>;
  configFiles: string[];
}

export const WORKSPACE_SCAN_SCHEMA = `WorkspaceScanResult JSON schema:
{
  "totalFiles": number,
  "sourceFiles": number,
  "directoryTree": [{ "name": string, "path": string, "fileCount": number, "children": DirectoryNode[] }],
  "languageDistribution": { ".ts": number, ".py": number, ... },
  "importGraph": [{ "sourceFile": string, "importedModule": string }],
  "entryPoints": ["path/to/index.ts", ...],
  "largestFilesByDirectory": { "src": ["largest.ts", "second.ts", "third.ts"], ... },
  "configFiles": ["package.json", "tsconfig.json", ...]
}`;

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

/**
 * Extracts imported module paths from file content using language-specific regex patterns.
 * Regex (not AST) is intentional — keeps this module deterministic and dependency-free.
 * TS/JS: `import/export ... from 'x'`
 * Python: `import x` and `from x import`
 * Go: `import "x"` and grouped import blocks `\t"x"`
 */
function extractImports(content: string, ext: string): string[] {
  const results: string[] = [];
  let m: RegExpExecArray | null;

  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
    const importFrom = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
    while ((m = importFrom.exec(content)) !== null) results.push(m[1]);
    const exportFrom = /export\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
    while ((m = exportFrom.exec(content)) !== null) results.push(m[1]);
  } else if (ext === '.py') {
    const importSimple = /^import\s+([^\s;#]+)/gm;
    while ((m = importSimple.exec(content)) !== null) results.push(m[1]);
    const fromImport = /^from\s+([^\s;#]+)\s+import/gm;
    while ((m = fromImport.exec(content)) !== null) results.push(m[1]);
  } else if (ext === '.go') {
    const goImport = /import\s+"([^"]+)"/g;
    while ((m = goImport.exec(content)) !== null) results.push(m[1]);
    const goMulti = /^\s+"([^"]+)"/gm;
    while ((m = goMulti.exec(content)) !== null) results.push(m[1]);
  }

  return results;
}

export async function scanWorkspace(projectPath: string): Promise<WorkspaceScanResult> {
  const totalFilesCount = { value: 0 };
  const sourceFilesCount = { value: 0 };
  const languageDistribution: Record<string, number> = {};
  const importGraph: ImportEdge[] = [];
  const entryPoints: string[] = [];
  const filesByTopDir: Record<string, Array<{ file: string; lines: number }>> = {};
  const configFiles: string[] = [];

  async function walk(dirPath: string, topLevelDir: string | null): Promise<DirectoryNode> {
    const node: DirectoryNode = {
      name: path.basename(dirPath),
      path: dirPath,
      fileCount: 0,
      children: [],
    };

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true }) as Dirent[];
    } catch (error) {
      console.error(`[brownfield-scanner] Cannot read directory ${dirPath}:`, error);
      return node;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const child = await walk(fullPath, topLevelDir);
        node.fileCount += child.fileCount;
        node.children.push(child);
      } else if (entry.isFile()) {
        totalFilesCount.value += 1;
        node.fileCount += 1;

        const ext = path.extname(entry.name);
        const isSource = (SOURCE_EXTENSIONS as readonly string[]).includes(ext);

        if (isSource) {
          sourceFilesCount.value += 1;
          languageDistribution[ext] = (languageDistribution[ext] ?? 0) + 1;

          if (ENTRY_POINT_NAMES.has(entry.name)) entryPoints.push(fullPath);

          const topKey = topLevelDir ?? '(root)';
          if (!filesByTopDir[topKey]) filesByTopDir[topKey] = [];
          filesByTopDir[topKey].push({ file: fullPath, lines: countLines(fullPath) });

          try {
            const content = readFileSync(fullPath, 'utf8');
            for (const imp of extractImports(content, ext)) {
              importGraph.push({ sourceFile: fullPath, importedModule: imp });
            }
          } catch (error) {
            console.error(`[brownfield-scanner] Cannot read file ${fullPath}:`, error);
          }
        }
      }
    }

    return node;
  }

  let rootEntries: Dirent[] = [];
  try {
    rootEntries = await fs.readdir(projectPath, { withFileTypes: true }) as Dirent[];
  } catch (error) {
    console.error(`[brownfield-scanner] Cannot read project root ${projectPath}:`, error);
  }

  const directoryTree: DirectoryNode[] = [];

  for (const entry of rootEntries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(projectPath, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const child = await walk(fullPath, entry.name);
      directoryTree.push(child);
    } else if (entry.isFile()) {
      totalFilesCount.value += 1;

      const ext = path.extname(entry.name);
      const isSource = (SOURCE_EXTENSIONS as readonly string[]).includes(ext);

      if (isSource) {
        sourceFilesCount.value += 1;
        languageDistribution[ext] = (languageDistribution[ext] ?? 0) + 1;

        if (ENTRY_POINT_NAMES.has(entry.name)) entryPoints.push(fullPath);

        if (!filesByTopDir['(root)']) filesByTopDir['(root)'] = [];
        filesByTopDir['(root)'].push({ file: fullPath, lines: countLines(fullPath) });

        try {
          const content = readFileSync(fullPath, 'utf8');
          for (const imp of extractImports(content, ext)) {
            importGraph.push({ sourceFile: fullPath, importedModule: imp });
          }
        } catch (error) {
          console.error(`[brownfield-scanner] Cannot read file ${fullPath}:`, error);
        }
      }

      if (CONFIG_FILE_NAMES.has(entry.name)) configFiles.push(entry.name);
    }
  }

  const largestFilesByDirectory: Record<string, string[]> = {};
  for (const [dir, files] of Object.entries(filesByTopDir)) {
    const sorted = files.slice().sort((a, b) => b.lines - a.lines);
    largestFilesByDirectory[dir] = sorted.slice(0, 3).map(f => f.file);
  }

  return {
    totalFiles: totalFilesCount.value,
    sourceFiles: sourceFilesCount.value,
    directoryTree,
    languageDistribution,
    importGraph,
    entryPoints,
    largestFilesByDirectory,
    configFiles,
  };
}

export function selectKeyFiles(scan: WorkspaceScanResult, maxFiles = 20): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();

  function add(filePath: string): void {
    if (!seen.has(filePath)) {
      seen.add(filePath);
      selected.push(filePath);
    }
  }

  for (const ep of scan.entryPoints.slice(0, 5)) add(ep);

  const topDirs = Object.keys(scan.largestFilesByDirectory).slice(0, 10);
  for (const dir of topDirs) {
    const files = scan.largestFilesByDirectory[dir];
    if (files && files.length > 0) add(files[0]);
  }

  for (const cfg of scan.configFiles.slice(0, 5)) add(cfg);

  return selected.slice(0, maxFiles);
}

export function selectIntentRelevantFiles(
  scan: WorkspaceScanResult,
  intentText: string,
  maxFiles = 15
): string[] {
  const keywords = intentText
    .split(/\s+/)
    .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));

  if (keywords.length === 0) return [];

  const allSourceFiles = new Set<string>(scan.importGraph.map(e => e.sourceFile));
  for (const ep of scan.entryPoints) allSourceFiles.add(ep);
  for (const files of Object.values(scan.largestFilesByDirectory)) {
    for (const f of files) allSourceFiles.add(f);
  }

  const forwardMap = new Map<string, string[]>();
  for (const edge of scan.importGraph) {
    const existing = forwardMap.get(edge.sourceFile) ?? [];
    existing.push(edge.importedModule);
    forwardMap.set(edge.sourceFile, existing);
  }

  function resolveImportToFiles(importedModule: string): string[] {
    const bare = importedModule.replace(/^\.+\//, '').replace(/\.js$/, '').toLowerCase();
    if (!bare) return [];
    return Array.from(allSourceFiles).filter(f =>
      f.replace(/\\/g, '/').toLowerCase().includes(bare)
    );
  }

  const matched = new Set<string>();
  for (const file of allSourceFiles) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    if (keywords.some(kw => normalized.includes(kw))) matched.add(file);
  }

  const expanded = new Set<string>(matched);
  for (const file of matched) {
    for (const imp of forwardMap.get(file) ?? []) {
      for (const resolved of resolveImportToFiles(imp)) expanded.add(resolved);
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const f of matched) {
    if (!seen.has(f)) { seen.add(f); result.push(f); }
  }
  for (const f of expanded) {
    if (!seen.has(f)) { seen.add(f); result.push(f); }
  }

  return result.slice(0, maxFiles);
}
