import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import type { WorkspaceScanResult } from '../../features/workflow-engine/brownfield-scanner.js';
import type { DesignSystemInfo } from '../../features/workflow-engine/design-system-detection.js';
import {
  generateArchitectureModel,
  saveArchitectureModel,
  loadArchitectureModel,
  updateArchitectureModel,
  getArchitectureContext,
  initializeGreenfieldArchitectureModel,
} from '../../features/workflow-engine/architecture-model.js';
import type { ComponentEntry, ArchDependencyEdge, ProjectArchitecture } from '../../features/workflow-engine/architecture-model.js';

let tmpDir: string;

function makeScanResult(overrides: Partial<WorkspaceScanResult> = {}): WorkspaceScanResult {
  return {
    totalFiles: 10,
    sourceFiles: 8,
    directoryTree: [
      { name: 'src', path: 'src', fileCount: 5, children: [
        { name: 'hooks', path: 'src/hooks', fileCount: 2, children: [] },
      ]},
      { name: 'tests', path: 'tests', fileCount: 3, children: [] },
    ],
    languageDistribution: { '.ts': 8, '.js': 2 },
    importGraph: [
      { sourceFile: 'src/index.ts', importedModule: 'src/utils.ts' },
      { sourceFile: 'src/utils.ts', importedModule: 'src/types.ts' },
      { sourceFile: 'src/index.ts', importedModule: 'src/types.ts' },
    ],
    entryPoints: [],
    largestFilesByDirectory: {},
    configFiles: [],
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arch-model-test-'));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe('generateArchitectureModel', () => {
  it('produces all 6 sections from a fixture scan result', async () => {
    const scan = makeScanResult();
    const model = await generateArchitectureModel(tmpDir, scan);

    expect(model.schemaVersion).toBe('1.0');
    expect(model.generatedAt).toBeTruthy();
    expect(model.updatedAt).toBeTruthy();
    expect(Array.isArray(model.componentInventory)).toBe(true);
    expect(Array.isArray(model.dataModels)).toBe(true);
    expect(Array.isArray(model.apiSurface)).toBe(true);
    expect(Array.isArray(model.dependencyGraph)).toBe(true);
    expect(Array.isArray(model.designPatterns)).toBe(true);
    expect(Array.isArray(model.technologyStack)).toBe(true);
  });

  it('maps directory tree top-level nodes to component inventory', async () => {
    const scan = makeScanResult();
    const model = await generateArchitectureModel(tmpDir, scan);

    expect(model.componentInventory).toHaveLength(2);
    const names = model.componentInventory.map(c => c.name);
    expect(names).toContain('src');
    expect(names).toContain('tests');
  });

  it('preserves fileCount on each component entry', async () => {
    const scan = makeScanResult();
    const model = await generateArchitectureModel(tmpDir, scan);

    const srcComponent = model.componentInventory.find(c => c.name === 'src');
    expect(srcComponent?.fileCount).toBe(5);
  });

  it('aggregates import edges to module-level dependency graph', async () => {
    const scan = makeScanResult({
      importGraph: [
        { sourceFile: 'src/features/a.ts', importedModule: 'src/utils/b.ts' },
        { sourceFile: 'src/features/c.ts', importedModule: 'src/utils/d.ts' },
        { sourceFile: 'src/features/a.ts', importedModule: 'src/utils/b.ts' },
      ],
    });
    const model = await generateArchitectureModel(tmpDir, scan);

    const featuresEdges = model.dependencyGraph.filter(e => e.source === 'features');
    expect(featuresEdges).toHaveLength(1);
    expect(featuresEdges[0].target).toBe('utils');
  });

  it('extracts language entries from language distribution', async () => {
    const scan = makeScanResult({ languageDistribution: { '.ts': 10, '.py': 2 } });
    const model = await generateArchitectureModel(tmpDir, scan);

    const names = model.technologyStack.map(t => t.name);
    expect(names).toContain('TypeScript');
    expect(names).toContain('Python');
  });

  it('skips languages with zero count', async () => {
    const scan = makeScanResult({ languageDistribution: { '.ts': 5, '.go': 0 } });
    const model = await generateArchitectureModel(tmpDir, scan);

    const names = model.technologyStack.map(t => t.name);
    expect(names).not.toContain('Go');
  });

  it('detects hook pattern when hooks directory is present', async () => {
    const scan = makeScanResult();
    const model = await generateArchitectureModel(tmpDir, scan);

    const hookPattern = model.designPatterns.find(p => p.name === 'Hook Pattern');
    expect(hookPattern).toBeDefined();
  });

  it('does not emit patterns when no matching directories exist', async () => {
    const scan = makeScanResult({
      directoryTree: [{ name: 'lib', path: 'lib', fileCount: 3, children: [] }],
      sourceFiles: 3,
    });
    const model = await generateArchitectureModel(tmpDir, scan);

    const hookPattern = model.designPatterns.find(p => p.name === 'Hook Pattern');
    expect(hookPattern).toBeUndefined();
  });

  it('passes designSystem through to the returned model when provided', async () => {
    const designSystem: DesignSystemInfo = {
      detected: true,
      systems: [
        { name: 'Tailwind CSS', type: 'css-framework', path: 'node_modules/tailwindcss', description: 'CSS framework: Tailwind CSS' },
      ],
    };
    const scan = makeScanResult();
    const model = await generateArchitectureModel(tmpDir, scan, designSystem);

    expect(model.designSystem).toEqual(designSystem);
  });

  it('leaves designSystem undefined when not provided', async () => {
    const scan = makeScanResult();
    const model = await generateArchitectureModel(tmpDir, scan);

    expect(model.designSystem).toBeUndefined();
  });

  it('enhances component description from agentsMdEntries when path matches', async () => {
    const scan = makeScanResult({
      agentsMdEntries: [
        {
          relativeFilePath: 'AGENTS.md',
          pathDescriptionPairs: [
            { path: 'src', description: 'Main source tree for the application' },
          ],
        },
      ],
    });
    const model = await generateArchitectureModel(tmpDir, scan);

    const srcComponent = model.componentInventory.find(c => c.name === 'src');
    expect(srcComponent?.description).toBe('Main source tree for the application');
  });

  it('adds new component entries from agentsMdEntries for unmatched paths', async () => {
    const scan = makeScanResult({
      agentsMdEntries: [
        {
          relativeFilePath: 'AGENTS.md',
          pathDescriptionPairs: [
            { path: 'extra/module.ts', description: 'Extra module not in directory tree' },
          ],
        },
      ],
    });
    const model = await generateArchitectureModel(tmpDir, scan);

    const extraComponent = model.componentInventory.find(c => c.path === 'extra');
    expect(extraComponent).toBeDefined();
    expect(extraComponent?.description).toBe('Extra module not in directory tree');
  });

  it('extracts tech stack entries from package.json when present', async () => {
    const pkg = {
      dependencies: { react: '^18.0.0' },
      devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(pkg), 'utf-8');

    const scan = makeScanResult({
      languageDistribution: { '.ts': 5 },
      configFiles: ['package.json'],
    });
    const model = await generateArchitectureModel(tmpDir, scan);

    const names = model.technologyStack.map(t => t.name);
    expect(names).toContain('React');
    expect(names).toContain('Vitest');
    expect(names).toContain('TypeScript Compiler');
  });
});

