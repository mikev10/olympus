/**
 * R55 (#175): a person asked to approve a draft can read it. The CLI, as its
 * own process given only a URL and a token, prints the draft waiting at a
 * station; the bytes it prints are the bytes the hash `status` names covers;
 * and the service refuses, rather than shows, a draft whose stored bytes no
 * longer hash to that hash (I9, I5, I3).
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { DraftView, RunView } from '@olympus-ai/api';
import type { VaultRef } from '@olympus-ai/core';
import type { DraftRecord, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { admitAndDrive, awaiting, drafting, helloSpec, lastAttempt } from './drafting.js';
import { cli } from './headless.js';
import { withLine } from './line.js';

const api = async () => import('@olympus-ai/api');

const TOKEN = 'conformance-draft-read-token-0123456789';

/** A Vault that returns one record with a file's bytes changed and every recorded hash left as it was. */
function withChangedBytes(vault: Vault, ref: VaultRef): Vault {
  return new Proxy(vault, {
    get(target, name, receiver) {
      const value: unknown = Reflect.get(target, name, receiver);
      if (name !== 'read' || typeof value !== 'function') return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      return async (asked: VaultRef): Promise<Uint8Array> => {
        const bytes = await target.read(asked);
        if (asked.kind !== ref.kind || asked.hash !== ref.hash) return bytes;
        const record = JSON.parse(new TextDecoder().decode(bytes)) as DraftRecord;
        const [first, ...rest] = record.files;
        if (first === undefined) throw new Error('R55 control: the draft recorded holds no file');
        const changed = { ...record, files: [{ ...first, base64: Buffer.from('bytes nobody hashed').toString('base64') }, ...rest] };
        return new TextEncoder().encode(JSON.stringify(changed));
      };
    },
  });
}

