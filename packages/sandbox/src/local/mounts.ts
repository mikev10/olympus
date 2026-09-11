/**
 * The mount layer, where I1 is physically enforced.
 *
 * Two steps, deliberately separate. `mountTable` validates the shape a caller
 * asked for and is synchronous: it refuses a second `rw` mount, a malformed
 * path, and overlapping targets. `resolveMounts` touches the filesystem: it
 * resolves every source through symlinks and `..` and only then asks whether
 * the mount lands on the Vault. The order is the point. A containment check
 * run against the path a caller wrote passes for a symlink whose target is
 * the Vault, and the container gets the Vault anyway.
 */
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { MountEntry, MountTable } from '../types.js';
import { containsPath, isAbsoluteHostPath, isContainerTarget, overlapsPath, samePath } from './paths.js';
import { refuse as refuseAt } from './refusal.js';

function refuse(reason: string): never {
  refuseAt('mount', reason);
}

/**
 * What a caller hands in: the shape *before* validation, so `mode` is a plain
 * string. Loose in, strict out. `mountTable` exists to check things the type
 * system cannot promise about a value that reached the runtime through a
 * cast, a parsed document, or JavaScript, and typing the input as the
 * validated form would make every one of those checks unreachable — the
 * compiler would call them impossible while they are exactly what happens.
 * The type-level guarantee is asserted separately, by the compile-error
 * fixture behind `I1.mount-table-single-rw`.
 */
export interface UnvalidatedMountEntry {
  readonly source: string;
  readonly target: string;
  readonly mode: string;
}

export interface MountTableSpec {
  readonly workspace: UnvalidatedMountEntry;
  readonly others?: readonly UnvalidatedMountEntry[];
}

/**
 * The `--mount` flag is comma-separated `key=value` pairs, so a path carrying
 * either character cannot be expressed in it. Quoting is not a fix: the
 * runtime would be guessing at a grammar the CLI does not document as
 * quotable, and a mount that lands somewhere other than where the table says
 * is the failure this whole module exists to prevent. Refused instead (I5).
 */
function refuseUnrepresentable(label: string, path: string): void {
  if (path.includes(',') || path.includes('=')) {
    refuse(`${label} ${path} contains a comma or an equals sign, which the Docker --mount grammar cannot carry; the mount is refused rather than approximated`);
  }
}

function validateEntry(label: string, entry: UnvalidatedMountEntry): void {
  if (!isAbsoluteHostPath(entry.source)) refuse(`${label} source ${entry.source} is not an absolute host path`);
  if (!isContainerTarget(entry.target)) {
    refuse(`${label} target ${entry.target} is not an absolute, normalized container path other than the root`);
  }
  refuseUnrepresentable(`${label} source`, entry.source);
  refuseUnrepresentable(`${label} target`, entry.target);
}

/**
 * Validates and freezes a mount table. I1 at the type layer says `others`
 * admits `ro` only; this is the same rule at run time, where a cast, a JSON
 * document, or a JavaScript caller can still produce a second `rw` entry.
 */
export function mountTable(spec: MountTableSpec): MountTable {
  validateEntry('the workspace', spec.workspace);
  // Bound to a local before the guard so the narrowing survives to the literal below.
  const mode = spec.workspace.mode;
  if (mode !== 'rw' && mode !== 'ro') refuse(`the workspace mount mode must be rw or ro, not ${mode}`);
  const workspace: MountEntry & { mode: 'rw' | 'ro' } = { source: spec.workspace.source, target: spec.workspace.target, mode };

  const others: Array<MountEntry & { mode: 'ro' }> = [];
  for (const entry of spec.others ?? []) {
    validateEntry(`mount ${entry.target}`, entry);
    if (entry.mode !== 'ro') {
      refuse(
        `mount ${entry.target} is declared ${entry.mode}: at most one rw mount is allowed and it is the workspace (I1), ` +
          'so every other mount must be ro',
      );
    }
    others.push({ source: entry.source, target: entry.target, mode: entry.mode });
  }

  const targets = [workspace, ...others];
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      // Both indices are inside the array's own length; the loop bounds are the invariant.
      const a = targets[i];
      const b = targets[j];
      if (a === undefined || b === undefined) continue;
      if (samePath(a.target, b.target) || containsPath(a.target, b.target) || containsPath(b.target, a.target)) {
        refuse(`mount targets ${a.target} and ${b.target} overlap; a mount nested inside another hides it`);
      }
    }
  }

  // Frozen through the binding rather than through the return value: `MountTable.others` is a
  // mutable array behind a readonly property, and `Object.freeze`'s `readonly T[]` return type
  // would not fit it. The array is frozen either way; only the static type differs.
  //
  // Every entry is frozen as well as the two containers. Freezing the array alone leaves each
  // entry's `mode` and `source` writable, so a validated table could still be edited after the
  // validation that makes it worth anything. Review finding 6, extended to `others`, which the
  // finding did not mention and which has the same hole.
  Object.freeze(workspace);
  for (const entry of others) Object.freeze(entry);
  Object.freeze(others);
  return Object.freeze({ workspace, others });
}

