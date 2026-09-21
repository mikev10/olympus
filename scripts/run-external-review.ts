import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UnitArtifacts } from './review-runner/artifacts.ts';
import { findUnitArtifacts } from './review-runner/artifacts.ts';
import type { CleanRoomProof } from './review-runner/cleanroom.ts';
import { assertCleanRoom } from './review-runner/cleanroom.ts';
import type { CliResult } from './review-runner/codex.ts';
import { codexApprovalPolicy, codexArgv, codexModel, codexUsage, resolveCodexEntry, runCli } from './review-runner/codex.ts';
import type { Family, Invocation, Manifest } from './review-runner/evidence.ts';
import { CODEX_KEEP, RECORDABLE_ENV, outcomeOf, redactEnv, stripSessionLog } from './review-runner/evidence.ts';
import type { GeminiResult } from './review-runner/gemini.ts';
import { GEMINI_MODEL, GeminiRequestError, callGemini, geminiRequest } from './review-runner/gemini.ts';
import { verifyIngestion } from './review-runner/ingestion.ts';
import type { BundleMarkers } from './review-runner/integrity.ts';
import { bundleMarkers, verifyEcho } from './review-runner/integrity.ts';
import { composePayload, sha256 } from './review-runner/payload.ts';
import type { CodexScratch } from './review-runner/scratch.ts';
import { buildCodexScratch, listRecursive, removeScratch } from './review-runner/scratch.ts';

export const USAGE = 'usage: node scripts/run-external-review.ts <UNIT> <codex|gemini> [--dry-run]';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEWS_DIR = 'docs/reviews';

export interface RunArgs {
  readonly unit: string;
  readonly family: Family;
  readonly dryRun: boolean;
}

const FAMILIES: readonly Family[] = ['codex', 'gemini'];

function isFamily(value: string): value is Family {
  return FAMILIES.some((family) => family === value);
}

/**
 * Refuses rather than defaults. A family that silently fell back to one of the
 * two would send the bundle to a vendor the maintainer did not name, and
 * egress cannot be taken back.
 */
export function parseArgs(argv: readonly string[]): RunArgs {
  const positional: string[] = [];
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option "${arg}"\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  const [unit, family, ...extra] = positional;
  if (unit === undefined || family === undefined) {
    throw new Error(`a unit and a family are both required\n${USAGE}`);
  }
  if (extra.length > 0) {
    throw new Error(`unexpected argument "${extra.join(' ')}"\n${USAGE}`);
  }
  if (!isFamily(family)) {
    throw new Error(`unknown family "${family}": expected codex or gemini\n${USAGE}`);
  }
  return { unit, family, dryRun };
}

const SECRET_PREFIX_LENGTH = 8;

/** Searched for whenever they are set. Neither reviewer can reach the
 *  environment, so any bug of ours that dumps `process.env` wholesale carries
 *  these with it: they are the canary for environment dumps generally. */
const CANARY_ENV: readonly string[] = ['GEMINI_API_KEY', 'OPENAI_API_KEY'];

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

/** What `findLeakedSecrets` reports for a hit on the copied credential file.
 *  A label, never the field or its value. */
export const AUTH_JSON_LABEL = 'auth.json';

/**
 * The tripwire for our own bugs, and deliberately NOT default-deny. This is
 * the opposite question from `redactEnv`'s: a miss there WRITES a secret, so
 * redaction treats every variable as one; a false positive here DESTROYS
 * genuine evidence after the bundle has already been sent, so this searches
 * only for values that are secrets. Measured before this was narrowed: a
 * reply quoting any path under C:\Users tripped APPDATA, TEMP and seven more.
 *
 * Searches for the first eight characters of the value of every canary
 * variable, of every variable whose name says it is a secret, and of every
 * string in `authSecrets`. Returns the variable NAMES, plus `AUTH_JSON_LABEL`
 * for a credential-file hit. It never returns, logs, or throws a value: the
 * caller prints what this returns, so returning a value would print it.
 */
export function findLeakedSecrets(
  contents: readonly string[],
  env: Readonly<Record<string, string>>,
  authSecrets: readonly string[] = [],
): readonly string[] {
  const appears = (value: string): boolean => {
    if (value.length < SECRET_PREFIX_LENGTH) return false;
    const prefix = value.slice(0, SECRET_PREFIX_LENGTH);
    return contents.some((text) => text.includes(prefix));
  };

  const leaked: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (RECORDABLE_ENV.includes(name)) continue;
    if (!CANARY_ENV.includes(name) && !SECRET_NAME.test(name)) continue;
    if (appears(value)) leaked.push(name);
  }
  if (authSecrets.some(appears)) leaked.push(AUTH_JSON_LABEL);
  return leaked;
}

