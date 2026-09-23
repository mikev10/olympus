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

/** The first parameter of the function a declarer call passes, which vitest binds to the test context. */
function contextParameter(call: ts.CallExpression): ts.ParameterDeclaration | undefined {
  const callback = [...call.arguments].reverse().find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
  return callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback.parameters[0] : undefined;
}

/**
 * `context.skip()`, or the context's `skip` destructured, inside a test body.
 * A destructured `skip` is followed under the name it was given: `{ skip:
 * omit }` binds the same function to `omit`, and calling it skips the test.
 */
function contextSkips(call: ts.CallExpression, sf: ts.SourceFile, names: ReadonlyMap<string, Chain>, name: string, out: string[]): void {
  const parameter = contextParameter(call);
  if (parameter === undefined) return;
  const callback = parameter.parent;
  const bound = ts.isIdentifier(parameter.name) ? parameter.name.text : undefined;
  const destructured = ts.isObjectBindingPattern(parameter.name)
    ? parameter.name.elements.find((e) => (e.propertyName ?? e.name).getText(sf) === 'skip')
    : undefined;
  const local = destructured !== undefined && ts.isIdentifier(destructured.name) ? destructured.name.text : undefined;
  const visit = (node: ts.Node): void => {
    // A nested declarer reports its own body.
    if (node !== callback && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isCallExpression(node.parent)
      && node.parent !== call && isDeclarer(node.parent.expression, sf, names)) return;
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const onBound = bound !== undefined
        && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
        && ts.isIdentifier(unwrap(callee.expression))
        && (unwrap(callee.expression) as ts.Identifier).text === bound
        && (ts.isPropertyAccessExpression(callee) ? callee.name.text : literalKey(callee)) === 'skip';
      if (onBound) out.push(`${bound}.skip: ${name}`);
      else if (local !== undefined && ts.isIdentifier(callee) && callee.text === local) out.push(`${local}: ${name}`);
    }
    node.forEachChild(visit);
  };
  visit(callback);
}

/**
 * Refuses a declarer that escapes into something this file cannot follow: a
 * declarer passed to a function, exported, or stored in an object, could be
 * called anywhere under any name, and the markers on those calls would be
 * read as absent.
 */
function assertNoEscape(sf: ts.SourceFile, names: ReadonlyMap<string, Chain>): void {
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

export function extractSkipMarkers(sf: ts.SourceFile): string[] {
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
        contextSkips(node, sf, names, name, out);
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}
