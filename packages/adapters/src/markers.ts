/**
 * Markers that stop a test from running as a test: skipped, focused (which
 * skips every other test in the file), left as a todo, run only on a
 * condition, or expected to fail. vitest and jest share most of them; the
 * union is detected in both, because a marker a framework does not support
 * fails that framework's run loudly and costs nothing to report.
 *
 * Each marker is reported as `<chain>: <test name>`, e.g. `it.skip: adds two
 * numbers`, with no line number, so a marker that moved is the same marker
 * and a caller diffing two files sees only the ones that were added.
 *
 * A declarer is found by the name it is called under, and the names a file
 * can call one under are not only `test` and `describe`: an import can rename
 * it, a fixture can extend it into a new binding, and a chain can be written
 * through parentheses or a string key. Every such form is resolved to the
 * declarer it stands for. A form that cannot be resolved — a declarer handed
 * to something else, or reached by a key only running the file would know —
 * is refused rather than reported as a file with no markers, because an empty
 * list is what a caller acts on (I5).
 */
import ts from 'typescript';
import { refuse } from './refusal.js';
import { unwrap } from './static.js';

/** Functions that declare a test or a suite. */
const DECLARERS: ReadonlySet<string> = new Set(['describe', 'it', 'test', 'suite', 'bench']);
/** Names that are a marker on their own: jasmine-style `xit`, `fit`, and the rest. */
const PREFIXED: ReadonlySet<string> = new Set(['xit', 'xtest', 'xdescribe', 'fit', 'fdescribe', 'ftest']);
/** Modifiers in a declarer's chain that are markers. */
const MODIFIERS: ReadonlySet<string> = new Set(['skip', 'only', 'todo', 'skipIf', 'runIf', 'fails', 'failing']);

/** Declarers that open a suite, whose title qualifies every case inside it. */
const SUITES: ReadonlySet<string> = new Set(['describe', 'suite', 'xdescribe', 'fdescribe']);
/** Declarers that declare one case. `bench` is neither: a benchmark is not a test. */
const CASES: ReadonlySet<string> = new Set(['it', 'test', 'xit', 'xtest', 'fit', 'ftest']);
/** Chain parts that build a declarer rather than call one: `test.extend({...})` declares no case. */
const BUILDERS: ReadonlySet<string> = new Set(['extend', 'scoped']);
/** Chain parts that call a declarer once per row of a table. */
const TABLES: ReadonlySet<string> = new Set(['each', 'for']);

/** A declarer call's chain: the framework name it resolves to, and the parts called on it. */
interface Chain {
  readonly root: string;
  readonly parts: readonly string[];
}

function text(node: ts.Node, sf: ts.SourceFile): string {
  return node.getText(sf).replace(/\s+/g, ' ').trim();
}

/** The name a `['skip']`-style access selects, or undefined when only running the file would say. */
function literalKey(node: ts.ElementAccessExpression): string | undefined {
  const argument = unwrap(node.argumentExpression);
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text;
  if (ts.isNumericLiteral(argument)) return argument.text;
  return undefined;
}

/**
 * Every local name that declares a test, and the chain each stands for.
 * `import { test as check }` makes `check` a declarer; `const myTest =
 * test.extend({...})`, which is how vitest fixtures are written, makes
 * `myTest` one; `const s = test.skip` makes `s` one that carries the marker
 * already in it. Aliases of aliases resolve, which is why this runs to a
 * fixed point.
 */
function declarersIn(sf: ts.SourceFile): ReadonlyMap<string, Chain> {
  const names = new Map<string, Chain>();
  for (const name of [...DECLARERS, ...PREFIXED]) names.set(name, { root: name, parts: [] });
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = names.get((element.propertyName ?? element.name).text);
      if (imported !== undefined) names.set(element.name.text, imported);
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        if (names.has(declaration.name.text)) continue;
        const chain = chainOf(declaration.initializer, sf, names);
        if (chain !== undefined) {
          names.set(declaration.name.text, chain);
          changed = true;
        }
      }
    }
  }
  return names;
}

/**
 * The chain of an expression rooted at a declarer, e.g. `test.skip.each`,
 * with call arguments kept: `test.skipIf(cond)`. Parentheses and type
 * wrappers are stripped, and a string key is the name it spells. Undefined
 * when the expression is not rooted at a declarer at all.
 */
