/**
 * Security at the gate (R17): the spec's security part, the scanners a graph
 * runs, and the rules that turn a security check's result, the base's
 * findings, and the diff's suppression markers into a gate outcome, in the
 * runtime's terms alone (I2). Each rule is exported so it is assertable
 * without a run.
 */
import {
  newFindings,
  SECRET_SCANNER,
  STAND_IN_SECRET_SCANNER,
  STAND_IN_STATIC_ANALYSIS_SCANNER,
  STATIC_ANALYSIS_SCANNER,
  type SecurityScanner,
} from '@olympus-ai/adapters';
import type { FailedCheck, StationRefusal } from '@olympus-ai/core';
import type { CheckResult, CheckSpec, Finding, SecurityCheckKind, SecurityCheckSpec, TamperReport } from '@olympus-ai/integrity';
import type { RequestProblem } from './validate.js';

/** The scanners a graph runs a security check with, by kind. */
export interface SecurityScanners {
  readonly secretScan: SecurityScanner;
  /** The static-analysis scanner a stack with one is given; the adapter set decides whether the stack has one. */
  readonly staticAnalysis: SecurityScanner;
}

/** The scanners the graph builder attests. Any other is a stand-in, and no run on it goes above L1. */
export const SCANNERS: SecurityScanners = Object.freeze({ secretScan: SECRET_SCANNER, staticAnalysis: STATIC_ANALYSIS_SCANNER });

/** The stand-in scanners, for a graph over a sandbox that runs no image. The graph builder declares them unsafe, so no run on them goes above L1. */
export const STAND_IN_SCANNERS: SecurityScanners = Object.freeze({ secretScan: STAND_IN_SECRET_SCANNER, staticAnalysis: STAND_IN_STATIC_ANALYSIS_SCANNER });

export function isSecurityCheck(check: CheckSpec): check is SecurityCheckSpec {
  return check.kind === 'secret-scan' || check.kind === 'static-analysis';
}

/** The scanner a security check runs: the one its kind is declared for. Admission refused any other image. */
export function scannerFor(kind: SecurityCheckKind, scanners: SecurityScanners): SecurityScanner {
  return kind === 'secret-scan' ? scanners.secretScan : scanners.staticAnalysis;
}

/** An authorization rule a change adds or relies on, by the id a denial check names. */
export interface AuthorizationRule {
  readonly id: string;
  readonly rule: string;
}

/**
 * What a spec says about its security surface (R17). `none` with one line
 * of reason is a valid answer, read by the person at the `spec` exit; any
 * other answer names every field, each list possibly empty.
 */
export type SecurityPart =
  | { readonly none: string }
  | {
    readonly trustBoundaries: readonly string[];
    readonly sensitiveData: readonly string[];
    readonly authorizationRules: readonly AuthorizationRule[];
    readonly secrets: readonly string[];
  };

