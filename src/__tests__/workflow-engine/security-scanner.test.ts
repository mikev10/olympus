import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  scanFileForSecrets,
  scanFileForSQLInjection,
  scanFileForXSS,
  discoverFiles,
  loadSecurityIgnore,
  applySuppression,
  generateSecurityReport,
  runDependencyAudit,
} from '../../features/workflow-engine/security-scanner.js';
import type { SecurityFinding, SecurityScanOptions } from '../../features/workflow-engine/security-scanner.js';

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

const TEST_DIR = path.join(process.cwd(), '.test-security-scanner');

beforeEach(() => {
  fs.ensureDirSync(TEST_DIR);
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('scanFileForSecrets', () => {
  it('detects AWS access key', () => {
    const findings = scanFileForSecrets('const key = "AKIAIOSFODNN7EXAMPLE";', 'test.ts');
    expect(findings.some(f => f.pattern === 'AWS Access Key')).toBe(true);
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].category).toBe('hardcoded-secret');
  });

  it('detects generic API key', () => {
    const findings = scanFileForSecrets('api_key = "abcdefghijklmnopqrstuvwxyz"', 'test.ts');
    expect(findings.some(f => f.pattern === 'Generic API Key')).toBe(true);
  });

  it('detects generic secret', () => {
    const findings = scanFileForSecrets('secret = "abcdefghijklmnopqrstuvwxyz"', 'test.ts');
    expect(findings.some(f => f.pattern === 'Generic Secret')).toBe(true);
  });

  it('detects private key header', () => {
    const findings = scanFileForSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE...', 'test.ts');
    expect(findings.some(f => f.pattern === 'Private Key')).toBe(true);
  });

  it('detects bearer token', () => {
    const findings = scanFileForSecrets('Authorization: Bearer eyABC123tokenValue==', 'test.ts');
    expect(findings.some(f => f.pattern === 'Bearer Token')).toBe(true);
  });

  it('detects connection string', () => {
    const content = 'const db = "postgres://user:pass@localhost/mydb"';
    const findings = scanFileForSecrets(content, 'test.ts');
    expect(findings.some(f => f.pattern === 'Connection String')).toBe(true);
  });

  it('detects JWT token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const findings = scanFileForSecrets(jwt, 'test.ts');
    expect(findings.some(f => f.pattern === 'JWT Token')).toBe(true);
  });

  it('returns line number for finding', () => {
    const content = 'line1\nline2\nconst key = "AKIAIOSFODNN7EXAMPLE";';
    const findings = scanFileForSecrets(content, 'test.ts');
    expect(findings[0].line).toBe(3);
  });

  it('returns file path on finding', () => {
    const findings = scanFileForSecrets('const key = "AKIAIOSFODNN7EXAMPLE";', 'src/config.ts');
    expect(findings[0].file).toBe('src/config.ts');
  });

  it('returns empty array for clean content', () => {
    const findings = scanFileForSecrets('const x = 1;\nexport default x;', 'test.ts');
    expect(findings).toHaveLength(0);
  });

  it('detects multiple secrets in one file', () => {
    const content = 'AKIAIOSFODNN7EXAMPLE\n' + 'postgres://user:pass@host/db';
    const findings = scanFileForSecrets(content, 'test.ts');
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('scanFileForSQLInjection', () => {
  it('detects string concatenation in query', () => {
    const findings = scanFileForSQLInjection(
      'const q = "SELECT * FROM users WHERE id = " + userId',
      'test.ts'
    );
    expect(findings.some(f => f.pattern === 'String concatenation in SQL query')).toBe(true);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].category).toBe('sql-injection');
  });

  it('detects template literal in query', () => {
    const findings = scanFileForSQLInjection(
      'const q = `SELECT * FROM users WHERE id = ${userId}`',
      'test.ts'
    );
    expect(findings.some(f => f.pattern === 'Template literal in SQL query')).toBe(true);
  });

  it('detects unparameterized query construction', () => {
    const findings = scanFileForSQLInjection(
      'db.query("SELECT * FROM " + tableName)',
      'test.ts'
    );
    expect(findings.some(f => f.pattern === 'Unparameterized query construction')).toBe(true);
  });

  it('returns empty for parameterized query', () => {
    const findings = scanFileForSQLInjection(
      'db.query("SELECT * FROM users WHERE id = ?", [userId])',
      'test.ts'
    );
    expect(findings).toHaveLength(0);
  });
});

describe('scanFileForXSS', () => {
  it('detects innerHTML assignment', () => {
    const findings = scanFileForXSS('element.innerHTML = userInput;', 'test.ts');
    expect(findings.some(f => f.pattern === 'innerHTML assignment')).toBe(true);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].category).toBe('xss');
  });

  it('detects dangerouslySetInnerHTML', () => {
    const findings = scanFileForXSS(
      '<div dangerouslySetInnerHTML={{ __html: content }} />',
      'test.tsx'
    );
    expect(findings.some(f => f.pattern === 'dangerouslySetInnerHTML')).toBe(true);
  });

  it('detects document.write', () => {
    const findings = scanFileForXSS('document.write(content);', 'test.ts');
    expect(findings.some(f => f.pattern === 'document.write')).toBe(true);
  });

  it('detects eval usage', () => {
    const findings = scanFileForXSS('eval(userCode)', 'test.ts');
    expect(findings.some(f => f.pattern === 'eval usage')).toBe(true);
  });

  it('returns empty for clean content', () => {
    const findings = scanFileForXSS('const x = document.getElementById("app");', 'test.ts');
    expect(findings).toHaveLength(0);
  });
});

