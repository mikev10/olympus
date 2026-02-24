import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import {
  buildStaticModelPrompt,
  buildDynamicModelPrompt,
  parseStaticModelResponse,
  parseDynamicModelResponse,
  truncateContent,
  flattenDirectoryTree,
  STATIC_MODEL_FORMAT_INSTRUCTIONS,
  DYNAMIC_MODEL_FORMAT_INSTRUCTIONS,
} from '../../features/workflow-engine/brownfield-analysis.js';
import type {
  BrownfieldAnalysisOptions,
  StaticModel,
  DynamicModel,
} from '../../features/workflow-engine/brownfield-analysis.js';
import type { WorkspaceScanResult } from '../../features/workflow-engine/brownfield-scanner.js';

let tmpDir: string;

function makeScanResult(overrides: Partial<WorkspaceScanResult> = {}): WorkspaceScanResult {
  return {
    totalFiles: 5,
    sourceFiles: 4,
    directoryTree: [
      {
        name: 'src',
        path: '/project/src',
        fileCount: 4,
        children: [
          { name: 'services', path: '/project/src/services', fileCount: 2, children: [] },
        ],
      },
    ],
    languageDistribution: { '.ts': 4 },
    importGraph: [
      { sourceFile: '/project/src/index.ts', importedModule: './services/auth.js' },
      { sourceFile: '/project/src/app.ts', importedModule: './models/user.js' },
    ],
    entryPoints: ['/project/src/index.ts', '/project/src/app.ts'],
    largestFilesByDirectory: { src: ['/project/src/services/auth.ts'] },
    configFiles: ['package.json', 'tsconfig.json'],
    ...overrides,
  };
}

