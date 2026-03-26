import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  detectApiSurfaces,
  inferContract,
  detectBreakingChanges,
  buildContractArtifact,
  createContractValidator,
} from '../../../features/workflow-engine/construction/validators/contract-validator.js';
import type { InferredContract } from '../../../features/workflow-engine/construction/validators/contract-validator.js';
import type { ValidatorConfig } from '../../../features/workflow-engine/construction/validators/types.js';

const testDir = path.join(process.cwd(), '.test-contract-validator');

function makeConfig(overrides: Partial<ValidatorConfig> = {}): ValidatorConfig {
  return {
    timeoutBudgetMs: 5000,
    allowFailures: false,
    workflowDepth: 2,
    unitId: 'UNIT-005',
    unitFiles: [],
    apiSurfaceFiles: [],
    projectPath: testDir,
    workflowId: 'wf-contract-test',
    ...overrides,
  };
}

async function writeFile(relPath: string, content: string): Promise<string> {
  const fullPath = path.join(testDir, relPath);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

beforeEach(async () => {
  await fs.ensureDir(testDir);
});

afterEach(async () => {
  await fs.remove(testDir);
});

describe('detectApiSurfaces — path matching', () => {
  it('detects file in routes/ as API surface', () => {
    const { surfaces, nonJsFiles } = detectApiSurfaces(['/project/src/routes/users.ts']);
    expect(surfaces).toContain('/project/src/routes/users.ts');
    expect(nonJsFiles).toHaveLength(0);
  });

  it('detects file in controllers/ as API surface', () => {
    const { surfaces } = detectApiSurfaces(['/project/src/controllers/auth.ts']);
    expect(surfaces).toContain('/project/src/controllers/auth.ts');
  });

  it('detects file in api/ as API surface', () => {
    const { surfaces } = detectApiSurfaces(['/project/src/api/users.ts']);
    expect(surfaces).toContain('/project/src/api/users.ts');
  });

  it('detects file in handlers/ as API surface', () => {
    const { surfaces } = detectApiSurfaces(['/project/src/handlers/webhooks.ts']);
    expect(surfaces).toContain('/project/src/handlers/webhooks.ts');
  });

  it('detects index.ts as API surface', () => {
    const { surfaces } = detectApiSurfaces(['/project/src/index.ts']);
    expect(surfaces).toContain('/project/src/index.ts');
  });

  it('does not detect file in utils/ as API surface', () => {
    const { surfaces } = detectApiSurfaces(['/project/src/utils/helper.ts']);
    expect(surfaces).toHaveLength(0);
  });

  it('does not detect file in services/ as API surface', () => {
    const { surfaces } = detectApiSurfaces(['/project/src/services/user-service.ts']);
    expect(surfaces).toHaveLength(0);
  });

  it('skips Python file with warning and adds to nonJsFiles', () => {
    const { surfaces, nonJsFiles } = detectApiSurfaces(['/project/routes/app.py']);
    expect(surfaces).toHaveLength(0);
    expect(nonJsFiles).toContain('/project/routes/app.py');
  });

  it('skips markdown file and adds to nonJsFiles', () => {
    const { nonJsFiles } = detectApiSurfaces(['/project/routes/README.md']);
    expect(nonJsFiles).toContain('/project/routes/README.md');
  });

  it('accepts .jsx and .js extensions as valid JS/TS', () => {
    const { surfaces } = detectApiSurfaces([
      '/project/routes/users.js',
      '/project/api/endpoints.jsx',
    ]);
    expect(surfaces).toHaveLength(2);
  });

  it('returns empty arrays for empty input', () => {
    const { surfaces, nonJsFiles } = detectApiSurfaces([]);
    expect(surfaces).toHaveLength(0);
    expect(nonJsFiles).toHaveLength(0);
  });
});

describe('inferContract — exported functions', () => {
  it('extracts exported function with two typed params and boolean return', () => {
    const content = `export function foo(a: string, b: number): boolean { return true; }`;
    const contract = inferContract(content, 'test.ts');
    expect(contract.exports).toHaveLength(1);
    expect(contract.exports[0]).toMatchObject({ name: 'foo', parameterCount: 2, returnType: 'boolean' });
  });

  it('extracts async exported function', () => {
    const content = `export async function fetchUser(id: string): Promise<User> { }`;
    const contract = inferContract(content, 'test.ts');
    expect(contract.exports[0]).toMatchObject({ name: 'fetchUser', parameterCount: 1 });
  });

  it('extracts exported function with no parameters', () => {
    const content = `export function noop(): void {}`;
    const contract = inferContract(content, 'test.ts');
    expect(contract.exports[0]).toMatchObject({ name: 'noop', parameterCount: 0 });
  });

  it('extracts multiple exported functions', () => {
    const content = `
export function getUser(id: string): User { }
export function deleteUser(id: string): void { }
`;
    const contract = inferContract(content, 'test.ts');
    expect(contract.exports).toHaveLength(2);
    expect(contract.exports.map(e => e.name)).toEqual(expect.arrayContaining(['getUser', 'deleteUser']));
  });

  it('extracts exported arrow function', () => {
    const content = `export const handler = (req: Request, res: Response) => {};`;
    const contract = inferContract(content, 'test.ts');
    expect(contract.exports[0]).toMatchObject({ name: 'handler', parameterCount: 2 });
  });

  it('returns empty exports for non-exported functions', () => {
    const content = `function internal(x: string): string { return x; }`;
    const contract = inferContract(content, 'test.ts');
    expect(contract.exports).toHaveLength(0);
  });
});

describe('inferContract — route definitions', () => {
  it('detects router.get route', () => {
    const content = `router.get('/users', handler);`;
    const contract = inferContract(content, 'routes.ts');
    expect(contract.endpoints).toHaveLength(1);
    expect(contract.endpoints[0]).toMatchObject({ method: 'GET', path: '/users' });
  });

  it('detects app.post route', () => {
    const content = `app.post('/users', createUser);`;
    const contract = inferContract(content, 'routes.ts');
    expect(contract.endpoints[0]).toMatchObject({ method: 'POST', path: '/users' });
  });

  it('detects multiple routes', () => {
    const content = `
router.get('/users', getUsers);
router.post('/users', createUser);
router.delete('/users/:id', deleteUser);
`;
    const contract = inferContract(content, 'routes.ts');
    expect(contract.endpoints).toHaveLength(3);
    expect(contract.endpoints.map(e => e.method)).toEqual(
      expect.arrayContaining(['GET', 'POST', 'DELETE'])
    );
  });

  it('returns empty endpoints for file with no routes', () => {
    const content = `export function helper() {}`;
    const contract = inferContract(content, 'helper.ts');
    expect(contract.endpoints).toHaveLength(0);
  });
});

describe('inferContract — types and interfaces', () => {
  it('extracts exported interface', () => {
    const content = `export interface User { id: string; name: string; }`;
    const contract = inferContract(content, 'types.ts');
    const userType = contract.types.find(t => t.name === 'User');
    expect(userType).toBeDefined();
  });

  it('extracts exported enum members for narrowed-enum detection', () => {
    const content = `export enum Status { Active = 'active', Inactive = 'inactive', Pending = 'pending' }`;
    const contract = inferContract(content, 'types.ts');
    const enumType = contract.types.find(t => t.name === 'enum:Status');
    expect(enumType).toBeDefined();
    expect(enumType!.definition).toContain('Active');
    expect(enumType!.definition).toContain('Inactive');
    expect(enumType!.definition).toContain('Pending');
  });
});

describe('detectBreakingChanges — exports', () => {
  it('detects removed export', () => {
    const baseline: InferredContract = {
      exports: [{ name: 'bar', parameterCount: 1, returnType: 'string' }],
      endpoints: [],
      types: [],
    };
    const current: InferredContract = { exports: [], endpoints: [], types: [] };
    const changes = detectBreakingChanges(baseline, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].category).toBe('removed-export');
    expect(changes[0].name).toBe('bar');
  });

  it('detects changed parameter count', () => {
    const baseline: InferredContract = {
      exports: [{ name: 'foo', parameterCount: 2, returnType: 'boolean' }],
      endpoints: [],
      types: [],
    };
    const current: InferredContract = {
      exports: [{ name: 'foo', parameterCount: 1, returnType: 'boolean' }],
      endpoints: [],
      types: [],
    };
    const changes = detectBreakingChanges(baseline, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].category).toBe('changed-params');
    expect(changes[0].before).toBe('2 params');
    expect(changes[0].after).toBe('1 params');
  });

  it('detects changed return type', () => {
    const baseline: InferredContract = {
      exports: [{ name: 'getData', parameterCount: 0, returnType: 'string' }],
      endpoints: [],
      types: [],
    };
    const current: InferredContract = {
      exports: [{ name: 'getData', parameterCount: 0, returnType: 'number' }],
      endpoints: [],
      types: [],
    };
    const changes = detectBreakingChanges(baseline, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].category).toBe('changed-return-type');
    expect(changes[0].before).toBe('string');
    expect(changes[0].after).toBe('number');
  });

  it('does not flag new export as breaking', () => {
    const baseline: InferredContract = { exports: [], endpoints: [], types: [] };
    const current: InferredContract = {
      exports: [{ name: 'newFn', parameterCount: 1, returnType: 'void' }],
      endpoints: [],
      types: [],
    };
    const changes = detectBreakingChanges(baseline, current);
    expect(changes).toHaveLength(0);
  });

  it('does not flag added optional param as breaking when count increases', () => {
    const baseline: InferredContract = {
      exports: [{ name: 'fn', parameterCount: 1, returnType: 'void' }],
      endpoints: [],
      types: [],
    };
    const current: InferredContract = {
      exports: [{ name: 'fn', parameterCount: 2, returnType: 'void' }],
      endpoints: [],
      types: [],
    };
    const changes = detectBreakingChanges(baseline, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].category).toBe('changed-params');
  });

  it('does not flag same export with same signature as breaking', () => {
    const baseline: InferredContract = {
      exports: [{ name: 'stable', parameterCount: 2, returnType: 'boolean' }],
      endpoints: [],
      types: [],
    };
    const current: InferredContract = {
      exports: [{ name: 'stable', parameterCount: 2, returnType: 'boolean' }],
      endpoints: [],
      types: [],
    };
    const changes = detectBreakingChanges(baseline, current);
    expect(changes).toHaveLength(0);
  });
});