function chainOf(node: ts.Expression, sf: ts.SourceFile, names: ReadonlyMap<string, Chain>): Chain | undefined {
  const value = unwrap(node);
  if (ts.isIdentifier(value)) {
    const known = names.get(value.text);
    return known === undefined ? undefined : { root: known.root, parts: [...known.parts] };
  }
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    const inner = chainOf(value.expression, sf, names);
    if (inner === undefined) return undefined;
    const part = ts.isPropertyAccessExpression(value) ? value.name.text : literalKey(value);
    if (part === undefined) {
      refuse(
        'unsupported-feature',
        `${text(value, sf)} selects a property of a test declarer by a key only running the file would resolve, so its markers cannot be read`,
      );
    }
    return { root: inner.root, parts: [...inner.parts, part] };
  }
  if (ts.isCallExpression(value)) {
    const inner = chainOf(value.expression, sf, names);
    if (inner === undefined) return undefined;
    if (inner.parts.length === 0) return { root: inner.root, parts: ['()'] };
    const last = inner.parts[inner.parts.length - 1] ?? '';
    return { root: inner.root, parts: [...inner.parts.slice(0, -1), `${last}(${value.arguments.map((a) => text(a, sf)).join(', ')})`] };
  }
  return undefined;
}

function isDeclarer(callee: ts.Expression, sf: ts.SourceFile, names: ReadonlyMap<string, Chain>): boolean {
  return chainOf(callee, sf, names) !== undefined;
}

function nameOf(call: ts.CallExpression, sf: ts.SourceFile): string {
  const first = call.arguments[0];
  if (first === undefined) return '<unnamed>';
  if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) return first.text;
  return `<${text(first, sf)}>`;
}

/**
 * The parameter of a case's function that vitest binds to the test context:
 * the first, or for `.for` the second, after the row. A `.each` function is
 * given only the row, and a suite's function nothing.
 */
function contextParameter(call: ts.CallExpression, chain: Chain): ts.ParameterDeclaration | undefined {
  if (!CASES.has(chain.root)) return undefined;
  const bare = chain.parts.map((p) => p.replace(/\(.*\)$/s, ''));
  if (bare.includes('each')) return undefined;
  // `.for` hands the row first and the context second.
  const callback = [...call.arguments].reverse().find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
  if (callback === undefined || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) return undefined;
  return callback.parameters[bare.includes('for') ? 1 : 0];
}

/** The outermost node standing for `node` itself: parentheses and type wrappers climbed. */
function climb(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent) || ts.isSatisfiesExpression(current.parent)
    || ts.isNonNullExpression(current.parent) || ts.isTypeAssertionExpression(current.parent)) current = current.parent;
  return current;
}

function isCalled(node: ts.Node): boolean {
  const outer = climb(node);
  return ts.isCallExpression(outer.parent) && outer.parent.expression === outer;
}

