/**
 * The start-up check of the model key (R55, #176). A host that listens with a
 * key the provider rejects admits a run and then fails every attempt of it
 * until it parks. So start-up asks the provider once, with a request that
 * spends nothing, and the host listens only if the provider accepted the key
 * (I5): a rejected key refuses, and so does a check that could not be made.
 *
 * The origin and the header are the relay's own (`MODEL_RELAY`), so the key
 * is checked against the provider the relay will send it to. Nothing in the
 * environment turns the check off or points it elsewhere.
 */
import { KEY_VARIABLE, MODEL_RELAY } from '@olympus-ai/driver-claude-code';

/** The relay's provider. A relay to a local upstream would have no provider to ask, and the host does not load. */
function providerOrigin(): string {
  if (typeof MODEL_RELAY.upstream !== 'string') throw new Error('factory-host: the model relay names a local upstream, so there is no provider to check the model key with');
  return MODEL_RELAY.upstream;
}

/** The one request: a list of models, one entry long. A `GET`, which the provider does not bill. */
export const MODEL_KEY_PROBE_URL = `${providerOrigin()}/v1/models?limit=1`;

/** The API version the request names; the provider refuses a request that names none. */
const API_VERSION = '2023-06-01';

/** How long the provider has to answer before the key counts as unchecked. */
export const MODEL_KEY_PROBE_TIMEOUT_MS = 10_000;

/** A key's check: null when the provider accepted it, or the line start-up lists. */
export type KeyProbe = (key: string) => Promise<string | null>;

/** What went wrong reaching the provider, as a code or an error's name: never its message, which is not ours to print. */
function failure(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  if (typeof cause?.code === 'string') return cause.code;
  return error instanceof Error ? error.name : 'unknown error';
}

/**
 * Asks the provider whether it accepts `key`. Null only for a 2xx answer.
 * Neither line holds the key or anything the provider sent but its status.
 * A redirect is an error rather than followed, so the key goes to the one
 * origin named here.
 */
export async function probeModelKey(key: string, request: typeof fetch = (input, init) => fetch(input, init)): Promise<string | null> {
  const host = new URL(MODEL_KEY_PROBE_URL).host;
  let status: number;
  try {
    const response = await request(MODEL_KEY_PROBE_URL, {
      method: 'GET',
      headers: { [MODEL_RELAY.header]: key, 'anthropic-version': API_VERSION },
      redirect: 'error',
      signal: AbortSignal.timeout(MODEL_KEY_PROBE_TIMEOUT_MS),
    });
    status = response.status;
    // The body is not read: only the status decides, and nothing of it is printed.
    await response.body?.cancel();
  } catch (error) {
    return `${KEY_VARIABLE} could not be checked: ${host} could not be reached (${failure(error)}); the host does not start on a key it could not check`;
  }
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return `${KEY_VARIABLE} was rejected by ${host} (${String(status)}): every model call would fail, so set a key the provider accepts`;
  return `${KEY_VARIABLE} could not be checked: ${host} answered ${String(status)}; the host does not start on a key it could not check`;
}
