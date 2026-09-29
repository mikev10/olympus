/**
 * Source scanning over a package's own TypeScript program: imports, property
 * chains, casts, and the words inside identifiers. Used by the runtime
 * assertions that read the repository rather than compile a fixture (I7's
 * cast rule, I9's terminal rule, I10's naming rule).
 */
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';
import { toPosix, walkFiles, workspaceRelative, type WorkspacePackage } from './workspace.js';

export interface PackageProgram {
  readonly pkg: WorkspacePackage;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  /** The package's own source files: under its directory, not under node_modules. */
  readonly files: readonly ts.SourceFile[];
}

const programs = new Map<string, PackageProgram>();

/** The program `tsc -p` would build for the package, created once per worker. */
export function packageProgram(pkg: WorkspacePackage): PackageProgram {
  const cached = programs.get(pkg.dir);
  if (cached !== undefined) return cached;
  const tsconfigPath = join(pkg.dir, 'tsconfig.json');
  const read = ts.readConfigFile(tsconfigPath, (path) => ts.sys.readFile(path));
  if (read.error !== undefined) {
    throw new Error(`conformance: cannot read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfigPath));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
  const prefix = `${toPosix(pkg.dir)}/`;
  const files = program
    .getSourceFiles()
    .filter((sf) => toPosix(sf.fileName).startsWith(prefix) && !sf.fileName.includes('/node_modules/'));
  const result: PackageProgram = { pkg, program, checker: program.getTypeChecker(), files };
  programs.set(pkg.dir, result);
  return result;
}

/**
 * Every `.ts` file under the package's `src` that its program does not
 * contain, relative to the package directory, POSIX separators, sorted. A
 * tsconfig `include` that names only a safe file keeps the program non-empty
 * while the runtime source leaves it, and a scan that trusts the program
 * alone then scans nothing that matters. (S1 external review, finding 10.)
 */
export function sourceFilesOutsideProgram(pkg: WorkspacePackage): string[] {
  const inProgram = new Set(packageProgram(pkg).files.map((sf) => toPosix(sf.fileName)));
  return walkFiles(join(pkg.dir, 'src'))
    .filter((file) => !inProgram.has(toPosix(file)))
    .map((file) => toPosix(relative(pkg.dir, file)))
    .sort();
}

export interface Located {
  /** Workspace-relative path, POSIX separators. */
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function locate(sf: ts.SourceFile, node: ts.Node, text: string): Located {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { file: workspaceRelative(sf.fileName), line: line + 1, text };
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => {
    walk(child, visit);
  });
}

/** Module specifiers of static imports and re-exports, dynamic import(), and require(). */
export function moduleSpecifiers(sf: ts.SourceFile): Located[] {
  const out: Located[] = [];
  walk(sf, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) out.push(locate(sf, node, node.moduleSpecifier.text));
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const first = node.arguments[0];
      if ((isImport || isRequire) && first !== undefined && ts.isStringLiteral(first)) out.push(locate(sf, node, first.text));
    }
  });
  return out;
}

/** Dotted access chains rooted at an identifier, e.g. `process.stdout.isTTY`, longest form only. */
export function propertyChains(sf: ts.SourceFile): Located[] {
  const out: Located[] = [];
  const chainText = (node: ts.Node): string | undefined => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) {
      const left = chainText(node.expression);
      return left === undefined ? undefined : `${left}.${node.name.text}`;
    }
    return undefined;
  };
  walk(sf, (node) => {
    if (!ts.isPropertyAccessExpression(node)) return;
    if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) return; // not the longest form
    const text = chainText(node);
    if (text !== undefined) out.push(locate(sf, node, text));
  });
  return out;
}

/** Names TypeScript gives a type: its alias, its symbol, or nothing for anonymous types. */
function typeNames(type: ts.Type): string[] {
  const names: string[] = [];
  if (type.aliasSymbol !== undefined) names.push(type.aliasSymbol.name);
  const symbol = type.getSymbol();
  if (symbol !== undefined) names.push(symbol.name);
  return names;
}

export interface CastSite extends Located {
  readonly from: string;
}

/** `x as T`, `<T>x`, and `x satisfies T` where x is typed as one of `names`. */
export function castsFrom(sf: ts.SourceFile, checker: ts.TypeChecker, names: ReadonlySet<string>): CastSite[] {
  const out: CastSite[] = [];
  walk(sf, (node) => {
    if (!ts.isAsExpression(node) && !ts.isTypeAssertionExpression(node) && !ts.isSatisfiesExpression(node)) return;
    const type = checker.getTypeAtLocation(node.expression);
    const hit = typeNames(type).find((n) => names.has(n));
    if (hit !== undefined) out.push({ ...locate(sf, node, node.getText(sf)), from: hit });
  });
  return out;
}

export interface CastExpectation {
  /** 1-based line the cast must be reported on. */
  readonly line: number;
  /** The type name the scan must report the cast as coming from. */
  readonly from: string;
}

const CAST_ANNOTATION = /\/\/\s*expect-cast\s+(\S+)\s*$/;

/** Reads `// expect-cast <TypeName>` annotations; each applies to its own line. */
export function parseCastExpectations(source: string): CastExpectation[] {
  const out: CastExpectation[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    const match = CAST_ANNOTATION.exec(text);
    if (match?.[1] !== undefined) out.push({ line: index + 1, from: match[1] });
  });
  return out;
}

/**
 * Pairs reported casts with annotations by line and type name; the leftovers
 * on either side are failures. An unmet annotation means the scan stopped
 * seeing a form; an unexpected cast means it reports something it should not.
 */
export function matchCastExpectations(
  expectations: readonly CastExpectation[],
  casts: readonly CastSite[],
): { unmet: CastExpectation[]; unexpected: CastSite[] } {
  const remaining = [...casts];
  const unmet: CastExpectation[] = [];
  for (const expectation of expectations) {
    const index = remaining.findIndex((c) => c.line === expectation.line && c.from === expectation.from);
    if (index === -1) unmet.push(expectation);
    else remaining.splice(index, 1);
  }
  return { unmet, unexpected: remaining };
}

export type WordSource = 'identifier' | 'string';

export interface WordSite extends Located {
  readonly source: WordSource;
  readonly word: string;
}

/**
 * Splits an identifier, path, or key into lowercase words at case changes,
 * digits, and every non-letter: `olympusRunState` and `olympus-run_state`
 * both give ['olympus', 'run', 'state'].
 */
export function splitWords(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .filter((w) => w !== '')
    .map((w) => w.toLowerCase());
}

/** Every word inside every identifier and string literal of a file. */
export function words(sf: ts.SourceFile, transformString: (text: string) => string = (t) => t): WordSite[] {
  const out: WordSite[] = [];
  const push = (node: ts.Node, source: WordSource, text: string): void => {
    for (const word of splitWords(text)) out.push({ ...locate(sf, node, text), source, word });
  };
  walk(sf, (node) => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) push(node, 'identifier', node.text);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) push(node, 'string', transformString(node.text));
    else if (ts.isTemplateExpression(node)) {
      push(node, 'string', transformString(node.head.text));
      for (const span of node.templateSpans) push(node, 'string', transformString(span.literal.text));
    }
  });
  return out;
}

