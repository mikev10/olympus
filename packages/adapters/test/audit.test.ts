/**
 * The dependency auditors (R13a, D-R13a-06). Outputs are as npm 10.9.8 and
 * pnpm 10.18.3 printed them in the pinned image (`docs/decisions.md`,
 * D-R13a-02). A report is read only when whole; anything else is never an
 * empty list (I5).
 */
import { describe, expect, test } from 'vitest';
import { NPM_AUDITOR, PNPM_AUDITOR } from '../src/index.js';

const NPM_LOCK = '{\n  "packages": {\n    "": {},\n    "node_modules/minimist": {\n      "version": "1.2.5"\n    }\n  }\n}\n';
const NPM_REPORT = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    minimist: {
      name: 'minimist', severity: 'critical',
      via: [{ source: 1097678, name: 'minimist', title: 'Prototype Pollution in minimist', url: 'https://github.com/advisories/GHSA-xvch-5gv4-984h' }],
      effects: [], nodes: ['node_modules/minimist'],
    },
    parent: { name: 'parent', severity: 'critical', via: ['minimist'], effects: [] },
  },
  metadata: { vulnerabilities: { critical: 1, total: 1 } },
});

const PNPM_LOCK = "lockfileVersion: '9.0'\n\npackages:\n\n  minimist@1.2.5:\n    resolution: {integrity: sha512-x}\n";
const PNPM_REPORT = JSON.stringify({
  advisories: {
    1097678: { id: 1097678, module_name: 'minimist', github_advisory_id: 'GHSA-xvch-5gv4-984h', url: 'https://github.com/advisories/GHSA-xvch-5gv4-984h', findings: [{ version: '1.2.5', paths: ['.>minimist'] }] },
  },
  metadata: { vulnerabilities: { critical: 1 } },
});

describe('npm audit', () => {
  test('a whole report is one finding per advisory and package, located in the lockfile', () => {
    const parsed = NPM_AUDITOR.parse(NPM_REPORT, NPM_LOCK);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]).toMatchObject({ rule: 'GHSA-xvch-5gv4-984h', packageName: 'minimist', line: 4 });
  });

  test('an empty report is no findings, and is whole', () => {
    const parsed = NPM_AUDITOR.parse(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} }), NPM_LOCK);
    expect(parsed).toEqual({ ok: true, findings: [] });
  });

  test('a failed advisory request is unreachable, never zero findings', () => {
    const out = JSON.stringify({ message: 'request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org', error: { summary: '', detail: '' } });
    expect(NPM_AUDITOR.parse(out, NPM_LOCK)).toEqual({ ok: false, unreachable: true });
  });

  test('output that is not a report is not one', () => {
    expect(NPM_AUDITOR.parse('npm ERR! something', NPM_LOCK)).toEqual({ ok: false, unreachable: false });
    expect(NPM_AUDITOR.parse('', NPM_LOCK)).toEqual({ ok: false, unreachable: false });
  });

  test('a package the lockfile does not name has no line, never an invented one', () => {
    const parsed = NPM_AUDITOR.parse(NPM_REPORT, '{}');
    expect(parsed.ok && parsed.findings[0]?.line).toBeNull();
  });
});

describe('pnpm audit', () => {
  test('a whole report is located at the package entry', () => {
    const parsed = PNPM_AUDITOR.parse(PNPM_REPORT, PNPM_LOCK);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.findings[0]).toMatchObject({ rule: 'GHSA-xvch-5gv4-984h', packageName: 'minimist', line: 5 });
  });

  test('an unreachable registry is unreachable', () => {
    const out = JSON.stringify({ error: { code: 'ECONNREFUSED', message: 'request to http://127.0.0.1:9/-/npm/v1/security/audits failed, reason: connect ECONNREFUSED 127.0.0.1:9' } });
    expect(PNPM_AUDITOR.parse(out, PNPM_LOCK)).toEqual({ ok: false, unreachable: true });
  });

  test('the version is pinned in the invocation', () => {
    expect(PNPM_AUDITOR.invocation.join(' ')).toMatch(/^corepack pnpm@\d+\.\d+\.\d+ audit --json$/u);
  });
});
