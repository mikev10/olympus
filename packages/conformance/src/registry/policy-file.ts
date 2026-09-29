/**
 * `I5.policy-document-load-is-hardened`: the loader that reads `policy.yaml`
 * refuses, rather than tolerates, each of four things — and each refusal is
 * shown to depend on its setting. For the byte cap and the depth limit, a
 * document exactly at the limit gets past it and one a step beyond is refused,
 * under the defaults and through `loadPolicyFile`, the path the service reads
 * the file by; relaxing the one setting lets the refused document past it. So
 * deleting or loosening a default fails this assertion rather than passing.
 *
 * The parser pin is read from the api package's manifest and from the parser
 * actually installed beside it: a range, or an installed version other than
 * the pin, fails.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PolicyLoad } from '@olympus-ai/api';
import { workspacePackages } from '../kit/workspace.js';
import { grantingDocument } from './policy.js';

/**
 * The service's defaults. Fixed here rather than read from the defaults, and
 * each is tested at the boundary and one past it, so changing a default in
 * either direction fails this assertion instead of moving the cases along
 * with it (D-P9-09).
 */
const MAX_BYTES = 64 * 1024;
const MAX_DEPTH = 32;

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function expectRefused(load: PolicyLoad, code: string, what: string): void {
  if (load.ok || load.code !== code) throw new Error(`I5: ${what} was not refused as ${code}: ${JSON.stringify(load)}`);
}

