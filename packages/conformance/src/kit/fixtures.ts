/**
 * The compile-error mechanism. A fixture is a TypeScript file that constructs
 * a violation of an invariant and annotates, line by line, the exact
 * diagnostic the compiler must produce:
 *
 *     const boundary: WriteBoundary = { ..., vault: 'append' }; // expect-error TS2322: not assignable to type '"never"'
 *
 * The fixture is compiled on its own, with the conformance package's compiler
 * options (the same strictness the contracts are checked with), and the
 * diagnostics must match the annotations exactly: every annotation met, no
 * diagnostic unannotated. A fixture with no annotations is a compile-ok
 * fixture and must produce no diagnostics at all.
 *
 * Annotating the code and a message fragment is what makes this stronger than
 * `@ts-expect-error`, which is satisfied by any error on the next line: a
 * typo in the fixture cannot pass as the invariant holding.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import ts from 'typescript';
import { conformanceRoot, toPosix, workspaceRelative } from './workspace.js';

export interface Expectation {
  /** 1-based line the diagnostic must start on. */
  readonly line: number;
  readonly code: number;
  /** Substring the flattened diagnostic message must contain, if given. */
  readonly message: string | undefined;
}

export interface FixtureDiagnostic {
  /** Workspace-relative path of the file the diagnostic is in, POSIX separators. */
  readonly file: string;
  readonly line: number;
  readonly code: number;
  readonly message: string;
}

export interface FixtureOutcome {
  /** Workspace-relative path of the fixture, POSIX separators. */
  readonly file: string;
  readonly expectations: readonly Expectation[];
  readonly diagnostics: readonly FixtureDiagnostic[];
  /** Annotations no diagnostic satisfied. */
  readonly unmet: readonly Expectation[];
  /** Diagnostics no annotation claimed. */
  readonly unexpected: readonly FixtureDiagnostic[];
}

const ANNOTATION = /\/\/\s*expect-error\s+TS(\d+)(?::\s*(.*?))?\s*$/;
const COMMENT_ONLY = /^\s*\/\//;

/**
 * Reads `// expect-error TSnnnn[: message fragment]` annotations. An
 * annotation on a line with code applies to that line; one on a line of its
 * own applies to the next line that holds code.
 */