describe('saveArchitectureModel + loadArchitectureModel round-trip', () => {
  it('writes and reads back an identical model', async () => {
    const scan = makeScanResult();
    const model = await generateArchitectureModel(tmpDir, scan);

    await saveArchitectureModel(tmpDir, model);
    const loaded = await loadArchitectureModel(tmpDir);

    expect(loaded).toEqual(model);
  });

  it('creates the .olympus directory if it does not exist', async () => {
    const scan = makeScanResult();
    const model = await generateArchitectureModel(tmpDir, scan);

    await saveArchitectureModel(tmpDir, model);

    const exists = await fs.pathExists(path.join(tmpDir, '.olympus'));
    expect(exists).toBe(true);
  });

  it('returns null for a missing file', async () => {
    const result = await loadArchitectureModel(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null for corrupted JSON', async () => {
    await fs.ensureDir(path.join(tmpDir, '.olympus'));
    await fs.writeFile(
      path.join(tmpDir, '.olympus/project-architecture.json'),
      'not valid json{{{',
      'utf-8'
    );

    const result = await loadArchitectureModel(tmpDir);
    expect(result).toBeNull();
  });
});

describe('updateArchitectureModel', () => {
  it('returns null when no existing model exists', async () => {
    const result = await updateArchitectureModel(tmpDir, ['src/foo.ts']);
    expect(result).toBeNull();
  });

  it('replaces data model entries for affected paths only', async () => {
    const tsContent = `export interface OldModel { id: string; }`;
    await fs.ensureDir(path.join(tmpDir, 'src'));
    await fs.writeFile(path.join(tmpDir, 'src/old.ts'), tsContent, 'utf-8');

    const scan = makeScanResult({ entryPoints: ['src/old.ts'] });
    const model = await generateArchitectureModel(tmpDir, scan);
    await saveArchitectureModel(tmpDir, model);

    const newContent = `export interface NewModel { name: string; value: number; }`;
    await fs.writeFile(path.join(tmpDir, 'src/old.ts'), newContent, 'utf-8');

    const updated = await updateArchitectureModel(tmpDir, ['src/old.ts']);
    expect(updated).not.toBeNull();
    expect(updated!.updatedAt).not.toBe(model.updatedAt);

    const newModels = updated!.dataModels.filter(m => m.path === 'src/old.ts');
    expect(newModels.some(m => m.name === 'NewModel')).toBe(true);
    expect(newModels.some(m => m.name === 'OldModel')).toBe(false);
  });

  it('preserves entries for non-affected paths', async () => {
    await fs.ensureDir(path.join(tmpDir, 'src'));
    await fs.writeFile(
      path.join(tmpDir, 'src/unchanged.ts'),
      'export interface Stable { x: number; }',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tmpDir, 'src/target.ts'),
      'export interface Target { y: string; }',
      'utf-8'
    );

    const scan = makeScanResult({ entryPoints: ['src/unchanged.ts', 'src/target.ts'] });
    const model = await generateArchitectureModel(tmpDir, scan);
    await saveArchitectureModel(tmpDir, model);

    await fs.writeFile(
      path.join(tmpDir, 'src/target.ts'),
      'export interface UpdatedTarget { z: boolean; }',
      'utf-8'
    );

    const updated = await updateArchitectureModel(tmpDir, ['src/target.ts']);
    expect(updated).not.toBeNull();

    const stableEntries = updated!.dataModels.filter(m => m.path === 'src/unchanged.ts');
    expect(stableEntries.some(m => m.name === 'Stable')).toBe(true);
  });
});

