/**
 * R36a: the shipped example runs on the real driver. Each assertion is the
 * free half of one fix the first real use needed (#145, #148 to #152, #154),
 * and fails when that fix is reverted (I8). The paid half, the shipped
 * `examples/` through the real driver to a merged pull request, is in
 * `packages/api/test/paid/`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuiltGraph, RunOutcome, RunRequest } from '@olympus-ai/api';
import { runtime } from '../kit/assert.js';
import { checkOutWithCrlf, commitFixture, committedFiles } from '../kit/git.js';
import type { LocalAssertion } from '../kit/types.js';
import { workspaceRoot } from '../kit/workspace.js';
import { approveAndResume, toApproval, withIntegration } from './integration.js';
import { refusalOf, withLine } from './line.js';
import { withVaultDirs } from './local-vault.js';
import { drafting } from './drafting.js';

const api = async () => import('@olympus-ai/api');

function examples(): string {
  return join(workspaceRoot(), 'examples');
}

/**
 * A user's JavaScript repository with the example's run files copied in, as
 * the README says, committed: a `package.json` and a lockfile pinning
 * nothing, so its stack is scanned for static analysis (#145).
 */
async function userRepository(dir: string): Promise<string> {
  const { hashedLockfile } = await import('@olympus-ai/adapters');
  await mkdir(dir, { recursive: true });
  await cp(join(examples(), 'run'), dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'user-repo', private: true }));
  await writeFile(join(dir, 'package-lock.json'), hashedLockfile('user-repo', []));
  return commitFixture(dir);
}

/**
 * The example's graph: the Claude Code driver in every seat, over a stub
 * sandbox it is never driven on, with the host's own scanners, so the images
 * the example pins are the ones checked and the tools it grants are checked
 * against what that driver declares.
 */
async function exampleGraph(dirs: { store: string; artifacts: string }, base: string): Promise<BuiltGraph> {
  const [{ buildGraph, localWorkspaceStore, SCANNERS }, { StubSandboxProvider }, { LocalVault }, { ClaudeCodeDriver }] = await Promise.all([
    api(), import('@olympus-ai/sandbox'), import('@olympus-ai/vault'), import('@olympus-ai/driver-claude-code'),
  ]);
  const sandbox = new StubSandboxProvider();
  const driver = new ClaudeCodeDriver({ provider: sandbox });
  const user = process.getuid === undefined ? { uid: 1000, gid: 1000 } : undefined;
  const root = join(base, 'trees');
  return buildGraph({
    vault: new LocalVault(dirs), sandbox, driver, reviewer: driver,
    drafting: { specDrafter: driver, specCritic: driver, testDrafter: driver, testCritic: driver },
    workspaces: localWorkspaceStore(user === undefined ? { root } : { root, user }),
    scanners: SCANNERS,
  });
}

/** A create of the example's two runs, as the README's "First run" gives them, at L1 and with no figure approved yet. */
async function exampleCreate(policyFile: string, drafted: boolean, body: (outcome: RunOutcome, what: string) => void): Promise<void> {
  const { loadPolicyFile, startRun } = await api();
  const loaded = await loadPolicyFile(policyFile);
  if (!loaded.ok) throw new Error(`R36a: the policy does not load: ${JSON.stringify(loaded)}`);
  await withVaultDirs(`r36a-example-${drafted ? 'drafted' : 'supplied'}-`, async (dirs, base) => {
    const baseCommit = await userRepository(dirs.artifacts);
    const req: RunRequest = {
      runId: `r36a-example-${drafted ? 'drafted' : 'supplied'}` as RunRequest['runId'],
      baseCommit, requestedLevel: 1, workspace: dirs.artifacts, policy: loaded.policy,
      roles: join(examples(), 'roles'), rubrics: join(examples(), 'rubrics'),
      components: await exampleGraph(dirs, base), approvedCostUsd: null,
      ...(drafted
        ? { intent: { text: 'Add hello.txt at the repository root, saying hello.', from: 'principal' }, artifacts: { spec: 'draft', acceptanceTests: ['acceptance.md'], verificationManifest: 'verify.json', taskGraph: 'graph.json' } }
        : { artifacts: { spec: ['spec.md'], acceptanceTests: ['acceptance.md'], verificationManifest: 'verify.json', taskGraph: 'graph.json', specParts: { security: 'security.json' } } }),
    };
    body(await startRun(req), drafted ? 'the drafted run' : 'the supplied run');
  });
}

