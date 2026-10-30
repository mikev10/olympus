// I7: the sink rule (`I7.untrusted-sink-lint-rule`, D-F3-06, D-R22-09).
//
// The type system stops UntrustedText from reaching a string-typed slot, and
// three typed rules stop `+`, interpolation, and String(). Two paths remained:
// `JSON.stringify(raw)`, and widening `raw` to `unknown`, `any`, or `object`
// by annotation, argument, return, or property before casting, which hides it
// from the cast scan. This rule reports a value that is, or holds, UntrustedText
// or UntrustedPayload in either place: held means inside a property, an array
// or tuple element, or a type argument, so wrapping it does not hide it. It also
// reports one passed to a function's own type parameter that the function's
// return type drops, which erases the type as an `unknown` parameter would.
//
// It lives in the conformance package, a protected path, so weakening it needs
// the gate label as turning a rule off in eslint.config.js does.
import ts from 'typescript';

const UNTRUSTED = new Set(['UntrustedText', 'UntrustedPayload']);

/** Whether `type`, or any member of a union or intersection, is one of the two. */
function isUntrusted(type) {
  if (type.isUnionOrIntersection()) return type.types.some(isUntrusted);
  const name = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName();
  return name !== undefined && UNTRUSTED.has(name);
}

/** How deep a container is searched; a payload held deeper is past what any finding or fixture has needed. */
const MAX_DEPTH = 6;

/**
 * Whether `type` is untrusted or holds an untrusted value: in a property, an
 * element, or a type argument. Function types are not searched: calling one
 * yields a value checked where it is used.
 */
function holdsUntrusted(checker, type, depth = 0, seen = new Set()) {
  if (isUntrusted(type)) return true;
  if (depth >= MAX_DEPTH || seen.has(type)) return false;
  seen.add(type);
  const inner = (t) => holdsUntrusted(checker, t, depth + 1, seen);
  if (type.isUnionOrIntersection()) return type.types.some(inner);
  if ((type.flags & ts.TypeFlags.Object) === 0) return false;
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) return false;
  if ((type.objectFlags & ts.ObjectFlags.Reference) !== 0 && checker.getTypeArguments(type).some(inner)) return true;
  if ((type.aliasTypeArguments ?? []).some(inner)) return true;
  return checker.getPropertiesOfType(type).some((property) => inner(checker.getTypeOfSymbol(property)));
}

/** Whether `type` mentions the type parameter `parameter` anywhere a value of it could be kept. */
function mentions(checker, type, parameter, depth = 0, seen = new Set()) {
  if (type === parameter) return true;
  if (depth >= MAX_DEPTH || seen.has(type)) return false;
  seen.add(type);
  const inner = (t) => mentions(checker, t, parameter, depth + 1, seen);
  if (type.isUnionOrIntersection()) return type.types.some(inner);
  if ((type.aliasTypeArguments ?? []).some(inner)) return true;
  if ((type.flags & ts.TypeFlags.Object) === 0) return false;
  if ((type.objectFlags & ts.ObjectFlags.Reference) !== 0 && checker.getTypeArguments(type).some(inner)) return true;
  return checker.getPropertiesOfType(type).some((property) => inner(checker.getTypeOfSymbol(property)));
}

/**
 * The arguments of `call` that fill a type parameter of the called signature's
 * own whose return type drops it: `erase<T>(v: T): unknown`. A class's type
 * parameter is bound by the receiver, not erased by the call, and is skipped.
 */
function erasingArguments(checker, call) {
  const declaration = checker.getResolvedSignature(call)?.getDeclaration();
  if (declaration == null) return [];
  const generic = checker.getSignatureFromDeclaration(declaration);
  const own = generic?.getTypeParameters() ?? [];
  if (generic == null || own.length === 0) return [];
  const returned = generic.getReturnType();
  const erasing = [];
  generic.getParameters().forEach((parameter, index) => {
    const type = checker.getTypeOfSymbol(parameter);
    if (own.includes(type) && !mentions(checker, returned, type)) erasing.push(index);
  });
  return erasing.flatMap((index) => (call.arguments?.[index] === undefined ? [] : [call.arguments[index]]));
}

