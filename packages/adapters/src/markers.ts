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
 */
import ts from 'typescript';

/** Functions that declare a test or a suite. */
const DECLARERS: ReadonlySet<string> = new Set(['describe', 'it', 'test', 'suite', 'bench']);
/** Names that are a marker on their own: jasmine-style `xit`, `fit`, and the rest. */
const PREFIXED: ReadonlySet<string> = new Set(['xit', 'xtest', 'xdescribe', 'fit', 'fdescribe', 'ftest']);
/** Modifiers in a declarer's chain that are markers. */
const MODIFIERS: ReadonlySet<string> = new Set(['skip', 'only', 'todo', 'skipIf', 'runIf', 'fails', 'failing']);

function text(node: ts.Node, sf: ts.SourceFile): string {
  return node.getText(sf).replace(/\s+/g, ' ').trim();
}

/** The chain of a callee rooted at an identifier, e.g. `test.skip.each`, with call arguments kept: `test.skipIf(cond)`. */
function chainOf(node: ts.Expression, sf: ts.SourceFile): { root: string; parts: string[] } | undefined {
  if (ts.isIdentifier(node)) return { root: node.text, parts: [] };
  if (ts.isPropertyAccessExpression(node)) {
    const inner = chainOf(node.expression, sf);
    return inner === undefined ? undefined : { root: inner.root, parts: [...inner.parts, node.name.text] };
  }
  if (ts.isCallExpression(node)) {
    const inner = chainOf(node.expression, sf);
    if (inner === undefined || inner.parts.length === 0) return inner === undefined ? undefined : { root: inner.root, parts: ['()'] };
    const last = inner.parts[inner.parts.length - 1] ?? '';
    return { root: inner.root, parts: [...inner.parts.slice(0, -1), `${last}(${node.arguments.map((a) => text(a, sf)).join(', ')})`] };
  }
  return undefined;
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

/** `context.skip()`, or `skip()` destructured from the context, inside a test body. */
function contextSkips(call: ts.CallExpression, sf: ts.SourceFile, name: string, out: string[]): void {
  const parameter = contextParameter(call);
  if (parameter === undefined) return;
  const callback = parameter.parent;
  const bound = ts.isIdentifier(parameter.name) ? parameter.name.text : undefined;
  const destructured = ts.isObjectBindingPattern(parameter.name)
    && parameter.name.elements.some((e) => (e.propertyName ?? e.name).getText(sf) === 'skip');
  const visit = (node: ts.Node): void => {
    // A nested declarer reports its own body.
    if (node !== callback && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isCallExpression(node.parent)
      && node.parent !== call && isDeclarer(node.parent.expression)) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (bound !== undefined && ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
        && callee.expression.text === bound && callee.name.text === 'skip') {
        out.push(`${bound}.skip: ${name}`);
      } else if (destructured && ts.isIdentifier(callee) && callee.text === 'skip') {
        out.push(`skip: ${name}`);
      }
    }
    node.forEachChild(visit);
  };
  visit(callback);
}

function isDeclarer(callee: ts.Expression): boolean {
  let root: ts.Expression = callee;
  while (ts.isPropertyAccessExpression(root) || ts.isCallExpression(root)) root = root.expression;
  return ts.isIdentifier(root) && (DECLARERS.has(root.text) || PREFIXED.has(root.text));
}

export function extractSkipMarkers(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    // The outermost call of a declarer chain is the one that receives the name and the body:
    // `test.skipIf(c)('name', fn)`, `it.each(rows)('name', fn)`, `describe.only('name', fn)`.
    if (ts.isCallExpression(node) && isDeclarer(node.expression) && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
      const chain = chainOf(node.expression, sf);
      if (chain !== undefined) {
        const name = nameOf(node, sf);
        const bare = chain.parts.map((p) => p.replace(/\(.*\)$/s, ''));
        if (PREFIXED.has(chain.root) || bare.some((p) => MODIFIERS.has(p))) {
          out.push(`${[chain.root, ...chain.parts].join('.')}: ${name}`);
        }
        contextSkips(node, sf, name, out);
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}