describe('discoverFiles', () => {
  function makeOptions(overrides: Partial<SecurityScanOptions> = {}): SecurityScanOptions {
    return {
      projectPath: TEST_DIR,
      workflowId: 'wf-001',
      unitId: 'UNIT-001',
      ...overrides,
    };
  }

  it('finds TypeScript files by default', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'index.ts'), 'export {}');
    const files = discoverFiles(TEST_DIR, makeOptions());
    expect(files.some(f => f.endsWith('index.ts'))).toBe(true);
  });

  it('finds JavaScript files by default', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'app.js'), 'module.exports = {}');
    const files = discoverFiles(TEST_DIR, makeOptions());
    expect(files.some(f => f.endsWith('app.js'))).toBe(true);
  });

  it('excludes node_modules by default', () => {
    fs.ensureDirSync(path.join(TEST_DIR, 'node_modules', 'pkg'));
    fs.writeFileSync(path.join(TEST_DIR, 'node_modules', 'pkg', 'index.ts'), '');
    const files = discoverFiles(TEST_DIR, makeOptions());
    expect(files.every(f => !f.includes('node_modules'))).toBe(true);
  });

  it('excludes __tests__ directories by default', () => {
    fs.ensureDirSync(path.join(TEST_DIR, '__tests__'));
    fs.writeFileSync(path.join(TEST_DIR, '__tests__', 'foo.test.ts'), '');
    const files = discoverFiles(TEST_DIR, makeOptions());
    expect(files.every(f => !f.includes('__tests__'))).toBe(true);
  });

  it('excludes test directories by default', () => {
    fs.ensureDirSync(path.join(TEST_DIR, 'test'));
    fs.writeFileSync(path.join(TEST_DIR, 'test', 'spec.ts'), '');
    const files = discoverFiles(TEST_DIR, makeOptions());
    expect(files.every(f => !f.replace(/\\/g, '/').includes('/test/'))).toBe(true);
  });

  it('excludes fixtures directories by default', () => {
    fs.ensureDirSync(path.join(TEST_DIR, 'fixtures'));
    fs.writeFileSync(path.join(TEST_DIR, 'fixtures', 'data.ts'), '');
    const files = discoverFiles(TEST_DIR, makeOptions());
    expect(files.every(f => !f.includes('fixtures'))).toBe(true);
  });

  it('excludes dist by default', () => {
    fs.ensureDirSync(path.join(TEST_DIR, 'dist'));
    fs.writeFileSync(path.join(TEST_DIR, 'dist', 'bundle.js'), '');
    const files = discoverFiles(TEST_DIR, makeOptions());
    expect(files.every(f => !f.replace(/\\/g, '/').includes('/dist/'))).toBe(true);
  });

  it('excludes .d.ts files by default', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'types.d.ts'), '');
    const files = discoverFiles(TEST_DIR, makeOptions());
    expect(files.every(f => !f.endsWith('.d.ts'))).toBe(true);
  });

  it('respects custom include globs', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'config.yaml'), '');
    fs.writeFileSync(path.join(TEST_DIR, 'index.ts'), '');
    const files = discoverFiles(TEST_DIR, makeOptions({ includeGlobs: ['**/*.yaml'] }));
    expect(files.some(f => f.endsWith('config.yaml'))).toBe(true);
    expect(files.every(f => !f.endsWith('.ts'))).toBe(true);
  });

  it('respects custom exclude globs', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'index.ts'), '');
    fs.writeFileSync(path.join(TEST_DIR, 'skip.ts'), '');
    const files = discoverFiles(TEST_DIR, makeOptions({ excludeGlobs: ['**/skip.ts'] }));
    expect(files.every(f => !f.endsWith('skip.ts'))).toBe(true);
    expect(files.some(f => f.endsWith('index.ts'))).toBe(true);
  });

  it('returns empty array for empty project', () => {
    const files = discoverFiles(TEST_DIR, makeOptions());
    expect(files).toHaveLength(0);
  });
});

