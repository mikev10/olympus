/**
 * The repository's `package.json`, read as data. It is the one config file
 * that is JSON by definition, so it is parsed rather than statically read,
 * and it is where a framework's declared version comes from.
 */
import { join } from 'node:path';
import { exists, readRegularFile, SOURCE_FILE_CAP } from './files.js';
import { describe, refuse } from './refusal.js';

export interface PackageManifest {
  readonly path: string;
  readonly value: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The manifest at `root`, or null when there is none. Present and unreadable is a refusal, never null. */
export async function readPackageManifest(root: string): Promise<PackageManifest | null> {
  const path = join(root, 'package.json');
  if (!(await exists(path))) return null;
  const text = await readRegularFile(path, SOURCE_FILE_CAP);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    refuse('unparseable', `${path} is not valid JSON: ${describe(error)}`);
  }
  if (!isRecord(value)) refuse('unparseable', `${path} is not a JSON object`);
  return { path, value };
}

/** The range `name` is declared at in `dependencies` or `devDependencies`, or undefined when it is in neither. */
export function declaredRange(manifest: PackageManifest, name: string): string | undefined {
  const ranges: string[] = [];
  for (const field of ['dependencies', 'devDependencies']) {
    const block = manifest.value[field];
    if (!isRecord(block)) continue;
    const range = block[name];
    if (typeof range === 'string') ranges.push(range);
  }
  const [first, ...rest] = ranges;
  if (first !== undefined && rest.some((range) => range !== first)) {
    refuse('unsupported-version', `${manifest.path} declares ${name} twice, at "${ranges.join('" and "')}"`);
  }
  return first;
}
