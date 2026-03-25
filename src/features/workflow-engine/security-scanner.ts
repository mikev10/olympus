import * as fs from 'fs-extra';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import type { SecurityFinding, SecurityScanResult } from './phase-types.js';

export interface SecurityScanOptions {
  projectPath: string;
  workflowId: string;
  unitId: string;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface SecurityIgnoreConfig {
  paths?: string[];
  patterns?: string[];
  reasons?: Record<string, string>;
}

interface ReportOptions {
  unitId: string;
  workflowId: string;
  outputDir: string;
  filesScanned: number;
  scanDate?: string;
}

const DEFAULT_INCLUDE_GLOBS = [
  '**/*.ts',
  '**/*.js',
  '**/*.tsx',
  '**/*.jsx',
  '**/*.py',
  '**/*.java',
  '**/*.go',
];

const DEFAULT_EXCLUDE_GLOBS = [
  '**/node_modules/**',
  '**/__tests__/**',
  '**/test/**',
  '**/fixtures/**',
  '**/dist/**',
  '**/*.d.ts',
];

/**
 * Converts a glob pattern to a RegExp.
 * Supports: * (any segment chars), double-star (any path including /), ? (single non-separator char)
 * Treats double-star-slash as optional path prefix so patterns match at root level too.
 */
function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/');
  let regexStr = '';
  let i = 0;
  while (i < normalized.length) {
    if (normalized[i] === '*' && normalized[i + 1] === '*') {
      if (normalized[i + 2] === '/') {
        regexStr += '(?:.+/)?';
        i += 3;
      } else {
        regexStr += '.*';
        i += 2;
      }
    } else if (normalized[i] === '*') {
      regexStr += '[^/]*';
      i++;
    } else if (normalized[i] === '?') {
      regexStr += '[^/]';
      i++;
    } else {
      regexStr += normalized[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${regexStr}$`);
}

function matchesGlob(filePath: string, glob: string): boolean {
  return globToRegex(glob).test(filePath);
}

function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  return globs.some(g => matchesGlob(filePath, g));
}

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

export function discoverFiles(projectPath: string, options: SecurityScanOptions): string[] {
  const includes = options.includeGlobs ?? DEFAULT_INCLUDE_GLOBS;
  const excludes = options.excludeGlobs ?? DEFAULT_EXCLUDE_GLOBS;
  return collectFiles(projectPath).filter(absPath => {
    const rel = relative(projectPath, absPath).replace(/\\/g, '/');
    return matchesAnyGlob(rel, includes) && !matchesAnyGlob(rel, excludes);
  });
}

function findLineNumber(content: string, index: number): number {
  return (content.substring(0, index).match(/\n/g) || []).length + 1;
}

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'Generic API Key', pattern: /['"]?api[_-]?key['"]?\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/gi },
  { name: 'Generic Secret', pattern: /['"]?secret['"]?\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/gi },
  { name: 'Private Key', pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/g },
  { name: 'Bearer Token', pattern: /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/g },
  { name: 'Connection String', pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/gi },
  { name: 'JWT Token', pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
];

export function scanFileForSecrets(content: string, filePath: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    // Reset lastIndex since we reuse stateful RegExp objects with /g flag
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      findings.push({
        id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category: 'hardcoded-secret',
        severity: 'critical',
        message: `${name} detected`,
        file: filePath,
        line: findLineNumber(content, match.index),
        pattern: name,
      });
    }
    pattern.lastIndex = 0;
  }
  return findings;
}

const SQL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'String concatenation in SQL query',
    pattern: /(?:['"`]\s*\+\s*\w+.*(?:SELECT|INSERT|UPDATE|DELETE|DROP|FROM|WHERE)|(?:SELECT|INSERT|UPDATE|DELETE|DROP|FROM|WHERE).*['"`]\s*\+\s*\w+)/gi,
  },
  {
    name: 'Template literal in SQL query',
    pattern: /(?:\$\{[^}]+\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP|FROM|WHERE)|(?:SELECT|INSERT|UPDATE|DELETE|DROP|FROM|WHERE)[^\n]*\$\{)/gi,
  },
  { name: 'Unparameterized query construction', pattern: /(?:query|execute|sql)\s*\(\s*['"`].*\+/gi },
];

export function scanFileForSQLInjection(content: string, filePath: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const { name, pattern } of SQL_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      findings.push({
        id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category: 'sql-injection',
        severity: 'warning',
        message: `${name} detected`,
        file: filePath,
        line: findLineNumber(content, match.index),
        pattern: name,
      });
    }
    pattern.lastIndex = 0;
  }
  return findings;
}

const XSS_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'innerHTML assignment', pattern: /\.innerHTML\s*=/g },
  { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/g },
  { name: 'document.write', pattern: /document\.write\s*\(/g },
  { name: 'eval usage', pattern: /\beval\s*\(/g },
];

export function scanFileForXSS(content: string, filePath: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const { name, pattern } of XSS_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      findings.push({
        id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category: 'xss',
        severity: 'warning',
        message: `${name} detected`,
        file: filePath,
        line: findLineNumber(content, match.index),
        pattern: name,
      });
    }
    pattern.lastIndex = 0;
  }
  return findings;
}

function parseNpmAuditOutput(output: string): SecurityFinding[] {
  const auditResult = JSON.parse(output);
  const findings: SecurityFinding[] = [];
  // npm audit v2+ format uses auditResult.vulnerabilities keyed by package name
  const vulnerabilities = auditResult.vulnerabilities || {};
  for (const [pkgName, vuln] of Object.entries(vulnerabilities as Record<string, any>)) {
    const npmSeverity = vuln.severity as string;
    const severity: SecurityFinding['severity'] =
      npmSeverity === 'critical' || npmSeverity === 'high' ? 'critical' :
      npmSeverity === 'moderate' ? 'warning' : 'info';
    findings.push({
      id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category: 'dependency-cve',
      severity,
      message: `Vulnerable dependency: ${pkgName} (${npmSeverity})`,
      pattern: pkgName,
    });
  }
  return findings;
}

export function runDependencyAudit(projectPath: string): SecurityFinding[] {
  try {
    const output = execSync('npm audit --json', {
      cwd: projectPath,
      timeout: 60000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return parseNpmAuditOutput(output);
  } catch (error: any) {
    // npm audit exits non-zero when vulnerabilities are found — parse stdout anyway
    try {
      if (error.stdout) return parseNpmAuditOutput(error.stdout as string);
    } catch {}
    return [];
  }
}

export function loadSecurityIgnore(projectPath: string): SecurityIgnoreConfig {
  const ignorePath = join(projectPath, '.olympus', 'security-ignore.json');
  try {
    if (fs.existsSync(ignorePath)) {
      return fs.readJsonSync(ignorePath) as SecurityIgnoreConfig;
    }
  } catch {}
  return {};
}

export function applySuppression(
  findings: SecurityFinding[],
  config: SecurityIgnoreConfig
): SecurityFinding[] {
  const suppressedPaths = config.paths || [];
  const suppressedPatterns = config.patterns || [];
  const reasons = config.reasons || {};

  return findings.map(finding => {
    if (finding.file && suppressedPaths.length > 0) {
      const normalizedFile = finding.file.replace(/\\/g, '/');
      for (const pathGlob of suppressedPaths) {
        if (matchesGlob(normalizedFile, pathGlob) ||
            normalizedFile.includes(pathGlob.replace(/\\/g, '/'))) {
          return {
            ...finding,
            suppressed: true,
            suppress_reason: reasons[pathGlob] || `Path suppressed: ${pathGlob}`,
          };
        }
      }
    }

    if (finding.pattern && suppressedPatterns.includes(finding.pattern)) {
      return {
        ...finding,
        suppressed: true,
        suppress_reason: reasons[finding.pattern] || `Pattern suppressed: ${finding.pattern}`,
      };
    }

    return finding;
  });
}

function categoryLabel(cat: SecurityFinding['category']): string {
  switch (cat) {
    case 'hardcoded-secret': return 'Hardcoded Secrets';
    case 'sql-injection': return 'SQL Injection';
    case 'xss': return 'Cross-Site Scripting (XSS)';
    case 'dependency-cve': return 'Dependency CVEs';
    case 'risky-pattern': return 'Risky Patterns';
  }
}

export function generateSecurityReport(findings: SecurityFinding[], options: ReportOptions): string {
  const { unitId, workflowId, filesScanned, scanDate } = options;
  const date = scanDate || new Date().toISOString();

  const activeFindings = findings.filter(f => !f.suppressed);
  const critical = activeFindings.filter(f => f.severity === 'critical').length;
  const warning = activeFindings.filter(f => f.severity === 'warning').length;
  const info = activeFindings.filter(f => f.severity === 'info').length;
  const suppressed = findings.filter(f => f.suppressed).length;
  const status = critical > 0 ? 'failed' : 'passed';

  const lines: string[] = [
    '---',
    `unit: ${unitId}`,
    `workflow: ${workflowId}`,
    `scan_date: ${date}`,
    `files_scanned: ${filesScanned}`,
    `findings_critical: ${critical}`,
    `findings_warning: ${warning}`,
    `findings_info: ${info}`,
    `findings_suppressed: ${suppressed}`,
    `status: ${status}`,
    '---',
    '',
    `# Security Report: ${unitId}`,
    '',
    `**Status**: ${status === 'passed' ? 'PASSED' : 'FAILED'}  `,
    `**Scan Date**: ${date}  `,
    `**Files Scanned**: ${filesScanned}  `,
    '',
    '## Summary',
    '',
    '| Severity | Count |',
    '|----------|-------|',
    `| Critical | ${critical} |`,
    `| Warning  | ${warning} |`,
    `| Info     | ${info} |`,
    `| Suppressed | ${suppressed} |`,
    '',
  ];

  const categories: SecurityFinding['category'][] = [
    'hardcoded-secret', 'sql-injection', 'xss', 'dependency-cve', 'risky-pattern',
  ];

  for (const cat of categories) {
    const catFindings = activeFindings.filter(f => f.category === cat);
    if (catFindings.length === 0) continue;
    lines.push(`## ${categoryLabel(cat)}`, '');
    for (const f of catFindings) {
      const location = f.file ? ` — \`${f.file}\`${f.line ? `:${f.line}` : ''}` : '';
      lines.push(`- **[${f.severity.toUpperCase()}]** ${f.message}${location}`);
    }
    lines.push('');
  }

  const suppressedFindings = findings.filter(f => f.suppressed);
  if (suppressedFindings.length > 0) {
    lines.push('## Suppressed Findings', '');
    for (const f of suppressedFindings) {
      const location = f.file ? ` — \`${f.file}\`${f.line ? `:${f.line}` : ''}` : '';
      lines.push(`- ~~**[${f.severity.toUpperCase()}]** ${f.message}${location}~~ *(${f.suppress_reason || 'suppressed'})*`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function scanProject(options: SecurityScanOptions): Promise<SecurityScanResult> {
  const start = Date.now();
  try {
    const files = discoverFiles(options.projectPath, options);

    const rawFindings: SecurityFinding[] = [];
    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        rawFindings.push(...scanFileForSecrets(content, filePath));
        rawFindings.push(...scanFileForSQLInjection(content, filePath));
        rawFindings.push(...scanFileForXSS(content, filePath));
      } catch {}
    }

    rawFindings.push(...runDependencyAudit(options.projectPath));

    const ignoreConfig = loadSecurityIgnore(options.projectPath);
    const findings = applySuppression(rawFindings, ignoreConfig);

    const outputDir = join(
      options.projectPath,
      'aidlc-docs',
      options.workflowId,
      'construction',
      options.unitId,
      'security'
    );
    fs.ensureDirSync(outputDir);

    const reportPath = join(outputDir, 'security-report.md');
    fs.writeFileSync(
      reportPath,
      generateSecurityReport(findings, {
        unitId: options.unitId,
        workflowId: options.workflowId,
        outputDir,
        filesScanned: files.length,
      }),
      'utf-8'
    );

    return {
      status: 'completed',
      findings,
      scanned_files: files.length,
      scan_duration_ms: Date.now() - start,
      report_path: reportPath,
    };
  } catch {
    return {
      status: 'failed',
      findings: [],
      scanned_files: 0,
      scan_duration_ms: Date.now() - start,
      report_path: '',
    };
  }
}
