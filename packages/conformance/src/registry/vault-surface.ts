/**
 * What a constructed Vault exposes at run time beyond its named operations
 * (I1, #65). Read from the instance and its whole prototype chain up to
 * `Object.prototype`, by `Reflect.ownKeys`, so an instance field, a
 * symbol-keyed method, an inherited helper, and an accessor are all seen: a
 * read of the class prototype's own string names misses every one of them.
 *
 * Returns one line per problem; an empty list is the only pass.
 */
export function vaultSurfaceProblems(instance: object, named: readonly string[]): string[] {
  const problems: string[] = [];
  const found = new Set<string>();
  for (const key of Reflect.ownKeys(instance)) {
    problems.push(`an instance property ${describeKey(key)}, which no prototype check sees`);
  }
  for (let proto: object | null = Object.getPrototypeOf(instance) as object | null; proto !== null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
    for (const key of Reflect.ownKeys(proto)) {
      if (key === 'constructor') continue;
      if (typeof key === 'symbol' || !named.includes(key)) {
        problems.push(`${describeKey(key)}, which is not a named operation`);
        continue;
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(proto, key);
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

function describeKey(key: string | symbol): string {
  return typeof key === 'symbol' ? `the symbol-keyed ${key.toString()}` : `'${key}'`;
}
