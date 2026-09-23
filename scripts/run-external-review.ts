import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UnitArtifacts } from './review-runner/artifacts.ts';
import { findUnitArtifacts } from './review-runner/artifacts.ts';
import type { CleanRoomProof } from './review-runner/cleanroom.ts';
import { assertCleanRoom } from './review-runner/cleanroom.ts';
import type { CliResult, RunCliOptions } from './review-runner/codex.ts';
import { codexApprovalPolicy, codexArgv, codexModel, codexUsage, resolveCodexEntry, runCli } from './review-runner/codex.ts';
import type { Family, Invocation, Manifest } from './review-runner/evidence.ts';
import { CODEX_KEEP, RECORDABLE_ENV, outcomeOf, redactEnv, stripSessionLog } from './review-runner/evidence.ts';
import type { GeminiResult } from './review-runner/gemini.ts';
import { GEMINI_MODEL, GeminiRequestError, callGemini, geminiRequest, isTimeout } from './review-runner/gemini.ts';
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

/** Shorter values are never searched for: they occur in ordinary text. */
const SECRET_MIN_LENGTH = 8;

/** A value this long or longer is searched for by its last
 *  `SECRET_TAIL_LENGTH` characters, which its full value contains too. */
const SECRET_TAIL_MIN_LENGTH = 24;
const SECRET_TAIL_LENGTH = 20;

/** A value this long or longer is ALSO searched for by a `SECRET_TAIL_LENGTH`
 *  slice from its middle, starting at `floor(length / 2) - SECRET_TAIL_LENGTH /
 *  2`. Below this length the middle slice overlaps the tail it would add
 *  nothing to, and on a value whose body repeats it collides across values of
 *  the same format. */
const SECRET_MIDDLE_MIN_LENGTH = 40;

/** Searched for whenever they are set. Neither reviewer can reach the
 *  environment, so any bug of ours that dumps `process.env` wholesale carries
 *  these with it: they are the canary for environment dumps generally. */
const CANARY_ENV: readonly string[] = ['GEMINI_API_KEY', 'OPENAI_API_KEY'];

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

/** An absolute filesystem path, POSIX or Windows. A variable that says where a
 *  credential lives (GOOGLE_APPLICATION_CREDENTIALS, AWS_SHARED_CREDENTIALS_FILE)
 *  holds a path, not the credential, and paths are what manifests record and
 *  replies quote: a reply naming that file would withhold every file after
 *  the bundle was sent. Such a value is skipped only when the path also exists
 *  on disk: a secret that merely begins with "/" almost never names an
 *  existing file. */
const ABSOLUTE_PATH = /^(?:[\\/]|[A-Za-z]:[\\/])/;

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
 * Searches for the value of every canary variable, of every variable whose
 * name says it is a secret, and of every string in `authSecrets`: in full; for
 * a value of 24 characters or more, by its last 20 characters alone, so a copy
 * missing its start is still caught; and for a value of 40 characters or more,
 * by a 20-character slice from its middle, so a copy missing its END is caught
 * too — a leak that reproduces a credential's start and stops short matches
 * neither of the other two (gemini-3). The middle of a long credential is
 * unique to it and clear of both the shared prefix and the tail.
 *
 * Never by a prefix. `sk-proj-` begins
 * every OpenAI project key, `sk-ant-a` every Anthropic key, and `eyJhbGci`
 * every JWT in auth.json, so a reply quoting any placeholder in one of those
 * formats would withhold every file after the bundle was sent. A key's tail is
 * its own; a JWT's is its signature. A secret-named value that is the absolute
 * path of an existing file is skipped; the canaries never are. Returns the
 * variable NAMES, plus `AUTH_JSON_LABEL` for a credential-file hit. It never
 * returns, logs, or throws a value: the caller prints what this returns, so
 * returning a value would print it.
 */
export function findLeakedSecrets(
  contents: readonly string[],
  env: Readonly<Record<string, string>>,
  authSecrets: readonly string[] = [],
): readonly string[] {
  const appears = (value: string): boolean => {
    if (value.length < SECRET_MIN_LENGTH) return false;
    const needles: string[] = [
      value.length >= SECRET_TAIL_MIN_LENGTH ? value.slice(-SECRET_TAIL_LENGTH) : value,
    ];
    if (value.length >= SECRET_MIDDLE_MIN_LENGTH) {
      const start = Math.floor(value.length / 2) - SECRET_TAIL_LENGTH / 2;
      needles.push(value.slice(start, start + SECRET_TAIL_LENGTH));
    }
    return contents.some((text) => needles.some((needle) => text.includes(needle)));
  };

  const leaked: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (RECORDABLE_ENV.includes(name)) continue;
    const canary = CANARY_ENV.includes(name);
    if (!canary && !SECRET_NAME.test(name)) continue;
    // Local and silent: the value is used as a path here and never reported.
    if (!canary && ABSOLUTE_PATH.test(value) && existsSync(value)) continue;
    if (appears(value)) leaked.push(name);
  }
  if (authSecrets.some(appears)) leaked.push(AUTH_JSON_LABEL);
  return leaked;
}

