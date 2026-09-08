/**
 * Source scanning over a package's own TypeScript program: imports, property
 * chains, casts, and the words inside identifiers. Used by the runtime
 * assertions that read the repository rather than compile a fixture (I7's
 * cast rule, I9's terminal rule, I10's naming rule).
 */
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { toPosix, workspaceRelative, type WorkspacePackage } from './workspace.js';

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