function makeOptions(overrides: Partial<BrownfieldAnalysisOptions> = {}): BrownfieldAnalysisOptions {
  return {
    projectPath: tmpDir,
    workflowId: 'wf-001',
    featureName: 'User Authentication',
    scanResult: makeScanResult(),
    keyFiles: [],
    relevantFiles: [],
    intentText: 'Add login and logout support for users',
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brownfield-analysis-test-'));

  await fs.ensureDir(path.join(tmpDir, 'src', 'services'));

  await fs.writeFile(
    path.join(tmpDir, 'src', 'services', 'auth.ts'),
    [
      `export function login(email: string): boolean { return true; }`,
      `export function logout(): void {}`,
      `export const SESSION_TTL = 3600;`,
    ].join('\n')
  );

  await fs.writeFile(
    path.join(tmpDir, 'src', 'services', 'database.ts'),
    `export async function query(sql: string): Promise<unknown[]> { return []; }`
  );
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe('brownfield-analysis', () => {
  describe('buildStaticModelPrompt()', () => {
    it('includes directory tree text', () => {
      const options = makeOptions();
      const prompt = buildStaticModelPrompt(options);
      expect(prompt).toMatch(/files\)/);
    });

    it('includes import graph edge notation', () => {
      const options = makeOptions();
      const prompt = buildStaticModelPrompt(options);
      expect(prompt).toContain('->');
    });

    it('includes file contents from key files', () => {
      const authPath = path.join(tmpDir, 'src', 'services', 'auth.ts');
      const options = makeOptions({ keyFiles: [authPath] });
      const prompt = buildStaticModelPrompt(options);
      expect(prompt).toContain('SESSION_TTL');
    });

    it('truncates large files and marks them as truncated', async () => {
      const largePath = path.join(tmpDir, 'src', 'services', 'large.ts');
      const lines = Array.from({ length: 300 }, (_, i) => `export const VAR_${i} = ${i};`);
      await fs.writeFile(largePath, lines.join('\n'));
      const options = makeOptions({ keyFiles: [largePath] });
      const prompt = buildStaticModelPrompt(options);
      expect(prompt).toContain('(truncated)');
    });
  });

  describe('buildDynamicModelPrompt()', () => {
    it('includes the provided static model text', () => {
      const staticModel = '## Modules\n| Auth | src/auth.ts | Authentication | login() |';
      const options = makeOptions();
      const prompt = buildDynamicModelPrompt(options, staticModel);
      expect(prompt).toContain(staticModel);
    });

    it('includes the feature name / intent text', () => {
      const options = makeOptions({ featureName: 'Payment Gateway', intentText: 'Process credit card payments' });
      const prompt = buildDynamicModelPrompt(options, 'static-model-content');
      expect(prompt).toContain('Payment Gateway');
      expect(prompt).toContain('Process credit card payments');
    });
  });

  describe('parseStaticModelResponse()', () => {
    const wellFormedResponse = `
## Modules
| Name | Path | Responsibility | Public Interface |
|------|------|----------------|------------------|
| Auth | src/auth.ts | Authentication | login(), logout() |
| DB | src/db.ts | Database access | query(), connect() |

## Dependency Graph
- Auth -> DB

## Data Models
| Name | Fields | Location |
|------|--------|----------|
| User | id, name, email | src/models/user.ts |

## Configuration Summary
Uses environment variables for database connection.
`;

    it('extracts modules from well-formed markdown', () => {
      const model = parseStaticModelResponse(wellFormedResponse);
      expect(model.modules.length).toBe(2);
      expect(model.modules[0].name).toBe('Auth');
      expect(model.modules[1].name).toBe('DB');
    });

    it('extracts dependency graph edges', () => {
      const model = parseStaticModelResponse(wellFormedResponse);
      expect(model.dependencyGraph.length).toBe(1);
      expect(model.dependencyGraph[0].source).toBe('Auth');
      expect(model.dependencyGraph[0].target).toBe('DB');
    });

    it('extracts data models', () => {
      const model = parseStaticModelResponse(wellFormedResponse);
      expect(model.dataModels.length).toBe(1);
      expect(model.dataModels[0].name).toBe('User');
      expect(model.dataModels[0].fields).toContain('id');
      expect(model.dataModels[0].fields).toContain('name');
      expect(model.dataModels[0].fields).toContain('email');
    });

    it('extracts config summary', () => {
      const model = parseStaticModelResponse(wellFormedResponse);
      expect(model.configSummary).toContain('environment');
    });

    it('handles malformed input without throwing', () => {
      const model = parseStaticModelResponse('garbage text with no structure');
      expect(model.modules).toHaveLength(0);
      expect(model.dependencyGraph).toHaveLength(0);
      expect(model.dataModels).toHaveLength(0);
    });
  });

  describe('parseDynamicModelResponse()', () => {
    const wellFormedResponse = `
## Use Cases
### UserLogin
Users authenticate with email and password.
1. User enters credentials
2. System validates credentials
3. System returns token

## Event Patterns
| Event | Publisher | Subscribers |
|-------|-----------|-------------|
| user.login | AuthService | AuditLog, NotificationService |

## State Management
Redux store with auth slice.

## Error Handling
Errors bubble up through middleware chain.
`;

    it('extracts use cases from well-formed markdown', () => {
      const model = parseDynamicModelResponse(wellFormedResponse);
      expect(model.useCases.length).toBe(1);
      expect(model.useCases[0].name).toBe('UserLogin');
    });

    it('extracts numbered steps from use case blocks', () => {
      const model = parseDynamicModelResponse(wellFormedResponse);
      expect(model.useCases[0].steps.length).toBe(3);
    });

    it('extracts event patterns', () => {
      const model = parseDynamicModelResponse(wellFormedResponse);
      expect(model.eventPatterns.length).toBe(1);
      expect(model.eventPatterns[0].eventName).toBe('user.login');
      expect(model.eventPatterns[0].publisher).toBe('AuthService');
      expect(model.eventPatterns[0].subscribers).toContain('AuditLog');
      expect(model.eventPatterns[0].subscribers).toContain('NotificationService');
    });

    it('extracts state management and error handling sections', () => {
      const model = parseDynamicModelResponse(wellFormedResponse);
      expect(model.stateManagement).toContain('Redux');
      expect(model.errorHandling).toContain('middleware');
    });

    it('handles malformed input without throwing', () => {
      const model = parseDynamicModelResponse('garbage text with no structure');
      expect(model.useCases).toHaveLength(0);
      expect(model.eventPatterns).toHaveLength(0);
    });
  });

  describe('truncateContent()', () => {
    it('truncates content longer than maxLines and appends truncation marker', () => {
      const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
      const content = lines.join('\n');
      const result = truncateContent(content, 10);
      const resultLines = result.split('\n');
      expect(resultLines.length).toBe(11);
      expect(result).toContain('(truncated)');
    });

    it('preserves content shorter than or equal to maxLines unchanged', () => {
      const content = ['a', 'b', 'c', 'd', 'e'].join('\n');
      const result = truncateContent(content, 10);
      expect(result).toBe(content);
    });
  });

  describe('flattenDirectoryTree()', () => {
    it('renders nodes with indentation and file count suffix', () => {
      const nodes = [
        {
          name: 'src',
          path: '/project/src',
          fileCount: 5,
          children: [
            { name: 'services', path: '/project/src/services', fileCount: 2, children: [] },
          ],
        },
      ];
      const result = flattenDirectoryTree(nodes, 0);
      expect(result).toContain('src/ (5 files)');
      expect(result).toContain('services/ (2 files)');
      const srcLine = result.split('\n').find(l => l.includes('src/ (5 files)'))!;
      const servicesLine = result.split('\n').find(l => l.includes('services/ (2 files)'))!;
      expect(servicesLine.startsWith('  ')).toBe(true);
      expect(srcLine.startsWith(' ')).toBe(false);
    });
  });

  describe('format instruction constants', () => {
    it('STATIC_MODEL_FORMAT_INSTRUCTIONS is a non-empty string', () => {
      expect(typeof STATIC_MODEL_FORMAT_INSTRUCTIONS).toBe('string');
      expect(STATIC_MODEL_FORMAT_INSTRUCTIONS.length).toBeGreaterThan(0);
    });

    it('DYNAMIC_MODEL_FORMAT_INSTRUCTIONS is a non-empty string', () => {
      expect(typeof DYNAMIC_MODEL_FORMAT_INSTRUCTIONS).toBe('string');
      expect(DYNAMIC_MODEL_FORMAT_INSTRUCTIONS.length).toBeGreaterThan(0);
    });
  });
});