function parseAuthJson(authJsonText: string): unknown {
  try {
    return JSON.parse(authJsonText);
  } catch {
    // Not the parser's message: V8 quotes the offending text in it, and that
    // text is a credential.
    throw new Error('auth.json is not valid JSON, so its tokens cannot be checked for');
  }
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
  const parsed = parseAuthJson(authJsonText);

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

/** `tokens.account_id`, when `tokens` is a non-empty object carrying one as a
 *  string; otherwise null. */
function accountIdOf(authJsonText: string): string | null {
  const parsed = parseAuthJson(authJsonText);
  if (typeof parsed !== 'object' || parsed === null || !('tokens' in parsed)) return null;
  const tokens = parsed.tokens;
  if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) return null;
  if (Object.keys(tokens).length === 0 || !('account_id' in tokens)) return null;
  return typeof tokens.account_id === 'string' ? tokens.account_id : null;
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
  | 'read-failed'
  | 'unparseable'
  | 'not-this-account'
  | 'write-failed';

export interface PostRunAuth {
  readonly writeBack: WriteBack;
  /** Credentials found only in the post-run file. Searched for alongside the
   *  ones copied in, since a refreshed token is as secret as the old one. */
  readonly refreshedSecrets: readonly string[];
  /** A temp file holding the refreshed credential that could not be removed
   *  after a failed write-back. Its path, never its contents. */
  readonly leftoverTemp: string | null;
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
 * This is the one write this program makes outside the repository, to a live
 * credential, so it is guarded four ways. The post-run file must parse, and
 * must hold a non-empty `tokens` object whose `account_id` equals the
 * copied-in one: a different account's credential never replaces the
 * maintainer's login. The real file must still hold the bytes that were copied
 * in: if it changed meanwhile, something else refreshed it, and overwriting it
 * would replace a credential this run never saw. And the write is atomic, a
 * sibling temp file renamed over the original, so no partial write is ever
 * left in its place.
 *
 * Never throws. Every failure is reported in the result, so nothing here can
 * stop a run whose bundle was sent from writing its evidence.
 */
export function reconcileAuthAfterRun(
  scratchAuthPath: string,
  realAuthPath: string,
  copiedIn: Uint8Array,
  fs: AuthFs = NODE_AUTH_FS,
): PostRunAuth {
  const result = (writeBack: WriteBack, refreshedSecrets: readonly string[] = [], leftoverTemp: string | null = null) => ({
    writeBack,
    refreshedSecrets,
    leftoverTemp,
  });

  let after: Uint8Array;
  try {
    if (!fs.exists(scratchAuthPath)) return result('scratch-missing');
    after = fs.readFile(scratchAuthPath);
  } catch {
    return result('read-failed');
  }
  if (!authRefreshed(copiedIn, after)) return result('unchanged');

  const decoder = new TextDecoder();
  let refreshedSecrets: readonly string[];
  let accountAfter: string | null;
  let accountBefore: string | null;
  try {
    refreshedSecrets = authJsonSecrets(decoder.decode(after));
    accountAfter = accountIdOf(decoder.decode(after));
    accountBefore = accountIdOf(decoder.decode(copiedIn));
  } catch {
    return result('unparseable');
  }
  if (accountAfter === null || accountAfter !== accountBefore) return result('not-this-account', refreshedSecrets);

  try {
    if (!fs.exists(realAuthPath) || authRefreshed(copiedIn, fs.readFile(realAuthPath))) {
      return result('real-file-changed', refreshedSecrets);
    }
  } catch {
    return result('read-failed', refreshedSecrets);
  }

  const temp = `${realAuthPath}.olympus-${String(process.pid)}.tmp`;
  try {
    fs.writeFile(temp, after);
    fs.rename(temp, realAuthPath);
  } catch {
    try {
      fs.remove(temp);
    } catch {
      return result('write-failed', refreshedSecrets, temp);
    }
    return result('write-failed', refreshedSecrets);
  }
  return result('written-back', refreshedSecrets);
}

const WRITE_BACK_NOTICE: Readonly<Record<WriteBack, string | null>> = {
  'unchanged': null,
  'written-back': 'The Codex credential was refreshed during the run and written back to ~/.codex/auth.json.',
  'real-file-changed':
    'The Codex credential was refreshed during the run, but ~/.codex/auth.json changed meanwhile, so it was ' +
    'left as it is. If Codex asks you to log in, run `codex login`.',
  'scratch-missing': 'The scratch auth.json was gone after the run; ~/.codex/auth.json was left as it is.',
  'read-failed':
    'Reading an auth.json after the run failed, so ~/.codex/auth.json was left as it is and any refreshed ' +
    'tokens could not be searched for.',
  'unparseable':
    'The scratch auth.json changed during the run but is not valid JSON, so it was not written back and its ' +
    'contents could not be searched for.',
  'not-this-account':
    'The scratch auth.json changed during the run but does not hold a non-empty tokens object for the same ' +
    'account_id, so it was not written back.',
  'write-failed':
    'The Codex credential was refreshed during the run, but writing it back to ~/.codex/auth.json failed; the ' +
    'original was left in place. If Codex asks you to log in, run `codex login`.',
};

/** Prints what the write-back did, where there is anything to say. */
function reportWriteBack(postRunAuth: PostRunAuth): void {
  const notice = WRITE_BACK_NOTICE[postRunAuth.writeBack];
  if (notice !== null) console.error(notice);
  if (postRunAuth.leftoverTemp !== null) {
    console.error(`The temp file ${postRunAuth.leftoverTemp} holds the refreshed credential and could not be removed. Delete it.`);
  }
}

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
 *
 * All of this was measured on Windows only, where the read-only sandbox also
 * blocked every file read. That is why the runner refuses Codex elsewhere
 * (`CODEX_PLATFORM`).
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
 * The only platform the Codex family runs on. There, measured twice, the
 * read-only sandbox blocked every file read, so the reviewer could not reach
 * the maintainer's files. Codex's documentation suggests its read-only sandbox
 * permits reads anywhere on macOS and Linux. Unmeasured, so refused, before
 * egress: lifting this takes the measurement, not a flag.
 */
const CODEX_PLATFORM: NodeJS.Platform = 'win32';

function codexPlatformRefusal(platform: NodeJS.Platform): string {
  return (
    'the Codex family runs only on Windows. Its read isolation has been measured only on Windows, where the ' +
    `read-only sandbox blocked every file read; on ${platform} it has not been measured, and it must be before ` +
    'Codex runs there.'
  );
}

/**
 * Assembles the manifest from facts already computed. The parameter type has
 * no `outcome`, and the spread puts the derived one last, so an `outcome`
 * smuggled in on a wider object is overwritten rather than recorded. Every
 * fact `outcomeOf` decides from is a field of the manifest, so the manifest
 * reproduces its own outcome.
 */
export function buildManifest(facts: Omit<Manifest, 'outcome'>): Manifest {
  return { ...facts, outcome: outcomeOf(facts) };
}

/** The three outputs of one run, as suffixes of `<date>-<UNIT>-<slug>-review-<family>`. */
const OUTPUT_EXTENSIONS: readonly string[] = ['.md', '.run.json', '.session.jsonl'];

export interface ArchiveMove {
  readonly from: string;
  readonly to: string;
}

export type ArchivePlan =
  | { readonly kind: 'counted' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'archive'; readonly moves: readonly ArchiveMove[] };

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A manifest's `outcome`, or null when the text is not a manifest this
 *  runner could have written: not JSON (a BOM from a Windows editor, merge
 *  conflict markers), not an object, or no string `outcome`. */
function recordedOutcome(manifestText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(manifestText);
    if (typeof parsed !== 'object' || parsed === null || !('outcome' in parsed)) return null;
    return typeof parsed.outcome === 'string' ? parsed.outcome : null;
  } catch {
    return null;
  }
}

/**
 * What to do with this family's earlier outputs before a rerun. Pure over a
 * directory listing and the current manifest's text (null when there is none).
 *
 * A manifest recording `counted` means a real review exists, and a rerun must
 * never supersede it. A manifest that cannot be read might be one, so it
 * refuses too: a guard that failed open on bad input would not be a guard.
 * Anything else is a failed attempt whose files are the record that the bundle
 * was sent, so they are kept, not overwritten: each is renamed with
 * `.attempt-<N>` before its extension, N the lowest number not yet used for
 * this stem. The fixed names are then free for the new run, which is what the
 * shipped skills read, and an archived name matches none of them.
 *
 * Per stem, deliberately: a regenerated bundle has a new date because it is
 * different code, and warrants its own review. This protects one bundle's
 * counted review from being overwritten, not the unit forever.
 */
export function planArchive(fileNames: readonly string[], stem: string, manifestText: string | null): ArchivePlan {
  if (manifestText !== null) {
    const outcome = recordedOutcome(manifestText);
    if (outcome === null) return { kind: 'unreadable' };
    if (outcome === 'counted') return { kind: 'counted' };
  }

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

/** A rename failed part-way through an archive. `renamed` is what had
 *  already moved, so the refusal can say so rather than claim nothing was
 *  touched. Rolling a partial archive back is deferred. */
export class ArchiveError extends Error {
  readonly renamed: readonly ArchiveMove[];

  constructor(message: string, renamed: readonly ArchiveMove[], options?: ErrorOptions) {
    super(message, options);
    this.name = 'ArchiveError';
    this.renamed = renamed;
  }
}

/**
 * Plans the archive for `stem` in `dir` and, unless this is a dry run, carries
 * it out. A counted or unreadable manifest is returned as such with nothing
 * renamed; the caller refuses.
 */
export function archiveEarlierAttempt(
  dir: string,
  stem: string,
  dryRun: boolean,
  rename: (from: string, to: string) => void = renameSync,
): ArchivePlan {
  const manifestPath = join(dir, `${stem}.run.json`);
  const manifestText = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null;
  const plan = planArchive(readdirSync(dir), stem, manifestText);
  if (plan.kind === 'archive' && !dryRun) {
    const renamed: ArchiveMove[] = [];
    for (const move of plan.moves) {
      try {
        rename(join(dir, move.from), join(dir, move.to));
      } catch (err) {
        throw new ArchiveError(`archiving ${move.from} failed: ${messageOf(err)}`, renamed, { cause: err });
      }
      renamed.push(move);
    }
  }
  return plan;
}

type ScratchEvent = 'SIGINT' | 'SIGTERM' | 'exit';

/** The process surface the scratch cleanup registers on, injectable so tests
 *  never install a real signal handler. */
export interface SignalHost {
  readonly on: (event: ScratchEvent, listener: () => void) => void;
  readonly off: (event: ScratchEvent, listener: () => void) => void;
  readonly exit: (code: number) => void;
}

const PROCESS_SIGNALS: SignalHost = {
  on: (event, listener) => {
    if (event === 'exit') process.on('exit', listener);
    else process.on(event, listener);
  },
  off: (event, listener) => {
    if (event === 'exit') process.off('exit', listener);
    else process.off(event, listener);
  },
  exit: (code) => {
    process.exit(code);
  },
};

/**
 * Removes the scratch by the path it holds. A failure is reported, never
 * thrown: it cannot change a finished run's exit code, and nothing that must
 * run after it is skipped.
 */
function removeScratchOrReport(scratch: CodexScratch, remove: (scratch: CodexScratch) => void): void {
  try {
    remove(scratch);
  } catch {
    console.error(`The scratch directory ${scratch.root} holds a copy of your Codex credential and could not be removed. Delete it.`);
  }
}

/** Who each family's bundle goes to. */
const VENDOR: Readonly<Record<Family, string>> = { codex: 'OpenAI (codex)', gemini: 'Google (gemini)' };

/** The one line a run interrupted after egress leaves. No evidence file is
 *  written from a signal handler, so this line is the only record of it. */
function interruptedNotice(family: Family): string {
  return `interrupted: the bundle WAS sent to ${VENDOR[family]}. No evidence was written because the run was interrupted.`;
}

export interface ScratchGuard {
  /**
   * Called immediately before the bundle is sent. From then on a signal
   * prints `interruptedNotice`, runs `writeBack`, and only then removes the
   * scratch: a credential Codex refreshed lives only in the scratch copy, so
   * removing it first would lose it. `writeBack` must not throw.
   */
  readonly sending: (family: Family, writeBack: () => void) => void;
  readonly release: () => void;
}

/**
 * Keeps the credential copy from outliving an interrupted run. From the moment
 * the scratch exists until `release`, Ctrl-C, SIGTERM or a process exit
 * removes it: the one directory this run created, identified by the path the
 * scratch holds and never by a name or a pattern. A signal then exits the way
 * it would have (130 and 143). All of it is synchronous: a signal handler
 * gets no later turn.
 */
export function guardScratch(
  scratch: CodexScratch,
  remove: (scratch: CodexScratch) => void,
  host: SignalHost = PROCESS_SIGNALS,
): ScratchGuard {
  let sent: { readonly family: Family; readonly writeBack: () => void } | null = null;
  const cleanUp = (): void => {
    removeScratchOrReport(scratch, remove);
  };
  const interrupted = (code: number) => (): void => {
    const egress = sent;
    if (egress !== null) {
      console.error(interruptedNotice(egress.family));
      egress.writeBack();
    }
    cleanUp();
    host.exit(code);
  };
  const onSigint = interrupted(130);
  const onSigterm = interrupted(143);
  host.on('SIGINT', onSigint);
  host.on('SIGTERM', onSigterm);
  host.on('exit', cleanUp);
  return {
    sending: (family, writeBack) => {
      sent = { family, writeBack };
    },
    release: () => {
      host.off('SIGINT', onSigint);
      host.off('SIGTERM', onSigterm);
      host.off('exit', cleanUp);
    },
  };
}

/**
 * The Gemini counterpart, which has no scratch to guard: from the call until
 * the returned release, a signal prints `interruptedNotice` and exits the way
 * it would have.
 */
export function guardEgress(family: Family, host: SignalHost = PROCESS_SIGNALS): () => void {
  const interrupted = (code: number) => (): void => {
    console.error(interruptedNotice(family));
    host.exit(code);
  };
  const onSigint = interrupted(130);
  const onSigterm = interrupted(143);
  host.on('SIGINT', onSigint);
  host.on('SIGTERM', onSigterm);
  return () => {
    host.off('SIGINT', onSigint);
    host.off('SIGTERM', onSigterm);
  };
}

/**
 * Everything the runner touches beyond its own memory and plain reads, so a
 * test can prove what happens before egress with no network, no real Codex
 * and no write. `defaultDeps()` supplies the real ones.
 */
export interface RunnerDeps {
  readonly repoRoot: string;
  readonly homeDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly git: (cwd: string, args: readonly string[]) => string;
  readonly runCli: (options: RunCliOptions) => Promise<CliResult>;
  readonly callGemini: (payload: string) => Promise<GeminiResult>;
  /** mkdtemp and the credential copy. */
  readonly buildScratch: (authJsonSource: string) => CodexScratch;
  /** rm of the scratch root. */
  readonly removeScratch: (scratch: CodexScratch) => void;
  /** Writes exactly these bytes, so a hash of them is a hash of the file. */
  readonly writeFile: (path: string, bytes: Uint8Array) => void;
  readonly rename: (from: string, to: string) => void;
  readonly authFs: AuthFs;
  readonly signals: SignalHost;
}

export function defaultDeps(): RunnerDeps {
  return {
    repoRoot: REPO_ROOT,
    homeDir: homedir(),
    env: process.env,
    platform: process.platform,
    git: (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    runCli,
    // callGemini reads GEMINI_API_KEY from process.env at call time.
    callGemini: (payload) => callGemini(payload),
    buildScratch: buildCodexScratch,
    removeScratch,
    writeFile: (path, bytes) => {
      writeFileSync(path, bytes);
    },
    rename: (from, to) => {
      renameSync(from, to);
    },
    authFs: NODE_AUTH_FS,
    signals: PROCESS_SIGNALS,
  };
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

function isTracked(deps: RunnerDeps, path: string): boolean {
  try {
    deps.git(deps.repoRoot, ['ls-files', '--error-unmatch', '--', path]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Step 2's second half: committed AND pushed. A reader can check that the
 * reviewer was not steered, and that the prompt was not edited after the
 * reply came back, only against a commit that left the machine before the
 * bundle did; a local-only commit can be rewritten along with everything else
 * local. So the commit that last touched either artifact must be an ancestor
 * of the branch's upstream.
 */
function assertPushed(deps: RunnerDeps, promptPath: string, bundlePath: string): void {
  const lastTouched = deps.git(deps.repoRoot, ['log', '-1', '--format=%H', '--', promptPath, bundlePath]).trim();
  if (lastTouched === '') throw new Error(`step 2: no commit touches ${promptPath} or ${bundlePath}`);

  let upstream: string;
  try {
    upstream = deps.git(deps.repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).trim();
  } catch (err) {
    throw new Error(
      'step 2: the current branch has no upstream, so the prompt and bundle cannot have been pushed. ' +
        'They must be pushed before any reviewer sees them: push the branch, then run again.',
      { cause: err },
    );
  }
  try {
    deps.git(deps.repoRoot, ['merge-base', '--is-ancestor', lastTouched, '@{u}']);
  } catch (err) {
    throw new Error(
      `step 2: commit ${lastTouched}, which last touched the prompt and bundle, is not on ${upstream}. ` +
        'They must be pushed before any reviewer sees them: push, then run again.',
      { cause: err },
    );
  }
}

/** Steps 1 to 5. Every throw here is a refusal before egress: nothing is written. */
function prepare(args: RunArgs, deps: RunnerDeps): Prepared {
  const at = (relative: string): string => join(deps.repoRoot, relative);

  // Step 1.
  let artifacts: UnitArtifacts;
  try {
    artifacts = findUnitArtifacts(readdirSync(at(REVIEWS_DIR)), args.unit);
  } catch (err) {
    const branch = deps.git(deps.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    throw new Error(
      `step 1: no committed review prompt and bundle were found for unit ${args.unit} in ${REVIEWS_DIR}/ ` +
        `on branch ${branch} (${messageOf(err)}). Run review-request for ${args.unit}, or switch to the ` +
        `branch that holds its review artifacts.`,
      { cause: err },
    );
  }
  // Several pairs for one unit is ordinary — units are re-bundled — and the
  // newest wins. Saying so makes the choice visible at the top of every run,
  // dry or real, rather than leaving it to be inferred from the filenames
  // (gemini-1).
  const pairs = artifacts.matchingPairs;
  console.log(
    `selected ${artifacts.promptFile} and ${artifacts.bundleFile} ` +
      `(${String(pairs)} pair${pairs === 1 ? '' : 's'} matched ${args.unit}` +
      `${pairs === 1 ? '' : '; the newest was chosen'})`,
  );

  const promptPath = `${REVIEWS_DIR}/${artifacts.promptFile}`;
  const bundlePath = `${REVIEWS_DIR}/${artifacts.bundleFile}`;

  // Step 2.
  for (const path of [promptPath, bundlePath]) {
    if (!isTracked(deps, path)) throw new Error(`step 2: ${path} is not committed`);
    if (deps.git(deps.repoRoot, ['status', '--porcelain', '--', path]) !== '') {
      throw new Error(`step 2: ${path} has uncommitted changes`);
    }
  }
  assertPushed(deps, promptPath, bundlePath);

  // A counted or unreadable manifest is refused here, early. An earlier
  // FAILED attempt is not: its files are archived just before egress, once
  // every other refusal has had its chance, so a rerun is one command.
  const stem = `${artifacts.date}-${args.unit}-${artifacts.slug}-review-${args.family}`;
  const base = `${REVIEWS_DIR}/${stem}`;
  const outputs: OutputPaths = { reply: `${base}.md`, manifest: `${base}.run.json`, session: `${base}.session.jsonl` };
  const manifestText = existsSync(at(outputs.manifest)) ? readFileSync(at(outputs.manifest), 'utf8') : null;
  const plan = planArchive(readdirSync(at(REVIEWS_DIR)), stem, manifestText);
  if (plan.kind === 'counted') throw new Error(countedRefusal(outputs.manifest));
  if (plan.kind === 'unreadable') throw new Error(unreadableRefusal(outputs.manifest));

  // Step 3.
  const promptText = readFileSync(at(promptPath), 'utf8');
  const bundleText = readFileSync(at(bundlePath), 'utf8');
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
  // `markers.endNonce` is non-null here: step 4 above refuses a bundle without
  // one, and the delimiters are built from it.
  const payload = composePayload(promptText, artifacts.bundleFile, bundleText, markers.endNonce);
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

function unreadableRefusal(manifestPath: string): string {
  return (
    `${manifestPath} exists but cannot be read as a manifest, so whether it records a counted review is ` +
    'unknown. Nothing was archived. Repair or remove it, then run again.'
  );
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
  deps: RunnerDeps,
): readonly ArchiveMove[] | null {
  let plan: ArchivePlan;
  try {
    plan = archiveEarlierAttempt(join(deps.repoRoot, REVIEWS_DIR), p.stem, dryRun, deps.rename);
  } catch (err) {
    if (err instanceof ArchiveError && err.renamed.length > 0) {
      const renamed = err.renamed.map((move) => `${move.from} -> ${move.to}`).join(', ');
      refuse(err, env, `Nothing was sent. Already renamed in ${REVIEWS_DIR}/ before the failure: ${renamed}.`);
    } else {
      refuse(err, env);
    }
    return null;
  }
  if (plan.kind === 'counted') {
    refuse(new Error(countedRefusal(p.outputs.manifest)), env);
    return null;
  }
  if (plan.kind === 'unreadable') {
    refuse(new Error(unreadableRefusal(p.outputs.manifest)), env);
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

function definedEnv(env: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string>> {
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

function refuse(
  err: unknown,
  env: Readonly<Record<string, string>>,
  aftermath = 'Nothing was sent and nothing was written.',
): number {
  console.error(`refused: ${printable(messageOf(err), env)}`);
  console.error(aftermath);
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

async function runCodex(
  args: RunArgs,
  p: Prepared,
  env: Readonly<Record<string, string>>,
  deps: RunnerDeps,
): Promise<number> {
  // Step 6, still before egress: every throw is a refusal.
  if (deps.platform !== CODEX_PLATFORM) return refuse(new Error(codexPlatformRefusal(deps.platform)), env);
  const realAuthPath = join(deps.homeDir, '.codex', 'auth.json');
  let entry: string;
  let cliVersion: string;
  let scratch: CodexScratch;
  try {
    entry = resolveCodexEntry(deps.env, deps.platform, process.execPath);
    cliVersion = codexCliVersion(entry);
    if (!existsSync(realAuthPath)) throw new Error('no Codex credential at ~/.codex/auth.json; run `codex login` first');
    scratch = deps.buildScratch(realAuthPath);
  } catch (err) {
    return refuse(err, env);
  }

  const guard = guardScratch(scratch, deps.removeScratch, deps.signals);
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
      const wouldArchive = archiveBeforeEgress(p, true, env, deps);
      if (wouldArchive === null) return 1;
      printDryRunHeader(args, p);
      console.log(`  codex           ${cliVersion}, read from its installed package.json`);
      console.log(`  config home     ${listing(cleanRoom.configHome)}`);
      console.log(`  work dir        ${listing(cleanRoom.workDir)}`);
      printWouldArchive(wouldArchive);
      return 0;
    }

    if (archiveBeforeEgress(p, false, env, deps) === null) return 1;

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

    // Interrupted from here on, the run says the bundle was sent and still
    // writes a refreshed credential back before the scratch goes.
    guard.sending('codex', () => {
      reportWriteBack(reconcileAuthAfterRun(scratchAuthPath, realAuthPath, authCopiedIn, deps.authFs));
    });

    const startedAt = new Date();
    let result: CliResult | null = null;
    let runError: unknown = null;
    try {
      result = await deps.runCli({ ...spawnSpec, stdin: p.payload });
    } catch (err) {
      runError = err;
    }
    const endedAt = new Date();

    // First, whatever happened, while the scratch home still exists: a
    // credential Codex refreshed goes back to the maintainer, and its new
    // tokens join the set nothing may leak. This never throws.
    const postRunAuth = reconcileAuthAfterRun(scratchAuthPath, realAuthPath, authCopiedIn, deps.authFs);
    reportWriteBack(postRunAuth);
    const secrets = [...authSecrets, ...postRunAuth.refreshedSecrets];

    const exitCode = result === null ? null : result.exitCode;
    const timedOut = result?.timedOut ?? false;
    if (runError !== null) {
      console.error(`codex could not be run: ${printable(messageOf(runError), env, secrets)}`);
    } else if (result !== null && (timedOut || exitCode !== 0)) {
      const stderrTail = result.stderr.trimEnd().split(/\r?\n/).slice(-20).join('\n');
      console.error(`codex did not complete; the tail of its stderr:\n${printable(stderrTail, env, secrets)}`);
    }

    // Every read from here to the evidence write is guarded: the bundle has
    // been sent, so a failed read must leave a non-counted run on record, not
    // none. A missing fact already derives a non-counted outcome: a null reply
    // fails the echo, and a null token count is `unreported` ingestion. A
    // failure is reported by its error message only, never file contents.
    const readAfterRun = (read: () => string | null, what: string): string | null => {
      try {
        return read();
      } catch (err) {
        console.error(`reading ${what} after the run failed: ${printable(messageOf(err), env, secrets)}`);
        return null;
      }
    };

    const replyText = readAfterRun(() => (existsSync(replyPath) ? readFileSync(replyPath, 'utf8') : null), 'the reply');
    const reply = replyText === '' ? null : replyText;

    // The rollout log is the ONLY place the model id, the input token count
    // and the approval policy exist. Anything but exactly one is read as none.
    let configListing: readonly string[] | null = null;
    try {
      configListing = listRecursive(scratch.configHome);
    } catch (err) {
      console.error(`listing the scratch config home after the run failed: ${printable(messageOf(err), env, secrets)}`);
    }
    const rollouts = (configListing ?? []).filter((path) => path.startsWith('sessions/') && path.endsWith('.jsonl'));
    const [onlyRollout, ...otherRollouts] = rollouts;
    const rollout =
      onlyRollout !== undefined && otherRollouts.length === 0
        ? readAfterRun(() => readFileSync(join(scratch.configHome, onlyRollout), 'utf8'), 'the rollout log')
        : null;
    if (configListing !== null && rollouts.length !== 1) {
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
    const replyFile = reply === null ? null : evidenceFile(p.outputs.reply, reply);
    const manifest = buildManifest({
      unit: args.unit,
      family: 'codex',
      artifacts: manifestArtifacts(p.artifacts),
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
      postRunFileCount: configListing === null ? null : configListing.length,
      recordedApprovalPolicy,
      bundleSha256: p.bundleSha256,
      integrity: verifyEcho(p.markers, reply ?? ''),
      replySha256: replyFile === null ? null : sha256(replyFile.bytes),
    });
    const session = rollout === null ? '' : stripSessionLog(rollout, CODEX_KEEP);

    // Steps 10 to 13. The scratch goes in the `finally`, once everything above
    // has read what it needs from it.
    return finish(args, manifest, evidenceFiles(p.outputs, manifest, replyFile, session), env, secrets, deps);
  } finally {
    // Neither may stop the other, nor change a finished run's exit code.
    removeScratchOrReport(scratch, deps.removeScratch);
    guard.release();
  }
}

async function runGemini(
  args: RunArgs,
  p: Prepared,
  env: Readonly<Record<string, string>>,
  deps: RunnerDeps,
): Promise<number> {
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
    const wouldArchive = archiveBeforeEgress(p, true, env, deps);
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

  if (archiveBeforeEgress(p, false, env, deps) === null) return 1;

  // Step 8. From here every path writes evidence that the bundle was sent,
  // and an interruption says so.
  const releaseEgress = guardEgress('gemini', deps.signals);
  const startedAt = new Date();
  let result: GeminiResult | null = null;
  let timedOut = false;
  let httpStatus: number | null = null;
  try {
    result = await deps.callGemini(p.payload);
  } catch (err) {
    timedOut = isTimeout(err);
    if (err instanceof GeminiRequestError) httpStatus = err.status;
    console.error(`the Gemini call failed: ${printable(messageOf(err), env)}`);
  } finally {
    releaseEgress();
  }
  const endedAt = new Date();

  // The api transport has no process exit code. Only a completed call whose
  // reply parsed as complete is 0, so an incomplete reply reaches `outcomeOf`
  // as a failure and can never be counted. The manifest records exactly this.
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
  const replyFile = reply === null ? null : evidenceFile(p.outputs.reply, reply);
  const manifest = buildManifest({
    unit: args.unit,
    family: 'gemini',
    artifacts: manifestArtifacts(p.artifacts),
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
    replySha256: replyFile === null ? null : sha256(replyFile.bytes),
  });

  // No session exists for the api transport. This one line is its provenance,
  // with the candidate text removed: that text is already the review file.
  const sessionRecord: Record<string, unknown> = {
    modelVersion: result?.modelVersion ?? null,
    responseId: result?.responseId ?? null,
    usageMetadata: sessionUsageMetadata(result?.usageMetadata ?? null),
  };
  if (httpStatus !== null) sessionRecord.httpStatus = httpStatus;

  // Steps 10 to 13.
  return finish(args, manifest, evidenceFiles(p.outputs, manifest, replyFile, JSON.stringify(sessionRecord)), env, [], deps);
}

/** The pair this run was built from, as the manifest records it. `UnitArtifacts`
 *  also carries the date and slug the filenames are built from; the manifest
 *  keeps the filenames themselves. */
function manifestArtifacts(artifacts: UnitArtifacts): Manifest['artifacts'] {
  return {
    promptFile: artifacts.promptFile,
    bundleFile: artifacts.bundleFile,
    matchingPairs: artifacts.matchingPairs,
  };
}

/**
 * The `usageMetadata` fields a session record may keep: every value that is a
 * number, plus `serviceTier` when it is a string. The whole object used to be
 * written into a committed file verbatim, so an unexpected property on it was
 * retained whatever it held, nested objects and arrays included (codex-2).
 * Storing whatever a vendor returns, unexamined, in a tracked file is worth
 * removing on its own merits; the token counts are what the record exists for,
 * and `serviceTier` says which terms the call ran under.
 */
export function sessionUsageMetadata(
  record: Readonly<Record<string, unknown>> | null,
): Readonly<Record<string, number | string>> | null {
  if (record === null) return null;
  const out: Record<string, number | string> = {};
  for (const [name, value] of Object.entries(record)) {
    if (typeof value === 'number') out[name] = value;
    else if (name === 'serviceTier' && typeof value === 'string') out[name] = value;
  }
  return out;
}

function numericFields(record: Readonly<Record<string, unknown>> | null): Readonly<Record<string, number>> | null {
  if (record === null) return null;
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(record)) {
    if (typeof value === 'number') out[name] = value;
  }
  return out;
}

interface EvidenceFile {
  readonly path: string;
  /** What the leak check searches. */
  readonly content: string;
  /** `content` encoded once: exactly what is written, and what a hash of the
   *  file is taken from. */
  readonly bytes: Uint8Array;
}

function evidenceFile(path: string, content: string): EvidenceFile {
  return { path, content, bytes: Buffer.from(content, 'utf8') };
}

/**
 * The files a run that reached the vendor leaves, as the exact bytes to be
 * written. The manifest comes first, being the record that the bundle was
 * sent. The reply file holds the reply and nothing else, and exists only when
 * there is one; it is built before the manifest, whose `replySha256` is
 * hashed from its bytes.
 */
function evidenceFiles(
  outputs: OutputPaths,
  manifest: Manifest,
  replyFile: EvidenceFile | null,
  session: string,
): readonly EvidenceFile[] {
  const files: EvidenceFile[] = [
    evidenceFile(outputs.manifest, `${JSON.stringify(manifest, null, 2)}\n`),
    evidenceFile(outputs.session, session === '' ? '' : `${session}\n`),
  ];
  if (replyFile !== null) files.push(replyFile);
  return files;
}

/**
 * Steps 12, 10 and 13, in that order. The leak check runs on the strings about
 * to be written, before ANY of them is: a hit writes none, so there is nothing
 * to roll back and no path by which a credential reaches the disk unchecked.
 * Never committing a secret outranks leaving evidence; the message keeps the
 * fact of egress on record.
 */
function finish(
  args: RunArgs,
  manifest: Manifest,
  files: readonly EvidenceFile[],
  env: Readonly<Record<string, string>>,
  authSecrets: readonly string[],
  deps: RunnerDeps,
): number {
  // Step 12.
  const leaked = findLeakedSecrets(
    files.map((file) => file.content),
    env,
    authSecrets,
  );
  if (leaked.length > 0) {
    console.error(
      `withheld: the evidence for this run contained a credential from ${leaked.join(', ')}, so none of its ` +
        'files were written.',
    );
    console.error(
      `The bundle WAS sent to ${args.family}. This message is the only record of that egress; ` +
        `the run's outcome was ${manifest.outcome}.`,
    );
    return 1;
  }

  // Step 10.
  const written: string[] = [];
  for (const file of files) {
    try {
      deps.writeFile(join(deps.repoRoot, file.path), file.bytes);
    } catch (err) {
      const before = written.length === 0 ? 'nothing else was written' : `${written.join(', ')} were written first`;
      throw new Error(`writing ${file.path} failed (${before}): ${messageOf(err)}`, { cause: err });
    }
    written.push(file.path);
  }

  // Step 13.
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

export async function main(argv: readonly string[], deps: RunnerDeps = defaultDeps()): Promise<number> {
  const env = definedEnv(deps.env);

  let args: RunArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(messageOf(err));
    return 1;
  }

  let prepared: Prepared;
  try {
    prepared = prepare(args, deps);
  } catch (err) {
    return refuse(err, env);
  }

  try {
    return await (args.family === 'codex'
      ? runCodex(args, prepared, env, deps)
      : runGemini(args, prepared, env, deps));
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
