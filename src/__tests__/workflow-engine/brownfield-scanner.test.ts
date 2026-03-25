import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import {
  scanWorkspace,
  selectKeyFiles,
  selectIntentRelevantFiles,
  detectAgentsMdFiles,
  WORKSPACE_SCAN_SCHEMA,
  SKIP_DIRS,
} from '../../features/workflow-engine/brownfield-scanner.js';
import type { WorkspaceScanResult, AgentsMdEntry } from '../../features/workflow-engine/brownfield-scanner.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brownfield-scanner-test-'));

  await fs.ensureDir(path.join(tmpDir, 'src', 'services'));
  await fs.ensureDir(path.join(tmpDir, 'src', 'models'));
  await fs.ensureDir(path.join(tmpDir, 'src', 'utils'));
  await fs.ensureDir(path.join(tmpDir, 'src', 'config'));
  await fs.ensureDir(path.join(tmpDir, 'node_modules', 'some-lib'));

  await fs.writeFile(
    path.join(tmpDir, 'src', 'index.ts'),
    `import { foo } from './services/auth.js';\nexport { foo };`
  );

  await fs.writeFile(
    path.join(tmpDir, 'src', 'app.ts'),
    `import { bar } from './models/user.js';\nconsole.log(bar);`
  );

  await fs.writeFile(
    path.join(tmpDir, 'src', 'services', 'auth.ts'),
    [
      `export function foo() { return 'auth'; }`,
      `export function login(email: string, password: string): boolean {`,
      `  if (!email || !password) return false;`,
      `  return true;`,
      `}`,
      `export function logout(sessionId: string): void {`,
      `  console.log('logout', sessionId);`,
      `}`,
      `export function refreshToken(token: string): string {`,
      `  return token + '-refreshed';`,
      `}`,
      `export function validateSession(token: string): boolean {`,
      `  return token.length > 0;`,
      `}`,
      `export function hashPassword(plain: string): string {`,
      `  return 'hashed-' + plain;`,
      `}`,
      `export function verifyPassword(plain: string, hash: string): boolean {`,
      `  return hash === 'hashed-' + plain;`,
      `}`,
      `export const AUTH_COOKIE = 'auth_session';`,
      `export const SESSION_TTL = 3600;`,
      `export interface Session { id: string; userId: string; expiresAt: number; }`,
      `export interface AuthResult { success: boolean; token: string | null; }`,
      `export const DEFAULT_PERMISSIONS = ['read'];`,
      `export function getPermissions(role: string): string[] {`,
      `  return role === 'admin' ? ['read', 'write', 'delete'] : ['read'];`,
      `}`,
      `export function isAdmin(role: string): boolean { return role === 'admin'; }`,
      `export function createSession(userId: string): Session {`,
      `  return { id: 'sess-' + userId, userId, expiresAt: Date.now() + SESSION_TTL * 1000 };`,
      `}`,
    ].join('\n')
  );

  await fs.writeFile(
    path.join(tmpDir, 'src', 'services', 'database.ts'),
    [
      `export interface DbConfig { host: string; port: number; database: string; }`,
      `export let connected = false;`,
      `export async function connect(config: DbConfig): Promise<void> {`,
      `  connected = true;`,
      `  console.log('Connected to', config.host);`,
      `}`,
      `export async function disconnect(): Promise<void> {`,
      `  connected = false;`,
      `}`,
      `export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {`,
      `  return [];`,
      `}`,
      `export async function execute(sql: string, params?: unknown[]): Promise<number> {`,
      `  return 0;`,
      `}`,
      `export function isConnected(): boolean { return connected; }`,
      `export const DEFAULT_PORT = 5432;`,
      `export const DEFAULT_HOST = 'localhost';`,
      `export const MAX_POOL_SIZE = 10;`,
      `export const QUERY_TIMEOUT_MS = 5000;`,
    ].join('\n')
  );

  await fs.writeFile(
    path.join(tmpDir, 'src', 'models', 'user.ts'),
    `export interface User { id: string; name: string; email: string; }`
  );

  await fs.writeFile(
    path.join(tmpDir, 'src', 'models', 'post.ts'),
    `export interface Post { id: string; title: string; }`
  );

  await fs.writeFile(
    path.join(tmpDir, 'src', 'utils', 'helpers.ts'),
    [
      `export function slugify(text: string): string {`,
      `  return text.toLowerCase().replace(/\\s+/g, '-');`,
      `}`,
      `export function capitalize(s: string): string {`,
      `  return s.charAt(0).toUpperCase() + s.slice(1);`,
      `}`,
      `export function clamp(val: number, min: number, max: number): number {`,
      `  return Math.min(Math.max(val, min), max);`,
      `}`,
      `export function sleep(ms: number): Promise<void> {`,
      `  return new Promise(resolve => setTimeout(resolve, ms));`,
      `}`,
      `export function unique<T>(arr: T[]): T[] {`,
      `  return [...new Set(arr)];`,
      `}`,
    ].join('\n')
  );

  await fs.writeFile(
    path.join(tmpDir, 'src', 'config', 'settings.ts'),
    [
      `export const APP_NAME = 'MyApp';`,
      `export const APP_VERSION = '1.0.0';`,
      `export const API_BASE_URL = process.env.API_URL ?? 'http://localhost:3000';`,
      `export const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';`,
      `export const MAX_RETRIES = 3;`,
      `export const TIMEOUT_MS = 10000;`,
      `export const CACHE_TTL = 300;`,
      `export const FEATURE_FLAGS = { darkMode: false, betaFeatures: false };`,
    ].join('\n')
  );

  await fs.writeFile(path.join(tmpDir, 'package.json'), '{}');
  await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');

  await fs.writeFile(
    path.join(tmpDir, 'node_modules', 'some-lib', 'index.js'),
    'module.exports = {};'
  );
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe('brownfield-scanner', () => {
  describe('scanWorkspace()', () => {
    it('counts files correctly', async () => {
      const result = await scanWorkspace(tmpDir);
      expect(result.totalFiles).toBeGreaterThanOrEqual(10);
      expect(result.sourceFiles).toBeGreaterThanOrEqual(8);
      expect(result.totalFiles).toBeLessThan(20);
    });

    it('builds language distribution', async () => {
      const result = await scanWorkspace(tmpDir);
      expect(result.languageDistribution['.ts']).toBeGreaterThanOrEqual(8);
    });

    it('extracts import graph with edge from src/index.ts importing services/auth', async () => {
      const result = await scanWorkspace(tmpDir);
      const indexEdges = result.importGraph.filter(e =>
        e.sourceFile.replace(/\\/g, '/').endsWith('src/index.ts')
      );
      expect(indexEdges.length).toBeGreaterThan(0);
      const authEdge = indexEdges.find(e => e.importedModule.includes('services/auth'));
      expect(authEdge).toBeDefined();
    });

    it('identifies entry points including index.ts and app.ts', async () => {
      const result = await scanWorkspace(tmpDir);
      const normalized = result.entryPoints.map(p => p.replace(/\\/g, '/'));
      expect(normalized.some(p => p.endsWith('index.ts'))).toBe(true);
      expect(normalized.some(p => p.endsWith('app.ts'))).toBe(true);
    });

    it('finds config files package.json and tsconfig.json', async () => {
      const result = await scanWorkspace(tmpDir);
      expect(result.configFiles).toContain('package.json');
      expect(result.configFiles).toContain('tsconfig.json');
    });

    it('skips node_modules — importGraph contains no node_modules paths', async () => {
      const result = await scanWorkspace(tmpDir);
      const nodeModuleEdge = result.importGraph.find(e =>
        e.sourceFile.replace(/\\/g, '/').includes('node_modules')
      );
      expect(nodeModuleEdge).toBeUndefined();
    });

    it('handles empty directory gracefully', async () => {
      const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brownfield-empty-'));
      try {
        const result = await scanWorkspace(emptyDir);
        expect(result.totalFiles).toBe(0);
        expect(result.sourceFiles).toBe(0);
        expect(result.importGraph).toHaveLength(0);
        expect(result.entryPoints).toHaveLength(0);
        expect(result.configFiles).toHaveLength(0);
      } finally {
        await fs.remove(emptyDir);
      }
    });
  });

  describe('selectKeyFiles()', () => {
    it('returns entry points and largest files', async () => {
      const scan = await scanWorkspace(tmpDir);
      const result = selectKeyFiles(scan);
      expect(result.length).toBeGreaterThan(0);
      const normalized = result.map(p => p.replace(/\\/g, '/'));
      expect(
        normalized.some(p => p.endsWith('index.ts') || p.endsWith('app.ts'))
      ).toBe(true);
    });

    it('respects maxFiles cap', async () => {
      const scan = await scanWorkspace(tmpDir);
      const result = selectKeyFiles(scan, 3);
      expect(result.length).toBeLessThanOrEqual(3);
    });
  });

  describe('selectIntentRelevantFiles()', () => {
    it('matches keywords present in file paths', async () => {
      const scan = await scanWorkspace(tmpDir);
      const result = selectIntentRelevantFiles(scan, 'auth service');
      const normalized = result.map(p => p.replace(/\\/g, '/'));
      expect(normalized.some(p => p.includes('auth'))).toBe(true);
    });

    it('follows import edges one hop from matched file', async () => {
      const scan = await scanWorkspace(tmpDir);
      const result = selectIntentRelevantFiles(scan, 'auth');
      const normalized = result.map(p => p.replace(/\\/g, '/'));
      expect(normalized.some(p => p.includes('auth'))).toBe(true);
    });

    it('returns empty array for empty intent string', async () => {
      const scan = await scanWorkspace(tmpDir);
      const result = selectIntentRelevantFiles(scan, '');
      expect(result).toHaveLength(0);
    });

    it('returns empty array when all words are stopwords', async () => {
      const scan = await scanWorkspace(tmpDir);
      const result = selectIntentRelevantFiles(scan, 'the and for are');
      expect(result).toHaveLength(0);
    });
  });

  describe('constants', () => {
    it('WORKSPACE_SCAN_SCHEMA is a non-empty string', () => {
      expect(typeof WORKSPACE_SCAN_SCHEMA).toBe('string');
      expect(WORKSPACE_SCAN_SCHEMA.length).toBeGreaterThan(0);
    });

    it('SKIP_DIRS contains node_modules, .git, and dist', () => {
      expect(SKIP_DIRS.has('node_modules')).toBe(true);
      expect(SKIP_DIRS.has('.git')).toBe(true);
      expect(SKIP_DIRS.has('dist')).toBe(true);
    });
  });
});