export const DRAFT_IS_READ_THROUGH_THE_API: LocalAssertion = runtime({
  id: 'I9.draft-is-read-through-the-api',
  title:
    "the CLI, a separate process given only a URL and a token, prints the draft waiting at a station: the hash status names, the key it waits at, and every line of every file; " +
    "the bytes the API returns hash to that hash; a station that drafts nothing, a station with no draft, and a request with no token are refused; " +
    'and a draft whose stored bytes no longer hash to the recorded hash is refused with none of them printed (R55, #175)',
  run: async () => {
    await withLine('r55-draft-', async (rig) => {
      const { createApiServer } = await api();
      const { draftDigest } = await import('@olympus-ai/vault');
      const r = await drafting(rig);
      awaiting(await admitAndDrive(r), 'spec:1', 'a drafted spec');
      const attempt = lastAttempt(await rig.state(), 'spec');
      if (attempt.sha256 === null || attempt.draft === null) throw new Error('R55 control: the spec attempt recorded no draft');
      const hash = attempt.sha256;
      const components = await r.components();
      const options = { token: TOKEN, principal: 'conformance', policyFile: join(rig.roles, '..', 'no-policy.yaml'), rolesDirectory: rig.roles };
      const server = createApiServer({ ...options, components });
      const url = await server.listen(0, '127.0.0.1');
      try {
        const remote = ['--url', url, '--token', TOKEN];
        const get = async (path: string, token: string | null = TOKEN): Promise<Response> => fetch(`${url}/${path}`, token === null ? {} : { headers: { authorization: `Bearer ${token}` } });

        // What status names is what the route returns, and its bytes hash to it.
        const status = (await (await get(`runs/${rig.runId}`)).json()) as RunView;
        const named = status.standing.standing === 'awaiting-approval' ? status.standing.draft?.draft.sha256 : undefined;
        if (named !== hash) throw new Error(`R55 control: status names the draft ${String(named)}, not the one drafted`);
        const view = (await (await get(`runs/${rig.runId}/draft?station=spec`)).json()) as DraftView;
        if (view.draft.sha256 !== named || view.awaiting !== 'spec:1') throw new Error(`I9: the route returned the draft ${view.draft.sha256} waiting at ${String(view.awaiting)}, not the one status names at spec:1`);
        for (const file of view.files) {
          if (createHash('sha256').update(Buffer.from(file.base64, 'base64')).digest('hex') !== file.sha256) throw new Error(`I3: the bytes returned for ${file.path} do not hash to its hash`);
        }
        if (draftDigest(view.files) !== named) throw new Error('I3: the files returned do not hash to the hash an approval names');
        if (view.questions.kind !== 'read') throw new Error(`I9: the questions part was returned as ${view.questions.kind}`);

        // The CLI prints it: one process, one URL, one token.
        const shown = await cli(['draft', rig.runId, 'spec', ...remote]);
        if (shown.code !== 0) throw new Error(`I9: the CLI's draft command exited ${String(shown.code)}\n${shown.stderr}`);
        const printed = shown.stdout.split(/\r?\n/u);
        if (!printed.includes(`hash ${hash}`)) throw new Error(`I9: the CLI did not print the draft's hash\n${shown.stdout}`);
        if (!printed.some((line) => line.startsWith('waiting for a decision at spec:1') && line.endsWith(`--draft ${hash}`))) throw new Error(`I9: the CLI did not say the draft is waiting at spec:1\n${shown.stdout}`);
        for (const [path, text] of Object.entries(helloSpec(rig.runId))) {
          if (!printed.some((line) => line.startsWith(`file ${path} (`))) throw new Error(`I9: the CLI printed no header for ${path}\n${shown.stdout}`);
          for (const line of text.split('\n').filter((l) => l !== '')) {
            if (!printed.includes(`| ${line}`)) throw new Error(`I9: the CLI did not print this line of ${path}: ${line}\n${shown.stdout}`);
          }
        }
        if (!printed.some((line) => line.startsWith('open questions:'))) throw new Error(`I9: the CLI printed no questions\n${shown.stdout}`);

        // Refusals: a station that drafts nothing, one with no draft yet, and no token.
        const notDrafting = await cli(['draft', rig.runId, 'build', ...remote]);
        if (notDrafting.code !== 1 || !notDrafting.stderr.includes('error 400') || notDrafting.stdout !== '') throw new Error(`I9: a draft asked for at build was not refused as a bad request\n${notDrafting.stderr}`);
        const none = await cli(['draft', rig.runId, 'test-design', ...remote]);
        if (none.code !== 1 || !none.stderr.includes('error 404') || none.stdout !== '') throw new Error(`I9: a station with no draft was not refused as not found\n${none.stderr}`);
        const anonymous = await get(`runs/${rig.runId}/draft?station=spec`, null);
        if (anonymous.status !== 401) throw new Error(`I9: the draft was returned to a request with no token (${String(anonymous.status)})`);
      } finally {
        await server.close();
      }

      // Bytes that no longer hash to the recorded hash are refused, and none is printed.
      const tampered = createApiServer({ ...options, components: { ...components, vault: withChangedBytes(components.vault, attempt.draft) } });
      const tamperedUrl = await tampered.listen(0, '127.0.0.1');
      try {
        const refused = await cli(['draft', rig.runId, 'spec', '--url', tamperedUrl, '--token', TOKEN]);
        if (refused.code !== 1 || !refused.stderr.includes('error 500') || !refused.stderr.includes('refused, not shown')) throw new Error(`I5: a draft whose bytes were changed was not refused\n${refused.stdout}\n${refused.stderr}`);
        if (refused.stdout !== '' || refused.stderr.includes('nobody hashed')) throw new Error(`I5: bytes that do not hash to the draft's hash were printed\n${refused.stdout}`);
      } finally {
        await tampered.close();
      }
    });
  },
});

export const R55_I9: readonly LocalAssertion[] = [DRAFT_IS_READ_THROUGH_THE_API];
