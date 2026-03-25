import * as fs from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';

export interface CICheckConfig {
  staticQuality: {
    enabled: boolean;
    commands?: string[];
  };
  security: {
    enabled: boolean;
    auditLevel?: string;  // 'low' | 'moderate' | 'high' | 'critical'
  };
  complexity: {
    enabled: boolean;
    agent?: string;  // Default: 'oracle-low'
  };
  customChecks?: Array<{ name: string; command: string }>;
}

export interface CICheckResult {
  name: string;
  layer: 'static-quality' | 'security' | 'complexity' | 'custom';
  passed: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

export interface CICheckSummary {
  allPassed: boolean;
  results: CICheckResult[];
  totalDuration_ms: number;
  failedChecks: string[];
}

/**
 * Loads CI check configuration from .olympus/config.json
 * Returns defaults if config doesn't exist.
 */
export function loadCICheckConfig(projectPath: string): CICheckConfig {
  const configPath = join(projectPath, '.olympus', 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const config = fs.readJsonSync(configPath);
      if (config?.ciChecks) {
        return {
          staticQuality: {
            enabled: config.ciChecks.staticQuality?.enabled !== false,
            commands: config.ciChecks.staticQuality?.commands,
          },
          security: {
            enabled: config.ciChecks.security?.enabled !== false,
            auditLevel: config.ciChecks.security?.auditLevel || 'moderate',
          },
          complexity: {
            enabled: config.ciChecks.complexity?.enabled !== false,
            agent: config.ciChecks.complexity?.agent || 'oracle-low',
          },
          customChecks: config.ciChecks.customChecks || [],
        };
      }
    }
  } catch {
    // Config parse error - use defaults
  }

  return getDefaultConfig();
}

/**
 * Returns default CI check config based on auto-detected project tooling.
 */
export function getDefaultConfig(): CICheckConfig {
  return {
    staticQuality: { enabled: true },
    security: { enabled: true, auditLevel: 'moderate' },
    complexity: { enabled: true, agent: 'oracle-low' },
    customChecks: [],
  };
}

/**
 * Auto-detect available commands from project config files.
 * Checks package.json scripts, tsconfig.json, .eslintrc*, etc.
 */
export function detectProjectCommands(projectPath: string): string[] {
  const commands: string[] = [];

  try {
    const pkgPath = join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = fs.readJsonSync(pkgPath);
      const scripts = pkg?.scripts || {};

      // Detect available script-based commands
      if (scripts.lint) commands.push('npm run lint');
      if (scripts.typecheck) commands.push('npm run typecheck');
      if (scripts.test) commands.push('npm test');

      // If no explicit typecheck script but tsconfig exists
      if (!scripts.typecheck && fs.existsSync(join(projectPath, 'tsconfig.json'))) {
        commands.push('npx tsc --noEmit');
      }
    }
  } catch {
    // Ignore errors in detection
  }

  return commands;
}

/**
 * Runs a single CI check command.
 * Returns structured result.
 * Never throws - all errors captured in result.
 */