describe('getArchitectureContext', () => {
  it('returns empty string when no model exists', async () => {
    const result = await getArchitectureContext(tmpDir, ['workflow-engine']);
    expect(result).toBe('');
  });

  it('returns empty string when touchedComponents is empty', async () => {
    const scan = makeScanResult();
    const model = await generateArchitectureModel(tmpDir, scan);
    await saveArchitectureModel(tmpDir, model);

    const result = await getArchitectureContext(tmpDir, []);
    expect(result).toBe('');
  });

  it('returns only touched components and their direct dependencies', async () => {
    const scan = makeScanResult({
      directoryTree: [
        { name: 'auth', path: 'auth', fileCount: 3, children: [] },
        { name: 'db', path: 'db', fileCount: 2, children: [] },
        { name: 'cache', path: 'cache', fileCount: 1, children: [] },
      ],
      importGraph: [
        { sourceFile: 'auth/index.ts', importedModule: 'db/index.ts' },
        { sourceFile: 'cache/index.ts', importedModule: 'db/index.ts' },
      ],
    });
    const model = await generateArchitectureModel(tmpDir, scan);
    await saveArchitectureModel(tmpDir, model);

    const context = await getArchitectureContext(tmpDir, ['auth']);
    expect(context).toContain('auth');
    expect(context).toContain('db');
    expect(context).not.toContain('cache');
  });

  it('caps output at roughly 500 tokens (2000 chars)', async () => {
    const manyComponents = Array.from({ length: 100 }, (_, i) => ({
      name: `module${i}`,
      path: `src/module${i}`,
      fileCount: i + 1,
      children: [],
    }));
    const scan = makeScanResult({
      directoryTree: manyComponents,
      importGraph: manyComponents.slice(1).map((m, i) => ({
        sourceFile: `src/module0/index.ts`,
        importedModule: `src/${m.name}/index.ts`,
      })),
    });
    const model = await generateArchitectureModel(tmpDir, scan);
    await saveArchitectureModel(tmpDir, model);

    const context = await getArchitectureContext(tmpDir, ['module0']);
    expect(context.length).toBeLessThanOrEqual(2100);
  });

  it('includes the Architecture Context header when model exists with matches', async () => {
    const scan = makeScanResult({
      directoryTree: [{ name: 'src', path: 'src', fileCount: 5, children: [] }],
    });
    const model = await generateArchitectureModel(tmpDir, scan);
    await saveArchitectureModel(tmpDir, model);

    const context = await getArchitectureContext(tmpDir, ['src']);
    expect(context).toContain('## Architecture Context');
  });

  it('includes design system section when model has detected design systems', async () => {
    const designSystem: DesignSystemInfo = {
      detected: true,
      systems: [
        { name: 'Tailwind CSS', type: 'css-framework', path: 'node_modules/tailwindcss', description: 'CSS framework: Tailwind CSS' },
      ],
    };
    const scan = makeScanResult({
      directoryTree: [{ name: 'src', path: 'src', fileCount: 5, children: [] }],
    });
    const model = await generateArchitectureModel(tmpDir, scan, designSystem);
    await saveArchitectureModel(tmpDir, model);

    const context = await getArchitectureContext(tmpDir, ['src']);
    expect(context).toContain('### Design System');
    expect(context).toContain('Tailwind CSS');
    expect(context).toContain('css-framework');
  });

  it('omits design system section when designSystem is not detected', async () => {
    const designSystem: DesignSystemInfo = { detected: false, systems: [] };
    const scan = makeScanResult({
      directoryTree: [{ name: 'src', path: 'src', fileCount: 5, children: [] }],
    });
    const model = await generateArchitectureModel(tmpDir, scan, designSystem);
    await saveArchitectureModel(tmpDir, model);

    const context = await getArchitectureContext(tmpDir, ['src']);
    expect(context).not.toContain('### Design System');
  });
});