function lineOf(node: ts.Node, sf: ts.SourceFile): string {
  return String(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
}

/**
 * `context.skip()`, or the context's `skip` destructured, inside a test body.
 * A destructured `skip` is followed under the name it was given: `{ skip:
 * omit }` binds the same function to `omit`, and calling it skips the test.
 *
 * Every other way to reach `skip` is refused rather than read as no marker:
 * `skip` taken as a value (`const omit = ctx.skip`), a key only running the
 * file would resolve, and — where the parameter is vitest's test context —
 * the context itself aliased or handed to a helper, which could call `skip`
 * under any name. Jest binds the first parameter to `done`, which has no
 * `skip` and is routinely handed on, so there the context may escape.
 */
function contextSkips(call: ts.CallExpression, chain: Chain, sf: ts.SourceFile, names: ReadonlyMap<string, Chain>, name: string, out: string[], testContext: boolean): void {
  const parameter = contextParameter(call, chain);
  if (parameter === undefined) return;
  const callback = parameter.parent;
  const cannotRead = (node: ts.Node, what: string): never => refuse(
    'unsupported-feature',
    `${what} at line ${lineOf(node, sf)}, in the test '${name}', so whether that test skips itself cannot be read`,
  );
  const pattern = ts.isObjectBindingPattern(parameter.name) ? parameter.name : undefined;
  const rest = pattern?.elements.find((e) => e.dotDotDotToken !== undefined);
  // The names the whole context is bound to: the parameter, or what a `...rest` gathers.
  const bound = new Set<string>();
  if (ts.isIdentifier(parameter.name)) bound.add(parameter.name.text);
  else if (rest !== undefined && ts.isIdentifier(rest.name)) bound.add(rest.name.text);
  else if (rest !== undefined || ts.isArrayBindingPattern(parameter.name)) cannotRead(parameter, 'the test context is destructured into a pattern');
  const destructured = pattern?.elements.find((e) => e !== rest && (e.propertyName ?? e.name).getText(sf) === 'skip');
  if (destructured !== undefined && !ts.isIdentifier(destructured.name)) cannotRead(destructured, "the context's `skip` is destructured into a pattern");
  const local = destructured !== undefined && ts.isIdentifier(destructured.name) ? destructured.name.text : undefined;
  const declarations = new Set<ts.Node>([parameter.name, ...(rest === undefined ? [] : [rest.name]), ...(destructured === undefined ? [] : [destructured.name])]);

  const visit = (node: ts.Node): void => {
    // A nested declarer reports its own body.
    if (node !== callback && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isCallExpression(node.parent)
      && node.parent !== call && isDeclarer(node.parent.expression, sf, names)) return;
    if (ts.isIdentifier(node) && !declarations.has(node) && !isPropertyName(node)) {
      if (bound.has(node.text)) {
        const use = climb(node);
        const access = use.parent;
        if ((ts.isPropertyAccessExpression(access) || ts.isElementAccessExpression(access)) && access.expression === use) {
          const key = ts.isPropertyAccessExpression(access) ? access.name.text : literalKey(access);
          if (key === undefined) cannotRead(access, `\`${text(access, sf)}\` selects a property of the test context by a computed key`);
          if (key === 'skip') {
            if (!isCalled(access)) cannotRead(access, `\`${text(access, sf)}\` takes the context's \`skip\` as a value rather than calling it`);
            out.push(`${node.text}.skip: ${name}`);
          }
        } else if (testContext) {
          cannotRead(node, `the test context \`${node.text}\` is used as a value — aliased, destructured, or handed on — rather than read by a property`);
        }
      } else if (node.text === local) {
        if (!isCalled(node)) cannotRead(node, `the context's \`skip\`, bound as \`${local}\`, is used as a value rather than called`);
        out.push(`${local}: ${name}`);
      }
    }
    node.forEachChild(visit);
  };
  visit(callback);
}

/** An identifier that names a property rather than a binding: `a.name`, `{ name: v }`, `{ name }` in a type. */
function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isBindingElement(parent) && parent.propertyName === node)
    || (ts.isPropertySignature(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node);
}

/**
 * The declarations that may bind a declarer's name: the imports, and the
 * top-level aliases `declarersIn` resolved. Any other binding of one of those
 * names — a local `const test = ...`, a parameter named `describe`, a
 * top-level `function it() {}` — shadows the declarer, so a call under that
 * name would be read as declaring a test that never runs. It is refused.
 */
function assertNoShadow(sf: ts.SourceFile, names: ReadonlyMap<string, Chain>): void {
  const builtin = new Set([...DECLARERS, ...PREFIXED]);
  const allowed = new Set<ts.Node>();
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) for (const element of bindings.elements) allowed.add(element.name);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && !builtin.has(declaration.name.text) && names.has(declaration.name.text)) allowed.add(declaration.name);
    }
  }
  const visit = (node: ts.Node): void => {
    const bindingName = (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)
      || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)
      || ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node) || ts.isEnumDeclaration(node))
      ? node.name
      : undefined;
    if (bindingName !== undefined && ts.isIdentifier(bindingName) && names.has(bindingName.text) && !allowed.has(bindingName)) {
      refuse(
        'unsupported-feature',
        `\`${bindingName.text}\` is declared again at line ${lineOf(bindingName, sf)}, shadowing the test declarer, `
        + 'so which calls under that name declare tests cannot be read',
      );
    }
    node.forEachChild(visit);
  };
  visit(sf);
}

/**
 * Refuses a declarer that escapes into something this file cannot follow: a
 * declarer passed to a function, exported, or stored in an object, could be
 * called anywhere under any name, and the markers on those calls would be
 * read as absent.
 */
