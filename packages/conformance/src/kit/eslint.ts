/**
 * ESLint helpers for lint-backed invariants (I7). Two questions matter: is a
 * rule active in the configuration ESLint actually resolves for a file, and
 * does the rule fire on a violation. Reading the config file would answer
 * neither; a later override could disable the rule for a path, and an
 * option could exempt the violating type.
 */
import { readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import { workspaceRoot } from './workspace.js';

export type RuleSeverity = 'off' | 'warn' | 'error';

export interface WorkspaceEslintOptions {
  /**
   * When false, `eslint-disable` comments in the linted file are ignored, so
   * a fixture that is disabled for the ordinary lint run still reports.
   */
  readonly allowInlineConfig?: boolean;
  readonly cwd?: string;
}

/** An ESLint instance that resolves the same configuration CI runs from the workspace root. */
export function workspaceEslint(options: WorkspaceEslintOptions = {}): ESLint {
  return new ESLint({
    cwd: options.cwd ?? workspaceRoot(),
    allowInlineConfig: options.allowInlineConfig ?? true,
  });
}

function toSeverity(value: unknown): RuleSeverity | undefined {
  const raw = Array.isArray(value) ? (value as unknown[])[0] : value;
  switch (raw) {
    case 0:
    case 'off':
      return 'off';
    case 1:
    case 'warn':
      return 'warn';
    case 2:
    case 'error':
      return 'error';
    default:
      return undefined;
  }
}

/**
 * The severity of `rule` in the configuration resolved for `file`.
 * 'ignored' when ESLint would not lint the file at all; 'absent' when the
 * resolved configuration does not mention the rule.
 */
export async function resolvedRuleSeverity(
  eslint: ESLint,
  file: string,
  rule: string,
): Promise<RuleSeverity | 'ignored' | 'absent'> {
  if (await eslint.isPathIgnored(file)) return 'ignored';
  const config: unknown = await eslint.calculateConfigForFile(file);
  if (typeof config !== 'object' || config === null || !('rules' in config)) return 'absent';
  const rules: unknown = config.rules;
  if (typeof rules !== 'object' || rules === null || !Object.hasOwn(rules, rule)) return 'absent';
  return toSeverity((rules as Record<string, unknown>)[rule]) ?? 'absent';
}

export interface LintMessage {
  readonly line: number;
  readonly ruleId: string | null;
  readonly message: string;
}

/** Every message ESLint reports for `file`, in file order. */
export async function lintFile(eslint: ESLint, file: string): Promise<LintMessage[]> {
  const results = await eslint.lintFiles([file]);
  return results.flatMap((r) => r.messages.map((m) => ({ line: m.line, ruleId: m.ruleId, message: m.message })));
}

export interface LintExpectation {
  readonly line: number;
  readonly rule: string;
}

const ANNOTATION = /\/\/\s*expect-lint\s+(\S+)\s*$/;

/** Reads `// expect-lint <rule-id>` annotations; each applies to its own line. */
export function parseLintExpectations(source: string): LintExpectation[] {
  const out: LintExpectation[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    const match = ANNOTATION.exec(text);
    if (match?.[1] !== undefined) out.push({ line: index + 1, rule: match[1] });
  });
  return out;
}

/**
 * Every annotated rule must fire on its line. Messages beyond the annotations
 * are not failures: a lint fixture only promises the rules it names.
 */
export function unmetLintExpectations(expectations: readonly LintExpectation[], messages: readonly LintMessage[]): LintExpectation[] {
  return expectations.filter((e) => !messages.some((m) => m.line === e.line && m.ruleId === e.rule));
}

/** Lints a fixture with inline configuration ignored and throws unless every annotated rule fired. */
export async function assertLintFixture(file: string, cwd: string = workspaceRoot()): Promise<LintMessage[]> {
  const eslint = workspaceEslint({ allowInlineConfig: false, cwd });
  const expectations = parseLintExpectations(readFileSync(file, 'utf8'));
  if (expectations.length === 0) throw new Error(`lint fixture ${file} carries no expect-lint annotations`);
  const messages = await lintFile(eslint, file);
  const fatal = messages.filter((m) => m.ruleId === null);
  if (fatal.length > 0) {
    throw new Error(`lint fixture ${file} could not be linted: ${fatal.map((m) => m.message).join('; ')}`);
  }
  const unmet = unmetLintExpectations(expectations, messages);
  if (unmet.length > 0) {
    const detail = unmet.map((e) => `  line ${String(e.line)}: ${e.rule} did not fire`).join('\n');
    throw new Error(`lint fixture ${file} did not report as annotated\n${detail}`);
  }
  return messages;
}
