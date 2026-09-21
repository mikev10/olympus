/**
 * Assertions as the parser sees them, and what changed between two sets.
 *
 * An assertion is an `expect(...)` chain — jest's matchers, vitest's, and the
 * chai forms vitest also accepts (`expect(x).to.equal(1)`, `expect(x).to.be.true`)
 * — an `expectTypeOf(...)` chain, an `assert(...)` call, or an
 * `assert.method(...)` call. `operator` is the chain after the subject, with
 * `()` marking each call in it; `args` is the subject's source text followed
 * by the text of every argument and type argument the chain passes, in
 * order. Whitespace inside each text is collapsed, so reformatting a file
 * changes no assertion.
 */
import ts from 'typescript';
import type { Assertion, AssertionDelta } from './types.js';

const EXPECT_ROOTS: ReadonlySet<string> = new Set(['expect', 'expectTypeOf', 'assertType']);
const EXPECT_METHODS: ReadonlySet<string> = new Set(['soft', 'poll']);
/** Calls on `expect` itself that assert something about the test: `expect.assertions(2)`. */
const EXPECT_META: ReadonlySet<string> = new Set(['assertions', 'hasAssertions']);

function text(node: ts.Node, sf: ts.SourceFile): string {
  return node.getText(sf).replace(/\s+/g, ' ').trim();
}

function lineOf(node: ts.Node, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function numericLiteral(node: ts.Expression | undefined): number | undefined {
  if (node === undefined) return undefined;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return -Number(node.operand.text);
  }
  return undefined;
}

/** The subject call of an expect chain: `expect(x)`, `expect.soft(x)`, `expect.poll(fn)`, `expectTypeOf(x)`. */
function isSubjectCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return EXPECT_ROOTS.has(callee.text);
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
    && callee.expression.text === 'expect' && EXPECT_METHODS.has(callee.name.text);
}

function isAssertCall(node: ts.CallExpression): string | undefined {
  const callee = node.expression;
  if (ts.isIdentifier(callee) && callee.text === 'assert') return 'assert';
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    if (callee.expression.text === 'assert') return `assert.${callee.name.text}`;
    if (callee.expression.text === 'expect' && EXPECT_META.has(callee.name.text)) return `expect.${callee.name.text}`;
  }
  return undefined;
}

/**
 * The tolerance an approximate matcher allows, when its arguments state it
 * as literals. `toBeCloseTo(v, d)` passes when |received − v| < 10^−d / 2,
 * with `d` defaulting to 2 (jest and vitest alike); chai's `closeTo(v, δ)` and
 * `approximately(v, δ)`, and `assert.closeTo(a, v, δ)`, take δ directly.
 */
function toleranceOf(operator: string, callArgs: readonly ts.Expression[]): number | undefined {
  const last = operator.split('.').pop()?.replace('()', '');
  if (last === 'toBeCloseTo') {
    const digits = callArgs.length < 2 ? 2 : numericLiteral(callArgs[1]);
    return digits === undefined ? undefined : 10 ** -digits / 2;
  }
  if (operator === 'assert.closeTo' || operator === 'assert.approximately') return numericLiteral(callArgs[2]);
  if (last === 'closeTo' || last === 'approximately') return numericLiteral(callArgs[1]);
  return undefined;
}

function assertion(file: string, line: number, operator: string, args: string[], tolerance: number | undefined): Assertion {
  return tolerance === undefined ? { file, line, operator, args } : { file, line, operator, args, tolerance };
}