/**
 * The credentials in a Codex `auth.json`, and nothing else in it: every string
 * anywhere under `tokens` (the maintainer's ChatGPT OAuth tokens), and a
 * top-level `OPENAI_API_KEY` when it is a string. The runner handles that
 * file, so it checks none of those reach a committed one.
 *
 * Named fields, not "every string minus exceptions": the same precision the
 * environment check needs. Measured 2026-09-21: the file's `last_refresh` is
 * an ISO timestamp whose first eight characters (`YYYY-MM-`) appear in every
 * manifest's own `startedAt`, so a broader rule deleted the evidence of every
 * run made in the month of the last refresh, and the next non-secret field
 * Codex adds could do the same.
 */
export function authJsonSecrets(authJsonText: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(authJsonText);
  } catch {
    // Not the parser's message: V8 quotes the offending text in it, and that
    // text is a credential.
    throw new Error('auth.json is not valid JSON, so its tokens cannot be checked for');
  }

  const secrets: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      secrets.push(value);
    } else if (typeof value === 'object' && value !== null) {
      const children: unknown[] = Object.values(value);
      for (const child of children) walk(child);
    }
  };
  if (typeof parsed === 'object' && parsed !== null) {
    if ('tokens' in parsed) walk(parsed.tokens);
    if ('OPENAI_API_KEY' in parsed && typeof parsed.OPENAI_API_KEY === 'string') secrets.push(parsed.OPENAI_API_KEY);
  }
  return secrets;
}

/** True when Codex rewrote its credential during the run. Byte for byte:
 *  any change at all is Codex's own write, and is what gets written back. */
export function authRefreshed(before: Uint8Array, after: Uint8Array): boolean {
  return Buffer.compare(before, after) !== 0;
}

/** The filesystem calls the credential write-back makes, injectable so tests
 *  never touch the real `~/.codex`. */
export interface AuthFs {
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => Uint8Array;
  readonly writeFile: (path: string, data: Uint8Array) => void;
  readonly rename: (from: string, to: string) => void;
  readonly remove: (path: string) => void;
}

const NODE_AUTH_FS: AuthFs = {
  exists: (path) => existsSync(path),
  readFile: (path) => readFileSync(path),
  // 0o600, as Codex writes it: a credential readable by other users is a leak.
  writeFile: (path, data) => {
    writeFileSync(path, data, { mode: 0o600 });
  },
  rename: (from, to) => {
    renameSync(from, to);
  },
  remove: (path) => {
    rmSync(path, { force: true });
  },
};

export type WriteBack =
  | 'unchanged'
  | 'written-back'
  | 'real-file-changed'
  | 'scratch-missing'
  | 'unparseable'
  | 'write-failed';

export interface PostRunAuth {
  readonly writeBack: WriteBack;
  /** Credentials found only in the post-run file. Searched for alongside the
   *  ones copied in, since a refreshed token is as secret as the old one. */
  readonly refreshedSecrets: readonly string[];
}

/**
 * Runs after every Codex run, whatever its outcome and even on a timeout,
 * while the scratch home still exists. If Codex refreshed its OAuth tokens,
 * the new ones live only in the scratch copy, and `removeScratch` would delete
 * them; if the provider rotates refresh tokens, the maintainer's real
 * `~/.codex/auth.json` would then hold a dead one. So a changed scratch copy
 * is written back over the real file: exactly the bytes Codex wrote, which is
 * what Codex itself does in normal use.
 *
 * Written only when the real file still holds the bytes that were copied in:
 * if it changed meanwhile, something else refreshed it, and overwriting it
 * would replace a credential this run never saw. Written atomically, to a
 * sibling temp file renamed over the original, so no partial write is ever
 * left in its place. A post-run file that is not valid JSON is never written
 * back.
 */
export function reconcileAuthAfterRun(
  scratchAuthPath: string,
  realAuthPath: string,
  copiedIn: Uint8Array,
  fs: AuthFs = NODE_AUTH_FS,
): PostRunAuth {
  if (!fs.exists(scratchAuthPath)) return { writeBack: 'scratch-missing', refreshedSecrets: [] };
  const after = fs.readFile(scratchAuthPath);
  if (!authRefreshed(copiedIn, after)) return { writeBack: 'unchanged', refreshedSecrets: [] };

  let refreshedSecrets: readonly string[];
  try {
    refreshedSecrets = authJsonSecrets(new TextDecoder().decode(after));
  } catch {
    return { writeBack: 'unparseable', refreshedSecrets: [] };
  }

  if (!fs.exists(realAuthPath) || authRefreshed(copiedIn, fs.readFile(realAuthPath))) {
    return { writeBack: 'real-file-changed', refreshedSecrets };
  }

  const temp = `${realAuthPath}.olympus-${String(process.pid)}.tmp`;
  try {
    fs.writeFile(temp, after);
    fs.rename(temp, realAuthPath);
  } catch {
    fs.remove(temp);
    return { writeBack: 'write-failed', refreshedSecrets };
  }
  return { writeBack: 'written-back', refreshedSecrets };
}

