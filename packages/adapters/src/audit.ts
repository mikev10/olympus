/**
 * The dependency audits the nightly sweep runs (R13a, D-R13a-06). Each is
 * declared once, here: the stack, the root files it reads, the image it is
 * pinned to, the arguments, and how its report becomes findings. A policy
 * names the one host its sandbox may reach and nothing else about it
 * (D-A-NR-04, D-A-NR-08).
 *
 * A report is read only when it is whole. An output that is not one, which
 * is what an unreachable advisory host produces, is never an empty list
 * (I5).
 */
import { createHash } from 'node:crypto';
import type { AuditFinding, AuditStack, DependencyAuditor } from './types.js';

/** `node:22-bookworm-slim`, by digest: Node 22.23.2 and npm 10.9.8, the image the drivers are built from. */
export const DEPENDENCY_AUDIT_IMAGE = 'node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5';

/** The pnpm an audit runs, by exact version: corepack would otherwise fetch the newest. */
export const PNPM_AUDIT_VERSION = '10.18.3';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function fingerprint(stack: AuditStack, rule: string, name: string): string {
  return createHash('sha256').update(`${stack}\0${rule}\0${name}`).digest('hex');
}

const GHSA = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/u;

/**
 * An advisory's id as a rule: the GHSA id it carries, extracted and never the
 * field around it, else its numeric id under a fixed prefix. A field holding
 * text beside the id yields the id alone (codex-3, gemini-4).
 */
function ruleOf(url: unknown, ghsa: unknown, id: unknown): string | undefined {
  for (const field of [ghsa, url]) {
    const match = typeof field === 'string' ? GHSA.exec(field)?.[0] : undefined;
    if (match !== undefined) return match;
  }
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? `advisory-${String(id)}` : undefined;
}

/** A failed request, as npm and pnpm print one: the request, or a network error code. */
const REQUEST_FAILED = /request to |ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|getaddrinfo|socket hang up|\b40[37]\b/u;

/** Whether an output that is not a whole report says the advisory request failed. */
function unreachable(stdout: string, parsed: unknown): boolean {
  if (isRecord(parsed) && Object.hasOwn(parsed, 'error')) return REQUEST_FAILED.test(JSON.stringify(parsed));
  return REQUEST_FAILED.test(stdout);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** The first line, 1-based, matching `pattern`; null where none does. */
function lineOf(text: string, pattern: RegExp): number | null {
  const lines = text.split(/\r?\n/u);
  const index = lines.findIndex((line) => pattern.test(line));
  return index === -1 ? null : index + 1;
}

/**
 * `npm audit --json --package-lock-only`: report version 2. Each vulnerable
 * package lists the advisories against it under `via`; a `via` that is a
 * string names another vulnerable package, which carries the advisory itself.
 */
export const NPM_AUDITOR: DependencyAuditor = Object.freeze({
  stack: 'npm',
  lockfile: 'package-lock.json',
  files: Object.freeze(['package.json', 'package-lock.json']),
  image: DEPENDENCY_AUDIT_IMAGE,
  invocation: Object.freeze(['npm', 'audit', '--json', '--package-lock-only', '--fetch-retries=0'] as const),
  parse(stdout: string, exitCode: number, lockfileText: string) {
    const parsed = parseJson(stdout);
    if (!isRecord(parsed) || Object.hasOwn(parsed, 'error') || parsed.auditReportVersion !== 2 || !isRecord(parsed.vulnerabilities) || !isRecord(parsed.metadata)) {
      return { ok: false, unreachable: unreachable(stdout, parsed) } as const;
    }
    const vulnerable = parsed.vulnerabilities;
    const findings = new Map<string, AuditFinding>();
    for (const entry of Object.values(vulnerable)) {
      if (!isRecord(entry) || !Array.isArray(entry.via)) return { ok: false, unreachable: false } as const;
      for (const via of entry.via as unknown[]) {
        // A string names another vulnerable package, which carries the advisory; one the report does not hold leaves it partial (codex-1).
        if (typeof via === 'string') {
          if (!Object.hasOwn(vulnerable, via)) return { ok: false, unreachable: false } as const;
          continue;
        }
        if (!isRecord(via) || typeof via.name !== 'string') return { ok: false, unreachable: false } as const;
        const rule = ruleOf(via.url, undefined, via.source);
        if (rule === undefined) return { ok: false, unreachable: false } as const;
        const name = via.name;
        const print = fingerprint('npm', rule, name);
        if (findings.has(print)) continue;
        const line = lineOf(lockfileText, new RegExp(`"(?:[^"]*/)?node_modules/${escape(name)}"\\s*:\\s*\\{`, 'u'));
        findings.set(print, { rule, packageName: name, line, fingerprint: print });
      }
    }
    return judged(exitCode, [...findings.values()]);
  },
});

/**
 * npm and pnpm exit 0 with nothing found and 1 with findings. Any other exit,
 * or one that disagrees with the report, is not a whole report (codex-1).
 */
function judged(exitCode: number, findings: AuditFinding[]): { readonly ok: true; readonly findings: AuditFinding[] } | { readonly ok: false; readonly unreachable: false } {
  if (exitCode !== (findings.length === 0 ? 0 : 1)) return { ok: false, unreachable: false };
  return { ok: true, findings: findings.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)) };
}

/** `pnpm audit --json`: `advisories` by id, each naming its module and the versions found. */
export const PNPM_AUDITOR: DependencyAuditor = Object.freeze({
  stack: 'pnpm',
  lockfile: 'pnpm-lock.yaml',
  files: Object.freeze(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']),
  image: DEPENDENCY_AUDIT_IMAGE,
  invocation: Object.freeze(['corepack', `pnpm@${PNPM_AUDIT_VERSION}`, 'audit', '--json'] as const),
  parse(stdout: string, exitCode: number, lockfileText: string) {
    const parsed = parseJson(stdout);
    if (!isRecord(parsed) || Object.hasOwn(parsed, 'error') || !isRecord(parsed.advisories) || !isRecord(parsed.metadata)) {
      return { ok: false, unreachable: unreachable(stdout, parsed) } as const;
    }
    const findings = new Map<string, AuditFinding>();
    for (const advisory of Object.values(parsed.advisories)) {
      if (!isRecord(advisory) || typeof advisory.module_name !== 'string' || !Array.isArray(advisory.findings)) return { ok: false, unreachable: false } as const;
      const rule = ruleOf(advisory.url, advisory.github_advisory_id, advisory.id);
      if (rule === undefined) return { ok: false, unreachable: false } as const;
      const name = advisory.module_name;
      const print = fingerprint('pnpm', rule, name);
      if (findings.has(print)) continue;
      const first: unknown = advisory.findings[0];
      const version = isRecord(first) && typeof first.version === 'string' ? first.version : null;
      const line = version === null ? null : lineOf(lockfileText, new RegExp(`^\\s+['"]?/?${escape(name)}@${escape(version)}(?:\\(.*\\))?['"]?:\\s*$`, 'u'));
      findings.set(print, { rule, packageName: name, line, fingerprint: print });
    }
    return judged(exitCode, [...findings.values()]);
  },
});

/** Every auditor, by the lockfile that selects it. */
export const AUDITORS: readonly DependencyAuditor[] = Object.freeze([NPM_AUDITOR, PNPM_AUDITOR]);

/** Lockfiles of stacks no auditor covers: a tree holding one is `unsupported-stack`, never "no lockfile" (D-R13a-06). */
export const UNSUPPORTED_LOCKFILES: readonly string[] = Object.freeze(['yarn.lock', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json']);
