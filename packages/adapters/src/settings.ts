/**
 * One view over a config object, whichever form it was written in: a JSON
 * value (`jest.config.json`, the `jest` key of `package.json`) or an object
 * literal read statically out of a module. Each accessor returns the value,
 * `undefined` when the key is absent, or `Unresolvable` naming why it could
 * not be read — never a default.
 */
import type ts from 'typescript';
import { booleanOf, objectOf, stringOf, stringsOf, Unresolvable, type ModuleScope, type ObjectView } from './static.js';

export interface Settings {
  readonly label: string;
  keys(): readonly string[];
  string(key: string): string | Unresolvable | undefined;
  /** An array of strings; with `allowSingle`, a lone string is read as a one-element array. */
  strings(key: string, allowSingle?: boolean): string[] | Unresolvable | undefined;
  boolean(key: string): boolean | Unresolvable | undefined;
  object(key: string): Settings | Unresolvable | undefined;
}

export class JsonSettings implements Settings {
  constructor(
    readonly label: string,
    private readonly value: Readonly<Record<string, unknown>>,
  ) {}

  keys(): readonly string[] {
    return Object.keys(this.value);
  }

  string(key: string): string | Unresolvable | undefined {
    if (!(key in this.value)) return undefined;
    const value = this.value[key];
    return typeof value === 'string' ? value : new Unresolvable(`${this.label}: ${key} is not a string`);
  }

  strings(key: string, allowSingle = false): string[] | Unresolvable | undefined {
    if (!(key in this.value)) return undefined;
    const value = this.value[key];
    if (allowSingle && typeof value === 'string') return [value];
    if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) return [...value];
    return new Unresolvable(`${this.label}: ${key} is not an array of strings`);
  }

  boolean(key: string): boolean | Unresolvable | undefined {
    if (!(key in this.value)) return undefined;
    const value = this.value[key];
    return typeof value === 'boolean' ? value : new Unresolvable(`${this.label}: ${key} is not a boolean`);
  }

  object(key: string): Settings | Unresolvable | undefined {
    if (!(key in this.value)) return undefined;
    const value = this.value[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return new JsonSettings(`${this.label}.${key}`, value as Record<string, unknown>);
    }
    return new Unresolvable(`${this.label}: ${key} is not an object`);
  }
}

export class StaticSettings implements Settings {
  constructor(
    readonly label: string,
    private readonly view: ObjectView,
    private readonly scope: ModuleScope,
  ) {}

  static of(node: ts.Expression, scope: ModuleScope, label: string): StaticSettings | Unresolvable {
    const view = objectOf(node, scope, label);
    return view instanceof Unresolvable ? view : new StaticSettings(label, view, scope);
  }

  keys(): readonly string[] {
    return [...this.view.properties.keys()];
  }

  private at(key: string): ts.Expression | undefined {
    return this.view.properties.get(key);
  }

  string(key: string): string | Unresolvable | undefined {
    const node = this.at(key);
    return node === undefined ? undefined : stringOf(node, this.scope, `${this.label}.${key}`);
  }

  strings(key: string, allowSingle = false): string[] | Unresolvable | undefined {
    const node = this.at(key);
    if (node === undefined) return undefined;
    if (allowSingle) {
      const single = stringOf(node, this.scope, `${this.label}.${key}`);
      if (!(single instanceof Unresolvable)) return [single];
    }
    return stringsOf(node, this.scope, `${this.label}.${key}`);
  }

  boolean(key: string): boolean | Unresolvable | undefined {
    const node = this.at(key);
    return node === undefined ? undefined : booleanOf(node, this.scope, `${this.label}.${key}`);
  }

  object(key: string): Settings | Unresolvable | undefined {
    const node = this.at(key);
    return node === undefined ? undefined : StaticSettings.of(node, this.scope, `${this.label}.${key}`);
  }
}
