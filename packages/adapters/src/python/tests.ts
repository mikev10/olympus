/**
 * What a pytest file asserts, skips, and declares, read from its parse with
 * nothing run (I1). Assertions are `assert` statements, `self.assert*`
 * calls, `pytest.raises` and `pytest.warns`, and `pytest.approx` with its
 * tolerance. Skip markers are pytest's marks and calls and unittest's
 * decorators and `skipTest`. Cases are the functions and methods pytest
 * collects, by the configured name patterns, with each parametrised row's
 * id where every value in it is a literal (D-R29-07).
 */
import type { SyntaxNode } from '@lezer/common';
import { pairAssertions, type AssertionRules } from '../assertions.js';
import type { Assertion, AssertionDelta } from '../types.js';
import type { PytestRules } from './config.js';
import { fnmatch } from './ini.js';
import {
  argumentsOf, callOf, childrenOf, decoratorOf, flatText, lineOf, partsOf, statementsOf, stringValue, textOf, type PythonModule,
} from './parse.js';

// ---- assertions ------------------------------------------------------------

const COMPARE_KEYWORDS = new Set(['is', 'not', 'in']);

/** The operator of a comparison `BinaryExpression`, `==` or `is not` or `not in`, or undefined for any other binary. */
function comparisonOf(module: PythonModule, node: SyntaxNode): string | undefined {
  const ops = childrenOf(node).slice(1, -1);
  if (ops.length === 0) return undefined;
  if (ops.length === 1 && ops[0]?.name === 'CompareOp') return textOf(module, ops[0]);
  if (ops.every((o) => COMPARE_KEYWORDS.has(o.name))) return ops.map((o) => textOf(module, o)).join(' ');
  return undefined;
}

/** A chain `a < b <= c` as its operands and operators, read through the left-nested parse. */
function chainOf(module: PythonModule, node: SyntaxNode): { operators: string[]; operands: SyntaxNode[] } | undefined {
  const operator = comparisonOf(module, node);
  if (node.name !== 'BinaryExpression' || operator === undefined) return undefined;
  const parts = childrenOf(node);
  const left = parts[0];
  const right = parts[parts.length - 1];
  if (left === undefined || right === undefined) return undefined;
  const inner = chainOf(module, left);
  if (inner === undefined) return { operators: [operator], operands: [left, right] };
  return { operators: [...inner.operators, operator], operands: [...inner.operands, right] };
}

/** A numeric literal's value, signed, or undefined. */
function numberOf(module: PythonModule, node: SyntaxNode | undefined): number | undefined {
  if (node === undefined) return undefined;
  if (node.name === 'Number') {
    const text = textOf(module, node).replaceAll('_', '');
    return /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text) ? Number(text) : undefined;
  }
  if (node.name === 'UnaryExpression') {
    const [sign, operand] = childrenOf(node);
    const value = numberOf(module, operand);
    if (value === undefined || sign === undefined) return undefined;
    const s = textOf(module, sign);
    return s === '-' ? -value : s === '+' ? value : undefined;
  }
  return undefined;
}

const APPROX = new Set(['pytest.approx', 'approx']);

/**
 * `x == pytest.approx(v, rel=r, abs=a)`. pytest's default band is `rel=1e-6`;
 * with only `abs` given, `rel` is not applied at all. A tolerance is one
 * comparable number only where one bound is given or none: with both, the
 * pair is in the arguments and any change to it is reported (D-R29-07).
 */
function approxAssertion(module: PythonModule, operator: string, subject: SyntaxNode, call: { name: string; args: SyntaxNode }, line: number, file: string): Assertion | undefined {
  if (!APPROX.has(call.name)) return undefined;
  const args = argumentsOf(module, call.args);
  const expected = args?.positional[0];
  if (args === undefined || expected === undefined) return undefined;
  const rel = args.keyword.get('rel') ?? args.positional[1];
  const abs = args.keyword.get('abs') ?? args.positional[2];
  const base = [flatText(module, subject), flatText(module, expected)];
  const relValue = numberOf(module, rel);
  const absValue = numberOf(module, abs);
  if (rel === undefined && abs === undefined) return { file, line, operator: `${operator} approx`, args: base, tolerance: 1e-6 };
  if (abs === undefined && relValue !== undefined) return { file, line, operator: `${operator} approx`, args: base, tolerance: relValue };
  if (rel === undefined && absValue !== undefined) return { file, line, operator: `${operator} approx abs`, args: base, tolerance: absValue };
  const bounds = [rel === undefined ? null : `rel=${flatText(module, rel)}`, abs === undefined ? null : `abs=${flatText(module, abs)}`].filter((b): b is string => b !== null);
  return { file, line, operator: `${operator} approx bounds`, args: [...base, ...bounds] };
}

