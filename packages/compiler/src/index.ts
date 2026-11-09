/**
 * The role compiler (R20): turns the roles directory a person wrote into the
 * `CompiledRole`s admission pins, each versioned by the SHA-256 of its file.
 * Depends on core's published types and nothing else.
 */
import { fileURLToPath } from 'node:url';

export {
  compileRoles,
  isRoleId,
  ROLE_FILE_MAX_BYTES,
  type RoleCompilation,
  type RoleFileCode,
  type RoleFileRefusal,
} from './compile.js';
export {
  readRepoInstructions,
  REPO_INSTRUCTION_FILE_MAX_BYTES,
  REPO_INSTRUCTIONS_MAX_BYTES,
  splitFrontMatter,
  type ReadInstructionFile,
  type RepoInstructionCode,
  type RepoInstructionRead,
  type RepoInstructionRefusal,
} from './instructions.js';

/**
 * The roles shipped with the runtime: `builder`, `reviewer`, `security-reviewer`,
 * and the four drafting seats R19 adds (`spec-drafter`, `spec-critic`,
 * `test-drafter`, `test-critic`). `builder` is the seat at `build`, and
 * `reviewer` and `security-reviewer` the two review seats (R9), and
 * `findings-reviewer` the nightly seat over a day's records (R13b). A service is configured with a roles directory
 * as it is with a policy file; this is one it can be pointed at.
 */
export const DEFAULT_ROLES_DIRECTORY: string = fileURLToPath(new URL('../roles/', import.meta.url));
