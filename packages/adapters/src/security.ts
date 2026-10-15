/**
 * The scanners a security check runs (R17). Each is declared once, here: the
 * image it is pinned to, the arguments the runtime runs it with, the inline
 * suppression markers its grammar has, the in-tree files it reads whatever
 * it is told, and how its report becomes findings. A manifest pins the image
 * and the rules; nothing in a manifest or a repository chooses the
 * arguments (D-R17-01).
 *
 * A finding's fingerprint is derived here from the report's fields, never
 * read from the scanner's own: gitleaks fingerprints by line, so a moved line
 * would read as a new finding (D-R17-02).
 */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Finding, SecurityCheckKind } from '@olympus-ai/integrity';

export interface SecurityScanner {
  readonly kind: SecurityCheckKind;
  /** `name@sha256:<digest>`: the only image a check of this scanner's kind may pin. */
  readonly image: string;
  /**
   * Inline markers that suppress a finding in this scanner's grammar,
   * matched case-insensitively as substrings of a line the diff added. Each
   * is a failure of its own whatever the scanner does with it (D-R17-04).
   */
  readonly markers: readonly string[];
  /**
   * Files, by base name, the scanner reads from the tree it scans whatever
   * its arguments say. The runtime removes every one from the copy it scans
   * (D-R17-03).
   */
  readonly inTreeConfig: readonly string[];
  /**
   * The rules a check that pins `config: null` runs with, as the text of a
   * configuration file that defers to the image's own; `null` when the
   * scanner has no rules of its own, and a check of it must pin some.
   */
  readonly defaultConfig: string | null;
  /** The base name the rules are written under in the sandbox: each scanner reads its configuration's format from the extension. */
  readonly configFile: string;
  /** The argument vector, run from the root of the tree it scans, with its rules at `config` in the sandbox. */
  invocation(config: string): readonly [string, ...string[]];
  /** The exit codes of a scan that ran to its end, findings or none. Any other exit is not a report. */
  readonly completed: readonly number[];
  /** The findings `stdout` reports, or undefined when it is not a whole report: never an empty list for a report it could not read (I5). */
  parse(stdout: string): Finding[] | undefined;
}

/** gitleaks 8.21.2, pinned by digest. R1's secret probe runs the same image (D-R17-01). */
export const SECRET_SCAN_IMAGE = 'zricethezav/gitleaks@sha256:0e99e8821643ea5b235718642b93bb32486af9c8162c8b8731f7cbdc951a7f46';