export const EXAMPLE_ADMITTED_AS_SHIPPED: LocalAssertion = runtime({
  id: 'I5.shipped-example-admitted-as-shipped',
  title:
    "the shipped examples — policy, roles, rubrics, and run files, unmodified — pass every refusal admission makes on a JavaScript repository, with the Claude Code driver's own tool declaration in every seat, and the only answer left is the worst-case cost to approve; both runs the README's first run gives (#145, #150)",
  run: async () => {
    for (const drafted of [false, true]) {
      await exampleCreate(join(examples(), 'policy.yaml'), drafted, (outcome, what) => {
        if (outcome.ok || outcome.reason !== 'cost-unapproved') throw new Error(`R36a: ${what} on the shipped examples was answered ${JSON.stringify(outcome)}, not with the cost to approve`);
      });
    }
  },
});

export const EXAMPLE_TOOLS_DECLARED: LocalAssertion = runtime({
  id: 'I4.example-tools-declared-by-the-seat-driver',
  title:
    "every tool the shipped example policy grants any role is one the Claude Code driver declares, the driver every seat of the default host resolves to, so no seat is refused at drive time for a name it was granted (#150)",
  run: async () => {
    const [{ loadPolicyFile }, { DECLARED_TOOLS }] = await Promise.all([api(), import('@olympus-ai/driver-claude-code')]);
    const loaded = await loadPolicyFile(join(examples(), 'policy.yaml'));
    if (!loaded.ok) throw new Error('R36a: the example policy does not load');
    const roles = Object.entries(loaded.policy.roles);
    if (roles.length === 0) throw new Error('R36a control: the example policy declares no role');
    const undeclared = roles.flatMap(([role, scope]) => scope.tools.filter((tool) => !DECLARED_TOOLS.includes(tool)).map((tool) => `${role} -> ${tool}`));
    if (undeclared.length > 0) throw new Error(`R36a: the example grants tools the Claude Code driver does not declare: ${undeclared.join(', ')}`);
  },
});

export const UNDECLARED_TOOL_REFUSED_BEFORE_THE_ESTIMATE: LocalAssertion = runtime({
  id: 'I4.tool-grant-undeclared-by-the-seat-driver-refused',
  title:
    "a run whose policy grants a seat a tool its driver does not declare — the example's builder granted 'read' where the Claude Code driver declares 'Read' — is refused at admission, naming the role, the station, and the tool, before the worst-case cost is offered, so no spend is approved for a run whose every call would be refused (I4, I5, #150)",
  run: async () => {
    await withVaultDirs('r36a-undeclared-', async (_dirs, base) => {
      const policyFile = join(base, 'policy.yaml');
      const text = await readFile(join(examples(), 'policy.yaml'), 'utf8');
      const lowered = text.replace('tools: [Read, Write]', 'tools: [read, Write]');
      if (lowered === text) throw new Error('R36a control: the example policy grants no [Read, Write] to lower');
      await writeFile(policyFile, lowered);
      await exampleCreate(policyFile, false, (outcome) => {
        if (outcome.ok || outcome.reason !== 'policy-refused' || outcome.refusal.reason !== 'capability-missing' || outcome.role !== 'builder' || outcome.station !== 'build'
          || !outcome.refusal.detail.includes("'read'")) {
          throw new Error(`R36a: a grant of 'read' to the builder was answered ${JSON.stringify(outcome)}, not refused at admission before the estimate`);
        }
      });
    });
  },
});

/** Product code a checkout holds, with more than one line, so its line endings are what a checkout rewrites. */
const PRODUCT = { 'src/existing.ts': 'export const one = 1;\nexport const two = 2;\n' };

export const CRLF_CHECKOUT_MERGES: LocalAssertion = runtime({
  id: 'I5.base-is-the-commit-under-autocrlf',
  title:
    "a working copy checked out with core.autocrlf=true, whose committed text files hold CRLF endings the commit's blobs do not, carries a run to a merged pull request, its run files uncommitted as the README has them: the base is the commit's tree read from git's object store, so integrate's comparison of the base with the commit holds; and an artifact committed with other bytes than the workspace holds is refused at admission, before the cost is offered, never at integrate (#154)",
  run: async () => {
    const checkout = (dir: string): string => {
      for (const [path, text] of Object.entries(PRODUCT)) {
        mkdirSync(join(dir, ...path.split('/').slice(0, -1)), { recursive: true });
        writeFileSync(join(dir, ...path.split('/')), text);
      }
      const commit = commitFixture(dir, { normalizeEndings: true, paths: Object.keys(PRODUCT) });
      checkOutWithCrlf(dir, commit);
      return commit;
    };
    await withIntegration('r36a-crlf-', async (it) => {
      // Control: the checkout really differs from the commit, as on a default Windows checkout.
      const onDisk = await readFile(join(it.rig.dirs.artifacts, 'src', 'existing.ts'), 'utf8');
      if (!onDisk.includes('\r\n')) throw new Error('R36a control: the autocrlf checkout wrote LF endings, so it proves nothing');
      await toApproval(it);
      const outcome = await approveAndResume(it);
      if (!outcome.ok) throw new Error(`R36a: a run over a CRLF checkout did not merge: ${JSON.stringify(outcome)}`);
    }, undefined, checkout);
    // The run's own files committed in that checkout: their bytes on disk are not the commit's, and the run is refused before the estimate.
    await withLine('r36a-crlf-artifacts-', async (rig) => {
      const { startRun } = await api();
      const components = await rig.components();
      const req = await rig.request(components, { approvedCostUsd: null });
      const commit = commitFixture(rig.dirs.artifacts, { normalizeEndings: true });
      checkOutWithCrlf(rig.dirs.artifacts, commit);
      const outcome = await startRun({ ...req, baseCommit: commit });
      if (outcome.ok || outcome.reason !== 'invalid-request' || !outcome.problems.some((p) => p.code === 'differs-from-commit')) {
        throw new Error(`R36a: an artifact committed with other line endings was answered ${JSON.stringify(outcome)}, not refused at admission`);
      }
    });
  },
});

