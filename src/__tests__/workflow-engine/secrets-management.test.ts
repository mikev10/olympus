import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  detectEnvVarReferences,
  getPlaceholderValue,
  generateEnvExample,
  ensureGitignore,
  runSecretsManagement,
} from '../../features/workflow-engine/secrets-management.js';

const TEST_DIR = path.join(process.cwd(), '.test-secrets-management');

function writeFile(name: string, content: string): string {
  const filePath = path.join(TEST_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function readFile(name: string): string {
  return fs.readFileSync(path.join(TEST_DIR, name), 'utf-8');
}

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('detectEnvVarReferences', () => {
  it('detects process.env references', () => {
    const file = writeFile('node.ts', `
const url = process.env.DATABASE_URL;
const key = process.env.API_KEY;
`);
    const refs = detectEnvVarReferences([file]);
    const names = refs.map((r) => r.name);
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('API_KEY');
  });

  it('returns file path and 1-based line number', () => {
    const file = writeFile('lines.ts', `const x = 1;\nconst y = process.env.MY_VAR;\n`);
    const refs = detectEnvVarReferences([file]);
    expect(refs).toHaveLength(1);
    expect(refs[0].file).toBe(file);
    expect(refs[0].line).toBe(2);
  });

  it('detects import.meta.env references (Vite-style)', () => {
    const file = writeFile('vite.ts', `const base = import.meta.env.VITE_API_URL;`);
    const refs = detectEnvVarReferences([file]);
    expect(refs.map((r) => r.name)).toContain('VITE_API_URL');
  });

  it('detects Deno.env.get references', () => {
    const file = writeFile('deno.ts', `const secret = Deno.env.get('DENO_SECRET');`);
    const refs = detectEnvVarReferences([file]);
    expect(refs.map((r) => r.name)).toContain('DENO_SECRET');
  });

  it('detects Python os.environ references', () => {
    const file = writeFile('app.py', `db = os.environ['DB_HOST']`);
    const refs = detectEnvVarReferences([file]);
    expect(refs.map((r) => r.name)).toContain('DB_HOST');
  });

  it('detects Python os.getenv references', () => {
    const file = writeFile('app2.py', `port = os.getenv('SERVER_PORT')`);
    const refs = detectEnvVarReferences([file]);
    expect(refs.map((r) => r.name)).toContain('SERVER_PORT');
  });

  it('deduplicates the same var used multiple times in one file', () => {
    const file = writeFile('dup.ts', `
const a = process.env.MY_KEY;
const b = process.env.MY_KEY;
`);
    const refs = detectEnvVarReferences([file]);
    expect(refs.filter((r) => r.name === 'MY_KEY')).toHaveLength(1);
  });

  it('allows the same var name across different files', () => {
    const f1 = writeFile('a.ts', `process.env.SHARED_VAR`);
    const f2 = writeFile('b.ts', `process.env.SHARED_VAR`);
    const refs = detectEnvVarReferences([f1, f2]);
    expect(refs.filter((r) => r.name === 'SHARED_VAR')).toHaveLength(2);
  });

  it('skips unreadable files gracefully', () => {
    const refs = detectEnvVarReferences(['/nonexistent/path/file.ts']);
    expect(refs).toEqual([]);
  });

  it('returns empty array when no env vars present', () => {
    const file = writeFile('empty.ts', `const x = 1;`);
    expect(detectEnvVarReferences([file])).toEqual([]);
  });
});

describe('getPlaceholderValue', () => {
  it('returns URL placeholder for _URL suffix', () => {
    expect(getPlaceholderValue('DATABASE_URL')).toBe('https://example.com');
  });

  it('returns URL placeholder for _URI suffix', () => {
    expect(getPlaceholderValue('MONGO_URI')).toBe('https://example.com');
  });

  it('returns api-key placeholder for _KEY suffix', () => {
    expect(getPlaceholderValue('API_KEY')).toBe('your-api-key-here');
  });

  it('returns api-key placeholder for _API_KEY suffix', () => {
    expect(getPlaceholderValue('STRIPE_API_KEY')).toBe('your-api-key-here');
  });

  it('returns secret placeholder for _SECRET suffix', () => {
    expect(getPlaceholderValue('JWT_SECRET')).toBe('your-secret-here');
  });

  it('returns secret placeholder for _TOKEN suffix', () => {
    expect(getPlaceholderValue('AUTH_TOKEN')).toBe('your-secret-here');
  });

  it('returns port placeholder for _PORT suffix', () => {
    expect(getPlaceholderValue('SERVER_PORT')).toBe('3000');
  });

  it('returns localhost placeholder for _HOST suffix', () => {
    expect(getPlaceholderValue('DB_HOST')).toBe('localhost');
  });

  it('returns password placeholder for _PASSWORD suffix', () => {
    expect(getPlaceholderValue('DB_PASSWORD')).toBe('your-password-here');
  });

  it('returns password placeholder for _PASS suffix', () => {
    expect(getPlaceholderValue('REDIS_PASS')).toBe('your-password-here');
  });

  it('returns database placeholder for _DATABASE suffix', () => {
    expect(getPlaceholderValue('POSTGRES_DATABASE')).toBe('your-database-name');
  });

  it('returns database placeholder for _DB suffix', () => {
    expect(getPlaceholderValue('POSTGRES_DB')).toBe('your-database-name');
  });

  it('returns generic placeholder for unrecognised names', () => {
    expect(getPlaceholderValue('MY_CUSTOM_VAR')).toBe('your-my-custom-var-here');
  });
});

describe('generateEnvExample', () => {
  it('creates .env.example from scratch', () => {
    const refs = [{ name: 'DATABASE_URL', file: 'x.ts', line: 1 }];
    const result = generateEnvExample(refs, TEST_DIR);

    expect(result.created).toBe(true);
    expect(result.added).toEqual(['DATABASE_URL']);
    expect(result.existing).toEqual([]);

    const content = readFile('.env.example');
    expect(content).toContain('DATABASE_URL=https://example.com');
  });

  it('adds new vars to an existing .env.example', () => {
    writeFile('.env.example', 'EXISTING_VAR=old-value\n');

    const refs = [{ name: 'NEW_VAR', file: 'x.ts', line: 1 }];
    const result = generateEnvExample(refs, TEST_DIR);

    expect(result.created).toBe(false);
    expect(result.added).toEqual(['NEW_VAR']);
    expect(result.existing).toEqual([]);

    const content = readFile('.env.example');
    expect(content).toContain('EXISTING_VAR=old-value');
    expect(content).toContain('NEW_VAR=');
  });

  it('preserves existing entries and does not duplicate them', () => {
    writeFile('.env.example', 'DATABASE_URL=existing-value\n');

    const refs = [
      { name: 'DATABASE_URL', file: 'x.ts', line: 1 },
      { name: 'API_KEY', file: 'x.ts', line: 2 },
    ];
    const result = generateEnvExample(refs, TEST_DIR);

    expect(result.added).toEqual(['API_KEY']);
    expect(result.existing).toEqual(['DATABASE_URL']);

    const content = readFile('.env.example');
    const matches = content.match(/DATABASE_URL/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(content).toContain('DATABASE_URL=existing-value');
  });

  it('deduplicates var names across multiple refs', () => {
    const refs = [
      { name: 'MY_VAR', file: 'a.ts', line: 1 },
      { name: 'MY_VAR', file: 'b.ts', line: 1 },
    ];
    const result = generateEnvExample(refs, TEST_DIR);
    expect(result.added).toEqual(['MY_VAR']);

    const content = readFile('.env.example');
    const matches = content.match(/MY_VAR/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('uses atomic write — no temp file remains after write completes', () => {
    const targetPath = path.join(TEST_DIR, '.env.example');

    generateEnvExample([{ name: 'ATOMIC_VAR', file: 'x.ts', line: 1 }], TEST_DIR);

    const allFiles = fs.readdirSync(TEST_DIR);
    const tempFiles = allFiles.filter((f) => f.includes('.env.example.tmp.'));
    expect(tempFiles).toHaveLength(0);
    expect(fs.existsSync(targetPath)).toBe(true);
    expect(fs.readFileSync(targetPath, 'utf-8')).toContain('ATOMIC_VAR=');
  });
});

describe('ensureGitignore', () => {
  it('creates .gitignore with .env when file does not exist', () => {
    const result = ensureGitignore(TEST_DIR);

    expect(result.created).toBe(true);
    expect(result.added).toBe(true);

    const content = readFile('.gitignore');
    expect(content).toContain('.env');
  });

  it('adds .env to existing .gitignore that lacks it', () => {
    writeFile('.gitignore', 'node_modules\ndist\n');

    const result = ensureGitignore(TEST_DIR);

    expect(result.created).toBe(false);
    expect(result.added).toBe(true);

    const content = readFile('.gitignore');
    expect(content).toContain('node_modules');
    expect(content).toContain('.env');
  });

  it('is a no-op when .env is already listed', () => {
    writeFile('.gitignore', 'node_modules\n.env\n');

    const result = ensureGitignore(TEST_DIR);

    expect(result.created).toBe(false);
    expect(result.added).toBe(false);

    const content = readFile('.gitignore');
    const matches = content.match(/^\.env$/gm) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('recognises /.env as already listed', () => {
    writeFile('.gitignore', '/.env\n');

    const result = ensureGitignore(TEST_DIR);

    expect(result.added).toBe(false);
  });
});

describe('runSecretsManagement', () => {
  it('returns empty result when no env vars are detected', () => {
    const file = writeFile('plain.ts', `const x = 1;`);
    const result = runSecretsManagement(TEST_DIR, [file]);

    expect(result.envVarsDetected).toEqual([]);
    expect(result.envExampleResult).toEqual({ created: false, added: [], existing: [] });
    expect(result.gitignoreResult).toEqual({ created: false, added: false });
  });

  it('generates .env.example and updates .gitignore when env vars are found', () => {
    const file = writeFile('src/app.ts', `const url = process.env.APP_URL;`);
    const result = runSecretsManagement(TEST_DIR, [file]);

    expect(result.envVarsDetected.map((r) => r.name)).toContain('APP_URL');
    expect(result.envExampleResult.added).toContain('APP_URL');
    expect(result.envExampleResult.created).toBe(true);
    expect(result.gitignoreResult.added).toBe(true);
    expect(result.gitignoreResult.created).toBe(true);

    expect(fs.existsSync(path.join(TEST_DIR, '.env.example'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, '.gitignore'))).toBe(true);
  });

  it('handles multiple files with mixed patterns', () => {
    const f1 = writeFile('server.ts', `process.env.DB_PASSWORD`);
    const f2 = writeFile('client.ts', `import.meta.env.VITE_HOST`);
    const result = runSecretsManagement(TEST_DIR, [f1, f2]);

    const names = result.envVarsDetected.map((r) => r.name);
    expect(names).toContain('DB_PASSWORD');
    expect(names).toContain('VITE_HOST');

    const content = fs.readFileSync(path.join(TEST_DIR, '.env.example'), 'utf-8');
    expect(content).toContain('DB_PASSWORD=your-password-here');
    expect(content).toContain('VITE_HOST=localhost');
  });
});
