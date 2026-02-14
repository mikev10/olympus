import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadCICheckConfig,
  getDefaultConfig,
  detectProjectCommands,
  runCICheck,
  scanForSecrets,
  scanForRiskyPatterns,
  runAllCIChecks,
  formatCIResults,
  type CICheckConfig,
  type CICheckSummary,
} from '../../features/workflow-engine/ci-checks.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';

describe('CI Checks', () => {
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = join(tmpdir(), `.test-ci-checks-${Date.now()}`);
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadCICheckConfig', () => {
    it('should load config from .olympus/config.json', () => {
      const configPath = join(testDir, '.olympus', 'config.json');
      fs.ensureDirSync(join(testDir, '.olympus'));
      fs.writeJsonSync(configPath, {
        ciChecks: {
          staticQuality: {
            enabled: true,
            commands: ['npm run lint', 'npm test'],
          },
          security: {
            enabled: true,
            auditLevel: 'high',
          },
          complexity: {
            enabled: false,
            agent: 'oracle-medium',
          },
          customChecks: [
            { name: 'custom-check', command: 'npm run custom' },
          ],
        },
      });

      const config = loadCICheckConfig(testDir);

      expect(config.staticQuality.enabled).toBe(true);
      expect(config.staticQuality.commands).toEqual(['npm run lint', 'npm test']);
      expect(config.security.enabled).toBe(true);
      expect(config.security.auditLevel).toBe('high');
      expect(config.complexity.enabled).toBe(false);
      expect(config.complexity.agent).toBe('oracle-medium');
      expect(config.customChecks).toHaveLength(1);
    });

    it('should return defaults when config file does not exist', () => {
      const config = loadCICheckConfig(testDir);

      expect(config.staticQuality.enabled).toBe(true);
      expect(config.security.enabled).toBe(true);
      expect(config.security.auditLevel).toBe('moderate');
      expect(config.complexity.enabled).toBe(true);
      expect(config.complexity.agent).toBe('oracle-low');
      expect(config.customChecks).toEqual([]);
    });

    it('should return defaults when config has no ciChecks', () => {
      const configPath = join(testDir, '.olympus', 'config.json');
      fs.ensureDirSync(join(testDir, '.olympus'));
      fs.writeJsonSync(configPath, { otherConfig: true });

      const config = loadCICheckConfig(testDir);

      expect(config.staticQuality.enabled).toBe(true);
      expect(config.security.enabled).toBe(true);
    });

    it('should return defaults on config parse error', () => {
      const configPath = join(testDir, '.olympus', 'config.json');
      fs.ensureDirSync(join(testDir, '.olympus'));
      fs.writeFileSync(configPath, 'invalid json{');

      const config = loadCICheckConfig(testDir);

      expect(config.staticQuality.enabled).toBe(true);
    });

    it('should default enabled to true when not specified', () => {
      const configPath = join(testDir, '.olympus', 'config.json');
      fs.ensureDirSync(join(testDir, '.olympus'));
      fs.writeJsonSync(configPath, {
        ciChecks: {
          staticQuality: {},
          security: {},
          complexity: {},
        },
      });

      const config = loadCICheckConfig(testDir);

      expect(config.staticQuality.enabled).toBe(true);
      expect(config.security.enabled).toBe(true);
      expect(config.complexity.enabled).toBe(true);
    });
  });

  describe('getDefaultConfig', () => {
    it('should return expected defaults', () => {
      const config = getDefaultConfig();

      expect(config).toEqual({
        staticQuality: { enabled: true },
        security: { enabled: true, auditLevel: 'moderate' },
        complexity: { enabled: true, agent: 'oracle-low' },
        customChecks: [],
      });
    });
  });

  describe('detectProjectCommands', () => {
    it('should detect lint script', () => {
      fs.writeJsonSync(join(testDir, 'package.json'), {
        scripts: { lint: 'eslint .' },
      });

      const commands = detectProjectCommands(testDir);

      expect(commands).toContain('npm run lint');
    });

    it('should detect typecheck script', () => {
      fs.writeJsonSync(join(testDir, 'package.json'), {
        scripts: { typecheck: 'tsc --noEmit' },
      });

      const commands = detectProjectCommands(testDir);

      expect(commands).toContain('npm run typecheck');
    });

    it('should detect test script', () => {
      fs.writeJsonSync(join(testDir, 'package.json'), {
        scripts: { test: 'vitest' },
      });

      const commands = detectProjectCommands(testDir);

      expect(commands).toContain('npm test');
    });

    it('should detect tsconfig and add npx tsc when no typecheck script', () => {
      fs.writeJsonSync(join(testDir, 'package.json'), {
        scripts: { lint: 'eslint .' },
      });
      fs.writeFileSync(join(testDir, 'tsconfig.json'), '{}');

      const commands = detectProjectCommands(testDir);

      expect(commands).toContain('npx tsc --noEmit');
    });

    it('should not add npx tsc when typecheck script exists', () => {
      fs.writeJsonSync(join(testDir, 'package.json'), {
        scripts: { typecheck: 'tsc --noEmit' },
      });
      fs.writeFileSync(join(testDir, 'tsconfig.json'), '{}');

      const commands = detectProjectCommands(testDir);

      expect(commands).toContain('npm run typecheck');
      expect(commands).not.toContain('npx tsc --noEmit');
    });

    it('should return empty array when package.json does not exist', () => {
      const commands = detectProjectCommands(testDir);

      expect(commands).toEqual([]);
    });

    it('should handle missing scripts field', () => {
      fs.writeJsonSync(join(testDir, 'package.json'), {});

      const commands = detectProjectCommands(testDir);

      expect(commands).toEqual([]);
    });

    it('should handle readJsonSync error', () => {
      fs.writeFileSync(join(testDir, 'package.json'), 'invalid json{');

      const commands = detectProjectCommands(testDir);

      expect(commands).toEqual([]);
    });
  });

  describe('runCICheck', () => {
    it('should return success result when command succeeds', () => {
      vi.mocked(execSync).mockReturnValue('All checks passed' as any);

      const result = runCICheck('npm run lint', '/test', 'Lint check', 'static-quality');

      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.name).toBe('Lint check');
      expect(result.layer).toBe('static-quality');
      expect(result.command).toBe('npm run lint');
      expect(result.stdout).toBe('All checks passed');
      expect(result.stderr).toBe('');
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should return failure result when command fails', () => {
      const error: any = new Error('Command failed');
      error.status = 1;
      error.stdout = 'Some output';
      error.stderr = 'Lint errors found';
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      const result = runCICheck('npm run lint', '/test', 'Lint check', 'static-quality');

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('Some output');
      expect(result.stderr).toBe('Lint errors found');
    });

    it('should truncate stdout to 2KB', () => {
      const longOutput = 'x'.repeat(5000);
      vi.mocked(execSync).mockReturnValue(longOutput as any);

      const result = runCICheck('npm run lint', '/test', 'Lint', 'static-quality');

      expect(result.stdout.length).toBe(2000);
    });

    it('should truncate stderr to 2KB on failure', () => {
      const error: any = new Error('Command failed');
      error.status = 1;
      error.stdout = '';
      error.stderr = 'e'.repeat(5000);
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      const result = runCICheck('npm run lint', '/test', 'Lint', 'static-quality');

      expect(result.stderr.length).toBe(2000);
    });

    it('should handle timeout', () => {
      const error: any = new Error('Command timed out');
      error.status = undefined;
      error.stdout = '';
      error.stderr = 'ETIMEDOUT';
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      const result = runCICheck('npm test', '/test', 'Tests', 'static-quality');

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);  // Defaults to 1 when status is undefined
    });

    it('should call execSync with correct options', () => {
      vi.mocked(execSync).mockReturnValue('output' as any);

      runCICheck('npm run lint', '/test/project', 'Lint', 'static-quality');

      expect(execSync).toHaveBeenCalledWith('npm run lint', {
        cwd: '/test/project',
        timeout: 120000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    });
  });

  describe('scanForSecrets', () => {
    it('should detect AWS Access Key', () => {
      const content = 'const key = "AKIAIOSFODNN7EXAMPLE";';
      const findings = scanForSecrets(content);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('AWS Access Key');
      expect(findings[0]).toContain('1 occurrence');
    });

    it('should detect Generic API Key', () => {
      const content = 'api_key: "abcdef1234567890123456789012"';
      const findings = scanForSecrets(content);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('Generic API Key');
    });

    it('should detect Generic Secret', () => {
      const content = 'secret = "mysecretkey12345678901234567890"';
      const findings = scanForSecrets(content);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('Generic Secret');
    });

    it('should detect Private Key', () => {
      const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...';
      const findings = scanForSecrets(content);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('Private Key');
    });

    it('should detect Bearer Token', () => {
      const content = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const findings = scanForSecrets(content);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('Bearer Token');
    });

    it('should return empty array for clean code', () => {
      const content = `
        function doSomething() {
          const data = fetchData();
          return process(data);
        }
      `;
      const findings = scanForSecrets(content);

      expect(findings).toHaveLength(0);
    });

    it('should handle multiple occurrences', () => {
      const content = `
        const key1 = "AKIAIOSFODNN7EXAMPLE";
        const key2 = "AKIAIOSFODNN8EXAMPLE";
      `;
      const findings = scanForSecrets(content);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('2 occurrences');
    });

    it('should not have false positives on variable names', () => {
      const content = `
        const apiKey = config.get('key');
        const secret = vault.retrieve();
      `;
      const findings = scanForSecrets(content);

      expect(findings).toHaveLength(0);
    });
  });

  describe('scanForRiskyPatterns', () => {
    it('should detect eval usage', () => {
      const content = 'const result = eval(userInput);';
      const findings = scanForRiskyPatterns(content);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('eval() usage');
    });

    it('should detect exec usage', () => {
      const content = 'exec(command, callback);';
      const findings = scanForRiskyPatterns(content);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('exec() usage');
    });

    it('should detect innerHTML assignment', () => {
      const content = 'element.innerHTML = userContent;';
      const findings = scanForRiskyPatterns(content);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('innerHTML assignment');
    });

    it('should detect dangerouslySetInnerHTML', () => {
      const content = '<div dangerouslySetInnerHTML={{__html: content}} />';
      const findings = scanForRiskyPatterns(content);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('dangerouslySetInnerHTML');
    });

    it('should return empty array for safe code', () => {
      const content = `
        function safeFn() {
          return execute();
        }
      `;
      const findings = scanForRiskyPatterns(content);

      expect(findings).toHaveLength(0);
    });

    it('should handle multiple occurrences', () => {
      const content = `
        eval(x);
        eval(y);
      `;
      const findings = scanForRiskyPatterns(content);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('2 occurrences');
    });
  });

  describe('runAllCIChecks', () => {
    it('should run all enabled layers', () => {
      fs.writeJsonSync(join(testDir, 'package.json'), {
        scripts: { lint: 'eslint .' },
      });
      vi.mocked(execSync).mockReturnValue('ok' as any);

      const config: CICheckConfig = {
        staticQuality: { enabled: true },
        security: { enabled: true, auditLevel: 'moderate' },
        complexity: { enabled: true, agent: 'oracle-low' },
        customChecks: [],
      };

      const summary = runAllCIChecks(testDir, config);

      expect(summary.results).toHaveLength(3);  // lint, npm audit, complexity placeholder
      expect(summary.results.some(r => r.layer === 'static-quality')).toBe(true);
      expect(summary.results.some(r => r.layer === 'security')).toBe(true);
      expect(summary.results.some(r => r.layer === 'complexity')).toBe(true);
    });

    it('should skip disabled layers', () => {
      const config: CICheckConfig = {
        staticQuality: { enabled: false },
        security: { enabled: false },
        complexity: { enabled: false },
        customChecks: [],
      };

      const summary = runAllCIChecks(testDir, config);

      expect(summary.results).toHaveLength(0);
    });

    it('should run custom checks', () => {
      vi.mocked(execSync).mockReturnValue('ok' as any);

      const config: CICheckConfig = {
        staticQuality: { enabled: false },
        security: { enabled: false },
        complexity: { enabled: false },
        customChecks: [
          { name: 'check1', command: 'npm run check1' },
          { name: 'check2', command: 'npm run check2' },
        ],
      };

      const summary = runAllCIChecks(testDir, config);

      expect(summary.results).toHaveLength(2);
      expect(summary.results[0].layer).toBe('custom');
      expect(summary.results[0].name).toBe('Custom: check1');
      expect(summary.results[1].name).toBe('Custom: check2');
    });

    it('should use custom commands when specified', () => {
      vi.mocked(execSync).mockReturnValue('ok' as any);

      const config: CICheckConfig = {
        staticQuality: {
          enabled: true,
          commands: ['npm run custom-lint', 'npm run custom-test'],
        },
        security: { enabled: false },
        complexity: { enabled: false },
        customChecks: [],
      };

      const summary = runAllCIChecks(testDir, config);

      expect(summary.results).toHaveLength(2);
      expect(summary.results[0].command).toBe('npm run custom-lint');
      expect(summary.results[1].command).toBe('npm run custom-test');
    });

    it('should use specified audit level', () => {
      vi.mocked(execSync).mockReturnValue('ok' as any);

      const config: CICheckConfig = {
        staticQuality: { enabled: false },
        security: { enabled: true, auditLevel: 'high' },
        complexity: { enabled: false },
        customChecks: [],
      };

      runAllCIChecks(testDir, config);

      expect(execSync).toHaveBeenCalledWith(
        'npm audit --audit-level=high',
        expect.any(Object)
      );
    });

    it('should mark allPassed false when checks fail', () => {
      fs.writeJsonSync(join(testDir, 'package.json'), {
        scripts: { lint: 'eslint .' },
      });
      const error: any = new Error('Failed');
      error.status = 1;
      error.stdout = '';
      error.stderr = 'Lint failed';
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      const config: CICheckConfig = {
        staticQuality: { enabled: true },
        security: { enabled: false },
        complexity: { enabled: false },
        customChecks: [],
      };

      const summary = runAllCIChecks(testDir, config);

      expect(summary.allPassed).toBe(false);
      expect(summary.failedChecks).toHaveLength(1);
      expect(summary.failedChecks[0]).toContain('Static: npm run lint');
    });

    it('should include complexity placeholder', () => {
      const config: CICheckConfig = {
        staticQuality: { enabled: false },
        security: { enabled: false },
        complexity: { enabled: true, agent: 'oracle-medium' },
        customChecks: [],
      };

      const summary = runAllCIChecks(testDir, config);

      expect(summary.results).toHaveLength(1);
      expect(summary.results[0].layer).toBe('complexity');
      expect(summary.results[0].passed).toBe(true);
      expect(summary.results[0].command).toBe('dispatch oracle-medium');
      expect(summary.results[0].stdout).toBe('AI complexity review dispatched');
    });

    it('should calculate total duration', () => {
      const config: CICheckConfig = {
        staticQuality: { enabled: false },
        security: { enabled: false },
        complexity: { enabled: false },
        customChecks: [],
      };

      const summary = runAllCIChecks(testDir, config);

      expect(summary.totalDuration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatCIResults', () => {
    it('should format all passed results', () => {
      const summary: CICheckSummary = {
        allPassed: true,
        results: [
          {
            name: 'Static: npm run lint',
            layer: 'static-quality',
            passed: true,
            command: 'npm run lint',
            exitCode: 0,
            stdout: 'ok',
            stderr: '',
            duration_ms: 100,
          },
          {
            name: 'Security: npm audit',
            layer: 'security',
            passed: true,
            command: 'npm audit --audit-level=moderate',
            exitCode: 0,
            stdout: 'ok',
            stderr: '',
            duration_ms: 200,
          },
        ],
        totalDuration_ms: 300,
        failedChecks: [],
      };

      const formatted = formatCIResults(summary);

      expect(formatted).toContain('CI Review Pipeline: ALL CHECKS PASSED');
      expect(formatted).toContain('[PASS] Static: npm run lint');
      expect(formatted).toContain('[PASS] Security: npm audit');
      expect(formatted).toContain('Total duration: 300ms');
    });

    it('should format failed results with details', () => {
      const summary: CICheckSummary = {
        allPassed: false,
        results: [
          {
            name: 'Static: npm run lint',
            layer: 'static-quality',
            passed: false,
            command: 'npm run lint',
            exitCode: 1,
            stdout: '',
            stderr: 'Lint errors found',
            duration_ms: 100,
          },
        ],
        totalDuration_ms: 100,
        failedChecks: ['Static: npm run lint'],
      };

      const formatted = formatCIResults(summary);

      expect(formatted).toContain('CI Review Pipeline: 1 CHECK(S) FAILED');
      expect(formatted).toContain('[FAIL] Static: npm run lint');
      expect(formatted).toContain('Command: npm run lint');
      expect(formatted).toContain('Exit code: 1');
      expect(formatted).toContain('Error: Lint errors found');
    });

    it('should truncate long stderr in formatted output', () => {
      const longError = 'e'.repeat(1000);
      const summary: CICheckSummary = {
        allPassed: false,
        results: [
          {
            name: 'Test',
            layer: 'static-quality',
            passed: false,
            command: 'test',
            exitCode: 1,
            stdout: '',
            stderr: longError,
            duration_ms: 100,
          },
        ],
        totalDuration_ms: 100,
        failedChecks: ['Test'],
      };

      const formatted = formatCIResults(summary);

      expect(formatted).toContain('Error: ' + longError.substring(0, 500));
    });

    it('should not include error details for passing checks', () => {
      const summary: CICheckSummary = {
        allPassed: true,
        results: [
          {
            name: 'Test',
            layer: 'static-quality',
            passed: true,
            command: 'test',
            exitCode: 0,
            stdout: 'All good',
            stderr: '',
            duration_ms: 100,
          },
        ],
        totalDuration_ms: 100,
        failedChecks: [],
      };

      const formatted = formatCIResults(summary);

      expect(formatted).not.toContain('Command:');
      expect(formatted).not.toContain('Exit code:');
    });
  });
});