describe('loadSecurityIgnore', () => {
  it('returns empty config when file does not exist', () => {
    const config = loadSecurityIgnore(TEST_DIR);
    expect(config).toEqual({});
  });

  it('loads paths, patterns, and reasons', () => {
    fs.ensureDirSync(path.join(TEST_DIR, '.olympus'));
    fs.writeJsonSync(path.join(TEST_DIR, '.olympus', 'security-ignore.json'), {
      paths: ['src/legacy/**'],
      patterns: ['Bearer Token'],
      reasons: { 'Bearer Token': 'test tokens only' },
    });
    const config = loadSecurityIgnore(TEST_DIR);
    expect(config.paths).toContain('src/legacy/**');
    expect(config.patterns).toContain('Bearer Token');
    expect(config.reasons?.['Bearer Token']).toBe('test tokens only');
  });

  it('returns empty config for malformed JSON', () => {
    fs.ensureDirSync(path.join(TEST_DIR, '.olympus'));
    fs.writeFileSync(path.join(TEST_DIR, '.olympus', 'security-ignore.json'), '{not valid json}');
    const config = loadSecurityIgnore(TEST_DIR);
    expect(config).toEqual({});
  });
});

describe('applySuppression', () => {
  const baseFinding: SecurityFinding = {
    id: 'sec-001',
    category: 'hardcoded-secret',
    severity: 'critical',
    message: 'Bearer Token detected',
    file: 'src/legacy/auth.ts',
    line: 10,
    pattern: 'Bearer Token',
  };

  it('suppresses finding matching pattern', () => {
    const results = applySuppression([baseFinding], { patterns: ['Bearer Token'] });
    expect(results[0].suppressed).toBe(true);
    expect(results[0].suppress_reason).toContain('Bearer Token');
  });

  it('suppresses finding matching path glob', () => {
    const results = applySuppression([baseFinding], { paths: ['src/legacy/**'] });
    expect(results[0].suppressed).toBe(true);
  });

  it('includes reason from reasons map', () => {
    const results = applySuppression([baseFinding], {
      patterns: ['Bearer Token'],
      reasons: { 'Bearer Token': 'test environment only' },
    });
    expect(results[0].suppress_reason).toBe('test environment only');
  });

  it('does not suppress finding with non-matching config', () => {
    const results = applySuppression([baseFinding], { patterns: ['AWS Access Key'] });
    expect(results[0].suppressed).toBeUndefined();
  });

  it('leaves non-matching findings unchanged', () => {
    const other: SecurityFinding = { ...baseFinding, id: 'sec-002', pattern: 'AWS Access Key' };
    const results = applySuppression([baseFinding, other], { patterns: ['Bearer Token'] });
    expect(results[0].suppressed).toBe(true);
    expect(results[1].suppressed).toBeUndefined();
  });
});