/** One mount as it will be handed to Docker: the source resolved, the mode as the table gave it. */
export interface ResolvedMount {
  /** The path the table declared, kept so a refusal can name both. */
  readonly declared: string;
  /** The path after symlinks and `..`. This is what is mounted. */
  readonly source: string;
  readonly target: string;
  readonly mode: 'ro' | 'rw';
}

/**
 * The real path of `path`, resolving as much of it as exists.
 *
 * A Vault root that does not exist yet still names a location nothing may
 * mount, so it cannot simply be dropped. Returning it unresolved is worse than
 * dropping it: the containment check would then compare a fully resolved
 * mount source against an unresolved Vault string, and two spellings of one
 * location would not match. A Vault declared behind a symlinked parent before
 * it is created would be mountable, and the refusal would arrive only once the
 * directory existed — which is exactly the wrong way round for a check that
 * must fail closed. So the deepest existing ancestor is resolved and the
 * missing tail is appended to it. Review finding 3.
 */
async function canonicalise(path: string): Promise<string> {
  const absolute = resolve(path);
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      const real = await realpath(current);
      return missing.length === 0 ? real : join(real, ...missing.reverse());
    } catch {
      const parent = dirname(current);
      // At the filesystem root `dirname` returns its argument; nothing above it exists to resolve.
      if (parent === current) return absolute;
      missing.push(basename(current));
      current = parent;
    }
  }
}

async function resolveSource(label: string, source: string): Promise<string> {
  const absolute = resolve(source);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    // Docker creates a missing bind source as an empty directory owned by root. A mount that
    // silently becomes an empty tree is a degrade, so an absent source is refused (I5).
    refuse(`${label} source ${absolute} does not exist; it is refused rather than created`);
  }
  const info = await stat(real);
  if (!info.isDirectory()) refuse(`${label} source ${absolute} resolves to ${real}, which is not a directory`);
  // The resolved path is what reaches `--mount`, so it is what the grammar check has to cover.
  // Checking only the declared path leaves a comma-free name that resolves to a comma-bearing
  // one: Docker then reads the comma as an option delimiter and mounts the prefix before it,
  // which is a different directory from the one every check above just validated. A sibling of
  // the Vault named `vault,readonly` truncates to the Vault itself. Review finding 1.
  refuseUnrepresentable(`${label} source ${absolute} resolves to`, real);
  return real;
}

/**
 * Resolves every source and refuses any mount that lands on a Vault path.
 * `vaultPaths` are the host directories the Vault owns; a mount that is one,
 * sits inside one, or contains one is refused at any mode. `ro` is refused
 * too: I1 is about writes, but a Vault mounted into an agent's container is a
 * mount away from being rw, and there is no reason for one to be there.
 */
export async function resolveMounts(table: MountTable, vaultPaths: readonly string[]): Promise<ResolvedMount[]> {
  const vault = await Promise.all(vaultPaths.map((path) => canonicalise(path)));

  const entries: Array<{ label: string; entry: MountEntry }> = [
    { label: 'the workspace', entry: table.workspace },
    ...table.others.map((entry) => ({ label: `mount ${entry.target}`, entry })),
  ];

  const resolved: ResolvedMount[] = [];
  for (const { label, entry } of entries) {
    const source = await resolveSource(label, entry.source);
    for (const path of vault) {
      if (!overlapsPath(source, path)) continue;
      const via = samePath(source, entry.source) ? '' : ` (declared as ${entry.source}, which resolves to it)`;
      refuse(`${label} would mount ${source}${via}, which is a Vault path or overlaps one (${path}). No agent writes to the Vault (I1)`);
    }
    resolved.push({ declared: entry.source, source, target: entry.target, mode: entry.mode });
  }

  // Resolution can collapse two declared sources onto one location, and it can turn two
  // non-overlapping declared paths into a pair where one contains the other. The table's
  // target checks ran before any of that, so the resolved set is checked again here.
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const a = resolved[i];
      const b = resolved[j];
      if (a === undefined || b === undefined) continue;
      if (a.mode === 'ro' && b.mode === 'ro') continue;
      if (overlapsPath(a.source, b.source)) {
        refuse(
          `${a.declared} and ${b.declared} resolve to ${a.source} and ${b.source}, which overlap, and one of them is rw: ` +
            'the rw mount would be reachable through the other',
        );
      }
    }
  }

  return resolved;
}

/** The `--mount` argument for one resolved mount. */
export function mountArgument(mount: ResolvedMount): string {
  const readonly = mount.mode === 'ro' ? ',readonly' : '';
  return `type=bind,source=${mount.source},target=${mount.target}${readonly}`;
}