const WRITE_BACK_NOTICE: Readonly<Record<WriteBack, string | null>> = {
  'unchanged': null,
  'written-back': 'The Codex credential was refreshed during the run and written back to ~/.codex/auth.json.',
  'real-file-changed':
    'The Codex credential was refreshed during the run, but ~/.codex/auth.json changed meanwhile, so it was ' +
    'left as it is. If Codex asks you to log in, run `codex login`.',
  'scratch-missing': 'The scratch auth.json was gone after the run; ~/.codex/auth.json was left as it is.',
  'unparseable':
    'The scratch auth.json changed during the run but is not valid JSON, so it was not written back and its ' +
    'contents could not be searched for.',
  'write-failed':
    'The Codex credential was refreshed during the run, but writing it back to ~/.codex/auth.json failed; the ' +
    'original was left in place. If Codex asks you to log in, run `codex login`.',
};

/** Everything `runCli` needs for the Codex child except its stdin. */
export interface CodexSpawn {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The child's environment is exactly `{ CODEX_HOME }`: nothing inherited,
 * nothing merged from `process.env`. `spawn`'s `env` replaces the environment
 * entirely, so every parent secret, GEMINI_API_KEY and OPENAI_API_KEY
 * included, is unreachable from inside the reviewer, whose read-only shell
 * tool could otherwise print them into its reply. Measured 2026-09-21 against
 * codex-cli 0.155.1 on Windows with a real call: Codex runs, reaches OpenAI and
 * answers with only this one variable passed. If some platform needs more,
 * Codex fails to start and the run records FAILED: loud, not silent.
 *
 * On Windows the child nonetheless sees twelve variables, not one: libuv adds
 * its fixed list of required system variables (HOMEDRIVE, HOMEPATH,
 * LOGONSERVER, PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME,
 * USERPROFILE, WINDIR) from the parent whenever they are missing. Measured the
 * same day with a stand-in child that printed its variable names. None is a
 * secret, and the list is closed, so no API key can arrive by that route.
 */
export function codexSpawn(scratch: CodexScratch, entry: string, replyPath: string): CodexSpawn {
  return {
    command: process.execPath,
    args: [entry, ...codexArgv(replyPath)],
    cwd: scratch.workDir,
    env: { CODEX_HOME: scratch.configHome },
  };
}

/**
 * The exit code `outcomeOf` sees for a codex run whose rollout log records an
 * approval policy other than "never". Codex 0.155.1 has no
 * `--ask-for-approval` flag, so the recorded policy is the only evidence the
 * run could not have been prompted; without it the run is treated as failed.
 */
const APPROVAL_NOT_NEVER_EXIT = 1;

/**
 * Assembles the manifest from facts already computed. The parameter type has
 * no `outcome`, and the spread puts the derived one last, so an `outcome`
 * smuggled in on a wider object is overwritten rather than recorded. The
 * manifest keeps the process's real exit code; only the value handed to
 * `outcomeOf` is replaced, and `recordedApprovalPolicy` beside it shows why.
 */
export function buildManifest(facts: Omit<Manifest, 'outcome'>): Manifest {
  const approvalNotNever = facts.family === 'codex' && facts.recordedApprovalPolicy !== 'never';
  const exitCode = approvalNotNever && facts.exitCode === 0 ? APPROVAL_NOT_NEVER_EXIT : facts.exitCode;
  const outcome = outcomeOf({
    exitCode,
    timedOut: facts.timedOut,
    ingestion: facts.ingestion,
    integrity: facts.integrity,
  });
  return { ...facts, outcome };
}

/** The three outputs of one run, as suffixes of `<date>-<UNIT>-<slug>-review-<family>`. */
const OUTPUT_EXTENSIONS: readonly string[] = ['.md', '.run.json', '.session.jsonl'];

export interface ArchiveMove {
  readonly from: string;
  readonly to: string;
}

export type ArchivePlan =
  | { readonly kind: 'counted' }
  | { readonly kind: 'archive'; readonly moves: readonly ArchiveMove[] };

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function recordedOutcome(manifestText: string): unknown {
  try {
    const parsed: unknown = JSON.parse(manifestText);
    return typeof parsed === 'object' && parsed !== null && 'outcome' in parsed ? parsed.outcome : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What to do with this family's earlier outputs before a rerun. Pure over a
 * directory listing and the current manifest's text (null when there is none).
 *
 * A manifest recording `counted` means a real review exists, and a rerun must
 * never supersede it. Anything else is a failed attempt whose files are the
 * record that the bundle was sent, so they are kept, not overwritten: each is
 * renamed with `.attempt-<N>` before its extension, N the lowest number not yet
 * used for this stem. The fixed names are then free for the new run, which is
 * what the shipped skills read, and an archived name matches none of them.
 */
export function planArchive(fileNames: readonly string[], stem: string, manifestText: string | null): ArchivePlan {
  if (manifestText !== null && recordedOutcome(manifestText) === 'counted') return { kind: 'counted' };

  const attempt = new RegExp(`^${escapeForRegExp(stem)}\\.attempt-(\\d+)\\.`);
  const used = new Set<number>();
  for (const name of fileNames) {
    const match = attempt.exec(name);
    if (match?.[1] !== undefined) used.add(Number(match[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;

  const moves = OUTPUT_EXTENSIONS.filter((ext) => fileNames.includes(`${stem}${ext}`)).map((ext) => ({
    from: `${stem}${ext}`,
    to: `${stem}.attempt-${String(n)}${ext}`,
  }));
  return { kind: 'archive', moves };
}

/**
 * Plans the archive for `stem` in `dir` and, unless this is a dry run, carries
 * it out. A counted review is returned as such with nothing renamed; the caller
 * refuses.
 */
export function archiveEarlierAttempt(dir: string, stem: string, dryRun: boolean): ArchivePlan {
  const manifestPath = join(dir, `${stem}.run.json`);
  const manifestText = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null;
  const plan = planArchive(readdirSync(dir), stem, manifestText);
  if (plan.kind === 'archive' && !dryRun) {
    for (const move of plan.moves) renameSync(join(dir, move.from), join(dir, move.to));
  }
  return plan;
}

interface OutputPaths {
  readonly reply: string;
  readonly manifest: string;
  readonly session: string;
}

/** Everything settled before anything is sent. */
interface Prepared {
  readonly artifacts: UnitArtifacts;
  readonly markers: BundleMarkers;
  readonly payload: string;
  readonly payloadSha256: string;
  readonly payloadBytes: number;
  readonly bundleSha256: string;
  /** `<date>-<UNIT>-<slug>-review-<family>`, the file name every output extends. */
  readonly stem: string;
  readonly outputs: OutputPaths;
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function isTracked(path: string): boolean {
  try {
    git(['ls-files', '--error-unmatch', '--', path]);
    return true;
  } catch {
    return false;
  }
}

function repoPath(relative: string): string {
  return join(REPO_ROOT, relative);
}

/** Steps 1 to 5. Every throw here is a refusal before egress: nothing is written. */
function prepare(args: RunArgs): Prepared {
  // Step 1.
  let artifacts: UnitArtifacts;
  try {
    artifacts = findUnitArtifacts(readdirSync(repoPath(REVIEWS_DIR)), args.unit);
  } catch (err) {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    throw new Error(
      `step 1: no committed review prompt and bundle were found for unit ${args.unit} in ${REVIEWS_DIR}/ ` +
        `on branch ${branch} (${messageOf(err)}). Run review-request for ${args.unit}, or switch to the ` +
        `branch that holds its review artifacts.`,
      { cause: err },
    );
  }
  const promptPath = `${REVIEWS_DIR}/${artifacts.promptFile}`;
  const bundlePath = `${REVIEWS_DIR}/${artifacts.bundleFile}`;

  // Step 2.
  for (const path of [promptPath, bundlePath]) {
    if (!isTracked(path)) throw new Error(`step 2: ${path} is not committed`);
    if (git(['status', '--porcelain', '--', path]) !== '') {
      throw new Error(`step 2: ${path} has uncommitted changes`);
    }
  }

  // A counted review is refused here, early. An earlier FAILED attempt is not:
  // its files are archived just before egress, once every other refusal has
  // had its chance, so a rerun is one command.
  const stem = `${artifacts.date}-${args.unit}-${artifacts.slug}-review-${args.family}`;
  const base = `${REVIEWS_DIR}/${stem}`;
  const outputs: OutputPaths = { reply: `${base}.md`, manifest: `${base}.run.json`, session: `${base}.session.jsonl` };
  const manifestText = existsSync(repoPath(outputs.manifest)) ? readFileSync(repoPath(outputs.manifest), 'utf8') : null;
  if (planArchive(readdirSync(repoPath(REVIEWS_DIR)), stem, manifestText).kind === 'counted') {
    throw new Error(countedRefusal(outputs.manifest));
  }

  // Step 3.
  const promptText = readFileSync(repoPath(promptPath), 'utf8');
  const bundleText = readFileSync(repoPath(bundlePath), 'utf8');
  const markers = bundleMarkers(bundleText);

  // Step 4. A bundle with no end nonce can reach INTEGRITY_UNVERIFIED at best,
  // never `counted`, so sending it would spend the full source of every
  // changed file on a third party for nothing.
  if (markers.endNonce === null) {
    throw new Error(
      `step 4: ${bundlePath} has no "=== BUNDLE END === <nonce>" line, so no run against it can ever ` +
        `count. Regenerate it with review-request ${args.unit}, commit it, and run again.`,
    );
  }

  // Step 5.
  const payload = composePayload(promptText, artifacts.bundleFile, bundleText);
  return {
    artifacts,
    markers,
    payload,
    payloadSha256: sha256(payload),
    payloadBytes: Buffer.byteLength(payload, 'utf8'),
    bundleSha256: sha256(bundleText),
    stem,
    outputs,
  };
}

function countedRefusal(manifestPath: string): string {
  return `${manifestPath} records a counted review. A rerun would supersede a real review, so this family is not run again.`;
}

/**
 * Called immediately before egress, after every other refusal, and in a dry
 * run in place of it. Returns the moves made (or, in a dry run, the moves that
 * would be made), or null after refusing.
 */
function archiveBeforeEgress(
  p: Prepared,
  dryRun: boolean,
  env: Readonly<Record<string, string>>,
): readonly ArchiveMove[] | null {
  let plan: ArchivePlan;
  try {
    plan = archiveEarlierAttempt(repoPath(REVIEWS_DIR), p.stem, dryRun);
  } catch (err) {
    refuse(err, env);
    return null;
  }
  if (plan.kind === 'counted') {
    refuse(new Error(countedRefusal(p.outputs.manifest)), env);
    return null;
  }
  if (!dryRun) {
    for (const move of plan.moves) console.log(`archived ${REVIEWS_DIR}/${move.from} -> ${move.to}`);
  }
  return plan.moves;
}

function printWouldArchive(moves: readonly ArchiveMove[]): void {
  if (moves.length === 0) console.log('  would archive   nothing');
  for (const move of moves) console.log(`  would archive   ${move.from} -> ${move.to}`);
}

/**
 * The installed Codex version, read from the package.json beside the entry
 * point `resolveCodexEntry` found: the same install the run will use. Refuses
 * rather than record a placeholder.
 */
function codexCliVersion(entry: string): string {
  const packageJson = join(dirname(entry), '..', 'package.json');
  if (!existsSync(packageJson)) {
    throw new Error('the Codex install has no package.json beside its entry point, so its version cannot be recorded');
  }
  const parsed: unknown = JSON.parse(readFileSync(packageJson, 'utf8'));
  const version = typeof parsed === 'object' && parsed !== null && 'version' in parsed ? parsed.version : undefined;
  if (typeof version !== 'string' || version === '') {
    throw new Error("the Codex install's package.json carries no version string, so its version cannot be recorded");
  }
  return version;
}

/**
 * The api transport has no CLI. Derived from the endpoint rather than written
 * as a constant, so it cannot drift from the URL actually called; the `api:`
 * prefix keeps a reader from mistaking an API version for a CLI version.
 */
function geminiApiVersion(url: string): string {
  const { hostname, pathname } = new URL(url);
  const service = hostname.split('.')[0] ?? '';
  const version = pathname.split('/')[1] ?? '';
  if (service === '' || version === '') throw new Error('cannot derive the Gemini API version from its endpoint');
  return `api:${service}/${version}`;
}

function definedEnv(env: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) out[name] = value;
  }
  return out;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

/**
 * Every message this runner prints that it did not compose itself goes
 * through the same check the written files do, and is replaced by the names
 * of what it would have leaked.
 */
function printable(
  text: string,
  env: Readonly<Record<string, string>>,
  authSecrets: readonly string[] = [],
): string {
  const names = findLeakedSecrets([text], env, authSecrets);
  return names.length === 0 ? text : `(withheld: the text contains a secret from ${names.join(', ')})`;
}

function refuse(err: unknown, env: Readonly<Record<string, string>>): number {
  console.error(`refused: ${printable(messageOf(err), env)}`);
  console.error('Nothing was sent and nothing was written.');
  return 1;
}

function printDryRunHeader(args: RunArgs, p: Prepared): void {
  console.log(`DRY RUN: ${args.unit} ${args.family}. Nothing was sent and nothing was written.`);
  console.log(`  prompt          ${REVIEWS_DIR}/${p.artifacts.promptFile}`);
  console.log(`  bundle          ${REVIEWS_DIR}/${p.artifacts.bundleFile}`);
  console.log(`  bundle sha256   ${p.bundleSha256}`);
  console.log(`  payload sha256  ${p.payloadSha256}`);
  console.log(`  payload bytes   ${String(p.payloadBytes)}`);
  console.log(`  ingestion floor ${String(verifyIngestion(p.payloadBytes, null).floor)} input tokens`);
}

function listing(paths: readonly string[]): string {
  return paths.length === 0 ? '(empty)' : paths.join(', ');
}

async function runCodex(args: RunArgs, p: Prepared, env: Readonly<Record<string, string>>): Promise<number> {
  // Step 6, still before egress: every throw is a refusal.
  const realAuthPath = join(homedir(), '.codex', 'auth.json');
  let entry: string;
  let cliVersion: string;
  let scratch: CodexScratch;
  try {
    entry = resolveCodexEntry(process.env, process.platform, process.execPath);
    cliVersion = codexCliVersion(entry);
    if (!existsSync(realAuthPath)) throw new Error('no Codex credential at ~/.codex/auth.json; run `codex login` first');
    scratch = buildCodexScratch(realAuthPath);
  } catch (err) {
    return refuse(err, env);
  }

  try {
    // Listed BEFORE the run: one Codex turn leaves ~332 files of vendor cache
    // behind it, so a listing taken afterwards proves nothing about the input.
    const scratchAuthPath = join(scratch.configHome, 'auth.json');
    let cleanRoom: CleanRoomProof;
    let authCopiedIn: Uint8Array;
    let authSecrets: readonly string[];
    try {
      cleanRoom = { configHome: listRecursive(scratch.configHome), workDir: listRecursive(scratch.workDir) };
      assertCleanRoom(cleanRoom, { configFiles: ['auth.json'], workFiles: [] });
      authCopiedIn = readFileSync(scratchAuthPath);
      authSecrets = authJsonSecrets(new TextDecoder().decode(authCopiedIn));
    } catch (err) {
      return refuse(err, env);
    }

    // Step 7.
    if (args.dryRun) {
      const wouldArchive = archiveBeforeEgress(p, true, env);
      if (wouldArchive === null) return 1;
      printDryRunHeader(args, p);
      console.log(`  codex           ${cliVersion}, read from its installed package.json`);
      console.log(`  config home     ${listing(cleanRoom.configHome)}`);
      console.log(`  work dir        ${listing(cleanRoom.workDir)}`);
      printWouldArchive(wouldArchive);
      return 0;
    }

    if (archiveBeforeEgress(p, false, env) === null) return 1;

    // Step 8. From here the bundle has left the machine, so every path below
    // writes evidence that it did.
    const replyPath = join(scratch.root, 'last-message.txt');
    const spawnSpec = codexSpawn(scratch, entry, replyPath);
    const invocation: Invocation = {
      kind: 'cli',
      command: spawnSpec.command,
      argv: spawnSpec.args,
      envOverrides: redactEnv(spawnSpec.env),
    };

    const startedAt = new Date();
    let result: CliResult | null = null;
    let runError: unknown = null;
    try {
      result = await runCli({ ...spawnSpec, stdin: p.payload });
    } catch (err) {
      runError = err;
    }
    const endedAt = new Date();

    // First, whatever happened, while the scratch home still exists: a
    // credential Codex refreshed goes back to the maintainer, and its new
    // tokens join the set nothing may leak.
    const postRunAuth = reconcileAuthAfterRun(scratchAuthPath, realAuthPath, authCopiedIn);
    const notice = WRITE_BACK_NOTICE[postRunAuth.writeBack];
    if (notice !== null) console.error(notice);
    const secrets = [...authSecrets, ...postRunAuth.refreshedSecrets];

    const exitCode = result === null ? null : result.exitCode;
    const timedOut = result?.timedOut ?? false;
    if (runError !== null) {
      console.error(`codex could not be run: ${printable(messageOf(runError), env, secrets)}`);
    } else if (result !== null && (timedOut || exitCode !== 0)) {
      const stderrTail = result.stderr.trimEnd().split(/\r?\n/).slice(-20).join('\n');
      console.error(`codex did not complete; the tail of its stderr:\n${printable(stderrTail, env, secrets)}`);
    }

    const replyText = existsSync(replyPath) ? readFileSync(replyPath, 'utf8') : '';
    const reply = replyText === '' ? null : replyText;

    // The rollout log is the ONLY place the model id, the input token count
    // and the approval policy exist. Anything but exactly one is read as none.
    const rollouts = listRecursive(scratch.configHome).filter(
      (path) => path.startsWith('sessions/') && path.endsWith('.jsonl'),
    );
    const [onlyRollout, ...otherRollouts] = rollouts;
    const rollout =
      onlyRollout !== undefined && otherRollouts.length === 0
        ? readFileSync(join(scratch.configHome, onlyRollout), 'utf8')
        : null;
    if (rollout === null) {
      console.error(`expected exactly one rollout log under sessions/, found ${String(rollouts.length)}`);
    }

    const inputTokens = rollout === null ? null : codexUsage(rollout);
    const recordedApprovalPolicy = rollout === null ? null : codexApprovalPolicy(rollout);
    if (recordedApprovalPolicy !== 'never') {
      console.error(
        `codex recorded approval policy ${JSON.stringify(recordedApprovalPolicy)}, not "never": ` +
          'this run could have been prompted, so it is recorded as failed and cannot count',
      );
    }

    // Step 9.
    const manifest = buildManifest({
      unit: args.unit,
      family: 'codex',
      invocation,
      cleanRoom,
      exitCode,
      timedOut,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      cliVersion,
      modelReported: rollout === null ? null : codexModel(rollout),
      tokenUsage: inputTokens === null ? null : { input_tokens: inputTokens },
      payloadSha256: p.payloadSha256,
      payloadBytes: p.payloadBytes,
      ingestion: verifyIngestion(p.payloadBytes, inputTokens),
      postRunFileCount: listRecursive(scratch.configHome).length,
      recordedApprovalPolicy,
      bundleSha256: p.bundleSha256,
      integrity: verifyEcho(p.markers, reply ?? ''),
    });
    const session = rollout === null ? '' : stripSessionLog(rollout, CODEX_KEEP);

    // Step 10, then step 11: the scratch goes only once everything above has
    // read what it needs from it.
    const written = writeEvidence(p.outputs, manifest, reply, session);
    removeScratch(scratch);
    return finish(args, manifest, written, env, secrets);
  } finally {
    removeScratch(scratch);
  }
}

async function runGemini(args: RunArgs, p: Prepared, env: Readonly<Record<string, string>>): Promise<number> {
  // Step 6: nothing local is loaded, so there is no clean room to build.
  let cliVersion: string;
  const request = geminiRequest(p.payload);
  try {
    cliVersion = geminiApiVersion(request.url);
  } catch (err) {
    return refuse(err, env);
  }

  // Step 7.
  if (args.dryRun) {
    const wouldArchive = archiveBeforeEgress(p, true, env);
    if (wouldArchive === null) return 1;
    printDryRunHeader(args, p);
    console.log(`  request         POST ${request.url}`);
    console.log(`  api version     ${cliVersion}`);
    console.log(`  header names    ${request.headerNames.join(', ')}`);
    printWouldArchive(wouldArchive);
    return 0;
  }

  // Presence only, checked here so a missing key refuses before egress rather
  // than surfacing as a failed call. `callGemini` reads the value itself.
  if ((env.GEMINI_API_KEY ?? '') === '') {
    return refuse(new Error('GEMINI_API_KEY is not set'), env);
  }

  if (archiveBeforeEgress(p, false, env) === null) return 1;

  // Step 8. From here every path writes evidence that the bundle was sent.
  const startedAt = new Date();
  let result: GeminiResult | null = null;
  let timedOut = false;
  let httpStatus: number | null = null;
  try {
    result = await callGemini(p.payload);
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') timedOut = true;
    if (err instanceof GeminiRequestError) httpStatus = err.status;
    console.error(`the Gemini call failed: ${printable(messageOf(err), env)}`);
  }
  const endedAt = new Date();

  // The api transport has no process exit code. Only a completed call whose
  // reply parsed as complete is 0, so an incomplete reply reaches `outcomeOf`
  // as a failure and can never be counted.
  const exitCode = result?.complete === true ? 0 : 1;
  if (result !== null && !result.complete) {
    console.error(`the Gemini reply was incomplete: ${result.incompleteReason ?? 'no reason given'}`);
  }
  const reply = result?.reply ?? null;
  const inputTokens = result?.promptTokenCount ?? null;

  const invocation: Invocation = {
    kind: 'api',
    method: 'POST',
    url: request.url,
    modelRequested: GEMINI_MODEL,
    headerNames: request.headerNames,
  };

  // Step 9.
  const manifest = buildManifest({
    unit: args.unit,
    family: 'gemini',
    invocation,
    cleanRoom: null,
    exitCode,
    timedOut,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    cliVersion,
    modelReported: result?.modelVersion ?? null,
    tokenUsage: numericFields(result?.usageMetadata ?? null),
    payloadSha256: p.payloadSha256,
    payloadBytes: p.payloadBytes,
    ingestion: verifyIngestion(p.payloadBytes, inputTokens),
    postRunFileCount: null,
    recordedApprovalPolicy: null,
    bundleSha256: p.bundleSha256,
    integrity: verifyEcho(p.markers, reply ?? ''),
  });

  // No session exists for the api transport. This one line is its provenance,
  // with the candidate text removed: that text is already the review file.
  const sessionRecord: Record<string, unknown> = {
    modelVersion: result?.modelVersion ?? null,
    responseId: result?.responseId ?? null,
    usageMetadata: result?.usageMetadata ?? null,
  };
  if (httpStatus !== null) sessionRecord.httpStatus = httpStatus;

  // Step 10.
  const written = writeEvidence(p.outputs, manifest, reply, JSON.stringify(sessionRecord));
  return finish(args, manifest, written, env);
}

function numericFields(record: Readonly<Record<string, unknown>> | null): Readonly<Record<string, number>> | null {
  if (record === null) return null;
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(record)) {
    if (typeof value === 'number') out[name] = value;
  }
  return out;
}

/**
 * Step 10. The reply file holds the reply and nothing else, and is written
 * only when there is one. The manifest and the session log are written for
 * every run that reached the vendor, counted or not.
 */
function writeEvidence(
  outputs: OutputPaths,
  manifest: Manifest,
  reply: string | null,
  session: string,
): readonly string[] {
  const files: Array<readonly [string, string]> = [
    [outputs.manifest, `${JSON.stringify(manifest, null, 2)}\n`],
    [outputs.session, session === '' ? '' : `${session}\n`],
  ];
  if (reply !== null) files.unshift([outputs.reply, reply]);
  for (const [path, content] of files) writeFileSync(repoPath(path), content, 'utf8');
  return files.map(([path]) => path);
}

/** Steps 12 and 13. */
function finish(
  args: RunArgs,
  manifest: Manifest,
  written: readonly string[],
  env: Readonly<Record<string, string>>,
  authSecrets: readonly string[] = [],
): number {
  const leaked = findLeakedSecrets(
    written.map((path) => readFileSync(repoPath(path), 'utf8')),
    env,
    authSecrets,
  );
  if (leaked.length > 0) {
    for (const path of written) rmSync(repoPath(path), { force: true });
    console.error(`refused: the files written for this run contained a secret from ${leaked.join(', ')}.`);
    console.error('All of them were deleted. The bundle WAS sent; this run left no evidence file.');
    return 1;
  }

  const ingestion = manifest.ingestion;
  const ingested =
    ingestion.kind === 'unreported'
      ? `no input token count reported (floor ${String(ingestion.floor)})`
      : `${String(ingestion.inputTokens)} input tokens ingested (floor ${String(ingestion.floor)})`;
  console.log(`${args.unit} ${args.family}: ${manifest.outcome}`);
  console.log(`  model     ${manifest.modelReported ?? 'none reported'}`);
  console.log(`  ingestion ${ingested}`);
  for (const path of written) console.log(`  wrote     ${path}`);
  return manifest.outcome === 'counted' ? 0 : 1;
}

export async function main(argv: readonly string[]): Promise<number> {
  const env = definedEnv(process.env);

  let args: RunArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(messageOf(err));
    return 1;
  }

  let prepared: Prepared;
  try {
    prepared = prepare(args);
  } catch (err) {
    return refuse(err, env);
  }

  try {
    return await (args.family === 'codex' ? runCodex(args, prepared, env) : runGemini(args, prepared, env));
  } catch (err) {
    // Anything unforeseen still exits non-zero, and its text passes the same
    // check as every other message rather than reaching Node's uncaught dump.
    console.error(`failed: ${printable(messageOf(err), env)}`);
    console.error('The bundle may have been sent. Check docs/reviews/ for any file this run left.');
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2));