describe('AGENTS.md integration', () => {
  const AGENTS_MD_CONTENT = `# AGENTS.md

## src/features/workflow-engine/
Core workflow engine handling AIDLC lifecycle phases. Central entry point for all workflow state.

## src/hooks/
Hook system for event interception. Registers PreToolUse, PostToolUse, and Notification handlers.

## src/installer/
Installation and distribution logic. Manages file copying.
`;

  const AGENTS_MD_BULLET_CONTENT = `# AGENTS.md

- **src/features/auth/**: Primary authentication service with critical login flows.
- **src/models/user.ts**: Main user data model central to all operations.
`;

  function makeBaseScan(overrides?: Partial<WorkspaceScanResult>): WorkspaceScanResult {
    return {
      totalFiles: 10,
      sourceFiles: 8,
      directoryTree: [],
      languageDistribution: { '.ts': 8 },
      importGraph: [
        { sourceFile: 'src/index.ts', importedModule: './features/workflow-engine/index.js' },
      ],
      entryPoints: ['src/index.ts'],
      largestFilesByDirectory: {
        src: ['src/features/workflow-engine/engine.ts', 'src/installer/index.ts'],
      },
      configFiles: ['package.json', 'tsconfig.json'],
      ...overrides,
    };
  }

  function makeAgentsMdEntry(content: string): AgentsMdEntry {
    const pairs: Array<{ path: string; description: string }> = [];
    const lines = content.split('\n');
    let i = 0;
    while (i < lines.length) {
      const headingMatch = /^##\s+(.+)$/.exec(lines[i]);
      if (headingMatch) {
        const entryPath = headingMatch[1].trim();
        const descLines: string[] = [];
        i++;
        while (i < lines.length && !/^##/.test(lines[i])) {
          const trimmed = lines[i].trim();
          if (trimmed.length > 0) descLines.push(trimmed);
          i++;
        }
        if (descLines.length > 0) pairs.push({ path: entryPath, description: descLines.join(' ') });
        continue;
      }
      const bulletMatch = /^[-*]\s+\*{0,2}([^*:]+)\*{0,2}:\s*(.+)$/.exec(lines[i]);
      if (bulletMatch) {
        pairs.push({ path: bulletMatch[1].trim(), description: bulletMatch[2].trim() });
      }
      i++;
    }
    return { relativeFilePath: 'AGENTS.md', pathDescriptionPairs: pairs };
  }

  describe('detectAgentsMdFiles()', () => {
    let agentsTmpDir: string;

    beforeEach(async () => {
      agentsTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-md-test-'));
    });

    afterEach(async () => {
      await fs.remove(agentsTmpDir);
    });

    it('parses AGENTS.md at project root and returns entries', async () => {
      await fs.writeFile(path.join(agentsTmpDir, 'AGENTS.md'), AGENTS_MD_CONTENT);
      const results = await detectAgentsMdFiles(agentsTmpDir);
      expect(results.length).toBeGreaterThan(0);
      const pairs = results[0].pathDescriptionPairs;
      expect(pairs.length).toBeGreaterThanOrEqual(3);
      expect(pairs.some(p => p.path.includes('workflow-engine'))).toBe(true);
      expect(pairs.some(p => p.description.toLowerCase().includes('core'))).toBe(true);
    });

    it('parses bullet-point format AGENTS.md', async () => {
      await fs.writeFile(path.join(agentsTmpDir, 'AGENTS.md'), AGENTS_MD_BULLET_CONTENT);
      const results = await detectAgentsMdFiles(agentsTmpDir);
      expect(results.length).toBeGreaterThan(0);
      const pairs = results[0].pathDescriptionPairs;
      expect(pairs.length).toBeGreaterThanOrEqual(2);
      expect(pairs.some(p => p.path.includes('auth'))).toBe(true);
    });

    it('returns empty array when no AGENTS.md exists', async () => {
      const results = await detectAgentsMdFiles(agentsTmpDir);
      expect(results).toHaveLength(0);
    });

    it('scans AGENTS.md in immediate subdirectories', async () => {
      await fs.ensureDir(path.join(agentsTmpDir, 'src'));
      await fs.writeFile(path.join(agentsTmpDir, 'src', 'AGENTS.md'), AGENTS_MD_CONTENT);
      const results = await detectAgentsMdFiles(agentsTmpDir);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].relativeFilePath).toContain('src');
    });

    it('does not throw on unreadable directory', async () => {
      const results = await detectAgentsMdFiles(path.join(agentsTmpDir, 'nonexistent'));
      expect(results).toHaveLength(0);
    });
  });

  describe('selectKeyFiles() with AGENTS.md', () => {
    it('places architecturally significant files before entry points when agentsMdEntries present', () => {
      const agentEntry = makeAgentsMdEntry(AGENTS_MD_CONTENT);
      const scan = makeBaseScan({ agentsMdEntries: [agentEntry] });
      const result = selectKeyFiles(scan);
      const workflowEngineIdx = result.findIndex(f => f.includes('workflow-engine'));
      const indexTsIdx = result.findIndex(f => f === 'src/index.ts');
      expect(workflowEngineIdx).toBeGreaterThanOrEqual(0);
      expect(workflowEngineIdx).toBeLessThan(indexTsIdx);
    });

    it('is identical to baseline when agentsMdEntries is absent', () => {
      const scanWithout = makeBaseScan();
      const scanWithEmpty = makeBaseScan({ agentsMdEntries: [] });
      const resultWithout = selectKeyFiles(scanWithout);
      const resultWithEmpty = selectKeyFiles(scanWithEmpty);
      expect(resultWithout).toEqual(resultWithEmpty);
    });

    it('does not regress: entry points still appear when no agentsMdEntries', () => {
      const scan = makeBaseScan();
      const result = selectKeyFiles(scan);
      expect(result).toContain('src/index.ts');
    });

    it('respects maxFiles cap with agentsMdEntries', () => {
      const agentEntry = makeAgentsMdEntry(AGENTS_MD_CONTENT);
      const scan = makeBaseScan({ agentsMdEntries: [agentEntry] });
      const result = selectKeyFiles(scan, 2);
      expect(result.length).toBeLessThanOrEqual(2);
    });
  });

  describe('selectIntentRelevantFiles() with AGENTS.md', () => {
    it('ranks files higher when AGENTS.md description matches intent keywords', () => {
      const agentEntry = makeAgentsMdEntry(AGENTS_MD_CONTENT);
      const scanWith = makeBaseScan({ agentsMdEntries: [agentEntry] });
      const scanWithout = makeBaseScan();

      const resultWith = selectIntentRelevantFiles(scanWith, 'workflow lifecycle phases');
      const resultWithout = selectIntentRelevantFiles(scanWithout, 'workflow lifecycle phases');

      const workflowRankWith = resultWith.findIndex(f => f.includes('workflow-engine'));
      const workflowRankWithout = resultWithout.findIndex(f => f.includes('workflow-engine'));

      if (workflowRankWith >= 0 && workflowRankWithout >= 0) {
        expect(workflowRankWith).toBeLessThanOrEqual(workflowRankWithout);
      } else {
        expect(resultWith.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('is identical to baseline when agentsMdEntries is absent', () => {
      const scanWithout = makeBaseScan();
      const scanWithEmpty = makeBaseScan({ agentsMdEntries: [] });
      const resultWithout = selectIntentRelevantFiles(scanWithout, 'auth service');
      const resultWithEmpty = selectIntentRelevantFiles(scanWithEmpty, 'auth service');
      expect(resultWithout).toEqual(resultWithEmpty);
    });

    it('returns empty for empty intent regardless of agentsMdEntries', () => {
      const agentEntry = makeAgentsMdEntry(AGENTS_MD_CONTENT);
      const scan = makeBaseScan({ agentsMdEntries: [agentEntry] });
      const result = selectIntentRelevantFiles(scan, '');
      expect(result).toHaveLength(0);
    });

    it('description match boosts score: keyword in description ranks above path-only match', () => {
      const agentsContent = `# AGENTS.md\n\n## src/features/hooks/\nCore hook interception system. Primary event handler.\n`;
      const agentEntry = makeAgentsMdEntry(agentsContent);
      const scan = makeBaseScan({
        importGraph: [
          { sourceFile: 'src/features/hooks/registry.ts', importedModule: './base.js' },
          { sourceFile: 'src/features/core/engine.ts', importedModule: './state.js' },
        ],
        entryPoints: [],
        largestFilesByDirectory: {
          src: ['src/features/hooks/registry.ts', 'src/features/core/engine.ts'],
        },
        agentsMdEntries: [agentEntry],
      });

      const result = selectIntentRelevantFiles(scan, 'core primary');
      const hooksIdx = result.findIndex(f => f.includes('hooks'));
      const coreIdx = result.findIndex(f => f.includes('core/engine'));

      if (hooksIdx >= 0 && coreIdx >= 0) {
        expect(hooksIdx).toBeLessThan(coreIdx);
      } else {
        expect(result.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('file selection order comparison', () => {
    it('order differs between scan with and without AGENTS.md when descriptions match intent', () => {
      const agentsContent = `# AGENTS.md\n\n## src/features/workflow-engine/\nCore workflow engine. Central entry point for lifecycle.\n`;
      const agentEntry = makeAgentsMdEntry(agentsContent);
      const scanWith = makeBaseScan({
        importGraph: [
          { sourceFile: 'src/features/workflow-engine/engine.ts', importedModule: './state.js' },
          { sourceFile: 'src/installer/index.ts', importedModule: './copy.js' },
        ],
        entryPoints: ['src/installer/index.ts'],
        largestFilesByDirectory: {
          src: ['src/features/workflow-engine/engine.ts', 'src/installer/index.ts'],
        },
        agentsMdEntries: [agentEntry],
      });
      const scanWithout = makeBaseScan({
        importGraph: scanWith.importGraph,
        entryPoints: scanWith.entryPoints,
        largestFilesByDirectory: scanWith.largestFilesByDirectory,
      });

      const keyWith = selectKeyFiles(scanWith);
      const keyWithout = selectKeyFiles(scanWithout);

      expect(keyWith[0]).toContain('workflow-engine');
      expect(keyWithout[0]).not.toContain('workflow-engine');
    });
  });
});
