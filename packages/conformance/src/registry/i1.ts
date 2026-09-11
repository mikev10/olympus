import { mkdir, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { compileError, pending, runtime } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { DIR_NAMES, ESCAPE_MECHANISM, linkTo, refusalFrom, specFor, withProvider, withSandbox } from './local-sandbox.js';

/** The seven named, audited operations the Vault contract declares. Nothing else may be reachable on an instance. */
const NAMED_OPERATIONS: readonly string[] = [
  'read', 'lock', 'verifyLocks', 'writeEvidence', 'recordViolation', 'readRunState', 'commitRunState',
];

/** I1: No agent writes to the Vault. */
export const I1: InvariantEntry = {
  title: INVARIANTS.I1,
  assertions: [
    compileError({
      id: 'I1.write-boundary-vault-never',
      title: 'WriteBoundary.vault admits no value but "never"',
      fixture: 'i1/write-boundary-vault-never.ts',
    }),
    compileError({
      id: 'I1.mount-table-single-rw',
      title: 'MountTable admits at most one rw mount and only in the workspace slot: every other mount is ro by type, a second rw mount has no slot, and the workspace may itself be ro',
      fixture: 'i1/mount-table-single-rw.ts',
    }),
    compileError({
      id: 'I1.vault-has-no-generic-write',
      title: 'the Vault contract exposes named mutators only; write, put, and delete do not exist',
      fixture: 'i1/vault-has-no-generic-write.ts',
    }),
    runtime({
      id: 'I1.vault-implementation-exposes-only-named-operations',
      title:
        'the filesystem Vault carries exactly the seven named operations at run time: no generic write, no delete, and no helper left reachable on the prototype for a caller to mutate the store past them',
      run: async () => {
        const { LocalVault } = await import('@olympus-ai/vault');
        const reachable = Object.getOwnPropertyNames(LocalVault.prototype).filter((name) => name !== 'constructor');
        const extra = reachable.filter((name) => !NAMED_OPERATIONS.includes(name));
        if (extra.length > 0) {
          throw new Error(
            `I1: the Vault exposes [${extra.join(', ')}] beyond its named operations. The type-level fixture cannot ` +
              'see these: a TypeScript `private` method is public at run time, so an internal helper is a write path ' +
              'the contract does not declare. Use a module-level function or a `#private` method.',
          );
        }
        const missing = NAMED_OPERATIONS.filter((name) => !reachable.includes(name));
        if (missing.length > 0) throw new Error(`I1: the Vault is missing the named operations [${missing.join(', ')}]`);
      },
    }),
    runtime({
      id: 'I1.mount-layer-enforcement',
      title:
        'inside a provisioned container the mount table is what the kernel applies: the rw workspace is writable and its writes ' +
        'land on the host, a workspace the table marks ro is not writable, an `others` mount is not writable, and nothing ' +
        'written outside the workspace reaches any host path',
      run: async () => {
        await withProvider('i1-mount-layer-', async (provider, dirs, base) => {
          // The one rw mount is the workspace, and it really is the host's tree.
          await withSandbox(provider, specFor(dirs, 'rw'), async (handle) => {
            const wrote = await provider.exec(handle, ['sh', '-c', 'echo landed > /workspace/made.txt']);
            if (wrote.exitCode !== 0) throw new Error(`I1: a write to the rw workspace failed: ${wrote.stderr}`);
            const onHost = (await readFile(join(dirs.workspace, 'made.txt'), 'utf8')).trim();
            if (onHost !== 'landed') throw new Error(`I1: the rw workspace write did not reach the host (read ${onHost})`);

            // Everything else the container can write is the container's own layer, and dies with it.
            const outside = await provider.exec(handle, ['sh', '-c', 'echo escaped > /outside.txt']);
            if (outside.exitCode !== 0) throw new Error('I1: this assertion assumes the container root is writable; it was not');
            const leaked = (await readdir(base)).filter((name) => !DIR_NAMES.includes(name));
            if (leaked.length > 0) throw new Error(`I1: a write outside the workspace reached the host: ${leaked.join(', ')}`);
          });

          // A workspace the table marks ro is mounted ro, which is what lets verification run against a
          // tree it cannot modify (I3, and the TOCTOU limit P1 recorded against this unit's obligation).
          await withSandbox(provider, specFor(dirs, 'ro'), async (handle) => {
            const blocked = await provider.exec(handle, ['sh', '-c', 'echo x > /workspace/nope.txt']);
            if (blocked.exitCode === 0) throw new Error('I1: a workspace the table marks ro accepted a write');
            if (!blocked.stderr.includes('Read-only file system')) {
              throw new Error(`I1: the ro workspace refused the write for the wrong reason: ${blocked.stderr}`);
            }
          });

          // And an `others` mount, which the type layer already holds to ro.
          const withOther = specFor(dirs, 'rw', {
            mounts: {
              workspace: { source: dirs.workspace, target: '/workspace', mode: 'rw' },
              others: [{ source: dirs.readable, target: '/readable', mode: 'ro' }],
            },
          });
          await withSandbox(provider, withOther, async (handle) => {
            const blocked = await provider.exec(handle, ['sh', '-c', 'echo x > /readable/nope.txt']);
            if (blocked.exitCode === 0) throw new Error('I1: an `others` mount declared ro accepted a write');
          });
        });
      },
    }),
    runtime({
      id: 'I1.mount-layer-refuses-a-vault-mount',
      title:
        'a mount that would put a Vault path in the container is refused before any container starts — declared directly, ' +
        `reached through a ${ESCAPE_MECHANISM}, or asked for as ro — and so is a second rw mount`,
      run: async () => {
        await withProvider('i1-mount-refusals-', async (provider, dirs) => {
          const direct = await refusalFrom(() =>
            provider.provision(
              specFor(dirs, 'rw', { mounts: { workspace: { source: dirs.vault, target: '/workspace', mode: 'rw' }, others: [] } }),
            ),
          );
          if (direct.layer !== 'mount') {
            throw new Error(`I1: a Vault path as the workspace was refused at the ${direct.layer} layer, not the mount layer`);
          }

          // The escape: the declared path is inside the workspace and only resolves to the Vault.
          // A containment check that ran before resolution would let this one through.
          const link = join(dirs.workspace, 'link');
          await linkTo(dirs.vault, link);
          const viaLink = await refusalFrom(() =>
            provider.provision(
              specFor(dirs, 'rw', { mounts: { workspace: { source: link, target: '/workspace', mode: 'rw' }, others: [] } }),
            ),
          );
          if (viaLink.layer !== 'mount' || !viaLink.message.includes(link)) {
            throw new Error(`I1: a ${ESCAPE_MECHANISM} into the Vault was not refused by name: ${viaLink.message}`);
          }

          // ro is refused too: a Vault inside the container is one flag away from a writable one.
          const readOnly = await refusalFrom(() =>
            provider.provision(
              specFor(dirs, 'rw', {
                mounts: {
                  workspace: { source: dirs.workspace, target: '/workspace', mode: 'rw' },
                  others: [{ source: dirs.vault, target: '/audit', mode: 'ro' }],
                },
              }),
            ),
          );
          if (readOnly.layer !== 'mount') {
            throw new Error(`I1: a Vault path mounted ro was accepted, or refused elsewhere: ${readOnly.message}`);
          }

          // The Vault reached by truncation rather than by naming it. Docker's --mount grammar
          // splits on commas, so a source of `<vault>,readonly` is mounted as `<vault>`: every
          // containment check passes on the longer name and the container gets the Vault. The
          // declared path carries no comma, so checking only what the caller wrote misses it.
          // Review finding 1; an I1 bypass demonstrated against a running container.
          const decoy = join(dirname(dirs.vault), `${basename(dirs.vault)},readonly`);
          await mkdir(decoy, { recursive: true });
          const plain = join(dirs.readable, 'plain-link');
          await linkTo(decoy, plain);
          if (plain.includes(',')) throw new Error('I1: this assertion needs a comma-free declared path');
          const truncated = await refusalFrom(() =>
            provider.provision(
              specFor(dirs, 'rw', { mounts: { workspace: { source: plain, target: '/workspace', mode: 'rw' }, others: [] } }),
            ),
          );
          if (truncated.layer !== 'mount') {
            throw new Error(`I1: a source resolving to a comma-bearing path was not refused by the mount layer: ${truncated.message}`);
          }

          // A second rw mount has no slot in the type, so a cast is how it arrives at run time.
          const twoWritable = {
            workspace: { source: dirs.workspace, target: '/workspace', mode: 'rw' },
            others: [{ source: dirs.readable, target: '/second', mode: 'rw' }],
          } as unknown as ReturnType<typeof specFor>['mounts'];
          const second = await refusalFrom(() => provider.provision(specFor(dirs, 'rw', { mounts: twoWritable })));
          if (second.layer !== 'mount' || !second.message.includes('I1')) {
            throw new Error(`I1: a second rw mount was not refused by the mount layer: ${second.message}`);
          }
        });
      },
    }),
  ],
  pending: [
    pending({
      id: 'I1.driver-executes-inside-the-sandbox',
      owner: 'P5',
      reason:
        'TaskRequest hands a driver a SandboxHandle, and nothing in the contract lets the driver run anything inside it. ' +
        'A driver with no path into the sandbox runs the model on the host, outside the mount table where I1 is enforced. ' +
        'P5 must give the driver an exec path into the provisioned sandbox, with P2 on the provider side, and assert that ' +
        "a task's commands run inside the sandbox and nowhere else. Surfaced by S1 (docs/decisions.md, owed contract gaps).",
    }),
  ],
};
