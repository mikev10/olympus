/**
 * Reading values out of a config module without running it.
 *
 * A framework config is code, and code the agent could have written, so it is
 * parsed and never loaded (I1). What can be read is what the source states
 * as a literal: strings, numbers, booleans, arrays and objects of those,
 * top-level `const` bindings to them, and a small set of framework exports
 * whose values this package knows. Anything else — a call, a conditional, an
 * environment read, a spread of an object it cannot see — is `Unresolvable`,
 * and the caller refuses rather than guessing.
 *
 * A binding is followed only when nothing else in the module refers to it,
 * because a second reference is a place the value could be changed before the
 * framework reads it (`config.test.include.push(...)`).
 */
import ts from 'typescript';

export class Unresolvable {
  constructor(readonly why: string) {}
}

/** A value a known framework export stands for, resolved by the caller's major version. */
export type KnownExport = (path: readonly string[]) => readonly string[] | undefined;

export interface ModuleScope {
  readonly sf: ts.SourceFile;
  /** Top-level `const` bindings to their initialisers. */
  readonly consts: ReadonlyMap<string, ts.Expression>;
  /** Import bindings: local name to the module and the name it imports (`default` or `*` for those forms). */
  readonly imports: ReadonlyMap<string, { readonly module: string; readonly imported: string }>;
  /** Every appearance of each identifier text outside declarations and property names. */
  readonly references: ReadonlyMap<string, readonly ts.Identifier[]>;
  readonly known: (module: string, imported: string) => KnownExport | undefined;
}

export function parseModule(text: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
}

export function scriptKindOf(fileName: string): ts.ScriptKind {
  if (/\.[mc]?tsx$/.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.[mc]?ts$/.test(fileName)) return ts.ScriptKind.TS;
  if (/\.[mc]?jsx$/.test(fileName)) return ts.ScriptKind.JSX;
  if (fileName.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.JS;
}

/** The parser's own syntax errors, which `createSourceFile` records rather than throws. */
export function syntaxErrors(sf: ts.SourceFile): string[] {
  const diagnostics = (sf as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diagnostics.map((d) => {
    const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    return `line ${String(line + 1)}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  });
}

export function scopeOf(sf: ts.SourceFile, known: ModuleScope['known']): ModuleScope {
  const consts = new Map<string, ts.Expression>();
  const imports = new Map<string, { module: string; imported: string }>();
  const declarations = new Set<ts.Node>();
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
          consts.set(declaration.name.text, declaration.initializer);
          declarations.add(declaration.name);
        }
      }
    } else if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const module = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause === undefined) continue;
      if (clause.name !== undefined) {
        imports.set(clause.name.text, { module, imported: 'default' });
        declarations.add(clause.name);
      }
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        imports.set(bindings.name.text, { module, imported: '*' });
        declarations.add(bindings.name);
      } else if (bindings !== undefined) {
        for (const element of bindings.elements) {
          imports.set(element.name.text, { module, imported: (element.propertyName ?? element.name).text });
          declarations.add(element.name);
          if (element.propertyName !== undefined) declarations.add(element.propertyName);
        }
      }
    }
  }
  const references = new Map<string, ts.Identifier[]>();
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !declarations.has(node) && !isPropertyName(node)) {
      const list = references.get(node.text);
      if (list === undefined) references.set(node.text, [node]);
      else list.push(node);
    }
    node.forEachChild(collect);
  };
  collect(sf);
  return { sf, consts, imports, references, known };
}

/** An identifier that names a property rather than refers to a binding: `a.name`, `{ name: v }`. */
function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertySignature(parent) && parent.name === node);
}

/** Strips the wrappers that do not change a value: parentheses, `as`, `satisfies`, `<T>`, and `!`. */
export function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
      || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

function where(scope: ModuleScope, node: ts.Node): string {
  const { line } = scope.sf.getLineAndCharacterOfPosition(node.getStart(scope.sf));
  return `line ${String(line + 1)}`;
}

/**
 * Follows an identifier to the `const` it names. Refused when the binding is
 * referenced anywhere else in the module, since that reference could change
 * the value before the framework reads it.
 */
export function followBinding(node: ts.Identifier, scope: ModuleScope): ts.Expression | Unresolvable {
  const initializer = scope.consts.get(node.text);
  if (initializer === undefined) {
    return new Unresolvable(`\`${node.text}\` at ${where(scope, node)} is not a top-level const this file declares`);
  }
  const uses = scope.references.get(node.text)?.length ?? 0;
  if (uses > 1) {
    return new Unresolvable(`\`${node.text}\` is referenced ${String(uses)} times in the config, and any of them could change it before it is read`);
  }
  return unwrap(initializer);
}

/** An object literal's properties by static key, or why the object cannot be read. */
export interface ObjectView {
  readonly properties: ReadonlyMap<string, ts.Expression>;
  readonly node: ts.ObjectLiteralExpression;
}

export function objectOf(node: ts.Expression, scope: ModuleScope, label: string): ObjectView | Unresolvable {
  const value = unwrap(node);
  if (ts.isIdentifier(value)) {
    const followed = followBinding(value, scope);
    return followed instanceof Unresolvable ? followed : objectOf(followed, scope, label);
  }
  if (!ts.isObjectLiteralExpression(value)) {
    return new Unresolvable(`${label} at ${where(scope, value)} is not an object literal`);
  }
  const properties = new Map<string, ts.Expression>();
  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) {
      return new Unresolvable(`${label} at ${where(scope, property)} spreads another object into itself, which could set any key`);
    }
    const key = staticKey(property.name);
    if (key === undefined) {
      return new Unresolvable(`${label} at ${where(scope, property)} has a computed key, which could be any key`);
    }
    if (ts.isPropertyAssignment(property)) properties.set(key, property.initializer);
    else if (ts.isShorthandPropertyAssignment(property)) properties.set(key, property.name);
    else return new Unresolvable(`${label}.${key} at ${where(scope, property)} is a method or accessor, which runs code when read`);
  }
  return { properties, node: value };
}

