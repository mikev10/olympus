/**
 * Schema validation: the narrowing from an already-parsed value to a
 * PolicyDocument. Every case here is a refusal that must not be a repair
 * (I5), or an unknown key that must not be ignored (I4).
 */
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_POLICY_DOCUMENT, formatDefects, validatePolicyDocument,
  type PolicyDefect, type PolicyDocument, type RoleId,
} from '../src/index.js';

/** A structurally complete document, as a plain value the validator has not seen. */
function authored(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DEFAULT_POLICY_DOCUMENT)) as Record<string, unknown>;
}

function scope(): Record<string, unknown> {
  return {
    stations: ['build'],
    writableGlobs: ['src/**'],
    tools: ['read', 'write'],
    network: { egress: 'none' },
    tier: 'standard',
    autonomyCeiling: 2,
    triggerKinds: ['human'],
    budget: { maxTokens: 1000, maxCostUsd: 1.5, maxWallClockMs: 60_000 },
  };
}

const BUILDER = 'builder' as RoleId;
const CLOSED = 'closed' as RoleId;
const OPEN = 'open' as RoleId;

function refuse(input: unknown): readonly PolicyDefect[] {
  const outcome = validatePolicyDocument(input);
  if (outcome.ok) throw new Error(`expected a refusal, got a document:\n${JSON.stringify(input)}`);
  return outcome.defects;
}

function accept(input: unknown): PolicyDocument {
  const outcome = validatePolicyDocument(input);
  if (!outcome.ok) throw new Error(`expected a document, got defects:\n${formatDefects(outcome.defects)}`);
  return outcome.document;
}

/** Every defect, as `path: problem`, so a test can match on either half. */
function lines(defects: readonly PolicyDefect[]): string[] {
  return defects.map((d) => `${d.path}: ${d.problem}`);
}

describe('the shipped default', () => {
  test('passes the validator, so the default and the schema cannot drift', () => {
    const document = accept(authored());
    expect(document.globalCap).toBe(2);
    expect(document.triggers.enabled).toStrictEqual(['human']);
  });

  test('grants nothing: no role, no approval, no station cap', () => {
    expect(Object.keys(DEFAULT_POLICY_DOCUMENT.roles)).toHaveLength(0);
    expect(Object.keys(DEFAULT_POLICY_DOCUMENT.approvals)).toHaveLength(0);
    expect(Object.keys(DEFAULT_POLICY_DOCUMENT.stationCaps)).toHaveLength(0);
  });

  test('names the paths that escalate the integrate gate', () => {
    expect(DEFAULT_POLICY_DOCUMENT.protectedPaths).toContain('.github/**');
    expect(DEFAULT_POLICY_DOCUMENT.protectedPaths).toContain('packages/conformance/**');
    expect(DEFAULT_POLICY_DOCUMENT.protectedPaths.length).toBeGreaterThan(0);
  });
});

describe('an unknown key is refused, never ignored (I4)', () => {
  test('at the document root, naming the key and the keys allowed there', () => {
    const defects = refuse({ ...authored(), globalCapp: 3 });
    expect(lines(defects)).toContainEqual(expect.stringContaining('globalCapp: unknown key'));
    expect(lines(defects).join('\n')).toContain('globalCap');
  });

  test('inside a role scope, at its full path', () => {
    const document = authored();
    document.roles = { builder: { ...scope(), netwrok: { egress: 'none' } } };
    expect(lines(refuse(document))).toContainEqual(expect.stringContaining('roles.builder.netwrok: unknown key'));
  });

  test('inside the nested network and budget objects', () => {
    const document = authored();
    document.roles = {
      builder: { ...scope(), network: { egress: 'none', allow: ['example.com'] } },
    };
    expect(lines(refuse(document))).toContainEqual(expect.stringContaining('roles.builder.network.allow: unknown key'));
  });

  test('inside the trigger policy', () => {
    const document = authored();
    document.triggers = { ...DEFAULT_POLICY_DOCUMENT.triggers, allowAnonymous: true };
    expect(lines(refuse(document))).toContainEqual(expect.stringContaining('triggers.allowAnonymous: unknown key'));
  });

  test('even when every required key is present and valid', () => {
    // The point of the invariant: the document is otherwise perfect, and the
    // stray key is still a refusal rather than a value to drop.
    const defects = refuse({ ...authored(), note: 'harmless' });
    expect(defects).toHaveLength(1);
    expect(lines(defects)[0]).toContain('note: unknown key');
  });
});

