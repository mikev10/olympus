/**
 * Host-path comparison for the mount layer. Every function here decides a
 * refusal, so each is deliberately over-strict: paths are compared
 * case-insensitively on every platform, which calls a pair distinct only a
 * case-sensitive filesystem would separate. Refusing a mount that would in
 * fact have been safe is the fail-closed direction (I5); the reverse is a
 * Vault path reachable because two spellings looked different.
 */
import { isAbsolute, resolve, sep } from 'node:path';

/**
 * An absolute host path with its trailing separator removed and its case
 * folded, so two spellings of one location compare equal.
 */
function normalize(path: string): string {
  const absolute = resolve(path);
  const trimmed = absolute.length > 1 && absolute.endsWith(sep) ? absolute.slice(0, -1) : absolute;
  return trimmed.toLowerCase();
}

/** True when the two paths name the same location. */
export function samePath(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/** True when `child` sits strictly inside `parent`. A path does not contain itself. */
export function containsPath(parent: string, child: string): boolean {
  const p = normalize(parent);
  const c = normalize(child);
  return c.length > p.length && c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/** True when the two paths are the same location or either sits inside the other. */
export function overlapsPath(a: string, b: string): boolean {
  return samePath(a, b) || containsPath(a, b) || containsPath(b, a);
}

/** True when the path is absolute as this host writes absolute paths. */
export function isAbsoluteHostPath(path: string): boolean {
  return isAbsolute(path);
}

/**
 * True when the path is an absolute, normalized POSIX path other than the
 * root: a container target. `..` and `.` segments are refused rather than
 * folded away, because a target the caller wrote and a target the runtime
 * mounted must be the same string for the refusals above it to mean anything.
 */
export function isContainerTarget(path: string): boolean {
  if (!path.startsWith('/') || path === '/') return false;
  if (path.endsWith('/')) return false;
  return !path.split('/').some((segment, index) => (index > 0 && segment === '') || segment === '.' || segment === '..');
}