function expectAdmitted(load: PolicyLoad, what: string): void {
  if (!load.ok) throw new Error(`I5: ${what} was refused as ${load.code}, so the refusal beside it is not the limit's: ${load.message}`);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

export async function assertPolicyLoadIsHardened(): Promise<void> {
  const { parsePolicyYaml, loadPolicyFile, POLICY_FILE_LIMITS } = await import('@olympus-ai/api');
  const json = JSON.stringify(grantingDocument());
  const valid = parsePolicyYaml(bytes(json));
  if (!valid.ok) throw new Error(`I5: a valid policy document was refused, so no refusal below is evidence: ${valid.message}`);

  // No alias: an alias bomb has nothing to expand. The document is otherwise valid, so relaxing the count admits it.
  if (!json.includes('"maxAutonomy":{"human":2}') || !json.includes('"maxTriggerDepth":2')) throw new Error('I5: the fixture document lost the fields the alias case edits');
  const aliased = json.replace('"maxAutonomy":{"human":2}', '"maxAutonomy":{"human":&n 2}').replace('"maxTriggerDepth":2', '"maxTriggerDepth":*n');
  expectRefused(parsePolicyYaml(bytes(aliased)), 'alias', 'a document with one alias');
  expectAdmitted(parsePolicyYaml(bytes(aliased), { ...POLICY_FILE_LIMITS, maxAliasCount: 10 }), 'the aliased document with aliases allowed');
  const bomb = ['a: &a [x, x, x, x, x, x, x, x, x]', ...Array.from({ length: 8 }, (_, i) => `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array.from({ length: 9 }, () => `*${String.fromCharCode(97 + i)}`).join(', ')}]`)].join('\n');
  expectRefused(parsePolicyYaml(bytes(bomb)), 'alias', 'an alias bomb');

  // A byte cap, checked before parsing: the same valid document, padded with a comment to exactly
  // the cap and then one byte past it. The first is admitted and the second refused, so the default
  // is the cap itself — raising it by a byte fails here, as does lowering it.
  const pad = (total: number): string => `#${' '.repeat(total - bytes(json).byteLength - 2)}\n${json}`;
  const atCap = pad(MAX_BYTES);
  const pastCap = pad(MAX_BYTES + 1);
  if (bytes(atCap).byteLength !== MAX_BYTES || bytes(pastCap).byteLength !== MAX_BYTES + 1) throw new Error('I5: the byte-cap fixtures are not the sizes they claim');
  expectAdmitted(parsePolicyYaml(bytes(atCap)), 'a valid document exactly at the byte cap');
  expectRefused(parsePolicyYaml(bytes(pastCap)), 'too-large', 'a document one byte past the byte cap');
  expectAdmitted(parsePolicyYaml(bytes(pastCap), { ...POLICY_FILE_LIMITS, maxBytes: MAX_BYTES + 1 }), 'the same document with the byte cap relaxed');

  // A nesting-depth limit, measured before anything recursive composes the document. `a:` opens one
  // map, and each `[` one more level. No policy field nests freely, so a document this deep can never
  // be a valid policy: past the depth check it is refused as `invalid-policy`, and only as that, which
  // is the evidence the depth check let it through. Any other refusal fails.
  const nested = (depth: number): string => `a: ${'['.repeat(depth - 1)}${']'.repeat(depth - 1)}\n`;
  expectRefused(parsePolicyYaml(bytes(nested(MAX_DEPTH))), 'invalid-policy', `a document nested exactly ${String(MAX_DEPTH)} deep`);
  expectRefused(parsePolicyYaml(bytes(nested(MAX_DEPTH + 1))), 'too-deep', `a document nested ${String(MAX_DEPTH + 1)} deep`);
  expectRefused(parsePolicyYaml(bytes(nested(MAX_DEPTH + 1)), { ...POLICY_FILE_LIMITS, maxDepth: MAX_DEPTH + 1 }), 'invalid-policy', `a document nested ${String(MAX_DEPTH + 1)} deep with the depth limit relaxed`);
  // Far past any stack: refused by the measure, not by a crash.
  expectRefused(parsePolicyYaml(bytes(`a: ${'['.repeat(30_000)}`)), 'too-deep', 'a document nested thirty thousand deep');

  // The service reads the file through `loadPolicyFile`, with no limits passed; the same boundaries
  // hold there, so a loader handed relaxed limits of its own fails here.
  const dir = await mkdtemp(join(tmpdir(), 'policy-load-'));
  try {
    const write = async (name: string, text: string): Promise<string> => {
      const path = join(dir, name);
      await writeFile(path, text);
      return path;
    };
    expectAdmitted(await loadPolicyFile(await write('at-cap.yaml', atCap)), 'a policy file exactly at the byte cap');
    expectRefused(await loadPolicyFile(await write('past-cap.yaml', pastCap)), 'too-large', 'a policy file one byte past the byte cap');
    expectRefused(await loadPolicyFile(await write('at-depth.yaml', nested(MAX_DEPTH))), 'invalid-policy', `a policy file nested exactly ${String(MAX_DEPTH)} deep`);
    expectRefused(await loadPolicyFile(await write('past-depth.yaml', nested(MAX_DEPTH + 1))), 'too-deep', `a policy file nested ${String(MAX_DEPTH + 1)} deep`);
    expectRefused(await loadPolicyFile(await write('aliased.yaml', aliased)), 'alias', 'a policy file with one alias');
    expectRefused(await loadPolicyFile(join(dir, 'absent.yaml')), 'unreadable', 'a policy file that does not exist');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // The pin: exact in the manifest, and what is installed is what is pinned.
  const api = workspacePackages().find((p) => p.name === '@olympus-ai/api');
  if (api === undefined) throw new Error('I5: @olympus-ai/api is not in the workspace');
  const dependencies = readJson(join(api.dir, 'package.json')).dependencies as Record<string, string> | undefined;
  const pinned = dependencies?.yaml;
  if (pinned === undefined || !/^\d+\.\d+\.\d+$/.test(pinned)) throw new Error(`I5: the YAML parser is not pinned to an exact version: ${String(pinned)}`);
  const installed = readJson(join(api.dir, 'node_modules', 'yaml', 'package.json')).version;
  if (installed !== pinned) throw new Error(`I5: the installed YAML parser is ${String(installed)}, not the pinned ${pinned}`);
}