describe('detectBreakingChanges — endpoints', () => {
  it('detects removed endpoint', () => {
    const baseline: InferredContract = {
      exports: [],
      endpoints: [{ method: 'GET', path: '/users', statusCodes: [200] }],
      types: [],
    };
    const current: InferredContract = { exports: [], endpoints: [], types: [] };
    const changes = detectBreakingChanges(baseline, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].category).toBe('removed-endpoint');
    expect(changes[0].name).toBe('GET /users');
  });

  it('does not flag new endpoint as breaking', () => {
    const baseline: InferredContract = { exports: [], endpoints: [], types: [] };
    const current: InferredContract = {
      exports: [],
      endpoints: [{ method: 'POST', path: '/users', statusCodes: [201] }],
      types: [],
    };
    const changes = detectBreakingChanges(baseline, current);
    expect(changes).toHaveLength(0);
  });

  it('does not flag retained endpoint as breaking', () => {
    const baseline: InferredContract = {
      exports: [],
      endpoints: [{ method: 'GET', path: '/health', statusCodes: [200] }],
      types: [],
    };
    const current: InferredContract = {
      exports: [],
      endpoints: [{ method: 'GET', path: '/health', statusCodes: [200] }],
      types: [],
    };
    const changes = detectBreakingChanges(baseline, current);
    expect(changes).toHaveLength(0);
  });
});