const PART_LISTS = ['trustBoundaries', 'sensitiveData', 'secrets'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** The security part, or the problems that keep it from being one. */
export function parseSecurityPart(value: unknown): { ok: true; part: SecurityPart } | { ok: false; problems: RequestProblem[] } {
  const at = 'artifacts.specParts.security';
  const problems: RequestProblem[] = [];
  const report = (path: string, message: string): void => {
    problems.push({ path, code: 'not-a-security-part', message });
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    report(at, `${at} must be a JSON object: { "none": reason } or every field the part requires`);
    return { ok: false, problems };
  }
  const v = value as Record<string, unknown>;
  if ('none' in v) {
    if (!isNonEmptyString(v.none)) report(`${at}.none`, `${at}.none must say in one line why the change has no security surface`);
    const others = Object.keys(v).filter((key) => key !== 'none');
    if (others.length > 0) report(at, `${at} answers none and also names ${others.join(', ')}; it is one answer or the other`);
    return problems.length > 0 ? { ok: false, problems } : { ok: true, part: { none: v.none as string } };
  }
  for (const list of PART_LISTS) {
    const entries = v[list];
    if (!Array.isArray(entries) || !entries.every(isNonEmptyString)) report(`${at}.${list}`, `${at}.${list} must be a list of non-empty strings, empty if there are none`);
  }
  const rules = v.authorizationRules;
  const seen = new Set<string>();
  if (!Array.isArray(rules)) report(`${at}.authorizationRules`, `${at}.authorizationRules must be a list of { id, rule }, empty if there are none`);
  else {
    rules.forEach((rule: unknown, i) => {
      const one = `${at}.authorizationRules[${String(i)}]`;
      const r = (typeof rule === 'object' && rule !== null ? rule : {}) as Record<string, unknown>;
      if (!isNonEmptyString(r.id) || !isNonEmptyString(r.rule)) report(one, `${one} must name an id and the rule it states`);
      else if (seen.has(r.id)) report(`${one}.id`, `${one}.id '${r.id}' is listed twice; a denial check names exactly one rule`);
      else seen.add(r.id);
    });
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    part: {
      trustBoundaries: [...(v.trustBoundaries as string[])],
      sensitiveData: [...(v.sensitiveData as string[])],
      authorizationRules: (rules as AuthorizationRule[]).map((r) => ({ id: r.id, rule: r.rule })),
      secrets: [...(v.secrets as string[])],
    },
  };
}

/** The refusal of the `spec` exit for a spec admitted without its security part. */
export function specPartRefusal(part: SecurityPart | null): StationRefusal | undefined {
  if (part !== null) return undefined;
  return {
    ok: false,
    reason: 'spec-part-missing',
    part: 'security',
    message: 'the spec carries no security part; every spec states the trust boundaries, data, authorization rules, and secrets it touches, or none with its reason',
  };
}

/**
 * The refusal of the `test-design` exit for each authorization rule the
 * security part names that no locked acceptance or behavioral check names
 * as the rule it denies.
 */
export function denialRefusal(part: SecurityPart | null, checks: readonly CheckSpec[]): StationRefusal | undefined {
  if (part === null || 'none' in part) return undefined;
  const denied = new Set(checks.flatMap((c) => (c.kind === 'acceptance' || c.kind === 'behavioral') && c.deniesRule !== undefined ? [c.deniesRule] : []));
  const [first, ...rest] = part.authorizationRules.map((r) => r.id).filter((id) => !denied.has(id));
  if (first === undefined) return undefined;
  const rules: [string, ...string[]] = [first, ...rest];
  return {
    ok: false,
    reason: 'denial-check-missing',
    rules,
    message: `no locked check exercises a caller refused by ${rules.join(', ')}; each authorization rule the security part names needs a check that names it in deniesRule`,
  };
}

/**
 * Why a security check fails the gate, or undefined when it does not. A
 * marker the diff added fails it whatever the scanner found, since a
 * suppressed finding is never a passing one. A report that could not be read
 * is no result, and an exit outside the scanner's completed codes is an
 * error, never a clean scan (I5). Otherwise only a finding the base's result
 * does not account for fails it (D-A-SC-02).
 */
export function securityShortfall(
  check: SecurityCheckSpec,
  result: CheckResult | undefined,
  base: readonly Finding[],
  scanner: SecurityScanner,
  tamper: Pick<TamperReport, 'suppressionMarkersAdded'>,
): FailedCheck | undefined {
  if (tamper.suppressionMarkersAdded.some((m) => m.kind === check.kind)) {
    return { checkId: check.id, exitCode: result?.exitCode ?? null, cause: 'suppression-added' };
  }
  if (result === undefined) return { checkId: check.id, exitCode: null, cause: 'no-result' };
  if (!scanner.completed.includes(result.exitCode)) return { checkId: check.id, exitCode: result.exitCode, cause: 'exit-code' };
  if (result.findings === null) return { checkId: check.id, exitCode: result.exitCode, cause: 'no-result' };
  if (newFindings(base, result.findings).length > 0) return { checkId: check.id, exitCode: result.exitCode, cause: 'new-finding' };
  return undefined;
}

/**
 * What a security check's stored stdout is: the runtime's rendering of its
 * findings, never the scanner's own output, which carries a secret's value
 * (D-R17-02).
 */
export function renderFindings(findings: readonly Finding[] | null): string {
  if (findings === null) return 'the scanner wrote no report the runtime could read\n';
  return `${JSON.stringify(findings.map((f) => ({ rule: f.rule, path: f.location.path, line: f.location.line, fingerprint: f.fingerprint })), null, 2)}\n`;
}
