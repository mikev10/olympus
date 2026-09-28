/**
 * `I5.policy-document-load-is-hardened`: the loader that reads `policy.yaml`
 * refuses, rather than tolerates, each of four things — and each refusal is
 * shown to depend on its setting. For every limit, one document is refused
 * under the defaults the service uses and accepted past that limit when the
 * one setting is relaxed, so deleting or loosening the default makes the
 * strict half of this assertion fail rather than pass.
 *
 * The parser pin is read from the api package's manifest and from the parser
 * actually installed beside it: a range, or an installed version other than
 * the pin, fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PolicyLoad } from '@olympus-ai/api';
import { workspacePackages } from '../kit/workspace.js';
import { grantingDocument } from './policy.js';

/**
 * The ceilings the service's defaults must stay within. Fixed here rather than
 * read from the defaults, so raising a default past them fails this assertion
 * instead of moving the cases along with it.
 */
const MAX_BYTES = 64 * 1024;
const MAX_DEPTH = 32;

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function expectRefused(load: PolicyLoad, code: string, what: string): void {
  if (load.ok || load.code !== code) throw new Error(`I5: ${what} was not refused as ${code}: ${JSON.stringify(load)}`);
}

function expectNotRefusedFor(load: PolicyLoad, code: string, what: string): void {
  if (!load.ok && load.code === code) throw new Error(`I5: ${what} was still refused as ${code} with the setting relaxed, so the refusal is not the setting's: ${load.message}`);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

export async function assertPolicyLoadIsHardened(): Promise<void> {
  const { parsePolicyYaml, POLICY_FILE_LIMITS } = await import('@olympus-ai/api');
  const json = JSON.stringify(grantingDocument());
  const valid = parsePolicyYaml(bytes(json));
  if (!valid.ok) throw new Error(`I5: a valid policy document was refused, so no refusal below is evidence: ${valid.message}`);

  // No alias: an alias bomb has nothing to expand. The document is otherwise valid, so relaxing the count admits it.
  if (!json.includes('"maxAutonomy":{"human":2}') || !json.includes('"maxTriggerDepth":2')) throw new Error('I5: the fixture document lost the fields the alias case edits');
  const aliased = json.replace('"maxAutonomy":{"human":2}', '"maxAutonomy":{"human":&n 2}').replace('"maxTriggerDepth":2', '"maxTriggerDepth":*n');
  expectRefused(parsePolicyYaml(bytes(aliased)), 'alias', 'a document with one alias');
  const aliasRelaxed = parsePolicyYaml(bytes(aliased), { ...POLICY_FILE_LIMITS, maxAliasCount: 10 });
  if (!aliasRelaxed.ok) throw new Error(`I5: the aliased document was refused with aliases allowed: ${aliasRelaxed.message}`);
  const bomb = ['a: &a [x, x, x, x, x, x, x, x, x]', ...Array.from({ length: 8 }, (_, i) => `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array.from({ length: 9 }, () => `*${String.fromCharCode(97 + i)}`).join(', ')}]`)].join('\n');
  expectRefused(parsePolicyYaml(bytes(bomb)), 'alias', 'an alias bomb');

  // A byte cap, checked before parsing: the same valid document, padded past the cap with a comment.
  const padded = `#${' '.repeat(MAX_BYTES)}\n${json}`;
  expectRefused(parsePolicyYaml(bytes(padded)), 'too-large', 'a document one comment past the byte cap');
  const sizeRelaxed = parsePolicyYaml(bytes(padded), { ...POLICY_FILE_LIMITS, maxBytes: padded.length * 2 });
  if (!sizeRelaxed.ok) throw new Error(`I5: the padded document was refused with the byte cap relaxed: ${sizeRelaxed.message}`);

  // A nesting-depth limit, measured before anything recursive composes the document.
  const depth = MAX_DEPTH + 1;
  const deep = json.replace('"protectedPaths":[', `"protectedPaths":[${'['.repeat(depth)}${']'.repeat(depth)},`);
  expectRefused(parsePolicyYaml(bytes(deep)), 'too-deep', `a document nested ${String(depth)} deep`);
  expectNotRefusedFor(parsePolicyYaml(bytes(deep), { ...POLICY_FILE_LIMITS, maxDepth: depth + 10 }), 'too-deep', `a document nested ${String(depth)} deep`);
  // Far past any stack: refused by the measure, not by a crash.
  expectRefused(parsePolicyYaml(bytes(`a: ${'['.repeat(30_000)}`)), 'too-deep', 'a document nested thirty thousand deep');

  // The pin: exact in the manifest, and what is installed is what is pinned.
  const api = workspacePackages().find((p) => p.name === '@olympus-ai/api');
  if (api === undefined) throw new Error('I5: @olympus-ai/api is not in the workspace');
  const dependencies = readJson(join(api.dir, 'package.json')).dependencies as Record<string, string> | undefined;
  const pinned = dependencies?.yaml;
  if (pinned === undefined || !/^\d+\.\d+\.\d+$/.test(pinned)) throw new Error(`I5: the YAML parser is not pinned to an exact version: ${String(pinned)}`);
  const installed = readJson(join(api.dir, 'node_modules', 'yaml', 'package.json')).version;
  if (installed !== pinned) throw new Error(`I5: the installed YAML parser is ${String(installed)}, not the pinned ${pinned}`);
}
