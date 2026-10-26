/**
 * The corpus: repositories the line runs on, and items, each a change a
 * scripted seat makes to one of them and the answer key that says what the
 * change seeds. A corpus is versioned and pinned file by file, so a result is
 * always read against the bytes that produced it, and a changed byte without
 * a new version is refused (D-R7-03).
 *
 * The answer key (an item's id, kind, group, and what it seeds) never leaves
 * the host. What reaches a workspace is a repository's files and an item's
 * change, and nothing else (I3).
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every corpus this package ships, newest last. */
export const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'corpus');

/** The corpus a result is measured against unless a caller names another. */
export const CURRENT_CORPUS = 'v1';

export type ItemKind = 'seeded' | 'control';
export type Tier = 'deterministic' | 'model';
/** Which seat's work the item is: the build seat's change, or a drafter's draft (R19). */
export type Seat = 'build' | 'spec-drafter' | 'test-drafter';

/** A file's content, or parts the scripted seat joins, so the corpus never holds a line a scanner matches. */
export type Content = string | { readonly parts: readonly string[] };

export interface Change {
  /** Tree-relative paths and what each holds after the change. */
  readonly write: Readonly<Record<string, Content>>;
  /** Tree-relative paths the change deletes. */
  readonly remove: readonly string[];
}

export interface Item {
  readonly id: string;
  readonly repo: string;
  readonly tier: Tier;
  readonly kind: ItemKind;
  /** The detector the item is reported under: a seeded item's expected catch, or the group a control stands beside. */
  readonly group: string;
  /** What a seeded item plants, in words; null for a control. */
  readonly seeds: string | null;
  readonly seat: Seat;
  readonly change: Change;
  /** The scripted seat's narrative: what it claims, never what happened (I2). */
  readonly claim: string;
  /** A drafted item's request, the intent or the spec its draft answers; null for a build item, whose request is its repository's spec. */
  readonly asked: string | null;
}

export interface RepoPolicy {
  /** The globs the build seat may write. */
  readonly builderGlobs: readonly string[];
}

export interface Corpus {
  readonly version: string;
  /** SHA-256 over every pinned file's path and digest, in path order. */
  readonly digest: string;
  readonly root: string;
  readonly repos: Readonly<Record<string, RepoPolicy>>;
  /** Each group's detector: the prefixes of the causes that are it (`detectorFired` in `result.ts`). */
  readonly groups: Readonly<Record<string, readonly string[]>>;
  readonly items: readonly Item[];
}

interface Manifest {
  readonly version: string;
  readonly repos: Readonly<Record<string, RepoPolicy>>;
  readonly groups: Readonly<Record<string, readonly string[]>>;
  readonly files: Readonly<Record<string, string>>;
}

const MANIFEST = 'corpus.json';

/**
 * Reads a corpus and refuses it unless every file under it is pinned in its
 * manifest at the digest it holds, and nothing pinned is missing (I5).
 */
export async function loadCorpus(version: string = CURRENT_CORPUS, root: string = CORPUS_ROOT): Promise<Corpus> {
  const dir = join(root, version);
  const manifest = parseManifest(await readFile(join(dir, MANIFEST), 'utf8'), version);
  const found = await digests(dir);
  const problems: string[] = [];
  for (const [path, digest] of Object.entries(found)) {
    const pinned = manifest.files[path];
    if (pinned === undefined) problems.push(`${path} is not pinned`);
    else if (pinned !== digest) problems.push(`${path} holds sha256:${digest}, pinned at sha256:${pinned}`);
  }
  for (const path of Object.keys(manifest.files)) if (found[path] === undefined) problems.push(`${path} is pinned and missing`);
  if (problems.length > 0) throw new Error(`benchmark: corpus ${version} does not match its manifest; a changed corpus is a new version: ${problems.join('; ')}`);

  const items: Item[] = [];
  for (const path of Object.keys(found).filter((p) => p.startsWith('items/')).sort()) {
    items.push(parseItem(JSON.parse(await readFile(join(dir, path), 'utf8')) as unknown, path, manifest));
  }
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`benchmark: corpus ${version} holds item '${item.id}' twice`);
    ids.add(item.id);
  }
  return { version, digest: corpusDigest(found), root: dir, repos: manifest.repos, groups: manifest.groups, items };
}

/** The directory a repository's files are read from. */
export function repoDir(corpus: Corpus, repo: string): string {
  return join(corpus.root, 'repos', repo);
}

/** A content's bytes as the seat writes them. */
export function render(content: Content): string {
  return typeof content === 'string' ? content : content.parts.join('');
}

/** Every file under `dir` but the manifest, by forward-slash relative path, with its SHA-256. */
export async function digests(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        // A repository's install is never part of the corpus; it is made from the pinned lockfile per run.
        if (entry.name === 'node_modules') continue;
        await walk(full);
      } else if (entry.isFile()) {
        const path = relative(dir, full).split(sep).join('/');
        if (path !== MANIFEST) out[path] = createHash('sha256').update(await readFile(full)).digest('hex');
      } else {
        throw new Error(`benchmark: ${full} is neither a file nor a directory; the corpus holds only files`);
      }
    }
  };
  await walk(dir);
  return out;
}

