import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UnitArtifacts } from './review-runner/artifacts.ts';
import { findUnitArtifacts } from './review-runner/artifacts.ts';
import type { CleanRoomProof } from './review-runner/cleanroom.ts';
import { assertCleanRoom } from './review-runner/cleanroom.ts';
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

/**
 * The belt to the branded types' braces. `RedactedEnv` and `KeylessUrl` keep a
 * secret out of the manifest by construction, but nothing brands the reply or
 * the session log, and either could carry a value back. Returns the NAMES of
 * every non-recordable variable whose value's first eight characters appear in
 * any of `contents`. It never returns, logs, or throws a value: the caller
 * prints what this returns, so returning a value would print it.
 */
export function findLeakedSecrets(
  contents: readonly string[],
  env: Readonly<Record<string, string>>,
): readonly string[] {
  const leaked: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (RECORDABLE_ENV.includes(name) || value.length < SECRET_PREFIX_LENGTH) continue;
    const prefix = value.slice(0, SECRET_PREFIX_LENGTH);
    if (contents.some((text) => text.includes(prefix))) leaked.push(name);
  }
  return leaked;
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

  // Overwriting an earlier run's files would erase the only local record that
  // it happened, and a stale reply left beside a new manifest would be read as
  // that manifest's reply. Refused before egress, so a rerun costs nothing.
  const base = `${REVIEWS_DIR}/${artifacts.date}-${args.unit}-${artifacts.slug}-review-${args.family}`;
  const outputs: OutputPaths = { reply: `${base}.md`, manifest: `${base}.run.json`, session: `${base}.session.jsonl` };
  for (const path of [outputs.reply, outputs.manifest, outputs.session]) {
    if (existsSync(repoPath(path))) {
      throw new Error(
        `${path} already exists from an earlier run. Commit it, then remove or rename it before running ` +
          `${args.family} again, so both runs stay on record.`,
      );
    }
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
    outputs,
  };
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
 * through the same check the written files do. A module error can carry a
 * path built from an environment value; this prints the variable names
 * instead of the text.
 */
function printable(text: string, env: Readonly<Record<string, string>>): string {
  const names = findLeakedSecrets([text], env);
  return names.length === 0 ? text : `(withheld: the text contains the value of ${names.join(', ')})`;
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
  let entry: string;
  let cliVersion: string;
  let scratch: CodexScratch;
  try {
    entry = resolveCodexEntry(process.env, process.platform, process.execPath);
    cliVersion = codexCliVersion(entry);
    const authJson = join(homedir(), '.codex', 'auth.json');
    if (!existsSync(authJson)) throw new Error('no Codex credential at ~/.codex/auth.json; run `codex login` first');
    scratch = buildCodexScratch(authJson);
  } catch (err) {
    return refuse(err, env);
  }

  try {
    // Listed BEFORE the run: one Codex turn leaves ~332 files of vendor cache
    // behind it, so a listing taken afterwards proves nothing about the input.
    let cleanRoom: CleanRoomProof;
    try {
      cleanRoom = { configHome: listRecursive(scratch.configHome), workDir: listRecursive(scratch.workDir) };
      assertCleanRoom(cleanRoom, { configFiles: ['auth.json'], workFiles: [] });
    } catch (err) {
      return refuse(err, env);
    }

    // Step 7.
    if (args.dryRun) {
      printDryRunHeader(args, p);
      console.log(`  codex           ${cliVersion}, read from its installed package.json`);
      console.log(`  config home     ${listing(cleanRoom.configHome)}`);
      console.log(`  work dir        ${listing(cleanRoom.workDir)}`);
      return 0;
    }

    // Step 8. From here the bundle has left the machine, so every path below
    // writes evidence that it did.
    const replyPath = join(scratch.root, 'last-message.txt');
    const argv = [entry, ...codexArgv(replyPath)];
    const invocation: Invocation = {
      kind: 'cli',
      command: process.execPath,
      argv,
      envOverrides: redactEnv({ CODEX_HOME: scratch.configHome }),
    };

    const startedAt = new Date();
    let exitCode: number | null = null;
    let timedOut = false;
    try {
      const result = await runCli({
        command: process.execPath,
        args: argv,
        cwd: scratch.workDir,
        env: { ...process.env, CODEX_HOME: scratch.configHome },
        stdin: p.payload,
      });
      exitCode = result.exitCode;
      timedOut = result.timedOut;
      if (timedOut || exitCode !== 0) {
        const stderrTail = result.stderr.trimEnd().split(/\r?\n/).slice(-20).join('\n');
        console.error(`codex did not complete; the tail of its stderr:\n${printable(stderrTail, env)}`);
      }
    } catch (err) {
      console.error(`codex could not be run: ${printable(messageOf(err), env)}`);
    }
    const endedAt = new Date();

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
    return finish(args, manifest, written, env);
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
    printDryRunHeader(args, p);
    console.log(`  request         POST ${request.url}`);
    console.log(`  api version     ${cliVersion}`);
    console.log(`  header names    ${request.headerNames.join(', ')}`);
    return 0;
  }

  // Presence only, checked here so a missing key refuses before egress rather
  // than surfacing as a failed call. `callGemini` reads the value itself.
  if ((env.GEMINI_API_KEY ?? '') === '') {
    return refuse(new Error('GEMINI_API_KEY is not set'), env);
  }

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
): number {
  const leaked = findLeakedSecrets(
    written.map((path) => readFileSync(repoPath(path), 'utf8')),
    env,
  );
  if (leaked.length > 0) {
    for (const path of written) rmSync(repoPath(path), { force: true });
    console.error(`refused: the files written for this run contained the value of ${leaked.join(', ')}.`);
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
