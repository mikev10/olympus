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

/**
 * What the runtime has done, counted where it happens rather than read from
 * what the CLI printed: every Vault write and every driver call. The parent
 * asks for it over IPC, so a refused create that still admitted or drove a
 * run is caught by its side effects (P9 review, codex-6).
 */
const census = { vaultWrites: 0, driverCalls: 0 };
const VAULT_WRITES: ReadonlySet<PropertyKey> = new Set(['lock', 'writeEvidence', 'recordViolation', 'recordAdmission', 'recordTaskResult', 'recordUsage', 'commitRunState']);
const DRIVER_CALLS: ReadonlySet<PropertyKey> = new Set(['runTask']);
function counted<T extends object>(target: T, names: ReadonlySet<PropertyKey>, count: () => void): T {
  return new Proxy(target, {
    get(obj, name, receiver) {
      const value: unknown = Reflect.get(obj, name, receiver);
      if (typeof value !== 'function' || !names.has(name)) return value;
      return (...args: unknown[]): unknown => {
        count();
        return Reflect.apply(value, obj, args);
      };
    },
  });
}
const stub = stubComponents(workspace);
const countCall = (): void => { census.driverCalls += 1; };
const driver = counted(stub.driver, DRIVER_CALLS, countCall);
const components = {
  ...stub,
  vault: counted(stub.vault, VAULT_WRITES, () => { census.vaultWrites += 1; }),
  driver,
  reviewer: stub.reviewer === stub.driver ? driver : counted(stub.reviewer, DRIVER_CALLS, countCall),
};
const server = createApiServer({ components, token, principal: 'headless-host', policyFile });
const url = await server.listen(0, '127.0.0.1');

// The parent going away is the only stop signal; the host closes what it opened and lets the event loop drain.
process.on('disconnect', () => {
  void server.close()
    .then(() => removeWorkspace(workspace))
    .then(() => rm(policyFile, { force: true }));
});
process.on('message', (message: unknown) => {
  if (typeof message === 'object' && message !== null && (message as { kind?: unknown }).kind === 'census') process.send?.({ kind: 'census', ...census });
});
process.send({ url, workspace });