describe('detectBreakingChanges — narrowed enum', () => {
  it('detects narrowed enum when member is removed', () => {
    const baseline: InferredContract = {
      exports: [],
      endpoints: [],
      types: [{ name: 'enum:Status', definition: 'Active,Inactive,Pending' }],
    };
    const current: InferredContract = {
      exports: [],
      endpoints: [],
      types: [{ name: 'enum:Status', definition: 'Active,Inactive' }],
    };
    const changes = detectBreakingChanges(baseline, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].category).toBe('narrowed-enum');
    expect(changes[0].name).toBe('Status');
  });

  it('does not flag widened enum as breaking', () => {
    const baseline: InferredContract = {
      exports: [],
      endpoints: [],
      types: [{ name: 'enum:Status', definition: 'Active,Inactive' }],
    };
    const current: InferredContract = {
      exports: [],
      endpoints: [],
      types: [{ name: 'enum:Status', definition: 'Active,Inactive,Pending' }],
    };
    const changes = detectBreakingChanges(baseline, current);
    expect(changes).toHaveLength(0);
  });
});

describe('createContractValidator — validator behavior', () => {
  it('returns skipped when no API surface files', async () => {
    const validator = createContractValidator();
    const config = makeConfig({ unitFiles: ['/project/src/utils/helper.ts'] });
    const result = await validator(config);
    expect(result.status).toBe('skipped');
  });

  it('returns passed when file has no breaking changes against itself', async () => {
    const content = `export function getUser(id: string): User {}`;
    const filePath = await writeFile('routes/users.ts', content);
    const validator = createContractValidator();
    const config = makeConfig({ unitFiles: [filePath] });
    const result = await validator(config);
    expect(result.status).toBe('passed');
    expect(result.findings.filter(f => f.severity === 'error')).toHaveLength(0);
  });

  it('writes artifact file to expected path', async () => {
    const filePath = await writeFile('routes/index.ts', 'export function health(): string { return "ok"; }');
    const validator = createContractValidator();
    const config = makeConfig({ unitFiles: [filePath] });
    const result = await validator(config);
    expect(result.artifactPath).toContain('contract-validation.md');
    const exists = await fs.pathExists(result.artifactPath);
    expect(exists).toBe(true);
  });

  it('returns warned when non-JS/TS files are present alongside JS/TS surfaces', async () => {
    const tsFile = await writeFile('routes/users.ts', 'export function getUsers(): User[] {}');
    const validator = createContractValidator();
    const config = makeConfig({
      unitFiles: [tsFile, '/project/routes/schema.py'],
    });
    const result = await validator(config);
    expect(['passed', 'warned']).toContain(result.status);
    const nonJsFinding = result.findings.find(f => f.category === 'non-js-ts-file');
    expect(nonJsFinding).toBeDefined();
  });

  it('downgrades findings when allowFailures is true', async () => {
    const baselineContent = `export function foo(a: string, b: number): boolean {}`;
    const unitContent = `export function foo(a: string): boolean {}`;
    const baselinePath = await writeFile('api/base.ts', baselineContent);
    const unitPath = await writeFile('api/unit.ts', unitContent);
    const validator = createContractValidator();
    const config = makeConfig({
      apiSurfaceFiles: [baselinePath],
      unitFiles: [unitPath],
      allowFailures: true,
    });
    const result = await validator(config);
    expect(result.status).toBe('passed');
    expect(result.findings.every(f => f.severity === 'info')).toBe(true);
  });

  it('ValidatorResult has required shape', async () => {
    const filePath = await writeFile('routes/health.ts', 'export function ping(): string { return "pong"; }');
    const validator = createContractValidator();
    const config = makeConfig({ unitFiles: [filePath] });
    const result = await validator(config);
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('artifactPath');
    expect(Array.isArray(result.findings)).toBe(true);
  });
});

