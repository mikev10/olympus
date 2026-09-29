/**
 * Reads `policy.yaml` from bytes into a resolved Policy. The first code to
 * touch untrusted-shaped bytes on their way into the Vault, so every limit is
 * a refusal, never a setting that degrades (I5):
 *
 * - the parser is pinned to an exact version in `package.json`, so the code
 *   these limits were proved against is the code that runs;
 * - no alias is allowed, so an alias bomb has nothing to expand;
 * - the document has a byte cap, checked before a byte is parsed;
 * - collections nest to a fixed depth, measured on the parser's concrete
 *   syntax tree with an explicit stack before anything recursive composes it.
 *
 * `limits` exists so the conformance suite can relax one setting and watch the
 * refusal disappear; a service passes nothing and gets the defaults.
 */
import { open } from 'node:fs/promises';
import { formatDefects, StrictPolicyEngine, validatePolicyDocument, type Policy } from '@olympus-ai/core';
import { Parser, parseDocument } from 'yaml';

export interface PolicyFileLimits {
  readonly maxBytes: number;
  /** Collection nesting, the document's top-level collection counting as one. */
  readonly maxDepth: number;
  readonly maxAliasCount: number;
}

export const POLICY_FILE_LIMITS: PolicyFileLimits = Object.freeze({ maxBytes: 64 * 1024, maxDepth: 32, maxAliasCount: 0 });

export type PolicyFileCode = 'unreadable' | 'too-large' | 'not-yaml' | 'alias' | 'too-deep' | 'invalid-policy';

export type PolicyLoad =
  | { readonly ok: true; readonly policy: Policy }
  | { readonly ok: false; readonly code: PolicyFileCode; readonly message: string };

const COLLECTIONS: ReadonlySet<string> = new Set(['block-map', 'block-seq', 'flow-collection']);

interface CstNode {
  readonly type?: unknown;
  readonly value?: unknown;
  readonly items?: unknown;
}

function isNode(value: unknown): value is CstNode {
  return typeof value === 'object' && value !== null;
}

/** The deepest collection nesting and the alias count, walked with an explicit stack. */
function measure(roots: readonly unknown[]): { depth: number; aliases: number } {
  let depth = 0;
  let aliases = 0;
  const stack: Array<{ node: unknown; depth: number }> = roots.map((node) => ({ node, depth: 0 }));
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { node } = next;
    if (!isNode(node)) continue;
    if (node.type === 'alias') aliases += 1;
    const here = COLLECTIONS.has(String(node.type)) ? next.depth + 1 : next.depth;
    depth = Math.max(depth, here);
    if (isNode(node.value)) stack.push({ node: node.value, depth: here });
    if (Array.isArray(node.items)) {
      for (const item of node.items as unknown[]) {
        if (!isNode(item)) continue;
        const pair = item as { key?: unknown; value?: unknown };
        if (isNode(pair.key)) stack.push({ node: pair.key, depth: here });
        if (isNode(pair.value)) stack.push({ node: pair.value, depth: here });
      }
    }
  }
  return { depth, aliases };
}

export function parsePolicyYaml(bytes: Uint8Array, limits: PolicyFileLimits = POLICY_FILE_LIMITS): PolicyLoad {
  if (bytes.byteLength > limits.maxBytes) {
    return { ok: false, code: 'too-large', message: `the policy document is ${String(bytes.byteLength)} bytes; the limit is ${String(limits.maxBytes)}` };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: 'not-yaml', message: 'the policy document is not UTF-8' };
  }
  const cst = [...new Parser().parse(text)];
  const documents = cst.filter((token) => token.type === 'document');
  if (documents.length !== 1) {
    return { ok: false, code: 'not-yaml', message: `the policy file holds ${String(documents.length)} documents; it must hold exactly one` };
  }
  const { depth, aliases } = measure(documents);
  if (aliases > limits.maxAliasCount) {
    return { ok: false, code: 'alias', message: `the policy document uses ${String(aliases)} alias(es); at most ${String(limits.maxAliasCount)} are allowed` };
  }
  if (depth > limits.maxDepth) {
    return { ok: false, code: 'too-deep', message: `the policy document nests ${String(depth)} deep; the limit is ${String(limits.maxDepth)}` };
  }
  const doc = parseDocument(text, { schema: 'core', uniqueKeys: true, prettyErrors: false });
  const problems = [...doc.errors, ...doc.warnings];
  if (problems.length > 0) {
    return { ok: false, code: 'not-yaml', message: `the policy document does not parse: ${problems.map((p) => p.message).join('; ')}` };
  }
  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: limits.maxAliasCount });
  } catch (error) {
    return { ok: false, code: 'alias', message: `the policy document could not be read: ${error instanceof Error ? error.message : 'unknown error'}` };
  }
  const checked = validatePolicyDocument(value);
  if (!checked.ok) return { ok: false, code: 'invalid-policy', message: formatDefects(checked.defects) };
  return { ok: true, policy: new StrictPolicyEngine().resolvePolicy(checked.document) };
}

/** Reads at most one byte past the cap, so an oversized file is refused without being read whole. */
export async function loadPolicyFile(path: string, limits: PolicyFileLimits = POLICY_FILE_LIMITS): Promise<PolicyLoad> {
  let bytes: Uint8Array;
  try {
    const file = await open(path, 'r');
    try {
      const buffer = new Uint8Array(limits.maxBytes + 1);
      let length = 0;
      for (;;) {
        const { bytesRead } = await file.read(buffer, length, buffer.byteLength - length, null);
        if (bytesRead === 0) break;
        length += bytesRead;
        if (length === buffer.byteLength) break;
      }
      bytes = buffer.subarray(0, length);
    } finally {
      await file.close();
    }
  } catch (error) {
    return { ok: false, code: 'unreadable', message: `the policy file ${path} cannot be read: ${error instanceof Error ? error.message : 'unknown error'}` };
  }
  return parsePolicyYaml(bytes, limits);
}
