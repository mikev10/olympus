// I7: the sink rule (`I7.untrusted-sink-lint-rule`, D-F3-06, D-R22-09).
//
// The type system stops UntrustedText from reaching a string-typed slot, and
// three typed rules stop `+`, interpolation, and String(). Two paths remained:
// `JSON.stringify(raw)`, and widening `raw` to `unknown`, `any`, or `object`
// by annotation, argument, return, or property before casting, which hides it
// from the cast scan. This rule reports a value typed UntrustedText or
// UntrustedPayload in either place.
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
      if (!isUntrusted(type)) return;
      const contextual = checker.getContextualType(services.esTreeNodeToTSNodeMap.get(node));
      if (contextual !== undefined && isOpaque(checker, contextual)) {
        context.report({ node, messageId: 'widened', data: { type: nameOf(type), target: nameOf(contextual) } });
      }
    };

    return {
      CallExpression(node) {
        if (isJsonStringify(node.callee)) {
          for (const arg of node.arguments) {
            if (arg.type !== 'SpreadElement' && isUntrusted(typeOf(arg))) {
              context.report({ node: arg, messageId: 'stringify', data: { type: nameOf(typeOf(arg)) } });
            }
          }
          return;
        }
        node.arguments.forEach(checkSlot);
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
