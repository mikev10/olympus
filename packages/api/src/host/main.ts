/**
 * The `factory-host` executable: the runtime as a service over the production
 * composition. Configured from its environment and nothing else, it touches
 * no terminal (I9); a client finds it at the address it was told to listen on.
 *
 * - `FACTORY_API_TOKEN`: the local token every request must bear
 * - `FACTORY_POLICY_FILE`: the `policy.yaml` every run is admitted under
 * - `FACTORY_ROLES_DIR`: the roles directory every run's seats are compiled
 *   from, outside the repository and the trees (D-A-RC-01)
 * - `FACTORY_RUBRICS_DIR` (optional): the rubrics directory a drafting run's
 *   critics are given, outside the repository and the trees (R19). Unset, a
 *   run that drafts is refused at admission
 * - `FACTORY_VAULT_STORE`: what the Vault owns
 * - `FACTORY_REPOSITORY`: the working copy runs are admitted from
 * - `FACTORY_TREES`: where the runtime keeps each run's trees
 * - `FACTORY_LISTEN_PORT`, and `FACTORY_LISTEN_HOST` (default `127.0.0.1`)
 * - `ANTHROPIC_API_KEY`: held by the sandbox provider for its relays, given to no sandbox
 * - `FACTORY_PRINCIPAL` (default `local`): who a request bearing the token is
 * - `FACTORY_GIT_REPOSITORY` (`owner/name`), `FACTORY_GIT_BASE_BRANCH`, and
 *   `FACTORY_GIT_TOKEN`: the remote a passed run merges into, and the token
 *   that merges it, held by the host and given to no sandbox (D-I1b-06)
 * - `FACTORY_CONTAINER_UID` and `FACTORY_CONTAINER_GID`, both or neither: who
 *   sandboxes run as, required on a host with no uids (D-I1b-10)
 * - `FACTORY_ENDPOINT_CONFIG` and `FACTORY_ENDPOINT_KEY`, both or neither: a
 *   JSON file outside the repository naming an OpenAI-compatible endpoint and
 *   the seats it fills, and that endpoint's credential, held by the sandbox
 *   provider for its relays and given to no sandbox (R6, D-R6-07). A file
 *   declaring scheme `'none'`, for a local endpoint on the Docker host, comes
 *   without the key, and one given with it stops the host (R21, A-R21-04)
 *
 * - `FACTORY_WEBHOOK_*`: each subscription's secret, named by the policy and
 *   read here on the host, never by a sandbox (D-A-TF-05). A subscription
 *   whose variable is unset verifies no delivery (I5)
 *
 * A missing variable stops the host before it listens (I5).
 */
import { WEBHOOK_SECRET_PREFIX } from '@olympus-ai/core';
import { createApiServer } from '../http/server.js';
import { readFile } from 'node:fs/promises';
import { composeHost, containerUser, parseEndpointFile } from './compose.js';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`factory-host: ${name} is not set`);
  return value;
}

const port = Number(required('FACTORY_LISTEN_PORT'));
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('factory-host: FACTORY_LISTEN_PORT is not a port');

const user = containerUser(process.env);
const endpointFile = process.env.FACTORY_ENDPOINT_CONFIG ?? '';
const endpointKey = process.env.FACTORY_ENDPOINT_KEY ?? '';
// A key with no file is half a configuration. A file with no key is the file's to allow: only one declaring scheme 'none' does.
if (endpointFile === '' && endpointKey !== '') {
  throw new Error('factory-host: FACTORY_ENDPOINT_KEY is set without FACTORY_ENDPOINT_CONFIG');
}
const endpoint = endpointFile === '' ? null : parseEndpointFile(await readFile(endpointFile, 'utf8'), endpointKey);
const components = await composeHost({
  ...(user === undefined ? {} : { containerUser: user }),
  endpoint,
  store: required('FACTORY_VAULT_STORE'),
  repository: required('FACTORY_REPOSITORY'),
  trees: required('FACTORY_TREES'),
  modelKey: required('ANTHROPIC_API_KEY'),
  git: {
    repository: required('FACTORY_GIT_REPOSITORY'),
    baseBranch: required('FACTORY_GIT_BASE_BRANCH'),
    token: required('FACTORY_GIT_TOKEN'),
  },
});
const server = createApiServer({
  components,
  token: required('FACTORY_API_TOKEN'),
  principal: process.env.FACTORY_PRINCIPAL ?? 'local',
  policyFile: required('FACTORY_POLICY_FILE'),
  rolesDirectory: required('FACTORY_ROLES_DIR'),
  // Only a name with the webhook prefix is ever read here, so a policy cannot name another host secret as one.
  secrets: (name) => (name.startsWith(WEBHOOK_SECRET_PREFIX) ? process.env[name] : undefined),
  rubricsDirectory: process.env.FACTORY_RUBRICS_DIR === undefined || process.env.FACTORY_RUBRICS_DIR === '' ? null : process.env.FACTORY_RUBRICS_DIR,
});
await server.listen(port, process.env.FACTORY_LISTEN_HOST ?? '127.0.0.1');

process.on('SIGTERM', () => {
  void server.close();
});
