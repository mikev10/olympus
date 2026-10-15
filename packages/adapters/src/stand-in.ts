/**
 * Stand-in scanners: the `SecurityScanner` contract over a sandbox that runs
 * no image. Each is a `node` script run in the tree it scans, so the line's
 * security checks run on the stub sandbox, which spawns commands on the
 * host. They find only what a fixture seeds, and the graph builder declares
 * any scanner it does not attest unsafe, so no run on one goes above L1
 * (R17). They report in the format of the scanner they stand in for, and
 * are parsed by its parser, so the runtime reads them as it reads the real
 * reports.
 */
import { parseGitleaksReport, parseSemgrepReport, SECRET_SCANNER, type SecurityScanner } from './security.js';

/** A secret no real rule set matches and a seeded fixture can spell: `SEEDED-SECRET-` and twenty capitals or digits. */
export const SEEDED_SECRET = /SEEDED-SECRET-[A-Z0-9]{20}/;

/** Code the stand-in static-analysis scanner reports: a call to `eval`. */
export const SEEDED_SINK = /\beval\(/;

/** Not an image: a name no registry serves, at a digest of zeros, so a stand-in can never be mistaken for a pin. */
export const STAND_IN_SECRET_SCAN_IMAGE = `stand-in/secret-scan@sha256:${'0'.repeat(64)}`;
export const STAND_IN_STATIC_ANALYSIS_IMAGE = `stand-in/static-analysis@sha256:${'0'.repeat(64)}`;

/**
 * Walks the working directory, skipping `node_modules` and VCS directories,
 * and prints each match of `pattern` on any line as `report` renders it. It
 * honours a `.gitleaksignore` in the tree it scans, as gitleaks does, so a
 * runtime that failed to remove one would be caught by the stand-in too.
 */
function script(pattern: RegExp, report: 'gitleaks' | 'semgrep'): string {
  return [
    "const fs = require('node:fs'); const path = require('node:path');",
    `const pattern = new RegExp(${JSON.stringify(pattern.source)}, 'g');`,
    "const skip = new Set(['node_modules', '.git', '.hg', '.sl', '.svn']);",
    "const ignored = new Set(fs.existsSync('.gitleaksignore') ? fs.readFileSync('.gitleaksignore', 'utf8').split(/\\r?\\n/).filter(Boolean) : []);",
    'const found = [];',
    'const walk = (dir) => {',
    '  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {',
    '    const file = path.join(dir, entry.name);',
    '    if (entry.isDirectory()) { if (!skip.has(entry.name)) walk(file); continue; }',
    '    if (!entry.isFile()) continue;',
    "    const rel = path.relative('.', file).split(path.sep).join('/');",
    "    fs.readFileSync(file, 'latin1').split(/\\r?\\n/).forEach((text, i) => {",
    '      for (const m of text.matchAll(pattern)) found.push({ rel, line: i + 1, text, match: m[0] });',
    '    });',
    '  }',
    '};',
    "walk('.');",
    report === 'gitleaks'
      ? "process.stdout.write(JSON.stringify(found.filter((f) => !ignored.has(`${f.rel}:seeded-secret:${f.line}`)).map((f) => ({ RuleID: 'seeded-secret', File: f.rel, StartLine: f.line, Secret: f.match }))));"
      : "process.stdout.write(JSON.stringify({ results: found.map((f) => ({ check_id: 'seeded-sink', path: f.rel, start: { line: f.line }, extra: { lines: f.text } })), errors: [] }));",
  ].join('\n');
}

/** Stands in for gitleaks: the same markers, in-tree files, and report format, over `SEEDED_SECRET`. */
export const STAND_IN_SECRET_SCANNER: SecurityScanner = {
  kind: 'secret-scan',
  image: STAND_IN_SECRET_SCAN_IMAGE,
  markers: SECRET_SCANNER.markers,
  inTreeConfig: SECRET_SCANNER.inTreeConfig,
  defaultConfig: SECRET_SCANNER.defaultConfig,
  configFile: SECRET_SCANNER.configFile,
  invocation: () => ['node', '-e', script(SEEDED_SECRET, 'gitleaks')],
  completed: [0],
  parse: parseGitleaksReport,
};

/** Stands in for Semgrep: its markers and report format, over `SEEDED_SINK`. Its rules are pinned, and it reads none of them. */
export const STAND_IN_STATIC_ANALYSIS_SCANNER: SecurityScanner = {
  kind: 'static-analysis',
  image: STAND_IN_STATIC_ANALYSIS_IMAGE,
  markers: ['nosem'],
  inTreeConfig: ['.semgrepignore'],
  defaultConfig: null,
  configFile: 'rules.yaml',
  invocation: () => ['node', '-e', script(SEEDED_SINK, 'semgrep')],
  completed: [0],
  parse: parseSemgrepReport,
};
