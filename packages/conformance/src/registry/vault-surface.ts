import { types } from 'node:util';

/**
 * What a constructed Vault exposes at run time beyond its named operations
 * (I1, #65). Read from the instance and its whole prototype chain up to
 * `Object.prototype`, by `Reflect.ownKeys`, so an instance field, a
 * symbol-keyed method, an inherited helper, and an accessor are all seen: a
 * read of the class prototype's own string names misses every one of them.
 * Each constructor on that chain is read too, with its own static chain up to
 * `Function.prototype`, since `vault.constructor` reaches a static member
 * from the instance (codex-2, gemini-2).
 *
 * A Proxy anywhere on the instance, its prototypes, or its constructors is
 * refused before anything is read (gemini-3): its traps decide what
 * reflection reports, so nothing read through one is evidence of the surface.
 *
 * Returns one line per problem; an empty list is the only pass.
 */
export function vaultSurfaceProblems(instance: object, named: readonly string[]): string[] {
  if (types.isProxy(instance)) return ['the instance is a Proxy, whose traps decide what reflection reports of its surface'];
  const problems: string[] = [];
  const found = new Set<string>();
  for (const key of Reflect.ownKeys(instance)) {
    problems.push(`an instance property ${describeKey(key)}, which no prototype check sees`);
  }
  for (let proto: object | null = Object.getPrototypeOf(instance) as object | null; proto !== null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
    if (types.isProxy(proto)) return [...problems, 'a prototype on the chain is a Proxy, whose traps decide what reflection reports of it'];
    for (const key of Reflect.ownKeys(proto)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(proto, key);
      if (key === 'constructor') {
        if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'function') {
          problems.push("'constructor', which is not a plain function: an accessor there runs code the contract does not declare");
        } else {
          problems.push(...staticProblems(descriptor.value as object));
        }
        continue;
      }
      if (typeof key === 'symbol' || !named.includes(key)) {
        problems.push(`${describeKey(key)}, which is not a named operation`);
        continue;
      }
      if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'function') {
        problems.push(`${describeKey(key)}, which is not a plain method: an accessor or a value under a named operation's name runs code the contract does not declare`);
        continue;
      }
      found.add(key);
    }
  }
  for (const name of named) {
    if (!found.has(name)) problems.push(`no plain method for the named operation '${name}'`);
  }
  return problems;
}

/** The names every function carries, which are not a surface a caller can mutate through. */
const FUNCTION_OWN = new Set<string | symbol>(['length', 'name', 'prototype']);

/** Static members of a constructor and of every constructor it inherits from, up to `Function.prototype`. */
function staticProblems(constructor: object): string[] {
  const problems: string[] = [];
  for (let fn: object | null = constructor; fn !== null && fn !== Function.prototype; fn = Object.getPrototypeOf(fn) as object | null) {
    if (types.isProxy(fn)) return [...problems, 'a constructor on the chain is a Proxy, whose traps decide what reflection reports of it'];
    for (const key of Reflect.ownKeys(fn)) {
      if (!FUNCTION_OWN.has(key)) problems.push(`a static ${describeKey(key)}, reachable from the instance as its constructor's`);
    }
  }
  return problems;
}

function describeKey(key: string | symbol): string {
  return typeof key === 'symbol' ? `the symbol-keyed ${key.toString()}` : `'${key}'`;
}
