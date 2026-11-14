/**
 * Python source, parsed on the host by a grammar written in TypeScript, so
 * reading a test file runs nothing (I1). A file the grammar cannot read
 * whole is refused, never read in part: a part would hold fewer assertions
 * and cases than the file, which reads as a deletion (D-R29-12).
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { parser } from '@lezer/python';
import { readRegularFile, SOURCE_FILE_CAP } from '../files.js';
import { refuse } from '../refusal.js';

export interface PythonModule {
  readonly file: string;
  readonly text: string;
  readonly tree: Tree;
  /** The offset each line starts at, 1-based by index + 1. */
  readonly lineStarts: readonly number[];
}

export function parsePython(text: string, file: string): PythonModule {
  const tree = parser.parse(text);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const module: PythonModule = { file, text, tree, lineStarts };
  let error: number | undefined;
  tree.iterate({
    enter: (node) => {
      if (error !== undefined) return false;
      if (node.type.isError) error = node.from;
      return undefined;
    },
  });
  if (error !== undefined) refuse('unparseable', `${file} does not parse at line ${String(lineOf(module, error))}`);
  return module;
}

export async function readPython(file: string): Promise<PythonModule> {
  return parsePython(await readRegularFile(file, SOURCE_FILE_CAP), file);
}

/** The 1-based line of an offset. */
export function lineOf(module: PythonModule, pos: number): number {
  let lo = 0;
  let hi = module.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((module.lineStarts[mid] ?? 0) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export function textOf(module: PythonModule, node: SyntaxNode): string {
  return module.text.slice(node.from, node.to);
}

/** Source text with its whitespace collapsed: the form an assertion's argument is compared in. */
export function flatText(module: PythonModule, node: SyntaxNode): string {
  return textOf(module, node).replace(/\s+/gu, ' ').trim();
}

/** Every direct child, in order. */
export function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) out.push(child);
  return out;
}

const PUNCTUATION = new Set(['(', ')', '[', ']', '{', '}', ',', ':', '.', '=', 'AssignOp', 'At']);

/** The children that carry meaning: no brackets, commas, or keywords spelled as their own node. */
export function partsOf(node: SyntaxNode): SyntaxNode[] {
  return childrenOf(node).filter((c) => !PUNCTUATION.has(c.name) && !/^[a-z]+$/u.test(c.name));
}

/** The statements of a `Script` or a `Body`. */
export function statementsOf(node: SyntaxNode): SyntaxNode[] {
  return childrenOf(node).filter((c) => /Statement$|Definition$/u.test(c.name));
}

/**
 * A dotted name as written: `pytest.mark.skip` from a `MemberExpression`
 * chain or a `Decorator`'s flat run of names, or undefined for anything
 * that is not one.
 */
export function dottedName(module: PythonModule, node: SyntaxNode): string | undefined {
  if (node.name === 'VariableName') return textOf(module, node);
  if (node.name === 'MemberExpression') {
    const parts = childrenOf(node);
    const head = parts[0];
    const tail = parts[parts.length - 1];
    if (head === undefined || tail?.name !== 'PropertyName') return undefined;
    const left = dottedName(module, head);
    return left === undefined ? undefined : `${left}.${textOf(module, tail)}`;
  }
  return undefined;
}

/** A decorator's dotted name and its argument list, if it is called. */
export function decoratorOf(module: PythonModule, decorator: SyntaxNode): { readonly name: string; readonly args: SyntaxNode | null } | undefined {
  const names: string[] = [];
  let args: SyntaxNode | null = null;
  for (const child of childrenOf(decorator)) {
    if (child.name === 'At' || child.name === '.') continue;
    if (child.name === 'VariableName' || child.name === 'PropertyName') {
      if (args !== null) return undefined;
      names.push(textOf(module, child));
    } else if (child.name === 'ArgList' && args === null) args = child;
    else return undefined;
  }
  return names.length === 0 ? undefined : { name: names.join('.'), args };
}

/** A call's callee name and its argument list, when the callee is a dotted name. */
export function callOf(module: PythonModule, node: SyntaxNode): { readonly name: string; readonly args: SyntaxNode } | undefined {
  if (node.name !== 'CallExpression') return undefined;
  const [callee, args] = childrenOf(node);
  if (callee === undefined || args?.name !== 'ArgList') return undefined;
  const name = dottedName(module, callee);
  return name === undefined ? undefined : { name, args };
}

/** An argument list's positional arguments and keyword arguments, or undefined when it spreads (`*a`, `**k`). */
export function argumentsOf(module: PythonModule, args: SyntaxNode): { readonly positional: SyntaxNode[]; readonly keyword: Map<string, SyntaxNode> } | undefined {
  const positional: SyntaxNode[] = [];
  const keyword = new Map<string, SyntaxNode>();
  const children = childrenOf(args).filter((c) => c.name !== '(' && c.name !== ')' && c.name !== ',');
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child === undefined) continue;
    if (child.name === '*' || child.name === '**') return undefined;
    const next = children[i + 1];
    if (child.name === 'VariableName' && next?.name === 'AssignOp') {
      const value = children[i + 2];
      if (value === undefined) return undefined;
      keyword.set(textOf(module, child), value);
      i += 2;
      continue;
    }
    if (keyword.size > 0) return undefined;
    positional.push(child);
  }
  return { positional, keyword };
}

/**
 * A Python string literal's value, when it is a plain one: quoted, with no
 * prefix and no escape. Anything else (an f-string, bytes, a raw string, an
 * escape, implicit concatenation) is undefined, for the caller to treat as
 * a value it cannot see.
 */
export function stringValue(module: PythonModule, node: SyntaxNode): string | undefined {
  if (node.name !== 'String') return undefined;
  const raw = textOf(module, node);
  const match = /^("""|'''|"|')([\s\S]*)\1$/u.exec(raw);
  if (match === null) return undefined;
  const body = match[2] ?? '';
  if (body.includes('\\')) return undefined;
  return body;
}