function staticKey(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return undefined;
}

export function stringOf(node: ts.Expression, scope: ModuleScope, label: string): string | Unresolvable {
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isIdentifier(value)) {
    const followed = followBinding(value, scope);
    return followed instanceof Unresolvable ? followed : stringOf(followed, scope, label);
  }
  return new Unresolvable(`${label} at ${where(scope, value)} is not a string literal`);
}

export function booleanOf(node: ts.Expression, scope: ModuleScope, label: string): boolean | Unresolvable {
  const value = unwrap(node);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isIdentifier(value)) {
    const followed = followBinding(value, scope);
    return followed instanceof Unresolvable ? followed : booleanOf(followed, scope, label);
  }
  return new Unresolvable(`${label} at ${where(scope, value)} is not a boolean literal`);
}

/** A string array, where each element is a literal and each spread is of an array this module or a known export states. */
export function stringsOf(node: ts.Expression, scope: ModuleScope, label: string): string[] | Unresolvable {
  const value = unwrap(node);
  if (ts.isIdentifier(value)) {
    const followed = followBinding(value, scope);
    return followed instanceof Unresolvable ? followed : stringsOf(followed, scope, label);
  }
  const known = knownValue(value, scope);
  if (known !== undefined) return known instanceof Unresolvable ? known : [...known];
  if (!ts.isArrayLiteralExpression(value)) {
    return new Unresolvable(`${label} at ${where(scope, value)} is not an array literal`);
  }
  const out: string[] = [];
  for (const element of value.elements) {
    if (ts.isSpreadElement(element)) {
      const spread = stringsOf(element.expression, scope, `${label} (spread)`);
      if (spread instanceof Unresolvable) return spread;
      out.push(...spread);
    } else {
      const text = stringOf(element, scope, `${label}[${String(out.length)}]`);
      if (text instanceof Unresolvable) return text;
      out.push(text);
    }
  }
  return out;
}

/**
 * A property access on an imported binding whose value this package knows
 * for the framework version in use, e.g. `configDefaults.exclude`. Every
 * reference to the binding in the module must be a plain read — spread into
 * an array, or the value of a property or an element — because a reference
 * that calls a method on it, assigns through it, or passes it to a function
 * is a place it could have been changed.
 */
function knownValue(node: ts.Expression, scope: ModuleScope): readonly string[] | Unresolvable | undefined {
  const path: string[] = [];
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current)) {
    path.unshift(current.name.text);
    current = unwrap(current.expression);
  }
  if (!ts.isIdentifier(current)) return undefined;
  const binding = scope.imports.get(current.text);
  if (binding === undefined) return undefined;
  const resolve = scope.known(binding.module, binding.imported);
  if (resolve === undefined) return undefined;
  const touched = (scope.references.get(current.text) ?? []).find((reference) => !isPlainRead(reference));
  if (touched !== undefined) {
    return new Unresolvable(`\`${current.text}\` is used at ${where(scope, touched)} in a way that could change it before it is read`);
  }
  return resolve(path) ?? new Unresolvable(`\`${[current.text, ...path].join('.')}\` is not a value this package knows`);
}

/** A reference read and never written, called, or handed to anything: `x.y` spread into an array or used as a value. */
function isPlainRead(reference: ts.Identifier): boolean {
  let outer: ts.Node = reference;
  while (ts.isPropertyAccessExpression(outer.parent) && outer.parent.expression === outer) outer = outer.parent;
  const parent = outer.parent;
  return ts.isSpreadElement(parent)
    || ts.isArrayLiteralExpression(parent)
    || (ts.isPropertyAssignment(parent) && parent.initializer === outer);
}

/** Whether a call's callee is the named export of one of `modules`. */
export function isCallTo(node: ts.Expression, scope: ModuleScope, name: string, modules: readonly string[]): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = unwrap(node.expression);
  if (!ts.isIdentifier(callee)) return false;
  const binding = scope.imports.get(callee.text);
  return binding?.imported === name && modules.includes(binding.module);
}

/**
 * The module's exported config expression: `export default <expr>` or
 * `module.exports = <expr>`. Exactly one is required; a module that states
 * neither, or both, is not one whose config can be read.
 */
export function exportedConfig(scope: ModuleScope, label: string): ts.Expression | Unresolvable {
  const found: ts.Expression[] = [];
  for (const statement of scope.sf.statements) {
    if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) found.push(statement.expression);
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
      && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = statement.expression.left;
      if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)
        && target.expression.text === 'module' && target.name.text === 'exports') {
        found.push(statement.expression.right);
      }
    }
  }
  const [first, ...rest] = found;
  if (first === undefined) return new Unresolvable(`${label} has no \`export default\` and no \`module.exports =\``);
  if (rest.length > 0) return new Unresolvable(`${label} exports its config ${String(found.length)} times`);
  return unwrap(first);
}