/** Semgrep 1.95.0, pinned by digest. It runs the rules a check pins and fetches none: `verify` has no egress. */
export const STATIC_ANALYSIS_IMAGE = 'semgrep/semgrep@sha256:30e6afa99ebd8e7b4115d4904898108eb4bf77025819e9263f09cf14e6f6e549';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A report path as the tree names it: forward slashes, no leading `./`, no sandbox mount prefix. */
export function treeRelative(path: string): string {
  let p = path.replace(/\\/g, '/');
  if (p.startsWith('/workspace/')) p = p.slice('/workspace/'.length);
  while (p.startsWith('./')) p = p.slice(2);
  return p;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * A secret's fingerprint: its rule and its value, and not its path or line,
 * so the same credential is the same finding wherever it moves (D-R17-02).
 * Only the hash leaves this function; the value is never stored.
 */
export function secretFingerprint(rule: string, secret: string): string {
  return sha256(`secret-scan\0${rule}\0${secret}`);
}

/** A static-analysis finding's fingerprint: its rule, its file, and the code it matched with whitespace collapsed, and not its line. */
export function staticFingerprint(rule: string, path: string, lines: string): string {
  return sha256(`static-analysis\0${rule}\0${path}\0${lines.trim().replace(/\s+/g, ' ')}`);
}

/** gitleaks' JSON report: an array of findings, each with `RuleID`, `File`, `StartLine`, and the unredacted `Secret`. */
export function parseGitleaksReport(stdout: string): Finding[] | undefined {
  const report = parseJson(stdout);
  if (!Array.isArray(report)) return undefined;
  const findings: Finding[] = [];
  for (const entry of report) {
    if (!isRecord(entry)) return undefined;
    const { RuleID: rule, File: file, StartLine: line, Secret: secret } = entry;
    if (typeof rule !== 'string' || typeof file !== 'string' || typeof line !== 'number' || typeof secret !== 'string') return undefined;
    // A redacted report has nothing to fingerprint, and every secret in it would collide.
    if (secret === '' || secret === 'REDACTED') return undefined;
    findings.push({ rule, location: { path: treeRelative(file), line }, fingerprint: secretFingerprint(rule, secret) });
  }
  return findings;
}

/**
 * Semgrep's JSON report. A scan that reports an error skipped what the error
 * names, so it is not a whole report and none of it is read (I5).
 */
export function parseSemgrepReport(stdout: string): Finding[] | undefined {
  const report = parseJson(stdout);
  if (!isRecord(report) || !Array.isArray(report.results) || !Array.isArray(report.errors)) return undefined;
  if (report.errors.length > 0) return undefined;
  const findings: Finding[] = [];
  for (const entry of report.results) {
    if (!isRecord(entry) || !isRecord(entry.start) || !isRecord(entry.extra)) return undefined;
    const { check_id: rule, path } = entry;
    const { line } = entry.start;
    const { lines } = entry.extra;
    if (typeof rule !== 'string' || typeof path !== 'string' || typeof line !== 'number' || typeof lines !== 'string') return undefined;
    // Semgrep withholds the matched code from a scan with no login; such a report cannot be fingerprinted.
    if (lines === 'requires login') return undefined;
    const relative = treeRelative(path);
    findings.push({ rule, location: { path: relative, line }, fingerprint: staticFingerprint(rule, relative, lines) });
  }
  return findings;
}

/**
 * gitleaks over the tree. `--config` always names the runtime's file, since
 * with none gitleaks reads `.gitleaks.toml` from the tree; it reads
 * `.gitleaksignore` from the tree whatever `--gitleaks-ignore-path` says, so
 * the runtime scans a copy without one (D-R17-03). `--ignore-gitleaks-allow`
 * reports a suppressed secret, and `--exit-code 0` makes a finding a report
 * rather than an error. No `--redact`: the fingerprint needs the value, and
 * the runtime never stores the stdout that carries it (D-R17-02).
 */
export const SECRET_SCANNER: SecurityScanner = {
  kind: 'secret-scan',
  image: SECRET_SCAN_IMAGE,
  markers: ['gitleaks:allow'],
  inTreeConfig: ['.gitleaksignore', '.gitleaks.toml'],
  defaultConfig: '[extend]\nuseDefault = true\n',
  configFile: 'gitleaks.toml',
  invocation: (config) => [
    'gitleaks', 'dir', '.', '--no-banner', '--log-level', 'error',
    '--config', config, '--gitleaks-ignore-path', posix.dirname(config), '--ignore-gitleaks-allow',
    '--report-format', 'json', '--report-path', '/dev/stdout', '--exit-code', '0',
  ],
  completed: [0],
  parse: parseGitleaksReport,
};

/**
 * Semgrep over the tree, with the pinned rules and nothing fetched.
 * `--disable-nosem` reports a suppressed finding, and `--no-git-ignore`
 * scans what `.gitignore` would hide; `.semgrepignore` is read from the tree
 * whatever it is told, so the runtime scans a copy without one (D-R17-03).
 */
export const STATIC_ANALYSIS_SCANNER: SecurityScanner = {
  kind: 'static-analysis',
  image: STATIC_ANALYSIS_IMAGE,
  // `nosem` is a prefix of `nosemgrep`, so one substring covers both of Semgrep's spellings.
  markers: ['nosem'],
  inTreeConfig: ['.semgrepignore'],
  defaultConfig: null,
  configFile: 'rules.yaml',
  invocation: (config) => [
    'semgrep', 'scan', '--config', config, '--json', '--metrics=off', '--disable-version-check',
    '--disable-nosem', '--no-git-ignore', '--quiet', '.',
  ],
  completed: [0],
  parse: parseSemgrepReport,
};

/** Each declared marker on a line, matched case-insensitively. */
export function markersIn(line: string, markers: readonly string[]): string[] {
  const lower = line.toLowerCase();
  return markers.filter((marker) => lower.includes(marker.toLowerCase()));
}

/**
 * The fingerprints `after` has more of than `base` does, one entry per
 * occurrence over the base's count. Counted rather than set-compared, so a
 * finding the base had once and the change copies elsewhere is new
 * (D-A-SC-02).
 */
export function newFindings(base: readonly Finding[], after: readonly Finding[]): Finding[] {
  const remaining = new Map<string, number>();
  for (const f of base) remaining.set(f.fingerprint, (remaining.get(f.fingerprint) ?? 0) + 1);
  const added: Finding[] = [];
  for (const f of after) {
    const left = remaining.get(f.fingerprint) ?? 0;
    if (left > 0) remaining.set(f.fingerprint, left - 1);
    else added.push(f);
  }
  return added;
}