function assertNoEscape(sf: ts.SourceFile, names: ReadonlyMap<string, Chain>): void {
  assertNoShadow(sf, names);
  const declaredHere = new Set<ts.Node>();
  const noteDeclaration = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node)) {
      declaredHere.add(node.name);
      if (node.propertyName !== undefined) declaredHere.add(node.propertyName);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declaredHere.add(node.name);
    node.forEachChild(noteDeclaration);
  };
  noteDeclaration(sf);

  const isReachable = (id: ts.Identifier): boolean => {
    let node: ts.Node = id;
    for (;;) {
      if (ts.isSourceFile(node)) return false;
      const parent: ts.Node = node.parent;
      if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)
        || ts.isNonNullExpression(parent) || ts.isTypeAssertionExpression(parent)) {
        node = parent;
        continue;
      }
      if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node) {
        node = parent;
        continue;
      }
      if (ts.isCallExpression(parent) && parent.expression === node) return true;
      // `const myTest = test.extend(...)`: the binding is a declarer of its own, resolved above.
      if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isIdentifier(parent.name)) {
        return names.has(parent.name.text);
      }
      return false;
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && names.has(node.text) && !declaredHere.has(node)) {
      const parent = node.parent;
      const isProperty = (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || (ts.isPropertyAssignment(parent) && parent.name === node)
        || (ts.isBindingElement(parent) && parent.name === node)
        || (ts.isParameter(parent) && parent.name === node)
        || (ts.isPropertySignature(parent) && parent.name === node);
      if (!isProperty && !isReachable(node)) {
        refuse(
          'unsupported-feature',
          `\`${node.text}\` declares tests and is used at line ${String(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)} `
          + 'as a value rather than called, so where its tests are declared, and which markers they carry, cannot be read',
        );
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
}

/**
 * `testContext` is whether a test's first parameter is vitest's test context,
 * which can skip the test, rather than jest's `done` (see `contextSkips`).
 */
export function extractSkipMarkers(sf: ts.SourceFile, testContext: boolean): string[] {
  const names = declarersIn(sf);
  assertNoEscape(sf, names);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    // The outermost call of a declarer chain is the one that receives the name and the body:
    // `test.skipIf(c)('name', fn)`, `it.each(rows)('name', fn)`, `describe.only('name', fn)`.
    if (ts.isCallExpression(node) && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
      const chain = chainOf(node.expression, sf, names);
      if (chain !== undefined) {
        const name = nameOf(node, sf);
        const bare = chain.parts.map((p) => p.replace(/\(.*\)$/s, ''));
        if (PREFIXED.has(chain.root) || bare.some((p) => MODIFIERS.has(p))) {
          out.push(`${[chain.root, ...chain.parts].join('.')}: ${name}`);
        }
        contextSkips(node, chain, sf, names, name, out, testContext);
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}

/**
 * The rows of the table a `.each` or `.for` call is given, each as its
 * source text, or undefined when the declarer takes no table. The table must
 * be an array literal, inline or in a top-level `const` that nothing else in
 * the file touches, with no spread: a table built at run time, imported, or
 * mutated has rows only running the file would know, and is refused, because
 * a row it loses is a case deleted.
 */
function rowsOf(call: ts.CallExpression, chain: Chain, sf: ts.SourceFile, file: string): string[] | undefined {
  if (!chain.parts.some((p) => TABLES.has(p.replace(/\(.*\)$/s, '')))) return undefined;
  const cannotRead = (node: ts.Node, why: string): never => refuse(
    'unsupported-feature',
    `${file}:${lineOf(node, sf)} declares tests from a table ${why}, so its rows cannot be counted and a row dropped from it could not be seen`,
  );
  // The call that receives the table: the one in the callee chain whose callee ends in `each` or `for`.
  let table: ts.CallExpression | undefined;
  for (let node = unwrap(call.expression); table === undefined;) {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const part = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isElementAccessExpression(callee) ? literalKey(callee) : undefined;
      if (part !== undefined && TABLES.has(part)) table = node;
      node = callee;
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      node = unwrap(node.expression);
    } else {
      return cannotRead(call, 'through an alias of the declarer that already holds it');
    }
  }
  const argument = table.arguments[0] === undefined ? undefined : unwrap(table.arguments[0]);
  if (argument === undefined) return cannotRead(table, 'that is missing');
  let rows: ts.ArrayLiteralExpression | undefined = ts.isArrayLiteralExpression(argument) ? argument : undefined;
  if (rows === undefined && ts.isIdentifier(argument)) {
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer === undefined ? undefined : unwrap(declaration.initializer);
        if (ts.isIdentifier(declaration.name) && declaration.name.text === argument.text && initializer !== undefined && ts.isArrayLiteralExpression(initializer)) {
          rows = initializer;
        }
      }
    }
    if (rows !== undefined) assertOnlyTable(sf, argument.text, rows, cannotRead);
  }
  if (rows === undefined) return cannotRead(argument, `\`${text(argument, sf)}\` that is not an array literal in this file`);
  const spread = rows.elements.find((e) => ts.isSpreadElement(e));
  if (spread !== undefined) return cannotRead(spread, 'with a spread row');
  return rows.elements.map((e) => text(e, sf));
}

/**
 * Refuses a table held in a `const` that the file uses as anything but a
 * table: `rows.pop()`, `rows.length = 1`, or `rows` handed to a function
 * could change what the declarer is given.
 */
function assertOnlyTable(sf: ts.SourceFile, name: string, rows: ts.ArrayLiteralExpression, cannotRead: (node: ts.Node, why: string) => never): void {
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && !isPropertyName(node) && !(ts.isVariableDeclaration(node.parent) && node.parent.initializer !== undefined && unwrap(node.parent.initializer) === rows)) {
      const outer = climb(node);
      const call = outer.parent;
      const callee = ts.isCallExpression(call) && call.arguments[0] === outer ? unwrap(call.expression) : undefined;
      const part = callee === undefined ? undefined
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isElementAccessExpression(callee) ? literalKey(callee) : undefined;
      if (part === undefined || !TABLES.has(part)) cannotRead(node, `in \`${name}\`, which is used at this line as something other than a table`);
    }
    node.forEachChild(visit);
  };
  visit(sf);
}

