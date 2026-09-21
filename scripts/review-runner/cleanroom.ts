/** Recursive relative paths actually found in each scratch directory. */
export interface CleanRoomProof {
  readonly configHome: readonly string[];
  readonly workDir: readonly string[];
}

/** Exactly what may exist. Anything else is a contaminant. */
export interface AllowedContents {
  readonly configFiles: readonly string[];
  readonly workFiles: readonly string[];
}

export class CleanRoomError extends Error {}

/**
 * Default deny, in both directions. Neither CLI is isolated by working
 * directory — Codex loads ~/.codex/AGENTS.md and Gemini loads ~/.gemini/GEMINI.md
 * regardless of cwd, and no documented flag suppresses either. So the clean room
 * is established by construction and proved by listing, and this function is the
 * proof step: every file present must be allowed, and every allowed file must be
 * present. A missing credential would hang the CLI on a login prompt; a missing
 * bundle would review nothing.
 */
export function assertCleanRoom(proof: CleanRoomProof, allowed: AllowedContents): void {
  const problems: string[] = [];

  for (const path of proof.configHome) {
    if (!allowed.configFiles.includes(path)) {
      problems.push(`config home holds unexpected "${path}"`);
    }
  }
  for (const path of proof.workDir) {
    if (!allowed.workFiles.includes(path)) {
      problems.push(`work dir holds unexpected "${path}"`);
    }
  }
  for (const path of allowed.configFiles) {
    if (!proof.configHome.includes(path)) {
      problems.push(`config home is missing required "${path}"`);
    }
  }
  for (const path of allowed.workFiles) {
    if (!proof.workDir.includes(path)) {
      problems.push(`work dir is missing required bundle "${path}"`);
    }
  }

  if (problems.length > 0) {
    throw new CleanRoomError(`clean room not established:\n  ${problems.join('\n  ')}`);
  }
}