export function corpusDigest(files: Readonly<Record<string, string>>): string {
  const hash = createHash('sha256');
  for (const path of Object.keys(files).sort()) hash.update(`${path}\0${files[path] ?? ''}\n`);
  return hash.digest('hex');
}

function parseManifest(text: string, version: string): Manifest {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || parsed.version !== version || !isRecord(parsed.repos) || !isRecord(parsed.groups) || !isRecord(parsed.files)) {
    throw new Error(`benchmark: corpus ${version}'s manifest must be { version: '${version}', repos, groups, files }`);
  }
  const repos: Record<string, RepoPolicy> = {};
  for (const [name, policy] of Object.entries(parsed.repos)) {
    if (!isRecord(policy) || !isStringList(policy.builderGlobs) || policy.builderGlobs.length === 0) {
      throw new Error(`benchmark: corpus ${version}'s repo '${name}' needs builderGlobs, a non-empty list of globs`);
    }
    repos[name] = { builderGlobs: policy.builderGlobs };
  }
  const groups: Record<string, string[]> = {};
  for (const [name, prefixes] of Object.entries(parsed.groups)) {
    if (!isStringList(prefixes) || prefixes.length === 0 || prefixes.some((p) => p === '')) {
      throw new Error(`benchmark: corpus ${version}'s group '${name}' needs its detector: a non-empty list of cause prefixes`);
    }
    groups[name] = prefixes;
  }
  const files: Record<string, string> = {};
  for (const [path, digest] of Object.entries(parsed.files)) {
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) throw new Error(`benchmark: corpus ${version} pins ${path} at something that is not a SHA-256`);
    files[path] = digest;
  }
  return { version, repos, groups, files };
}

const KINDS: ReadonlySet<string> = new Set<ItemKind>(['seeded', 'control']);
const TIERS: ReadonlySet<string> = new Set<Tier>(['deterministic', 'model']);
const SEATS: ReadonlySet<string> = new Set<Seat>(['build', 'spec-drafter', 'test-drafter']);

function parseItem(raw: unknown, path: string, manifest: Manifest): Item {
  const bad = (why: string): never => {
    throw new Error(`benchmark: ${path} ${why}`);
  };
  if (!isRecord(raw)) return bad('is not an object');
  const { id, repo, tier, kind, group, seeds, seat, change, claim, asked } = raw;
  if (typeof id !== 'string' || `items/${id}.json` !== path) return bad('must name itself: its id is its file name');
  if (typeof repo !== 'string' || manifest.repos[repo] === undefined) return bad('names a repository the manifest does not');
  if (typeof tier !== 'string' || !TIERS.has(tier)) return bad("has a tier that is not 'deterministic' or 'model'");
  if (typeof kind !== 'string' || !KINDS.has(kind)) return bad("has a kind that is not 'seeded' or 'control'");
  if (typeof group !== 'string' || manifest.groups[group] === undefined) return bad('names a group the manifest declares no detector for');
  if (kind === 'seeded' ? typeof seeds !== 'string' || seeds === '' : seeds !== null) return bad('must say what a seeded item seeds, and a control seeds nothing (null)');
  if (typeof seat !== 'string' || !SEATS.has(seat)) return bad('names a seat that is not build, spec-drafter, or test-drafter');
  if (typeof claim !== 'string' || claim === '') return bad('carries no claim');
  if (seat === 'build' ? asked !== null : typeof asked !== 'string' || asked === '') return bad("must carry what a drafted item was asked, and a build item nothing (null): its request is its repository's spec");
  if (!isRecord(change) || !isRecord(change.write) || !isStringList(change.remove)) return bad('needs a change of { write, remove }');
  const write: Record<string, Content> = {};
  for (const [file, content] of Object.entries(change.write)) {
    if (!isTreePath(file)) bad(`writes ${file}, which is not a relative path inside the tree`);
    if (typeof content === 'string') write[file] = content;
    else if (isRecord(content) && isStringList(content.parts) && content.parts.length > 0) write[file] = { parts: content.parts };
    else bad(`writes ${file} with something that is neither text nor { parts }`);
  }
  for (const file of change.remove) if (!isTreePath(file)) bad(`removes ${file}, which is not a relative path inside the tree`);
  if (Object.keys(write).length === 0 && change.remove.length === 0) bad('changes nothing; an item that lands nothing measures nothing');
  return { id, repo, tier: tier as Tier, kind: kind as ItemKind, group, seeds: seeds as string | null, seat: seat as Seat, change: { write, remove: change.remove }, claim, asked: asked as string | null };
}

function isTreePath(path: string): boolean {
  return path !== '' && !path.startsWith('/') && !path.includes('\\') && !/^[A-Za-z]:/.test(path) && path.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Rewrites a corpus manifest's file pins from the files on disk, keeping its
 * version, repositories, and groups. Making a new corpus version is a
 * deliberate act: copy the directory, change it, pin it, and commit both, so
 * the diff shows every byte that moved. Never run against a released version.
 */
export async function pinCorpus(dir: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as Record<string, unknown>;
  const found = await digests(dir);
  const files: Record<string, string> = {};
  for (const path of Object.keys(found).sort()) files[path] = found[path] ?? '';
  await writeFile(join(dir, MANIFEST), `${JSON.stringify({ ...manifest, files }, null, 2)}\n`);
}
