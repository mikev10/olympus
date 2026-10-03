/**
 * The `factory-host` executable: the runtime as a service over the production
 * composition. Configured from its environment and nothing else, it touches
 * no terminal (I9); a client finds it at the address it was told to listen on.
 *
 * - `FACTORY_API_TOKEN`: the local token every request must bear
 * - `FACTORY_POLICY_FILE`: the `policy.yaml` every run is admitted under
 * - `FACTORY_VAULT_STORE`: what the Vault owns
 * - `FACTORY_REPOSITORY`: the working copy runs are admitted from
 * - `FACTORY_TREES`: where the runtime keeps each run's trees
 * - `FACTORY_LISTEN_PORT`, and `FACTORY_LISTEN_HOST` (default `127.0.0.1`)
 * - `ANTHROPIC_API_KEY`: held by the sandbox provider for its relays, given to no sandbox
 * - `FACTORY_PRINCIPAL` (default `local`): who a request bearing the token is
 * - `FACTORY_GIT_REPOSITORY` (`owner/name`), `FACTORY_GIT_BASE_BRANCH`, and
 *   `FACTORY_GIT_TOKEN`: the remote a passed run merges into, and the token
 *   that merges it, held by the host and given to no sandbox (D-I1b-06)
 *
 * A missing variable stops the host before it listens (I5).
 */
import { createApiServer } from '../http/server.js';
import { composeHost } from './compose.js';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`factory-host: ${name} is not set`);
  return value;
}

const port = Number(required('FACTORY_LISTEN_PORT'));
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('factory-host: FACTORY_LISTEN_PORT is not a port');

const components = await composeHost({
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
});
await server.listen(port, process.env.FACTORY_LISTEN_HOST ?? '127.0.0.1');

process.on('SIGTERM', () => {
  void server.close();
});