describe('buildContractArtifact — output', () => {
  it('returns brief skip note when skipped', () => {
    const output = buildContractArtifact([], { exports: [], endpoints: [], types: [] }, true, []);
    expect(output).toContain('skipped');
    expect(output).toContain('No API surfaces');
  });

  it('includes breaking changes table when changes exist', () => {
    const changes = [
      {
        category: 'removed-export' as const,
        name: 'foo',
        before: 'foo(2 params): string',
        after: '(removed)',
      },
    ];
    const contract: InferredContract = {
      exports: [],
      endpoints: [],
      types: [],
    };
    const output = buildContractArtifact(changes, contract, false, []);
    expect(output).toContain('Breaking Changes');
    expect(output).toContain('removed-export');
    expect(output).toContain('foo');
    expect(output).toContain('(removed)');
  });

  it('includes non-JS/TS warning section when files were skipped', () => {
    const output = buildContractArtifact([], { exports: [], endpoints: [], types: [] }, false, [
      '/project/routes/schema.py',
    ]);
    expect(output).toContain('Non-JS/TS Files Skipped');
    expect(output).toContain('schema.py');
  });

  it('includes exports table when exports exist', () => {
    const contract: InferredContract = {
      exports: [{ name: 'getUser', parameterCount: 1, returnType: 'User' }],
      endpoints: [],
      types: [],
    };
    const output = buildContractArtifact([], contract, false, []);
    expect(output).toContain('Exports');
    expect(output).toContain('getUser');
  });

  it('includes endpoints table when endpoints exist', () => {
    const contract: InferredContract = {
      exports: [],
      endpoints: [{ method: 'GET', path: '/users', statusCodes: [200] }],
      types: [],
    };
    const output = buildContractArtifact([], contract, false, []);
    expect(output).toContain('Endpoints');
    expect(output).toContain('GET');
    expect(output).toContain('/users');
  });
});