/**
 * Names from Greek myth and the product's own Greek name, lowercase. Curated
 * to names that read as branding; common English words that happen to be
 * Greek names (atlas, echo, iris, pan, muse, phoenix, oracle) are left out so
 * the rule never fires on ordinary vocabulary.
 */
export const GREEK_NAMES: readonly string[] = [
  'olympus', 'olympian', 'olympians', 'pantheon', 'acropolis', 'parthenon', 'delphi', 'delphic', 'pythia',
  'zeus', 'hera', 'poseidon', 'demeter', 'athena', 'athene', 'apollo', 'artemis', 'ares', 'aphrodite',
  'hephaestus', 'hermes', 'hestia', 'dionysus', 'hades', 'persephone', 'prometheus', 'epimetheus',
  'titan', 'titans', 'kronos', 'cronus', 'cronos', 'chronos', 'gaia', 'gaea', 'ouranos', 'uranus', 'nyx',
  'erebus', 'hypnos', 'thanatos', 'nemesis', 'tyche', 'themis', 'metis', 'mnemosyne', 'helios', 'selene',
  'eos', 'hecate', 'morpheus', 'aegis', 'ambrosia', 'hydra', 'cerberus', 'chimera', 'pegasus', 'medusa',
  'gorgon', 'minotaur', 'cyclops', 'icarus', 'daedalus', 'achilles', 'odysseus', 'heracles', 'hercules',
  'perseus', 'theseus', 'argus', 'argonaut', 'orion', 'cassandra', 'styx', 'lethe', 'elysium', 'tartarus',
  'kratos', 'moirai', 'charon', 'sisyphus', 'tantalus', 'pandora', 'asclepius', 'hygieia', 'plutus',
  'nike', 'hebe', 'ganymede', 'pallas', 'apollon', 'iapetus', 'oceanus', 'tethys', 'hyperion', 'theia',
  'rhea', 'phoebe', 'coeus', 'crius', 'agamemnon', 'menelaus', 'medea', 'circe', 'calypso', 'scylla',
  'charybdis', 'centaur', 'satyr', 'dryad', 'naiad', 'nereus', 'proteus', 'boreas', 'zephyrus', 'aeolus',
];

