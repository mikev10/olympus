/**
 * One security check's run over one tree (R17), apart from the line so the
 * conformance suite can run it over a real daemon with the real scanners.
 * The line runs every security check through it, at the base and at
 * `verify`, and records the egress it returns.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SecurityScanner } from '@olympus-ai/adapters';
import type { CheckResult, SecurityCheckSpec } from '@olympus-ai/integrity';
import type { EgressLog, SandboxHandle, SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import { renderFindings } from './security.js';
import { copyTree } from './workspace.js';

/** Where a security check's rules are mounted in its sandbox, beside the tree at `/workspace` and outside it. */
export const SCAN_CONFIG = '/scanner-rules';

export interface ScanOptions {
  readonly sandbox: SandboxProvider;
  /** The tree the check judges. It is copied, never mounted. */
  readonly tree: string;
  /** A directory the runtime owns and nothing else uses: the copy and the rules are written under it, and it is removed when the scan ends. */
  readonly scratch: { readonly dir: string; readonly tree: string; readonly config: string };
  readonly check: SecurityCheckSpec;
  readonly scanner: SecurityScanner;
  /** The host profile's limits, or `null` on a graph with no profile: a sandbox that runs no image, which applies none. */
  readonly limits: Readonly<Omit<SandboxSpec['limits'], 'wallClockMs'>> | null;
  readonly user: SandboxSpec['user'];
}

export type ScanOutcome =
  | { readonly ok: true; readonly result: CheckResult; readonly egress: EgressLog }
  | { readonly ok: false; readonly at: 'provision'; readonly reason: string }
  | { readonly ok: false; readonly at: 'exec'; readonly reason: string; readonly egress: EgressLog };

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

/** Removes every entry under `root` whose base name is one of `names`, at any depth; a link is removed, never followed. */
async function removeNamed(root: string, names: readonly string[]): Promise<void> {
  if (names.length === 0) return;
  const wanted = new Set(names);
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (wanted.has(entry.name)) await rm(path, { recursive: true, force: true });
      else if (entry.isDirectory()) await visit(path);
    }
  };
  await visit(root);
}

/**
 * Runs the check's scanner over a copy of `tree` with every file the scanner
 * reads from a tree whatever it is told removed (D-R17-03), with the locked
 * rules on a second read-only mount, in the image the check pins, with no
 * egress. The arguments are the scanner declaration's, never the
 * manifest's. Its stdout carries what it found, a secret's value included,
 * so the result keeps the runtime's rendering of the findings in its place
 * and the scanner's own output is never returned (D-R17-02). An exit outside
 * the scanner's completed codes, or a report it cannot parse, is findings
 * `null`: never an empty list (I5).
 */
export async function scanTree(options: ScanOptions): Promise<ScanOutcome> {
  const { sandbox, scratch, check, scanner } = options;
  const rules = check.config ?? scanner.defaultConfig;
  // Admission refuses a check with no rules for a scanner that has none of its own.
  if (rules === null) throw new Error(`scan: ${check.kind} check ${check.id} pins no rules, and its scanner has none of its own`);
  await rm(scratch.dir, { recursive: true, force: true });
  await mkdir(scratch.config, { recursive: true });
  try {
    await copyTree(options.tree, scratch.tree);
    await removeNamed(scratch.tree, scanner.inTreeConfig);
    await writeFile(join(scratch.config, scanner.configFile), rules);
    const spec: SandboxSpec = {
      // The image is the check's pin, never the host's profile; a sandbox that runs no image ignores it.
      image: check.image,
      mounts: { workspace: { source: scratch.tree, target: '/workspace', mode: 'ro' }, others: [{ source: scratch.config, target: SCAN_CONFIG, mode: 'ro' }] },
      egress: { mode: 'deny-all', allow: [] },
      limits: options.limits === null ? { cpus: 0, memoryMb: 0, pids: 0, wallClockMs: check.timeoutMs } : { ...options.limits, wallClockMs: check.timeoutMs },
      user: { ...options.user },
    };
    let handle: SandboxHandle;
    try {
      handle = await sandbox.provision(spec);
    } catch (error) {
      return { ok: false, at: 'provision', reason: `its sandbox could not be provisioned: ${describe(error)}` };
    }
    let outcome: { ok: true; result: CheckResult } | { ok: false; reason: string };
    let egress: EgressLog;
    try {
      const startedAt = new Date().toISOString();
      try {
        // A scanner writes caches under its home; the container's own is not the runtime's to assume writable.
        const exec = await sandbox.exec(handle, [...scanner.invocation(`${SCAN_CONFIG}/${scanner.configFile}`)], { env: { HOME: '/tmp' } });
        const findings = scanner.completed.includes(exec.exitCode) ? scanner.parse(exec.stdout) ?? null : null;
        outcome = {
          ok: true,
          result: {
            checkId: check.id,
            exitCode: exec.exitCode,
            stdout: renderFindings(findings),
            stderr: exec.stderr,
            suiteCount: null,
            expectation: null,
            findings,
            durationMs: exec.durationMs,
            startedAt,
          },
        };
      } catch (error) {
        outcome = { ok: false, reason: describe(error) };
      }
    } finally {
      // Read after the scan whatever it did, so the caller records it (D-P14-04).
      ({ egress } = await sandbox.destroy(handle));
    }
    return outcome.ok ? { ok: true, result: outcome.result, egress } : { ok: false, at: 'exec', reason: outcome.reason, egress };
  } finally {
    await rm(scratch.dir, { recursive: true, force: true });
  }
}
