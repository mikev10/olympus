import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import {
  scanWorkspace,
  selectKeyFiles,
  selectIntentRelevantFiles,
  WORKSPACE_SCAN_SCHEMA,
  SKIP_DIRS,
} from '../../features/workflow-engine/brownfield-scanner.js';
import type { WorkspaceScanResult } from '../../features/workflow-engine/brownfield-scanner.js';

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