function assertStatement(module: PythonModule, node: SyntaxNode, file: string): Assertion {
  const line = lineOf(module, node.from);
  const [test] = partsOf(node);
  if (test === undefined) return { file, line, operator: 'truthy', args: [''] };
  const chain = chainOf(module, test);
  if (chain !== undefined) {
    const [subject, expected] = chain.operands;
    const call = expected === undefined ? undefined : callOf(module, expected);
    if (chain.operators.length === 1 && subject !== undefined && call !== undefined && (chain.operators[0] === '==' || chain.operators[0] === '!=')) {
      const approx = approxAssertion(module, chain.operators[0], subject, call, line, file);
      if (approx !== undefined) return approx;
    }
    return { file, line, operator: chain.operators.join(','), args: chain.operands.map((o) => flatText(module, o)) };
  }
  if (test.name === 'UnaryExpression' && textOf(module, test).startsWith('not')) {
    const operand = childrenOf(test)[1];
    return { file, line, operator: 'not', args: [operand === undefined ? '' : flatText(module, operand)] };
  }
  return { file, line, operator: 'truthy', args: [flatText(module, test)] };
}

/** unittest's almost-equal: `places` (default 7) as the band it implies, 0.5·10^-places, or `delta` as given. */
function almostEqual(module: PythonModule, method: string, args: NonNullable<ReturnType<typeof argumentsOf>>, line: number, file: string): Assertion {
  const operands = args.positional.slice(0, 2).map((p) => flatText(module, p));
  const delta = args.keyword.get('delta');
  if (delta !== undefined) {
    const value = numberOf(module, delta);
    return value === undefined ? { file, line, operator: `${method} delta`, args: [...operands, `delta=${flatText(module, delta)}`] } : { file, line, operator: `${method} delta`, args: operands, tolerance: value };
  }
  const placesNode = args.keyword.get('places') ?? args.positional[2];
  if (placesNode === undefined) return { file, line, operator: method, args: operands, tolerance: 0.5 * 10 ** -7 };
  const places = numberOf(module, placesNode);
  if (places === undefined) return { file, line, operator: method, args: [...operands, `places=${flatText(module, placesNode)}`] };
  return { file, line, operator: method, args: operands, tolerance: 0.5 * 10 ** -places };
}

const RAISES = new Set(['pytest.raises', 'raises', 'pytest.warns', 'warns', 'pytest.deprecated_call']);

function callAssertion(module: PythonModule, node: SyntaxNode, file: string): Assertion | undefined {
  const call = callOf(module, node);
  if (call === undefined) return undefined;
  const line = lineOf(module, node.from);
  const args = argumentsOf(module, call.args);
  const method = /^(?:self|cls)\.(assert\w*|fail\w*)$/u.exec(call.name)?.[1];
  if (method !== undefined) {
    if (args === undefined) return { file, line, operator: method, args: [flatText(module, call.args)] };
    if (method === 'assertAlmostEqual' || method === 'assertNotAlmostEqual') return almostEqual(module, method, args, line, file);
    return { file, line, operator: method, args: args.positional.map((p) => flatText(module, p)) };
  }
  if (RAISES.has(call.name)) {
    const kinds = call.name.endsWith('raises') ? 'raises' : call.name.endsWith('warns') ? 'warns' : 'deprecated_call';
    if (args === undefined) return { file, line, operator: kinds, args: [flatText(module, call.args)] };
    const match = args.keyword.get('match');
    return { file, line, operator: kinds, args: [...args.positional.map((p) => flatText(module, p)), ...(match === undefined ? [] : [`match=${flatText(module, match)}`])] };
  }
  return undefined;
}

export function extractAssertions(module: PythonModule): Assertion[] {
  const out: Assertion[] = [];
  module.tree.iterate({
    enter: (ref) => {
      const node = ref.node;
      if (node.name === 'AssertStatement') out.push(assertStatement(module, node, module.file));
      else if (node.name === 'CallExpression') {
        const found = callAssertion(module, node, module.file);
        if (found !== undefined) out.push(found);
      }
    },
  });
  return out;
}

function isNegated(operator: string): boolean {
  return /^(?:!=|not\b|is not|not in|assertNot|assertIsNot|assertFalse)/u.test(operator) || operator.includes(',not') || operator.startsWith('!=');
}