describe('a value outside its domain is refused, naming the field', () => {
  test('an autonomy level above 3', () => {
    expect(lines(refuse({ ...authored(), globalCap: 4 })))
      .toContainEqual('globalCap: expected an autonomy level 0-3, found the number 4');
  });

  test('an autonomy level written as text', () => {
    expect(lines(refuse({ ...authored(), globalCap: '2' })))
      .toContainEqual(expect.stringContaining('globalCap: expected an autonomy level 0-3, found the string'));
  });

  test('a station that is not one of the ten', () => {
    const document = authored();
    document.stationCaps = { deploy: 1 };
    expect(lines(refuse(document))).toContainEqual('stationCaps.deploy: not a station id');
  });

  test('an approval key that is not station:level', () => {
    const document = authored();
    document.approvals = { build: 'auto' };
    expect(lines(refuse(document))).toContainEqual(expect.stringContaining(`approvals.build: not a 'station:level' key`));
  });

  test('an approval key whose level is out of range', () => {
    const document = authored();
    document.approvals = { 'build:4': 'auto' };
    expect(lines(refuse(document))).toContainEqual(expect.stringContaining('approvals.build:4: not a'));
  });

  test('an approval outcome that is not one of the three', () => {
    const document = authored();
    document.approvals = { 'build:2': 'allow' };
    expect(lines(refuse(document))).toContainEqual(expect.stringContaining(`approvals.build:2: expected one of 'auto'`));
  });

  test('a negative budget', () => {
    const document = authored();
    document.roles = { builder: { ...scope(), budget: { maxTokens: -1, maxCostUsd: 0, maxWallClockMs: 0 } } };
    expect(lines(refuse(document)))
      .toContainEqual('roles.builder.budget.maxTokens: expected a non-negative integer, found the number -1');
  });

  test('a non-integer window, and a zero window length', () => {
    const document = authored();
    document.triggers = {
      ...DEFAULT_POLICY_DOCUMENT.triggers,
      budgetPerWindow: { runs: 1.5, windowMs: 0 },
    };
    const reported = lines(refuse(document)).join('\n');
    expect(reported).toContain('triggers.budgetPerWindow.runs: expected a non-negative integer');
    expect(reported).toContain('triggers.budgetPerWindow.windowMs: expected a positive integer');
  });

  test('a concurrency of zero parallel tasks', () => {
    const document = authored();
    document.concurrency = { maxParallelTasks: 0, maxConflictRetries: 3 };
    expect(lines(refuse(document)))
      .toContainEqual('concurrency.maxParallelTasks: expected a positive integer, found the number 0');
  });
});

describe('egress admits no wildcard (I4)', () => {
  test(`'none' and an explicit host list are both accepted`, () => {
    const document = authored();
    document.roles = {
      closed: scope(),
      open: { ...scope(), network: { egress: ['registry.npmjs.org'] } },
    };
    const accepted = accept(document);
    expect(accepted.roles[CLOSED]?.network.egress).toBe('none');
    expect(accepted.roles[OPEN]?.network.egress).toStrictEqual(['registry.npmjs.org']);
  });

  test(`a bare 'all' is refused and the message says there is no wildcard`, () => {
    const document = authored();
    document.roles = { builder: { ...scope(), network: { egress: 'all' } } };
    expect(lines(refuse(document))).toContainEqual(expect.stringContaining('there is no wildcard'));
  });

  test('an empty host entry is refused rather than trimmed away', () => {
    const document = authored();
    document.roles = { builder: { ...scope(), network: { egress: ['   '] } } };
    expect(lines(refuse(document)))
      .toContainEqual('roles.builder.network.egress: every egress entry must be a non-empty host string');
  });
});

describe('the document itself must be an object', () => {
  test.each([
    ['null', null],
    ['an array', []],
    ['a string', 'globalCap: 2'],
    ['undefined', undefined],
  ] as const)('%s is refused rather than read as empty', (_label, input) => {
    const defects = refuse(input);
    expect(defects).toHaveLength(1);
    expect(lines(defects)[0]).toContain('(document): expected an object');
  });
});

describe('a missing required key is reported once, at its path', () => {
  test('a top-level key', () => {
    const document = authored();
    delete document.concurrency;
    const defects = refuse(document);
    expect(defects).toHaveLength(1);
    expect(lines(defects)[0]).toContain('concurrency: required key is missing');
  });

  test('a key inside a role scope', () => {
    const document = authored();
    const partial = scope();
    delete partial.tools;
    document.roles = { builder: partial };
    const defects = refuse(document);
    expect(defects).toHaveLength(1);
    expect(lines(defects)[0]).toContain('roles.builder.tools: required key is missing');
  });

  test('every defect is reported, not just the first', () => {
    const defects = refuse({ globalCap: 9, stray: true });
    // globalCap out of range, five missing keys, one unknown key.
    expect(defects.length).toBeGreaterThan(3);
    expect(formatDefects(defects).split('\n').length).toBe(defects.length);
  });
});

describe('a role id must be usable', () => {
  test('__proto__ is refused by name', () => {
    const document = authored();
    // A plain object literal with a __proto__ key sets the prototype rather
    // than a property, so build the map explicitly.
    const roles: Record<string, unknown> = {};
    Object.defineProperty(roles, '__proto__', { value: scope(), enumerable: true, configurable: true });
    document.roles = roles;
    expect(lines(refuse(document))).toContainEqual(expect.stringContaining('not a usable role id'));
  });

  test('an empty role id is refused', () => {
    const document = authored();
    document.roles = { '  ': scope() };
    expect(lines(refuse(document))).toContainEqual(expect.stringContaining('not a usable role id'));
  });
});

describe('the validated document is built, not passed through', () => {
  test('a valid document round-trips to the same values', () => {
    const document = authored();
    document.roles = { builder: scope() };
    const validated = accept(document);
    expect(validated.roles[BUILDER]?.tools).toStrictEqual(['read', 'write']);
    expect(validated.roles[BUILDER]?.stations).toStrictEqual(['build']);
  });

  test('mutating the input afterwards does not change the validated document', () => {
    const document = authored();
    const tools = ['read'];
    document.roles = { builder: { ...scope(), tools } };
    const validated = accept(document);
    tools.push('shell');
    expect(validated.roles[BUILDER]?.tools).toStrictEqual(['read']);
  });
});