/** Members of the Node `process` object that assume a foreground process with a terminal attached. */
export const TERMINAL_PROCESS_MEMBERS: ReadonlySet<string> = new Set(['stdin', 'stdout', 'stderr', 'exit', 'exitCode', 'argv']);

/** Node's own declaration files for modules that exist to drive a terminal. */
const TERMINAL_DECLARATIONS = /\/@types\/node\/(tty|readline|readline\/promises)\.d\.ts$/;

function typeIs(checker: ts.TypeChecker, node: ts.Node, name: string): boolean {
  return typeNames(checker.getTypeAtLocation(node)).includes(name);
}

function memberName(node: ts.PropertyName | ts.BindingName | ts.Expression): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** Whether `node` names Node's global `process` object, directly or as `globalThis.process`. */
function isGlobalProcess(checker: ts.TypeChecker, node: ts.Identifier): boolean {
  if (node.text !== 'process') return false;
  const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
  return symbol?.declarations?.some((d) => ts.isVariableDeclaration(d) && toPosix(d.getSourceFile().fileName).includes('/@types/node/')) ?? false;
}

/**
 * Whether a reference to `process` lets the object go anywhere the scan cannot
 * follow it. Reading a member by name, destructuring named members, and
 * `typeof process` in a type keep it in view; the terminal members among those
 * are reported by the rules above. Anything else — an assignment, an
 * argument, a cast, a spread, a computed key — hands the object on under a
 * type the scan may not recognise, as `const p: Pick<NodeJS.Process, 'stdout'>
 * = process` does, so it is reported itself.
 */
function processEscapes(node: ts.Identifier): boolean {
  const expr: ts.Node = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node ? node.parent : node;
  const parent = expr.parent;
  if (ts.isTypeQueryNode(parent)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === expr) return false;
  if (ts.isElementAccessExpression(parent) && parent.expression === expr) return memberName(parent.argumentExpression) === undefined;
  if (ts.isVariableDeclaration(parent) && parent.initializer === expr && ts.isObjectBindingPattern(parent.name)) {
    return parent.name.elements.some((e) => e.dotDotDotToken !== undefined || memberName(e.propertyName ?? e.name) === undefined);
  }
  return true;
}

/**
 * Terminal use found by binding rather than by spelling: what the checker
 * resolves, not what the source happens to say. A value typed as Node's
 * `Process` has a terminal member read — by property access, by element
 * access with a literal key, or by destructuring — however the value was
 * named; any value typed as `Console` is referenced at all; and any
 * identifier resolves, through imports and re-exports, to a declaration in
 * Node's `tty` or `readline` modules. So `const { stdout } = process`,
 * `const p = process; p.exit()`, `const c = console`, and a re-export of
 * `tty` from a local module are each caught (the D-S1 note owed to P9).
 * `process` itself may only be read by member name: handed on as a value, it
 * is reported, since a structural type or a cast would hide it from the
 * rules that follow types (P9 review, codex-5).
 */
export function terminalBindings(sf: ts.SourceFile, checker: ts.TypeChecker): Located[] {
  const out: Located[] = [];
  walk(sf, (node) => {
    if (ts.isPropertyAccessExpression(node) && TERMINAL_PROCESS_MEMBERS.has(node.name.text) && typeIs(checker, node.expression, 'Process')) {
      out.push(locate(sf, node, `Process.${node.name.text}`));
    } else if (ts.isElementAccessExpression(node)) {
      const key = memberName(node.argumentExpression);
      if (key !== undefined && TERMINAL_PROCESS_MEMBERS.has(key) && typeIs(checker, node.expression, 'Process')) out.push(locate(sf, node, `Process.${key}`));
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = memberName(node.propertyName ?? node.name);
      if (key !== undefined && TERMINAL_PROCESS_MEMBERS.has(key) && typeIs(checker, node.parent, 'Process')) out.push(locate(sf, node, `Process.${key}`));
    } else if (ts.isIdentifier(node)) {
      if (typeIs(checker, node, 'Console')) {
        out.push(locate(sf, node, `Console ${node.text}`));
        return;
      }
      if (isGlobalProcess(checker, node) && processEscapes(node)) {
        out.push(locate(sf, node, `process as a value`));
        return;
      }
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
      const terminal = symbol?.declarations?.some((d) => TERMINAL_DECLARATIONS.test(toPosix(d.getSourceFile().fileName))) ?? false;
      if (terminal) out.push(locate(sf, node, `terminal module binding ${node.text}`));
    }
  });
  return out;
}