export function runCICheck(
  command: string,
  projectPath: string,
  name: string,
  layer: CICheckResult['layer']
): CICheckResult {
  const start = Date.now();
  try {
    const result = execSync(command, {
      cwd: projectPath,
      timeout: 120000,  // 2 minute timeout
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      name,
      layer,
      passed: true,
      command,
      exitCode: 0,
      stdout: (result || '').substring(0, 2000),  // Truncate to 2KB
      stderr: '',
      duration_ms: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name,
      layer,
      passed: false,
      command,
      exitCode: error.status || 1,
      stdout: (error.stdout || '').substring(0, 2000),
      stderr: (error.stderr || '').substring(0, 2000),
      duration_ms: Date.now() - start,
    };
  }
}

/**
 * @deprecated Use scanFileForSecrets() from security-scanner.ts instead.
 */
export function scanForSecrets(content: string): string[] {
  const patterns = [
    { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g },
    { name: 'Generic API Key', pattern: /['"]?api[_-]?key['"]?\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/gi },
    { name: 'Generic Secret', pattern: /['"]?secret['"]?\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/gi },
    { name: 'Private Key', pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/g },
    { name: 'Bearer Token', pattern: /Bearer\s+[a-zA-Z0-9\-._~+\/]+=*/g },
  ];

  const findings: string[] = [];
  for (const { name, pattern } of patterns) {
    const matches = content.match(pattern);
    if (matches) {
      findings.push(`${name} detected (${matches.length} occurrence${matches.length > 1 ? 's' : ''})`);
    }
  }
  return findings;
}

/**
 * @deprecated Use scanFileForXSS() from security-scanner.ts instead.
 */
export function scanForRiskyPatterns(content: string): string[] {
  const patterns = [
    { name: 'eval() usage', pattern: /\beval\s*\(/g },
    { name: 'exec() usage', pattern: /\bexec\s*\(/g },
    { name: 'innerHTML assignment', pattern: /\.innerHTML\s*=/g },
    { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/g },
  ];

  const findings: string[] = [];
  for (const { name, pattern } of patterns) {
    const matches = content.match(pattern);
    if (matches) {
      findings.push(`${name} (${matches.length} occurrence${matches.length > 1 ? 's' : ''})`);
    }
  }
  return findings;
}

/**
 * Runs all CI check layers.
 * Returns combined summary.
 */
export function runAllCIChecks(
  projectPath: string,
  config: CICheckConfig
): CICheckSummary {
  const results: CICheckResult[] = [];
  const start = Date.now();

  // Layer 1: Static Quality
  if (config.staticQuality.enabled) {
    const commands = config.staticQuality.commands || detectProjectCommands(projectPath);
    for (const cmd of commands) {
      results.push(runCICheck(cmd, projectPath, `Static: ${cmd}`, 'static-quality'));
    }
  }

  // Layer 2: Security
  if (config.security.enabled) {
    // npm audit
    const auditLevel = config.security.auditLevel || 'moderate';
    results.push(
      runCICheck(`npm audit --audit-level=${auditLevel}`, projectPath, 'Security: npm audit', 'security')
    );

    // Secret scanning is done separately on changed files (not via command)
    // Risky pattern scanning is done separately on changed files (not via command)
  }

  // Layer 3: Complexity - AI review is dispatched via agent (not a command)
  // This is handled by the hook itself by dispatching oracle-low
  // We record a placeholder here
  if (config.complexity.enabled) {
    results.push({
      name: 'Complexity: AI review',
      layer: 'complexity',
      passed: true,  // Will be updated by hook after agent dispatch
      command: `dispatch ${config.complexity.agent || 'oracle-low'}`,
      exitCode: 0,
      stdout: 'AI complexity review dispatched',
      stderr: '',
      duration_ms: 0,
    });
  }

  // Custom checks
  if (config.customChecks) {
    for (const check of config.customChecks) {
      results.push(runCICheck(check.command, projectPath, `Custom: ${check.name}`, 'custom'));
    }
  }

  const failedChecks = results.filter(r => !r.passed).map(r => r.name);

  return {
    allPassed: failedChecks.length === 0,
    results,
    totalDuration_ms: Date.now() - start,
    failedChecks,
  };
}

/**
 * Formats CI check results for context injection.
 */
export function formatCIResults(summary: CICheckSummary): string {
  const header = summary.allPassed
    ? 'CI Review Pipeline: ALL CHECKS PASSED'
    : `CI Review Pipeline: ${summary.failedChecks.length} CHECK(S) FAILED`;

  const details = summary.results.map(r => {
    const status = r.passed ? 'PASS' : 'FAIL';
    let detail = `[${status}] ${r.name}`;
    if (!r.passed) {
      detail += `\n  Command: ${r.command}`;
      detail += `\n  Exit code: ${r.exitCode}`;
      if (r.stderr) detail += `\n  Error: ${r.stderr.substring(0, 500)}`;
    }
    return detail;
  }).join('\n');

  return `${header}\n\n${details}\n\nTotal duration: ${summary.totalDuration_ms}ms`;
}
