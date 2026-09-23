import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fresh pair of scratch directories for one Codex run: a config home holding
 * only a copied credential, and a work dir. The work dir starts (and, for
 * Codex, stays) empty — the bundle is inlined on stdin, not written as a file
 * for the CLI to read, so there is nothing for the sandbox to be asked to open
 * and nothing to leave behind. `root` is the shared parent both live under, so
 * a single `removeScratch` call can take the whole thing with it.
 */
export interface CodexScratch {
  readonly root: string;
  readonly configHome: string;
  readonly workDir: string;
}

/**
 * Builds the scratch pair and copies `authJsonSource` in as the config home's
 * only file. Codex's real `~/.codex` also holds `memories_1.sqlite`,
 * `thread_history_1.sqlite`, `goals_1.sqlite` and `archived_sessions/` — a
 * reviewer reached through it could carry memory of the author's prior
 * conversations, so the scratch config home is built to hold nothing else.
 */
export function buildCodexScratch(authJsonSource: string): CodexScratch {
  const root = mkdtempSync(join(tmpdir(), 'olympus-codex-scratch-'));
  const configHome = join(root, 'config');
  const workDir = join(root, 'work');
  try {
    mkdirSync(configHome, { recursive: true });
    mkdirSync(workDir, { recursive: true });
    copyFileSync(authJsonSource, join(configHome, 'auth.json'));
  } catch (err) {
    // The caller never receives `root` from a throw, so only this function can
    // remove it, and a failed or partial copy may hold the credential.
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
  return { root, configHome, workDir };
}

/**
 * Every file under `root`, recursively, as a path relative to `root`. Always
 * forward-slash-joined regardless of platform: this is the function Task 4's
 * review assigned separator normalisation to, so `assertCleanRoom`'s allowlists
 * can be written once and compared literally on Windows and Linux alike.
 */
export function listRecursive(root: string): readonly string[] {
  const out: string[] = [];
  walk(root, '');
  return out.sort();

  function walk(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, relPath);
      } else {
        out.push(relPath);
      }
    }
  }
}

/** Deletes the scratch pair's shared root, config home and work dir with it. */
export function removeScratch(scratch: CodexScratch): void {
  rmSync(scratch.root, { recursive: true, force: true });
}