describe('generateSecurityReport', () => {
  const baseFinding: SecurityFinding = {
    id: 'sec-001',
    category: 'hardcoded-secret',
    severity: 'critical',
    message: 'AWS Access Key detected',
    file: 'src/config.ts',
    line: 5,
    pattern: 'AWS Access Key',
  };

  it('includes YAML frontmatter', () => {
    const report = generateSecurityReport([baseFinding], {
      unitId: 'UNIT-001',
      workflowId: 'wf-test',
      outputDir: TEST_DIR,
      filesScanned: 10,
      scanDate: '2024-01-01T00:00:00.000Z',
    });
    expect(report).toContain('---');
    expect(report).toContain('unit: UNIT-001');
    expect(report).toContain('workflow: wf-test');
    expect(report).toContain('scan_date: 2024-01-01T00:00:00.000Z');
    expect(report).toContain('files_scanned: 10');
  });

  it('sets status to failed when critical findings exist', () => {
    const report = generateSecurityReport([baseFinding], {
      unitId: 'UNIT-001',
      workflowId: 'wf-test',
      outputDir: TEST_DIR,
      filesScanned: 5,
    });
    expect(report).toContain('status: failed');
  });

  it('sets status to passed when no critical findings', () => {
    const warning: SecurityFinding = { ...baseFinding, severity: 'warning', category: 'xss' };
    const report = generateSecurityReport([warning], {
      unitId: 'UNIT-001',
      workflowId: 'wf-test',
      outputDir: TEST_DIR,
      filesScanned: 5,
    });
    expect(report).toContain('status: passed');
  });

  it('counts findings by severity in frontmatter', () => {
    const warning: SecurityFinding = { ...baseFinding, id: 'sec-002', severity: 'warning', category: 'xss' };
    const report = generateSecurityReport([baseFinding, warning], {
      unitId: 'UNIT-001',
      workflowId: 'wf-test',
      outputDir: TEST_DIR,
      filesScanned: 3,
    });
    expect(report).toContain('findings_critical: 1');
    expect(report).toContain('findings_warning: 1');
  });

  it('suppressed findings appear in report but do not count toward critical/warning', () => {
    const suppressed: SecurityFinding = {
      ...baseFinding,
      id: 'sec-003',
      suppressed: true,
      suppress_reason: 'test only',
    };
    const report = generateSecurityReport([suppressed], {
      unitId: 'UNIT-001',
      workflowId: 'wf-test',
      outputDir: TEST_DIR,
      filesScanned: 1,
    });
    expect(report).toContain('findings_critical: 0');
    expect(report).toContain('findings_suppressed: 1');
    expect(report).toContain('status: passed');
    expect(report).toContain('Suppressed Findings');
  });

  it('renders suppressed findings with strikethrough', () => {
    const suppressed: SecurityFinding = {
      ...baseFinding,
      suppressed: true,
      suppress_reason: 'intentional',
    };
    const report = generateSecurityReport([suppressed], {
      unitId: 'UNIT-001',
      workflowId: 'wf-test',
      outputDir: TEST_DIR,
      filesScanned: 1,
    });
    expect(report).toContain('~~');
    expect(report).toContain('intentional');
  });

  it('produces clean report for empty findings', () => {
    const report = generateSecurityReport([], {
      unitId: 'UNIT-001',
      workflowId: 'wf-test',
      outputDir: TEST_DIR,
      filesScanned: 0,
    });
    expect(report).toContain('status: passed');
    expect(report).toContain('findings_critical: 0');
  });

  it('groups findings by category', () => {
    const xss: SecurityFinding = { ...baseFinding, id: 'sec-xss', category: 'xss', severity: 'warning', message: 'eval usage detected' };
    const report = generateSecurityReport([baseFinding, xss], {
      unitId: 'UNIT-001',
      workflowId: 'wf-test',
      outputDir: TEST_DIR,
      filesScanned: 2,
    });
    expect(report).toContain('## Hardcoded Secrets');
    expect(report).toContain('## Cross-Site Scripting (XSS)');
  });
});

describe('runDependencyAudit', () => {
  it('returns empty array when npm audit succeeds with no vulnerabilities', () => {
    mockExecSync.mockReturnValue(JSON.stringify({ vulnerabilities: {} }));
    const findings = runDependencyAudit(TEST_DIR);
    expect(findings).toHaveLength(0);
  });

  it('returns findings when vulnerabilities exist in stdout on non-zero exit', () => {
    const mockError = Object.assign(new Error('audit failed'), {
      stdout: JSON.stringify({
        vulnerabilities: {
          lodash: { severity: 'critical' },
          moment: { severity: 'moderate' },
        },
      }),
    });
    mockExecSync.mockImplementation(() => { throw mockError; });
    const findings = runDependencyAudit(TEST_DIR);
    expect(findings.some(f => f.message.includes('lodash'))).toBe(true);
    expect(findings.find(f => f.message.includes('lodash'))?.severity).toBe('critical');
    expect(findings.find(f => f.message.includes('moment'))?.severity).toBe('warning');
  });

  it('returns empty array when execSync throws without stdout', () => {
    mockExecSync.mockImplementation(() => { throw new Error('npm not found'); });
    const findings = runDependencyAudit(TEST_DIR);
    expect(findings).toHaveLength(0);
  });

  it('returns empty array when stdout is invalid JSON', () => {
    const mockError = Object.assign(new Error('audit failed'), { stdout: 'not json' });
    mockExecSync.mockImplementation(() => { throw mockError; });
    const findings = runDependencyAudit(TEST_DIR);
    expect(findings).toHaveLength(0);
  });

  it('maps high severity to critical', () => {
    const mockError = Object.assign(new Error('audit failed'), {
      stdout: JSON.stringify({ vulnerabilities: { pkg: { severity: 'high' } } }),
    });
    mockExecSync.mockImplementation(() => { throw mockError; });
    const findings = runDependencyAudit(TEST_DIR);
    expect(findings[0].severity).toBe('critical');
  });

  it('maps low severity to info', () => {
    const mockError = Object.assign(new Error('audit failed'), {
      stdout: JSON.stringify({ vulnerabilities: { pkg: { severity: 'low' } } }),
    });
    mockExecSync.mockImplementation(() => { throw mockError; });
    const findings = runDependencyAudit(TEST_DIR);
    expect(findings[0].severity).toBe('info');
  });
});