export function parseExpectations(source: string): Expectation[] {
  const lines = source.split(/\r?\n/);
  const out: Expectation[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? '';
    const match = ANNOTATION.exec(text);
    if (match === null) continue;
    const code = Number(match[1]);
    const message = match[2] === undefined || match[2] === '' ? undefined : match[2];
    let target = i + 1;
    if (COMMENT_ONLY.test(text)) {
      let j = i + 1;
      while (j < lines.length && (COMMENT_ONLY.test(lines[j] ?? '') || (lines[j] ?? '').trim() === '')) j += 1;
      target = j + 1;
    }
    out.push({ line: target, code, message });
  }
  return out;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Pairs diagnostics with annotations; the leftovers on either side are failures. */
export function matchExpectations(
  expectations: readonly Expectation[],
  diagnostics: readonly FixtureDiagnostic[],
  fixtureFile: string,
): { unmet: Expectation[]; unexpected: FixtureDiagnostic[] } {
  const remaining = [...diagnostics];
  const unmet: Expectation[] = [];
  for (const expectation of expectations) {
    const index = remaining.findIndex(
      (d) =>
        d.file === fixtureFile &&
        d.line === expectation.line &&
        d.code === expectation.code &&
        (expectation.message === undefined ||
          normalizeWhitespace(d.message).includes(normalizeWhitespace(expectation.message))),
    );
    if (index === -1) unmet.push(expectation);
    else remaining.splice(index, 1);
  }
  return { unmet, unexpected: remaining };
}

export interface FixtureInput {
  /** Absolute path, or a path relative to `fixtures/types` in the conformance package. */
  readonly path: string;
  /** Source text to compile in place of the file's contents; the file need not exist. */
  readonly text?: string;
}

/** Absolute path of a fixture under `fixtures/types`. */
export function fixturePath(relativeOrAbsolute: string): string {
  return isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : join(conformanceRoot(), 'fixtures', 'types', relativeOrAbsolute);
}

/**
 * Compiles fixtures one at a time against the conformance tsconfig. Every
 * file other than the fixture is parsed once and kept, so the first compile
 * pays for @types/node and the rest are quick.
 */
export class FixtureCompiler {
  private readonly options: ts.CompilerOptions;
  private readonly host: ts.CompilerHost;
  private readonly cache = new Map<string, ts.SourceFile>();
  private readonly overlay = new Map<string, string>();
  private program: ts.Program | undefined;

  constructor(tsconfigPath: string = join(conformanceRoot(), 'tsconfig.json')) {
    const read = ts.readConfigFile(tsconfigPath, (path) => ts.sys.readFile(path));
    if (read.error !== undefined) {
      throw new Error(
        `conformance: cannot read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`,
      );
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfigPath));
    const fatal = parsed.errors.filter((e) => e.category === ts.DiagnosticCategory.Error);
    if (fatal.length > 0) {
      const detail = fatal.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('; ');
      throw new Error(`conformance: cannot parse ${tsconfigPath}: ${detail}`);
    }
    this.options = {
      ...parsed.options,
      noEmit: true,
      declaration: false,
      composite: false,
      incremental: false,
    };
    const base = ts.createCompilerHost(this.options, true);
    const normalize = (fileName: string): string => toPosix(resolve(fileName));
    this.host = {
      ...base,
      fileExists: (fileName) => this.overlay.has(normalize(fileName)) || base.fileExists(fileName),
      readFile: (fileName) => this.overlay.get(normalize(fileName)) ?? base.readFile(fileName),
      getSourceFile: (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
        const key = normalize(fileName);
        const overlaid = this.overlay.get(key);
        if (overlaid !== undefined) {
          return ts.createSourceFile(fileName, overlaid, languageVersionOrOptions, true);
        }
        const cached = this.cache.get(key);
        if (cached !== undefined) return cached;
        const created = base.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
        if (created !== undefined && !isFixtureFile(key)) this.cache.set(key, created);
        return created;
      },
    };
  }

  compile(input: FixtureInput): FixtureOutcome {
    return this.build(input).outcome;
  }

  /**
   * Compiles the fixture and also hands back the program, the source file,
   * and the text, so a scan can run the type checker over the fixture
   * (kit/scan.ts) rather than only compare diagnostics.
   */
  build(input: FixtureInput): CompiledFixture {
    const absolute = fixturePath(input.path);
    const key = toPosix(resolve(absolute));
    this.overlay.clear();
    let text: string;
    if (input.text !== undefined) {
      text = input.text;
      this.overlay.set(key, text);
    } else {
      if (!existsSync(absolute)) throw new Error(`conformance: fixture not found: ${absolute}`);
      text = readFileSync(absolute, 'utf8');
    }
    const program = ts.createProgram({
      rootNames: [absolute],
      options: this.options,
      host: this.host,
      ...(this.program === undefined ? {} : { oldProgram: this.program }),
    });
    this.program = program;
    const sourceFile = program.getSourceFile(absolute);
    if (sourceFile === undefined) throw new Error(`conformance: compiler did not load ${absolute}`);
    const file = workspaceRelative(absolute);
    const diagnostics = ts.getPreEmitDiagnostics(program, sourceFile).map((d) => toFixtureDiagnostic(d, file));
    const expectations = parseExpectations(text);
    const { unmet, unexpected } = matchExpectations(expectations, diagnostics, file);
    return { outcome: { file, expectations, diagnostics, unmet, unexpected }, program, sourceFile, text };
  }
}

export interface CompiledFixture {
  readonly outcome: FixtureOutcome;
  readonly program: ts.Program;
  readonly sourceFile: ts.SourceFile;
  /** The fixture's source text as compiled. */
  readonly text: string;
}

function isFixtureFile(posixPath: string): boolean {
  return posixPath.includes('/fixtures/types/');
}

function toFixtureDiagnostic(diagnostic: ts.Diagnostic, fallbackFile: string): FixtureDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return { file: fallbackFile, line: 0, code: diagnostic.code, message };
  }
  const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return { file: workspaceRelative(diagnostic.file.fileName), line: line + 1, code: diagnostic.code, message };
}

/** A human-readable account of a failed outcome, or undefined when it passed. */
export function describeFailure(outcome: FixtureOutcome): string | undefined {
  if (outcome.unmet.length === 0 && outcome.unexpected.length === 0) return undefined;
  const lines: string[] = [`fixture ${outcome.file} did not compile as annotated`];
  for (const e of outcome.unmet) {
    const fragment = e.message === undefined ? '' : `: ${e.message}`;
    lines.push(
      `  expected at line ${String(e.line)}: TS${String(e.code)}${fragment}` +
        ' (no such diagnostic: the violation now compiles, or compiles differently)',
    );
  }
  for (const d of outcome.unexpected) {
    lines.push(`  unexpected at ${d.file}:${String(d.line)}: TS${String(d.code)}: ${normalizeWhitespace(d.message)}`);
  }
  if (outcome.expectations.length === 0 && outcome.unexpected.length > 0) {
    lines.push('  (this fixture carries no expect-error annotations, so it must compile cleanly)');
  }
  return lines.join('\n');
}

/** Throws when the fixture did not compile as annotated. */
export function assertFixture(outcome: FixtureOutcome): void {
  const failure = describeFailure(outcome);
  if (failure !== undefined) throw new Error(failure);
}

let shared: FixtureCompiler | undefined;

/** One compiler per worker, so fixtures share the parsed contracts and lib. */
export function sharedFixtureCompiler(): FixtureCompiler {
  shared ??= new FixtureCompiler();
  return shared;
}