describe('architecture context for large projects (AC5)', () => {
  it('provides relevant context from a 25-component project', async () => {
    const components: ComponentEntry[] = [];
    const edges: ArchDependencyEdge[] = [];

    for (let i = 0; i < 25; i++) {
      components.push({
        name: `module-${i}`,
        path: `src/modules/module-${i}`,
        description: `Module ${i} handling feature ${i}`,
        type: 'module',
        fileCount: i + 1,
      });
    }

    for (let i = 0; i < 24; i++) {
      edges.push({
        source: `module-${i}`,
        target: `module-${i + 1}`,
        type: 'import',
      });
    }

    edges.push({ source: 'module-0', target: 'module-10', type: 'import' });
    edges.push({ source: 'module-5', target: 'module-20', type: 'import' });

    const model: ProjectArchitecture = {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      componentInventory: components,
      dataModels: [],
      apiSurface: [],
      dependencyGraph: edges,
      designPatterns: [
        { name: 'Modular Architecture', description: 'Code organized into 25 modules', locations: ['src/modules'] },
      ],
      technologyStack: [{ category: 'language', name: 'TypeScript' }],
    };

    await saveArchitectureModel(tmpDir, model);

    const context = await getArchitectureContext(tmpDir, ['module-0']);

    expect(context).toContain('module-0');
    expect(context).toContain('module-1');
    expect(context).toContain('module-10');
    expect(context).not.toContain('module-20');

    const componentMentions = (context.match(/module-\d+/g) || []);
    expect(componentMentions.length).toBeLessThan(25 * 2);
    expect(context.length).toBeLessThanOrEqual(2100);
  });

  it('includes design system in context when present', async () => {
    const model: ProjectArchitecture = {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      componentInventory: [
        { name: 'ui', path: 'src/ui', description: 'UI components', type: 'module', fileCount: 10 },
      ],
      dataModels: [],
      apiSurface: [],
      dependencyGraph: [],
      designPatterns: [],
      technologyStack: [],
      designSystem: {
        detected: true,
        systems: [
          { name: 'shadcn/ui', type: 'component-library', path: 'src/components/ui' },
          { name: 'Tailwind CSS', type: 'css-framework', path: 'tailwind.config.ts' },
        ],
      },
    };

    await saveArchitectureModel(tmpDir, model);

    const context = await getArchitectureContext(tmpDir, ['ui']);
    expect(context).toContain('Design System');
    expect(context).toContain('shadcn/ui');
    expect(context).toContain('Tailwind CSS');
  });

  it('initializes greenfield model with empty collections', async () => {
    const model = await initializeGreenfieldArchitectureModel(
      tmpDir,
      'my-new-project',
      [{ category: 'language', name: 'TypeScript' }]
    );

    expect(model.componentInventory).toEqual([]);
    expect(model.dataModels).toEqual([]);
    expect(model.technologyStack).toHaveLength(1);
    expect(model.technologyStack[0].name).toBe('TypeScript');

    const loaded = await loadArchitectureModel(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe('1.0');
    expect(loaded!.componentInventory).toEqual([]);
  });

  it('greenfield model is updated after first construction unit', async () => {
    await initializeGreenfieldArchitectureModel(tmpDir, 'my-project');

    const srcDir = path.join(tmpDir, 'src', 'auth');
    await fs.ensureDir(srcDir);
    await fs.writeFile(
      path.join(srcDir, 'auth.ts'),
      'export interface User { id: string; email: string; }\nexport async function login(email: string, password: string): Promise<User> { return { id: "1", email }; }',
      'utf-8'
    );

    const updated = await updateArchitectureModel(tmpDir, ['src/auth/auth.ts']);

    expect(updated).not.toBeNull();
    expect(updated!.dataModels.length).toBeGreaterThan(0);
    expect(updated!.dataModels.some(m => m.name === 'User')).toBe(true);
    expect(updated!.apiSurface.some(a => a.name === 'login')).toBe(true);
  });
});

describe('architecture model generation failure handling', () => {
  it('save+load cycle does not throw on a valid model', async () => {
    const scan = makeScanResult();
    const model = await generateArchitectureModel(tmpDir, scan);

    await expect(saveArchitectureModel(tmpDir, model)).resolves.not.toThrow();
    await expect(loadArchitectureModel(tmpDir)).resolves.not.toThrow();
  });

  it('loadArchitectureModel never throws even for corrupted state', async () => {
    await fs.ensureDir(path.join(tmpDir, '.olympus'));
    await fs.writeFile(
      path.join(tmpDir, '.olympus/project-architecture.json'),
      '\x00\x01\x02 garbage bytes',
      'utf-8'
    );

    await expect(loadArchitectureModel(tmpDir)).resolves.toBeNull();
  });
});
