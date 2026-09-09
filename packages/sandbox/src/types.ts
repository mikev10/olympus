/**
 * Sandbox: the ephemeral, agent-writable execution substrate. The mount table
 * is where I1 is physically enforced.
 */
export type SandboxHandle = string & { readonly __brand: 'SandboxHandle' };

export interface MountEntry {
  source: string;
  target: string;
  mode: 'ro' | 'rw';
}

/**
 * I1 enforced at the substrate: at most one rw mount, and if there is one, it
 * is the Workspace. `others` admits ro only, so a second rw mount has no slot;
 * the Workspace itself is rw for build and ro for verification, so the checks
 * run against a tree they cannot modify (I3). Implementations MUST reject
 * every table that violates this, MUST mount the Workspace with the mode the
 * table gives it, and MUST resolve symlinks and path escapes before mounting.
 */
export interface MountTable {
  workspace: MountEntry & { mode: 'rw' | 'ro' };
  readonly others: Array<MountEntry & { mode: 'ro' }>;
}

export interface EgressPolicy { mode: 'deny-all' | 'allowlist'; allow: string[]; }

export interface SandboxSpec {
  image: string;
  mounts: MountTable;
  egress: EgressPolicy;
  limits: { cpus: number; memoryMb: number; pids: number; wallClockMs: number };
}

export interface ExecResult { exitCode: number; stdout: string; stderr: string; durationMs: number; }

/**
 * I8: every capability claimed here needs an executable conformance assertion
 * (packages/conformance) that fails when the capability is removed.
 */
export interface SandboxCapabilities {
  computerUse: boolean; gpu: boolean; os: 'linux' | 'macos'; persistent: boolean; remote: boolean;
}

/**
 * M1 implements a local Docker provider only. Remote workers and pools arrive
 * later behind this same interface.
 */
export interface SandboxProvider {
  readonly id: string;
  provision(spec: SandboxSpec): Promise<SandboxHandle>;
  exec(h: SandboxHandle, cmd: string[]): Promise<ExecResult>;
  destroy(h: SandboxHandle): Promise<void>;
  capabilities(): SandboxCapabilities;
}