/** A slot that keeps nothing of the value's type: `unknown`, `any`, `object`, or `{}`. */
function isOpaque(checker, type) {
  if ((type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any | ts.TypeFlags.NonPrimitive)) !== 0) return true;
  if (type.isUnion()) return type.types.some((t) => isOpaque(checker, t));
  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    return checker.getPropertiesOfType(type).length === 0
      && checker.getSignaturesOfType(type, ts.SignatureKind.Call).length === 0
      && checker.getIndexInfosOfType(type).length === 0;
  }
  return false;
}

function isJsonStringify(callee) {
  return callee.type === 'MemberExpression'
    && !callee.computed
    && callee.object.type === 'Identifier' && callee.object.name === 'JSON'
    && callee.property.type === 'Identifier' && callee.property.name === 'stringify';
}

export const noUntrustedSink = {
  meta: {
    type: 'problem',
    docs: { description: 'Untrusted text is never serialised, nor widened to unknown, any, or object (I7)' },
    messages: {
      stringify: 'I7: {{type}} is passed to JSON.stringify, which serialises untrusted text into a string.',
      widened: 'I7: {{type}} is widened to {{target}}, which hides it from the cast scan.',
      erased: 'I7: {{type}} fills a type parameter that the function return type drops, which erases it as unknown would.',
    },
    schema: [],
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (services?.program == null) {
      throw new Error('i7/no-untrusted-sink needs type information; run it with a typed parser configuration');
    }
    const checker = services.program.getTypeChecker();
    const typeOf = (node) => checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
    const nameOf = (type) => checker.typeToString(type);

    /** Reports `node` when it is untrusted and the slot it fills is opaque. */
    const checkSlot = (node) => {
      if (node == null || node.type === 'SpreadElement') return;
      const type = typeOf(node);
      if (!holdsUntrusted(checker, type)) return;
      const contextual = checker.getContextualType(services.esTreeNodeToTSNodeMap.get(node));
      if (contextual !== undefined && isOpaque(checker, contextual)) {
        context.report({ node, messageId: 'widened', data: { type: nameOf(type), target: nameOf(contextual) } });
      }
    };

    /** Reports an untrusted argument a generic call erases (codex-1, gemini-1). */
    const checkErased = (node) => {
      const call = services.esTreeNodeToTSNodeMap.get(node);
      for (const arg of erasingArguments(checker, call)) {
        const type = checker.getTypeAtLocation(arg);
        if (holdsUntrusted(checker, type)) {
          context.report({ node: services.tsNodeToESTreeNodeMap.get(arg), messageId: 'erased', data: { type: nameOf(type) } });
        }
      }
    };

    return {
      CallExpression(node) {
        if (isJsonStringify(node.callee)) {
          for (const arg of node.arguments) {
            if (arg.type !== 'SpreadElement' && holdsUntrusted(checker, typeOf(arg))) {
              context.report({ node: arg, messageId: 'stringify', data: { type: nameOf(typeOf(arg)) } });
            }
          }
          return;
        }
        node.arguments.forEach(checkSlot);
        checkErased(node);
      },
      NewExpression(node) {
        node.arguments.forEach(checkSlot);
      },
      VariableDeclarator(node) {
        checkSlot(node.init);
      },
      AssignmentExpression(node) {
        checkSlot(node.right);
      },
      ReturnStatement(node) {
        checkSlot(node.argument);
      },
      ArrowFunctionExpression(node) {
        if (node.expression) checkSlot(node.body);
      },
      Property(node) {
        if (node.parent.type === 'ObjectExpression') checkSlot(node.value);
      },
      ArrayExpression(node) {
        node.elements.forEach(checkSlot);
      },
    };
  },
};

/** The plugin eslint.config.js loads: one rule, named for the invariant it serves. */
export default { rules: { 'no-untrusted-sink': noUntrustedSink } };
