/**
 * R55 (#176): the host refuses a model key its provider rejects, before it
 * listens, in the same list as every other start-up problem. A check that
 * could not be made refuses too: only an accepted key starts the host (I5).
 *
 * No request leaves this process. The provider's answers are stood in for by
 * a `fetch` the assertion passes, and by one put in the global's place for
 * the default path, so what is proven is what start-up does with each answer
 * and that start-up asks at all. That the real provider accepts a real key is
 * the paid init suite's to prove (`packages/api/test/paid/`). The installed
 * host's own refusal is in `release.ts`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';

const api = async () => import('@olympus-ai/api');

const KEY = 'sk-ant-made-up-for-the-start-up-assertion';

interface Seen { url: string; init: RequestInit | undefined }

/** A provider that answers every request with `status`, and records what it was asked. */
function answering(status: number, seen: Seen[]): typeof fetch {
  return (input, init) => {
    seen.push({ url: input instanceof Request ? input.url : String(input), init });
    return Promise.resolve(new Response('{"note":"a body start-up must not print"}', { status }));
  };
}

export const HOST_REFUSES_A_REJECTED_KEY: LocalAssertion = runtime({
  id: 'I5.host-refuses-a-rejected-key',
  title:
    "start-up asks the model provider once, with a GET that carries the key in the relay's header to the relay's origin and no body, and refuses unless the answer is a 2xx: " +
    '401 and 403 as a rejected key, any other status or no answer as a key that could not be checked, each beside the other start-up problems, naming the variable and never its value; ' +
    'an unset key is listed once and not asked about; and a caller that passes no probe gets the real one (R55, #176)',
  run: async () => {
    const { checkStartup, probeModelKey, MODEL_KEY_PROBE_URL } = await api();
    const { MODEL_RELAY } = await import('@olympus-ai/driver-claude-code');
    const dir = await mkdtemp(join(tmpdir(), 'r55-startup-'));
    const facts = { uids: true };
    const env: Record<string, string> = {
      FACTORY_API_TOKEN: 'x'.repeat(32), FACTORY_LISTEN_PORT: '7300', FACTORY_POLICY_FILE: '/p.yaml', FACTORY_ROLES_DIR: '/roles',
      FACTORY_VAULT_STORE: '/store', FACTORY_REPOSITORY: '/repo', FACTORY_TREES: join(dir, 'trees'), ANTHROPIC_API_KEY: KEY,
      FACTORY_GIT_REPOSITORY: 'o/r', FACTORY_GIT_BASE_BRANCH: 'main', FACTORY_GIT_TOKEN: 't',
    };
    try {
      // An accepted key starts, and the request is the one named.
      const seen: Seen[] = [];
      const accepted = await checkStartup(env, undefined, facts, (key) => probeModelKey(key, answering(200, seen)));
      if (!accepted.ok) throw new Error(`I5: start-up refused a key the provider accepted: ${accepted.problems.join('; ')}`);
      const [asked] = seen;
      if (seen.length !== 1 || asked === undefined) throw new Error(`I5: start-up asked the provider ${String(seen.length)} times, not once`);
      if (asked.url !== MODEL_KEY_PROBE_URL || typeof MODEL_RELAY.upstream !== 'string' || !asked.url.startsWith(`${MODEL_RELAY.upstream}/`)) throw new Error(`I5: the key was sent to ${asked.url}, not to the relay's own origin`);
      const headers = new Headers(asked.init?.headers);
      if (headers.get(MODEL_RELAY.header) !== KEY) throw new Error(`I5: the key was not sent in ${MODEL_RELAY.header}, the header the relay sends it in`);
      if ((asked.init?.method ?? 'GET') !== 'GET' || asked.init?.body != null) throw new Error('I5: the check is not a GET with no body, so it may spend');
      if (asked.init?.redirect !== 'error') throw new Error('I5: the check follows a redirect, which would carry the key to another origin');

      // Every other answer refuses, and says which kind of refusal it is.
      const refusedWith = async (probe: typeof fetch, what: string): Promise<string> => {
        const result = await checkStartup(env, undefined, facts, (key) => probeModelKey(key, probe));
        if (result.ok) throw new Error(`I5: the host would start although ${what}`);
        const [line] = result.problems;
        if (result.problems.length !== 1 || line === undefined) throw new Error(`I5: ${what}, and start-up listed ${JSON.stringify(result.problems)}`);
        if (!line.startsWith('ANTHROPIC_API_KEY ')) throw new Error(`I5: the refusal does not name the variable: ${line}`);
        if (line.includes(KEY) || line.includes('must not print')) throw new Error(`I5: the refusal prints the key or the provider's body: ${line}`);
        return line;
      };
      for (const status of [401, 403]) {
        const line = await refusedWith(answering(status, []), `the provider answered ${String(status)}`);
        if (!line.includes('was rejected') || !line.includes(String(status))) throw new Error(`I5: a ${String(status)} is not reported as a rejected key: ${line}`);
      }
      for (const status of [400, 404, 429, 500, 529]) {
        const line = await refusedWith(answering(status, []), `the provider answered ${String(status)}`);
        if (!line.includes('could not be checked') || !line.includes(String(status))) throw new Error(`I5: a ${String(status)} is not reported as a key that could not be checked: ${line}`);
      }
      const unreachable = await refusedWith(() => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), 'the provider could not be reached');
      if (!unreachable.includes('could not be checked') || !unreachable.includes('ENOTFOUND')) throw new Error(`I5: an unreachable provider is not reported as such: ${unreachable}`);

      // Beside the other problems, in one list.
      const several = await checkStartup({ ...env, FACTORY_API_TOKEN: 'short' }, undefined, facts, (key) => probeModelKey(key, answering(401, [])));
      if (several.ok || several.problems.length !== 2 || !several.problems.some((p) => p.includes('FACTORY_API_TOKEN')) || !several.problems.some((p) => p.includes('was rejected'))) {
        throw new Error(`I5: a rejected key is not listed beside the other start-up problems: ${JSON.stringify(several.ok ? [] : several.problems)}`);
      }

      // An unset key is the missing variable's line, once; there is nothing to ask the provider.
      const unasked: Seen[] = [];
      const { ANTHROPIC_API_KEY: _unset, ...without } = env;
      const missing = await checkStartup(without, undefined, facts, (key) => probeModelKey(key, answering(200, unasked)));
      if (missing.ok || unasked.length !== 0 || missing.problems.filter((p) => p.includes('ANTHROPIC_API_KEY')).length !== 1) {
        throw new Error(`I5: an unset key was not refused once, unasked: ${JSON.stringify(missing.ok ? [] : missing.problems)}`);
      }

      // No probe passed: the real one runs. The global is stood in for here, so the request goes nowhere.
      const real = globalThis.fetch;
      const byDefault: Seen[] = [];
      globalThis.fetch = answering(401, byDefault);
      try {
        const result = await checkStartup(env, undefined, facts);
        if (result.ok || !result.problems.some((p) => p.includes('was rejected'))) throw new Error('I5: start-up with no probe named does not check the key');
        if (byDefault.length !== 1 || byDefault[0]?.url !== MODEL_KEY_PROBE_URL) throw new Error(`I5: start-up's own probe asked ${JSON.stringify(byDefault.map((s) => s.url))}`);
      } finally {
        globalThis.fetch = real;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
});

export const R55_I5: readonly LocalAssertion[] = [HOST_REFUSES_A_REJECTED_KEY];
