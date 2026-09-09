/**
 * ESLint helpers for lint-backed invariants (I7). Two questions matter: is a
 * rule active in the configuration ESLint actually resolves for a file, and
 * does the rule fire on a violation. Reading the config file would answer
 * neither; a later override could disable the rule for a path, and an
 * option could exempt the violating type.
 */
import { readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { walkFiles, workspaceRelative, workspaceRoot, type WorkspacePackage } from './workspace.js';

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

export type InlineConfigKind = 'disable' | 'disable-line' | 'disable-next-line' | 'config';

/** An ESLint directive or configuration comment: the inline configuration the ordinary lint run honours. */
export interface InlineConfigComment {
  readonly line: number;
  readonly kind: InlineConfigKind;
  /** The rules the comment names; empty for a disable that names none, which disables every rule. */
  readonly rules: readonly string[];
  /** The comment body, trimmed. */
  readonly text: string;
}

/** `eslint`, `eslint-disable`, `eslint-disable-line`, `eslint-disable-next-line`, followed by whitespace or the end. */
const DIRECTIVE = /^eslint(-disable(?:-next-line|-line)?)?(?=\s|$)([\s\S]*)$/;
/** ESLint's description separator: a run of two or more dashes between whitespace. */
const DESCRIPTION = /\s-{2,}\s[\s\S]*$/;
/** A rule name followed by a colon inside a configuration comment, with or without quotes. */
const CONFIG_KEY = /["']?([^\s,:"'{}]+)["']?\s*:/g;

/** Every comment in the file, in order, including ones no statement owns (inside an empty argument list, say). */
function commentRanges(sf: ts.SourceFile): ts.CommentRange[] {
  const text = sf.text;
  const seen = new Set<number>();
  const out: ts.CommentRange[] = [];
  const add = (ranges: ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      out.push(range);
    }
  };
  const visit = (node: ts.Node): void => {
    // A JSDoc node's children start inside the comment; the comment itself is
    // trivia of the declaration it documents and is collected there.
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sf);
    if (children.length === 0) {
      add(ts.getLeadingCommentRanges(text, node.getFullStart()));
      add(ts.getTrailingCommentRanges(text, node.getEnd()));
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sf);
  add(ts.getLeadingCommentRanges(text, sf.endOfFileToken.getFullStart()));
  return out.sort((a, b) => a.pos - b.pos);
}

function parseDirective(body: string, line: number): InlineConfigComment | undefined {
  const match = DIRECTIVE.exec(body);
  if (match === null) return undefined;
  const suffix = match[1];
  const rest = (match[2] ?? '').replace(DESCRIPTION, '').trim();
  if (suffix === undefined) {
    const rules = [...rest.matchAll(CONFIG_KEY)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
    return { line, kind: 'config', rules, text: body };
  }
  const kind: InlineConfigKind = suffix === '-disable' ? 'disable' : suffix === '-disable-line' ? 'disable-line' : 'disable-next-line';
  const rules = rest === '' ? [] : rest.split(/[\s,]+/).filter((r) => r !== '');
  return { line, kind, rules, text: body };
}

/**
 * Every ESLint directive and configuration comment in `source`, read from
 * the parsed file so a directive inside a string or a regular expression is
 * not one. `eslint-enable` is not returned: it restores rules, it never
 * suppresses one.
 */
export function inlineConfigComments(source: string, fileName = 'source.ts'): InlineConfigComment[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: InlineConfigComment[] = [];
  for (const range of commentRanges(sf)) {
    const raw = source.slice(range.pos, range.end);
    const body = (range.kind === ts.SyntaxKind.MultiLineCommentTrivia ? raw.slice(2, -2) : raw.slice(2)).trim();
    const parsed = parseDirective(body, sf.getLineAndCharacterOfPosition(range.pos).line + 1);
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
}

/** Whether the comment turns off, or could reconfigure, any of `rules`: a disable that names one, a disable that names none, or a configuration comment that names one. */
export function suppressesAny(rules: readonly string[], comment: InlineConfigComment): boolean {
  if (comment.kind !== 'config' && comment.rules.length === 0) return true;
  return comment.rules.some((r) => rules.includes(r));
}

export interface InlineSuppression {
  /** Workspace-relative path, POSIX separators. */
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];

/**
 * Every inline comment in the packages' sources that suppresses or
 * reconfigures one of `rules`. Files under a `fixtures/` directory are
 * skipped: a lint fixture must carry the disable comments that let the
 * ordinary run pass, and it is linted with inline configuration ignored.
 */
export function inlineSuppressions(
  rules: readonly string[],
  packages: readonly WorkspacePackage[],
  root: string = workspaceRoot(),
): InlineSuppression[] {
  const out: InlineSuppression[] = [];
  for (const pkg of packages) {
    for (const file of walkFiles(pkg.dir, { extensions: SOURCE_EXTENSIONS })) {
      const relative = workspaceRelative(file, root);
      if (relative.includes('/fixtures/')) continue;
      for (const comment of inlineConfigComments(readFileSync(file, 'utf8'), file)) {
        if (suppressesAny(rules, comment)) out.push({ file: relative, line: comment.line, text: comment.text });
      }
    }
  }
  return out;
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