/**
 * The cases a file declares, each by its describe-qualified title joined with
 * ` > `, in source order. A `.each` or `.for` case is one case per row of its
 * table, the row's source text in brackets after the title template, so a
 * row dropped from the table is a case deleted; under a suite declared from a
 * table, every case inside is one per row. A title that is not a literal — a
 * variable, a function, a template with a substitution — is refused rather
 * than dropped, as is a table whose rows are not literal, because a case the
 * list leaves out reads as a case deleted, or a deletion as nothing (I5).
 */
export function extractCases(sf: ts.SourceFile, file: string): string[] {
  const names = declarersIn(sf);
  assertNoEscape(sf, names);
  const out: string[] = [];
  const titleOf = (call: ts.CallExpression): string => {
    const first = call.arguments[0];
    const value = first === undefined ? undefined : unwrap(first);
    if (value !== undefined && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) return value.text;
    const line = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
    return refuse(
      'unsupported-feature',
      `${file}:${String(line)} declares a test whose title is not a literal, so the case cannot be named and a deletion of it could not be seen`,
    );
  };
  const titlesOf = (call: ts.CallExpression, chain: Chain): string[] => {
    const title = titleOf(call);
    const rows = rowsOf(call, chain, sf, file);
    return rows === undefined ? [title] : rows.map((row) => `${title} [${row}]`);
  };
  const visit = (node: ts.Node, suites: readonly string[]): void => {
    if (ts.isCallExpression(node) && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
      const chain = chainOf(node.expression, sf, names);
      // `test.extend({...})` itself ends in the bare builder; a call through what it built,
      // `my('x')`, ends in the builder already called, `extend({...})`, and declares a case.
      const building = chain !== undefined && BUILDERS.has(chain.parts[chain.parts.length - 1] ?? '');
      if (chain !== undefined && !building) {
        if (CASES.has(chain.root)) {
          for (const title of titlesOf(node, chain)) out.push([...suites, title].join(' > '));
        } else if (SUITES.has(chain.root)) {
          for (const title of titlesOf(node, chain)) {
            node.forEachChild((child) => {
              visit(child, [...suites, title]);
            });
          }
          return;
        }
      }
    }
    node.forEachChild((child) => {
      visit(child, suites);
    });
  };
  visit(sf, []);
  return out;
}