export function extractAssertions(sf: ts.SourceFile, file: string): Assertion[] {
  const out: Assertion[] = [];
  const visit = (node: ts.Node): void => {
    if (isSubjectCall(node)) {
      const subject = node.arguments.map((a) => text(a, sf));
      const names: string[] = [];
      const args: string[] = [...subject];
      let lastCallArgs: readonly ts.Expression[] = [];
      let current: ts.Node = node;
      for (;;) {
        const parent: ts.Node = current.parent;
        if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
          names.push(parent.name.text);
          current = parent;
        } else if (ts.isCallExpression(parent) && parent.expression === current && names.length > 0) {
          names[names.length - 1] = `${names[names.length - 1] ?? ''}()`;
          for (const t of parent.typeArguments ?? []) args.push(`<${text(t, sf)}>`);
          for (const a of parent.arguments) args.push(text(a, sf));
          lastCallArgs = parent.arguments;
          current = parent;
        } else {
          break;
        }
      }
      // A subject with no matcher after it asserts nothing, and is not recorded.
      if (names.length > 0) {
        const operator = names.join('.');
        const callee = node.expression;
        const root = ts.isIdentifier(callee) ? callee.text : text(callee, sf);
        const qualified = root === 'expect' ? operator : `${root}:${operator}`;
        out.push(assertion(file, lineOf(node, sf), qualified, args, toleranceOf(operator, lastCallArgs)));
      }
    } else if (ts.isCallExpression(node)) {
      const operator = isAssertCall(node);
      if (operator !== undefined) {
        out.push(assertion(file, lineOf(node, sf), operator, node.arguments.map((a) => text(a, sf)), toleranceOf(operator, node.arguments)));
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}

// ---------------------------------------------------------------------------
// comparison

/** The last matcher name of an operator, without call markers or a leading `not`/`resolves`/`rejects`. */
function matcher(operator: string): string {
  const parts = operator.replace(/^[\w.]+:/, '').split('.').map((p) => p.replace('()', ''));
  return parts[parts.length - 1] ?? '';
}

function negated(operator: string): boolean {
  return /(^|\.)not(\.|$)/.test(operator.replace(/\(\)/g, ''));
}

/**
 * Checks that pin a value. A change from one of these to anything outside
 * the set, or down the ladder within it, loses what the assertion pinned.
 */
const EQUALITY_LADDER: ReadonlyMap<string, number> = new Map([
  ['toStrictEqual', 3], ['deepStrictEqual', 3], ['strictEqual', 3], ['toBe', 3],
  ['toEqual', 2], ['deepEqual', 2], ['eql', 2], ['equal', 2], ['equals', 2],
  ['toMatchObject', 1], ['include', 1], ['toContain', 1], ['toContainEqual', 1], ['toHaveProperty', 1], ['toMatch', 1],
]);

/** Checks that say only that a value exists or is truthy. */
const EXISTENCE: ReadonlySet<string> = new Set([
  'toBeTruthy', 'toBeFalsy', 'toBeDefined', 'toBeUndefined', 'toBeNull', 'toHaveBeenCalled', 'toBeInstanceOf', 'toBeTypeOf',
  'ok', 'exist', 'true', 'false', 'isOk', 'isNotOk', 'exists', 'isDefined', 'isTrue', 'isFalse', 'assert',
]);

/**
 * Whether `after` provably checks at least what `before` did on the same
 * subject. Everything else that differs is a weakening: this is the
 * direction that fails closed, because a changed assertion is reported for a
 * reviewer rather than assumed harmless.
 */
function atLeastAsStrong(before: Assertion, after: Assertion): boolean {
  if (negated(after.operator) !== negated(before.operator)) return !negated(after.operator);
  const was = matcher(before.operator);
  const now = matcher(after.operator);
  const wasRank = EQUALITY_LADDER.get(was);
  const nowRank = EQUALITY_LADDER.get(now);
  // From "it exists" to "it equals this": the new check implies the old one.
  if ((EXISTENCE.has(was) || before.operator === 'assert') && nowRank !== undefined) return true;
  if (was === now && after.args.length > before.args.length
    && before.args.every((arg, i) => after.args[i] === arg)) return true; // `toThrow()` → `toThrow('x')`
  if (was === 'toHaveBeenCalled' && now === 'toHaveBeenCalledWith') return true;
  if (wasRank !== undefined && nowRank !== undefined && wasRank < nowRank) {
    return before.args.every((arg, i) => after.args[i] === arg);
  }
  return false;
}

function key(a: Assertion): string {
  return [a.operator, ...a.args, a.tolerance === undefined ? '' : String(a.tolerance)].join('\u0000');
}

/**
 * Pairs `before` with `after` and reports what was lost. Identical
 * assertions pair first, wherever they moved to — line numbers and files are
 * not part of identity, so a moved test or a renamed file loses nothing. What
 * remains pairs by subject, same file first and then nearest line; a pair
 * that differs only by a wider tolerance is `toleranceWidened`, one whose new
 * form provably checks at least as much is dropped, and any other is
 * `weakened`. A `before` assertion left without a pair is `removed`.
 */
export function compareAssertions(before: readonly Assertion[], after: readonly Assertion[]): AssertionDelta {
  const unmatched = [...after];
  const take = (index: number): void => {
    unmatched.splice(index, 1);
  };
  const remaining: Assertion[] = [];
  for (const b of before) {
    const sameFile = unmatched.findIndex((a) => a.file === b.file && key(a) === key(b));
    const anywhere = sameFile === -1 ? unmatched.findIndex((a) => key(a) === key(b)) : sameFile;
    if (anywhere === -1) remaining.push(b);
    else take(anywhere);
  }

  const delta: AssertionDelta = { weakened: [], removed: [], toleranceWidened: [] };
  for (const b of remaining) {
    const subject = b.args[0];
    let best = -1;
    for (let i = 0; i < unmatched.length; i++) {
      const a = unmatched[i];
      if (a === undefined || a.args[0] !== subject) continue;
      const current = unmatched[best];
      if (current === undefined) {
        best = i;
        continue;
      }
      const score = (x: Assertion): [number, number] => [x.file === b.file ? 0 : 1, Math.abs(x.line - b.line)];
      const [fileA, lineA] = score(a);
      const [fileC, lineC] = score(current);
      if (fileA < fileC || (fileA === fileC && lineA < lineC)) best = i;
    }
    const a = unmatched[best];
    if (a === undefined) {
      delta.removed.push(b);
      continue;
    }
    take(best);
    // An approximate matcher's arguments are the subject, the value, and then what sets the tolerance.
    const sameValue = a.operator === b.operator && a.args.slice(0, 2).join('\u0000') === b.args.slice(0, 2).join('\u0000');
    if (sameValue && a.tolerance !== undefined && b.tolerance !== undefined) {
      if (a.tolerance > b.tolerance) delta.toleranceWidened.push(a);
      continue;
    }
    if (!atLeastAsStrong(b, a)) delta.weakened.push(a);
  }
  return delta;
}
