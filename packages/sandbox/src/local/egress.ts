/**
 * The egress policy, checked before any container starts.
 *
 * `deny-all` is `--network none`, which the kernel enforces. `allowlist` is a
 * filtering proxy the container's only route out passes through (`proxy.ts`),
 * and this module is the gate in front of it: every entry the proxy will be
 * asked to match must be a single host it *can* match exactly, or the
 * provision is refused. A proxy that matched an entry it did not understand —
 * a wildcard read as a literal, a URL read as a hostname — would grant
 * something the policy did not, or deny something it did, and either is the
 * silent degrade I5 forbids.
 *
 * D-P3-08 deferred the hostname grammar to "whichever unit can actually
 * enforce an allowlist". This is that unit, and this is that grammar.
 */
import { refuse } from './refusal.js';
import type { EgressPolicy } from '../types.js';

/** The longest a DNS name may be, in the presentation form this list is written in. */
const MAX_HOST_LENGTH = 253;

/** One DNS label: letters, digits, and interior hyphens. Deliberately no underscore and no leading digit rule — the resolver's, not ours. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

/** A dotted quad, each octet 0–255 and written without leading zeros, so `01.1.1.1` is not quietly a different address than `1.1.1.1`. */
const IPV4_OCTET = /^(?:0|[1-9][0-9]?|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/u;

/** The characters an IPv6 literal is written from. The exact form is the resolver's business; what matters here is that nothing else hides in the entry. */
const IPV6_CHARS = /^[0-9a-f:]+$/u;

function isIpv4(value: string): boolean {
  const octets = value.split('.');
  return octets.length === 4 && octets.every((octet) => IPV4_OCTET.test(octet));
}

/**
 * An IPv6 literal, bare rather than bracketed: the brackets belong to the
 * authority form a URL is written in, not to the address, and an allowlist
 * entry names an address.
 */
function isIpv6(value: string): boolean {
  return value.includes(':') && IPV6_CHARS.test(value) && !value.includes(':::');
}

function isHostname(value: string): boolean {
  if (value.length > MAX_HOST_LENGTH) return false;
  const labels = value.split('.');
  return labels.length > 0 && labels.every((label) => label.length > 0 && label.length <= 63 && LABEL.test(label));
}

/**
 * One host, as the proxy will match it: lower-cased, with no scheme, no port,
 * no path, no wildcard, and no whitespace. Returns the normalised form, or
 * undefined when the entry is not a single host.
 *
 * Normalisation is case only. Nothing here strips a scheme or a port and
 * carries on: an entry that carries one was written to mean something this
 * list cannot express, and repairing it would substitute a host the author
 * did not write.
 */
export function normalizeHost(entry: string): string | undefined {
  const host = entry.trim().toLowerCase();
  if (host === '' || host !== entry.toLowerCase()) return undefined;
  if (isIpv4(host) || isIpv6(host)) return host;
  return isHostname(host) ? host : undefined;
}

/**
 * The allowlist as the proxy will hold it: each entry a single host, no
 * duplicates, in the order it was written.
 *
 * Refuses rather than filters. A list that came back shorter than it went in
 * would be an allowlist the caller never wrote, and the entry that vanished is
 * exactly the one somebody would later look for and not find.
 */
export function allowedHosts(allow: readonly string[]): readonly string[] {
  const rejected: string[] = [];
  const hosts: string[] = [];
  for (const entry of allow) {
    const host = normalizeHost(entry);
    if (host === undefined) {
      rejected.push(JSON.stringify(entry));
      continue;
    }
    if (!hosts.includes(host)) hosts.push(host);
  }
  if (rejected.length > 0) {
    refuse(
      'egress',
      `egress.allow must name single hosts the proxy can match exactly — a hostname, an IPv4 address, or an IPv6 address, ` +
        `with no scheme, port, path, wildcard, or whitespace. Refused: ${rejected.join(', ')}. ` +
        'An entry the proxy cannot match is a grant it cannot honour, and applying it anyway would allow or deny a host nobody wrote.',
    );
  }
  return hosts;
}

/**
 * What the provider must apply for this policy. `deny-all` needs no proxy;
 * `allowlist` carries the hosts the proxy will open a connection to.
 *
 * There is no third answer and no partial one: a policy this provider cannot
 * apply exactly as written is refused here, before a container exists (I5).
 */
export type EgressPlan =
  | { readonly mode: 'deny-all' }
  | { readonly mode: 'allowlist'; readonly hosts: readonly string[] };

/**
 * `deny-all` is `--network none`: a loopback interface and nothing else, which
 * the kernel enforces. `allowlist` is an internal network whose only route out
 * is the filtering proxy, so a container on it reaches the named hosts through
 * the proxy and has no route to anything else at all.
 *
 * Each mode refuses the other's contradiction. A `deny-all` carrying `allow`
 * entries does not say what it wants, and an `allowlist` with none says it
 * wants an allowlist of nothing — which is deny-all wearing the wrong name.
 * Reading either as the other is a guess, and a guess about the network a
 * model can reach is the guess I5 exists to refuse.
 */
export function checkEgress(egress: EgressPolicy): EgressPlan {
  if (egress.mode === 'deny-all') {
    if (egress.allow.length > 0) {
      refuse('egress', `egress.mode is deny-all but ${String(egress.allow.length)} allow entries are set; the policy contradicts itself and is refused rather than half-applied`);
    }
    return { mode: 'deny-all' };
  }
  if (egress.allow.length === 0) {
    refuse(
      'egress',
      'egress.mode is allowlist but allow is empty. An empty allowlist is refused rather than read as deny-all or as ' +
        'allow-all: a caller that wanted no egress asks for deny-all, and a caller that asked for an allowlist and named ' +
        'nothing has not finished writing the policy. This is the rule validateToolGrants follows for an empty inventory.',
    );
  }
  return { mode: 'allowlist', hosts: allowedHosts(egress.allow) };
}