/** Every path under `root`, files and directories alike, by its path relative to it. */
async function everyPath(root: string, at = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, ...at.split('/').filter(Boolean)), { withFileTypes: true }).catch(() => [])) {
    const path = at === '' ? entry.name : `${at}/${entry.name}`;
    out.push(path);
    if (entry.isDirectory()) out.push(...(await everyPath(root, path)));
  }
  return out;
}

export const IGNORED_FILE_REACHES_NO_TREE: LocalAssertion = runtime({
  id: 'I4.ignored-file-reaches-no-tree',
  title:
    "a file the working copy holds and its .gitignore ignores — a .env — is in no tree the runtime builds for a run, base, task, or check, and no sandbox is handed it, because the base is the commit and not the working folder (#148)",
  run: async () => {
    await withLine('r36a-ignored-', async (rig) => {
      const { startRun } = await api();
      const components = await rig.components();
      const req = await rig.request(components);
      // Written after the rig's own commit, which adds ignored files too; a user's .env is never added.
      await writeFile(join(rig.dirs.artifacts, '.gitignore'), '.env\n');
      await writeFile(join(rig.dirs.artifacts, '.env'), 'API_KEY=never-in-a-tree\n');
      // The user's commit, made as git makes it: the ignored file is not in it.
      const baseCommit = commitFixture(rig.dirs.artifacts, { includeIgnored: false });
      if (committedFiles(rig.dirs.artifacts, baseCommit).some((f) => f.path === '.env')) throw new Error('R36a control: the commit holds the ignored .env');
      refusalOf(await startRun({ ...req, baseCommit }), 'R36a ignored');
      const trees = join(rig.workspaces.root, rig.runId);
      const paths = await everyPath(trees);
      if (!paths.some((p) => p.endsWith('/base') || p === 'base')) throw new Error('R36a control: the run built no base, so the search found nothing to find');
      const leaked = paths.filter((p) => p.split('/').includes('.env'));
      if (leaked.length > 0) throw new Error(`R36a: the ignored .env reached the run's trees at ${leaked.join(', ')}`);
    });
  },
});

export const DRAFTER_TOLD_WHERE_TO_WRITE: LocalAssertion = runtime({
  id: 'I5.drafter-request-names-its-drafts-directory',
  title:
    "the drafting task's request names the directory the runtime made for the run's drafts, .drafts/<run id>/, and the files the station reads from it, so a drafter granted no listing tool writes where the runtime collects (#151)",
  run: async () => {
    await withLine('r36a-drafts-', async (rig) => {
      const r = await drafting(rig);
      const { startRun } = await api();
      await startRun(await r.request());
      const [first] = r.drivers.specDrafter.requests;
      if (first === undefined) throw new Error('R36a control: the spec drafter was never asked to draft');
      const dir = `.drafts/${rig.runId}/`;
      if (!first.variableSuffix.includes(dir) || !first.variableSuffix.includes(`${dir}spec.md`)) {
        throw new Error(`R36a: the drafter's request does not name ${dir}: ${JSON.stringify(first.variableSuffix)}`);
      }
      // Runtime text, in the suffix and never in the prefix the spec and rubric share.
      if (first.stablePrefix.includes(dir)) throw new Error('R36a: the drafts directory is in the stable prefix');
    });
  },
});

export const R36A_I4: readonly LocalAssertion[] = [EXAMPLE_TOOLS_DECLARED, UNDECLARED_TOOL_REFUSED_BEFORE_THE_ESTIMATE, IGNORED_FILE_REACHES_NO_TREE];
export const R36A_I5: readonly LocalAssertion[] = [EXAMPLE_ADMITTED_AS_SHIPPED, CRLF_CHECKOUT_MERGES, DRAFTER_TOLD_WHERE_TO_WRITE];
