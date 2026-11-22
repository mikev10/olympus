/**
 * Docker labels a caller asks the local provider to put on every container
 * and network it creates (#19, D-R39-05). A label is how what a provider made
 * is found after the process that made it is gone: a run killed before its
 * teardown leaves objects nothing else can tell from a neighbour's.
 *
 * Checked once, at `create`, before a daemon is asked to make anything. A key
 * outside Docker's lower-case reverse-DNS form, one under a prefix Docker
 * reserves, or a value with a control character is refused (I5), never
 * dropped or rewritten.
 */
import { refuse } from './refusal.js';

const KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/u;
const RESERVED = ['com.docker.', 'io.docker.', 'org.dockerproject.'];
// eslint-disable-next-line no-control-regex -- the control characters are what is refused
const CONTROL = /[\u0000-\u001f\u007f]/u;

/** The `--label key=value` arguments for `labels`, in key order; empty when there are none. */
export function labelArgs(labels: Readonly<Record<string, string>> | undefined): readonly string[] {
  if (labels === undefined) return [];
  const args: string[] = [];
  for (const key of Object.keys(labels).sort()) {
    const value = labels[key];
    if (!KEY.test(key)) refuse('labels', `the label key ${JSON.stringify(key)} is not lower-case letters, digits, dots, and interior hyphens`);
    if (RESERVED.some((prefix) => key.startsWith(prefix))) refuse('labels', `the label key ${JSON.stringify(key)} is under a prefix Docker reserves`);
    if (typeof value !== 'string' || CONTROL.test(value)) refuse('labels', `the label ${key} has a value that is not text without control characters`);
    args.push('--label', `${key}=${value}`);
  }
  return Object.freeze(args);
}
