/**
 * A host process for the API server with no terminal: the conformance suite
 * spawns it with stdin closed and stdout discarded, and it talks to its parent
 * only over the IPC channel (`I9.api-runs-headless`). It composes stub
 * components over a fresh copy of the hello fixture, as I1's real host will
 * compose real ones (D-P9-01), and reports the URL it listens on.
 *
 * It is in the api package's program, so the I9 terminal scan reads it too:
 * the host obeys the rule it exists to prove.
 */
import { rm, writeFile } from 'node:fs/promises';
import { createApiServer } from '../../src/index.js';
import { makeWorkspace, policyDocument, removeWorkspace, stubComponents } from '../harness.js';

const token = process.env.FACTORY_API_TOKEN;
if (token === undefined) throw new Error('headless host: FACTORY_API_TOKEN is not set');
if (process.send === undefined) throw new Error('headless host: started without an IPC channel');

const workspace = await makeWorkspace('p9-headless-');
const policyFile = `${workspace}.policy.yaml`;
await writeFile(policyFile, JSON.stringify(policyDocument()));
const server = createApiServer({ components: stubComponents(workspace), token, principal: 'headless-host', policyFile });
const url = await server.listen(0, '127.0.0.1');

// The parent going away is the only stop signal; the host closes what it opened and lets the event loop drain.
process.on('disconnect', () => {
  void server.close()
    .then(() => removeWorkspace(workspace))
    .then(() => rm(policyFile, { force: true }));
});
process.send({ url, workspace });