/** A literal the parse can judge truthy: a non-zero number, a non-empty string, `True`. */
function truthyLiteral(text: string | undefined): boolean {
  if (text === undefined) return false;
  if (text === 'True') return true;
  if (/^-?\d+(?:\.\d+)?$/u.test(text)) return Number(text) !== 0;
  return /^(["']).+\1$/u.test(text);
}

/**
 * Whether `after` provably checks at least what `before` did. Only the
 * strengthenings below are recognised; any other change on the subject is
 * reported, the direction that fails closed.
 */
function atLeastAsStrong(before: Assertion, after: Assertion): boolean {
  if (isNegated(before.operator) || isNegated(after.operator)) return false;
  const value = after.args[1];
  if (before.operator === after.operator && after.args.length > before.args.length && before.args.every((a, i) => after.args[i] === a)) return true;
  const equality = after.operator === '==' || after.operator === 'assertEqual';
  if ((before.operator === 'truthy' || before.operator === 'assertTrue') && equality) return truthyLiteral(value);
  if ((before.operator === 'is not' || before.operator === 'assertIsNotNone') && equality) {
    return value !== undefined && value !== 'None' && (before.operator === 'assertIsNotNone' || before.args[1] === 'None');
  }
  return false;
}

export const PYTHON_ASSERTION_RULES: AssertionRules = { atLeastAsStrong, negated: isNegated };

export function comparePythonAssertions(before: readonly Assertion[], after: readonly Assertion[]): AssertionDelta {
  return pairAssertions(before, after, PYTHON_ASSERTION_RULES);
}

/** `line 3: assert a == b`, or `line 4: self.assertEqual(a, b)`. */
export function spellPython(a: Assertion): string {
  const at = `line ${String(a.line)}: `;
  const tolerance = a.tolerance === undefined ? '' : ` (tolerance ${String(a.tolerance)})`;
  if (/^assert|^fail/u.test(a.operator) || ['raises', 'warns', 'deprecated_call'].includes(a.operator)) return `${at}${a.operator}(${a.args.join(', ')})${tolerance}`;
  if (a.operator === 'truthy') return `${at}assert ${a.args[0] ?? ''}`;
  if (a.operator === 'not') return `${at}assert not ${a.args[0] ?? ''}`;
  const ops = a.operator.split(',');
  let text = a.args[0] ?? '';
  ops.forEach((op, i) => { text += ` ${op} ${a.args[i + 1] ?? ''}`; });
  return `${at}assert ${text}${a.args.length > ops.length + 1 ? ` [${a.args.slice(ops.length + 1).join(', ')}]` : ''}${tolerance}`;
}

// ---- names, marks, and ids --------------------------------------------------

/** `_matches_prefix_or_glob_option`: a prefix, or a glob where the option holds a wildcard. */
export function matchesOption(name: string, options: readonly string[]): boolean {
  return options.some((option) => name.startsWith(option) || (/[*?[]/u.test(option) && fnmatch(name, option)));
}

interface Decorated {
  readonly node: SyntaxNode;
  readonly decorators: ReadonlyArray<{ readonly name: string; readonly args: SyntaxNode | null; readonly line: number }>;
}

/** A definition with its decorators, nearest the `def` first, as pytest stores the marks they apply. */
function decorated(module: PythonModule, statement: SyntaxNode): Decorated | undefined {
  if (statement.name === 'FunctionDefinition' || statement.name === 'ClassDefinition') return { node: statement, decorators: [] };
  if (statement.name !== 'DecoratedStatement') return undefined;
  const children = childrenOf(statement);
  const node = children.find((c) => c.name === 'FunctionDefinition' || c.name === 'ClassDefinition');
  if (node === undefined) return undefined;
  const decorators = children.filter((c) => c.name === 'Decorator').map((d) => {
    const read = decoratorOf(module, d);
    return { name: read?.name ?? flatText(module, d), args: read?.args ?? null, line: lineOf(module, d.from) };
  });
  return { node, decorators: decorators.reverse() };
}

function nameOf(module: PythonModule, def: SyntaxNode): string {
  const name = childrenOf(def).find((c) => c.name === 'VariableName');
  return name === undefined ? '' : textOf(module, name);
}

const SKIP_DECORATORS = /(?:^|\.)(?:mark\.(?:skip|skipif|xfail)|skip|skipIf|skipUnless|expectedFailure)$/u;
const SKIP_CALLS = /^(?:pytest\.(?:skip|xfail|importorskip)|self\.skipTest|cls\.skipTest|skip|importorskip)$/u;
const PARAMETRIZE = /^(?:pytest\.)?mark\.parametrize$/u;
const FIXTURE = /(?:^|\.)fixture$/u;
const UNITTEST_BASES = new Set(['TestCase', 'unittest.TestCase', 'IsolatedAsyncioTestCase', 'unittest.IsolatedAsyncioTestCase']);
const PLAIN_BASES = new Set(['object']);

/** The id pytest makes for one value (`IdMaker._idval`), or undefined where it depends on what the parse cannot see. */
function idOf(module: PythonModule, value: SyntaxNode, argname: string, index: number, rules: PytestRules): string | undefined {
  const str = stringValue(module, value);
  if (str !== undefined) {
    // `ascii_escaped` leaves printable ASCII alone; anything else it rewrites, which is not modelled.
    if (!/^[\x20-\x7e]*$/u.test(str)) return undefined;
    return str.length > 100 && rules.longStringIds === 'short' ? `${argname}${String(index)}` : str;
  }
  if (value.name === 'Boolean' || value.name === 'None') return textOf(module, value);
  const number = numberOf(module, value);
  if (number !== undefined) {
    const text = textOf(module, value).replaceAll('_', '').replace(/^\+/u, '');
    if (/^-?\s*\d+$/u.test(text)) return String(BigInt(text.replace(/\s/gu, '')));
    // Python prints a float in fixed notation from 1e-4 to 1e16, as JavaScript does over that range, with `.0` when whole.
    const magnitude = Math.abs(number);
    if (magnitude === 0 || (magnitude >= 1e-4 && magnitude < 1e16)) return Number.isInteger(number) ? `${String(number)}.0` : String(number);
    return undefined;
  }
  if (['ArrayExpression', 'TupleExpression', 'DictionaryExpression', 'SetExpression', 'ArrayComprehensionExpression'].includes(value.name)) return `${argname}${String(index)}`;
  return undefined;
}

/** `make_unique_parameterset_ids`: a repeated id takes a counter, after `_` where it ends in a digit. */
function unique(ids: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const resolved = [...ids];
  const suffixes = new Map<string, number>();
  resolved.forEach((id, index) => {
    if ((counts.get(id) ?? 0) <= 1) return;
    const sep = /\d$/u.test(id) ? '_' : '';
    let n = suffixes.get(id) ?? 0;
    let candidate = `${id}${sep}${String(n)}`;
    while (resolved.includes(candidate)) candidate = `${id}${sep}${String(++n)}`;
    resolved[index] = candidate;
    suffixes.set(id, n + 1);
  });
  return resolved;
}

/** One `parametrize` mark's ids, and the skip marks its `pytest.param` rows carry, or undefined where a row is not literal. */
function parametrizeIds(module: PythonModule, args: SyntaxNode | null, rules: PytestRules): { ids: string[]; skips: Array<{ id: string; mark: string }> } | undefined {
  if (args === null) return undefined;
  const read = argumentsOf(module, args);
  const [namesNode, valuesNode] = read?.positional ?? [];
  if (read === undefined || namesNode === undefined) return undefined;
  const values = valuesNode ?? read.keyword.get('argvalues');
  if (values === undefined || (values.name !== 'ArrayExpression' && values.name !== 'TupleExpression')) return undefined;
  const namesText = stringValue(module, namesNode);
  const argnames = namesText !== undefined
    ? namesText.split(',').map((n) => n.trim()).filter((n) => n !== '')
    : (namesNode.name === 'ArrayExpression' || namesNode.name === 'TupleExpression') ? partsOf(namesNode).map((n) => stringValue(module, n)) : [undefined];
  if (argnames.length === 0 || argnames.some((n) => n === undefined)) return undefined;
  const names = argnames as string[];
  const explicit = read.keyword.get('ids');
  let given: Array<string | null> | undefined;
  if (explicit !== undefined) {
    if (explicit.name !== 'ArrayExpression' && explicit.name !== 'TupleExpression') return undefined;
    given = [];
    for (const item of partsOf(explicit)) {
      if (item.name === 'None') given.push(null);
      else {
        const s = stringValue(module, item);
        if (s === undefined || !/^[\x20-\x7e]*$/u.test(s)) return undefined;
        given.push(s);
      }
    }
  }
  const rows = partsOf(values);
  if (rows.length === 0) return undefined;
  const ids: string[] = [];
  const skips: Array<{ index: number; mark: string }> = [];
  for (const [index, row] of rows.entries()) {
    let cells: SyntaxNode[];
    let rowId: string | undefined;
    const param = callOf(module, row);
    if (param !== undefined && (param.name === 'pytest.param' || param.name === 'param')) {
      const p = argumentsOf(module, param.args);
      if (p === undefined) return undefined;
      cells = p.positional;
      const id = p.keyword.get('id');
      if (id !== undefined) {
        rowId = stringValue(module, id);
        if (rowId === undefined || !/^[\x20-\x7e]*$/u.test(rowId)) return undefined;
      }
      const marks = p.keyword.get('marks');
      if (marks !== undefined) for (const m of /mark\.(?:skip|skipif|xfail)/u.exec(flatText(module, marks)) ?? []) skips.push({ index, mark: `pytest.param(marks=${m})` });
    } else if (names.length === 1) cells = [row];
    else if (row.name === 'TupleExpression' || row.name === 'ArrayExpression') cells = partsOf(row);
    else return undefined;
    if (cells.length !== names.length) return undefined;
    if (rowId !== undefined) ids.push(rowId);
    else if (given !== undefined && index < given.length && given[index] !== null) ids.push(given[index] ?? '');
    else {
      const parts = cells.map((cell, i) => idOf(module, cell, names[i] ?? '', index, rules));
      if (parts.some((p) => p === undefined)) return undefined;
      ids.push(parts.join('-'));
    }
  }
  const resolved = unique(ids);
  return { ids: resolved, skips: skips.map((s) => ({ id: resolved[s.index] ?? '', mark: s.mark })) };
}

// ---- the walk ----------------------------------------------------------------

export interface PythonTestFile {
  /** The cases pytest collects, `Class > method[id]`. */
  readonly cases: string[];
  /** Each skip mark or call, `mark: case`. */
  readonly skips: string[];
}

/** A class's own body statements, and its bases as written. */
function classParts(module: PythonModule, cls: SyntaxNode): { body: SyntaxNode[]; bases: string[] } {
  const args = childrenOf(cls).find((c) => c.name === 'ArgList');
  const bases = args === undefined ? [] : partsOf(args).map((b) => flatText(module, b));
  const body = childrenOf(cls).find((c) => c.name === 'Body');
  return { body: body === undefined ? [] : statementsOf(body), bases };
}

/** Whether a statement assigns `name = value` exactly. */
function assigns(module: PythonModule, statement: SyntaxNode, name: string): SyntaxNode | undefined {
  if (statement.name !== 'AssignStatement') return undefined;
  const [target, op, value] = childrenOf(statement);
  return target?.name === 'VariableName' && textOf(module, target) === name && op?.name === 'AssignOp' ? value : undefined;
}

function skipCallsIn(module: PythonModule, node: SyntaxNode, owner: string, out: string[]): void {
  module.tree.iterate({
    from: node.from,
    to: node.to,
    enter: (ref) => {
      if (ref.name !== 'CallExpression') return;
      const call = callOf(module, ref.node);
      if (call !== undefined && SKIP_CALLS.test(call.name)) out.push(`${call.name}(): ${owner}`);
    },
  });
}

function marksOf(module: PythonModule, value: SyntaxNode | undefined): string[] {
  if (value === undefined) return [];
  return [...flatText(module, value).matchAll(/(?:pytest\.)?mark\.(?:skip|skipif|xfail)\b/gu)].map((m) => m[0]);
}

/**
 * The cases and skip markers of one file, under `rules`. A class is a test
 * class when its name matches `python_classes` or it derives from
 * unittest's `TestCase`, and it is passed over when it defines `__init__`
 * or `__new__` or sets `__test__ = False`. A base class the parse cannot see
 * contributes a case of its own, `Class > *Base`, so a change to what a
 * class inherits is a change to its cases (D-R29-07).
 */
export function readTestFile(module: PythonModule, rules: PytestRules): PythonTestFile {
  const cases: string[] = [];
  const skips: string[] = [];
  const top = statementsOf(module.tree.topNode);
  const classes = new Map<string, SyntaxNode>();
  for (const s of top) {
    const d = decorated(module, s);
    if (d?.node.name === 'ClassDefinition') classes.set(nameOf(module, d.node), d.node);
  }

  for (const s of top) {
    for (const mark of marksOf(module, assigns(module, s, 'pytestmark'))) skips.push(`pytestmark ${mark}: ${module.file}`);
    if (s.name === 'ExpressionStatement') {
      const call = callOf(module, childrenOf(s)[0] ?? s);
      if (call !== undefined && SKIP_CALLS.test(call.name)) skips.push(`${call.name}(): ${module.file}`);
    }
  }

  const isUnittest = (bases: readonly string[], seen: Set<string>): boolean => bases.some((b) => {
    if (UNITTEST_BASES.has(b)) return true;
    const local = classes.get(b);
    if (local === undefined || seen.has(b)) return false;
    seen.add(b);
    return isUnittest(classParts(module, local).bases, seen);
  });

  const functionCases = (d: Decorated, owner: string, inherited: Decorated['decorators'], unittest: boolean): void => {
    const name = nameOf(module, d.node);
    const decorators = [...d.decorators, ...inherited];
    if (decorators.some((x) => FIXTURE.test(x.name))) return;
    if (unittest ? !name.startsWith('test') : !matchesOption(name, rules.pythonFunctions)) return;
    const qualified = owner === '' ? name : `${owner} > ${name}`;
    for (const x of decorators) if (SKIP_DECORATORS.test(x.name)) skips.push(`${x.name}: ${qualified}`);
    skipCallsIn(module, d.node, qualified, skips);
    let ids: string[] | undefined = [''];
    if (!unittest) {
      for (const x of decorators.filter((y) => PARAMETRIZE.test(y.name))) {
        const read = parametrizeIds(module, x.args, rules);
        if (read === undefined || ids === undefined) {
          ids = undefined;
          continue;
        }
        for (const s of read.skips) skips.push(`${s.mark}: ${qualified}[${s.id}]`);
        ids = ids.flatMap((prefix) => read.ids.map((id) => (prefix === '' ? id : `${prefix}-${id}`)));
      }
    }
    if (ids === undefined || (ids.length === 1 && ids[0] === '')) cases.push(qualified);
    else for (const id of ids) cases.push(`${qualified}[${id}]`);
  };

  const classCases = (d: Decorated, owner: string, seen: Set<string>): void => {
    const name = nameOf(module, d.node);
    const { body, bases } = classParts(module, d.node);
    const unittest = isUnittest(bases, new Set());
    if (!unittest && !matchesOption(name, rules.pythonClasses)) return;
    const qualified = owner === '' ? name : `${owner} > ${name}`;
    const members = (statements: readonly SyntaxNode[]): Decorated[] => statements.map((s) => decorated(module, s)).filter((x): x is Decorated => x !== undefined);
    const own = members(body);
    if (own.some((m) => m.node.name === 'FunctionDefinition' && ['__init__', '__new__'].includes(nameOf(module, m.node)))) return;
    if (body.some((s) => assigns(module, s, '__test__') !== undefined && textOf(module, assigns(module, s, '__test__') ?? s) === 'False')) return;
    for (const x of d.decorators) if (SKIP_DECORATORS.test(x.name)) skips.push(`${x.name}: ${qualified}`);
    for (const s of body) for (const mark of marksOf(module, assigns(module, s, 'pytestmark'))) skips.push(`pytestmark ${mark}: ${qualified}`);
    const classMarks = [...d.decorators];
    const methods = new Map<string, Decorated>();
    const inherit = (bs: readonly string[], chain: Set<string>): void => {
      for (const base of bs) {
        if (UNITTEST_BASES.has(base) || PLAIN_BASES.has(base)) continue;
        const local = classes.get(base);
        if (local === undefined || chain.has(base)) {
          cases.push(`${qualified} > *${base}`);
          continue;
        }
        chain.add(base);
        const parts = classParts(module, local);
        inherit(parts.bases, chain);
        for (const m of members(parts.body)) if (m.node.name === 'FunctionDefinition') methods.set(nameOf(module, m.node), m);
      }
    };
    inherit(bases, new Set([name]));
    for (const m of own) if (m.node.name === 'FunctionDefinition') methods.set(nameOf(module, m.node), m);
    for (const m of methods.values()) functionCases(m, qualified, classMarks, unittest);
    for (const m of own) if (m.node.name === 'ClassDefinition' && !seen.has(nameOf(module, m.node))) classCases(m, qualified, new Set([...seen, nameOf(module, m.node)]));
  };

  for (const s of top) {
    const d = decorated(module, s);
    if (d === undefined) continue;
    if (d.node.name === 'FunctionDefinition') functionCases(d, '', [], false);
    else classCases(d, '', new Set([nameOf(module, d.node)]));
  }
  return { cases, skips };
}
