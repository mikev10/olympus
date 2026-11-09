/**
 * R24: the target repository's instructions as granted context. Each clause
 * of the unit's conformance is one assertion here, and each fails when its
 * check is deleted:
 *
 * - a run admitted with the grant records every delivered file's path and hash;
 * - a commit to the base after admission does not change what the run's tasks receive;
 * - a planted workspace copy that differs from the base copy is not what is delivered;
 * - an oversized, non-UTF-8, or non-regular entry refuses admission and names it;
 * - a skill whose front matter declares `allowed-tools` changes no grant;
 * - `test-design`'s seat never receives the grant, whatever policy says;
 * - a role whose scope does not set `repoInstructions` receives nothing;
 * - a run above L2 granted the set is narrowed through `narrowRun`, the
 *   narrowing recorded and committed before any model receives the set, which
 *   arrives in the suffix and not the prefix.
 *
 * No run above L2 can be admitted in M2, and none above L1 resumed on stub
 * components, so the last is the api package's test of the line itself
 * (D-R24-09).
 */
import { createHash } from 'node:crypto';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CapabilityScope, Policy, RoleId, TaskRequest, TaskResult } from '@olympus-ai/core';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import type { AdmissionRecord, Vault } from '@olympus-ai/vault';
import { external, runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { admitAndDrive, approveAndResume, artifactsFor, awaiting, drafting, draftingPolicy, draftingScopes, lastAttempt } from './drafting.js';
import { lineScope, linePolicy, readRecord, stubDriver, withLine, type LineRig, type ObservedDriver } from './line.js';

const api = async () => import('@olympus-ai/api');
const core = async () => import('@olympus-ai/core');

const BUILDER = 'builder' as RoleId;
const REVIEWER = 'reviewer' as RoleId;

/** What each listed file holds; each body carries a marker a request is searched for. */
const PLANTED: Readonly<Record<string, string>> = {
  'CLAUDE.md': 'r24-claude-marker: write small commits.\n',
  'AGENTS.md': 'r24-agents-marker: run the tests before you claim.\n',
  '.claude/rules/style.md': "---\npaths: ['**']\n---\nr24-rule-marker: two-space indentation.\n",
  '.claude/skills/greet/SKILL.md': '---\nname: greet\nallowed-tools: [shell, write]\nmodel: opus\n---\nr24-skill-marker: greet politely.\n',
  '.agents/skills/tidy/SKILL.md': 'r24-agents-skill-marker: keep it tidy.\n',
};

/** Files beside the list that are never read: a skill's script and reference, and a file outside it. */
const UNLISTED: Readonly<Record<string, string>> = {
  '.claude/skills/greet/scripts/run.sh': 'echo r24-script-marker\n',
  '.claude/skills/greet/references/ref.md': 'r24-reference-marker\n',
  '.claude/notes.md': 'r24-outside-marker\n',
};

/** The fixed order the reader lists them in. */
const ORDER = ['CLAUDE.md', 'AGENTS.md', '.claude/rules/style.md', '.claude/skills/greet/SKILL.md', '.agents/skills/tidy/SKILL.md'];
const MARKERS = ['r24-claude-marker', 'r24-agents-marker', 'r24-rule-marker', 'r24-skill-marker', 'r24-agents-skill-marker'];
const NEVER = ['r24-script-marker', 'r24-reference-marker', 'r24-outside-marker', 'allowed-tools', 'paths:'];

async function plant(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

function sha256(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A scope with the grant set, or left as the rig grants it. */
function granted(scope: CapabilityScope, on = true): CapabilityScope {
  return { ...scope, repoInstructions: on };
}

async function grantedPolicy(builder = true, reviewer = true): Promise<Policy> {
  return linePolicy({}, {
    roles: { [BUILDER]: granted(lineScope(['build', 'verify'], 'standard'), builder), [REVIEWER]: granted(lineScope(['review'], 'deep'), reviewer) },
  });
}

/** A builder and a reviewer each recording what it is given; the rig makes the builder do the fixture's work. */
async function observed(rig: LineRig, extra: Parameters<LineRig['components']>[0] = {}): Promise<{ builder: ObservedDriver; reviewer: ObservedDriver; components: Awaited<ReturnType<LineRig['components']>> }> {
  const builder = await stubDriver();
  const reviewer = await stubDriver({ family: 'reviewer-family' });
  return { builder, reviewer, components: await rig.components({ driver: builder, reviewer, ...extra }) };
}

async function admissionOf(rig: LineRig, vault: Vault): Promise<AdmissionRecord> {
  return readRecord<AdmissionRecord>(vault, (await rig.state()).admission);
}

function requestOf(requests: readonly TaskRequest[], role: RoleId, what: string): TaskRequest {
  const found = requests.find((r) => r.role.role === role);
  if (found === undefined) throw new Error(`R24: no ${what} request was made`);
  return found;
}

/** Throws where any of `markers` is, or is not, in `text`. */
function holds(text: string, markers: readonly string[], present: boolean, what: string): void {
  for (const marker of markers) {
    if (text.includes(marker) !== present) throw new Error(`R24: ${what} ${present ? 'lacks' : 'holds'} '${marker}'`);
  }
}

/** Both prefix and suffix of every request in `requests`. */
function textOf(requests: readonly TaskRequest[]): string {
  return requests.map((r) => `${r.stablePrefix}\n${r.variableSuffix}`).join('\n');
}

// ---------------------------------------------------------------------------

export const SET_RECORDED_BY_PATH_AND_HASH: LocalAssertion = runtime({
  id: 'I3.repo-instructions-recorded-by-path-and-hash',
  title:
    "a run admitted with the grant records each listed file of the base, in the fixed order, by path and SHA-256 of its bytes, marking each whose front matter was dropped; a granted seat is given exactly those bodies first in its stable prefix, after its role and before the rest of its context, and never a skill's scripts or references or a file outside the list (R24, A-R24-03)",
  run: async () => {
    await withLine('r24-recorded-', async (rig) => {
      await plant(rig.dirs.artifacts, { ...PLANTED, ...UNLISTED });
      const { builder, reviewer, components } = await observed(rig);
      const { startRun } = await api();
      await startRun(await rig.request(components, { policy: await grantedPolicy() }));
      const record = await admissionOf(rig, components.vault);
      const files = record.repoInstructions ?? [];
      if (JSON.stringify(files.map((f) => f.path)) !== JSON.stringify(ORDER)) throw new Error(`R24: the record lists ${JSON.stringify(files.map((f) => f.path))}, not ${JSON.stringify(ORDER)}`);
      for (const f of files) {
        if (f.sha256 !== sha256(PLANTED[f.path] ?? '')) throw new Error(`R24: ${f.path} is recorded under a hash that is not its bytes'`);
        const fronted = f.path.startsWith('.claude/');
        if (f.frontMatterDropped !== fronted) throw new Error(`R24: ${f.path} is recorded with frontMatterDropped ${String(f.frontMatterDropped)}`);
      }
      for (const [what, req] of [['the builder', requestOf(builder.requests, BUILDER, 'builder')], ['the reviewer', requestOf(reviewer.requests, REVIEWER, 'review')]] as const) {
        if (!req.stablePrefix.startsWith('[repo-instructions]\n')) throw new Error(`R24: ${what}'s prefix does not open with the set: ${req.stablePrefix.slice(0, 80)}`);
        holds(req.stablePrefix, MARKERS, true, `${what}'s prefix`);
        holds(textOf([req]), NEVER, false, `${what}'s request`);
        const last = Math.max(...MARKERS.map((m) => req.stablePrefix.indexOf(m)));
        if (req.stablePrefix.indexOf('[locked-spec]') < last) throw new Error(`R24: ${what}'s granted context comes before the set`);
      }
    });
  },
});

export const LATER_BASE_COMMIT_CHANGES_NOTHING: LocalAssertion = runtime({
  id: 'I3.base-commit-after-admission-changes-nothing-delivered',
  title: "a commit to the target's base after admission, rewriting CLAUDE.md and adding a rule, changes nothing a task of the admitted run receives: every granted seat is given the set as admitted (R24, I3)",
  run: async () => {
    await withLine('r24-later-commit-', async (rig) => {
      await plant(rig.dirs.artifacts, PLANTED);
      const { builder, reviewer, components } = await observed(rig);
      const { admitRun } = await api();
      const admitted = await admitRun(await rig.request(components, { policy: await grantedPolicy() }));
      if (!admitted.ok) throw new Error(`R24: the run was refused at admission as ${admitted.reason}`);
      await plant(rig.dirs.artifacts, { 'CLAUDE.md': 'r24-later-commit-marker\n', '.claude/rules/later.md': 'r24-later-rule-marker\n' });
      await admitted.admitted.drive();
      const given = textOf([requestOf(builder.requests, BUILDER, 'builder'), requestOf(reviewer.requests, REVIEWER, 'review')]);
      holds(given, ['r24-claude-marker'], true, 'what the seats were given');
      holds(given, ['r24-later-commit-marker', 'r24-later-rule-marker'], false, 'what the seats were given');
    });
  },
});

/** `driver`, whose builder writes `CLAUDE.md` into its workspace and claims it, as an agent rewriting the instructions would. */
function plantingInWorkspace(driver: ObservedDriver, sandbox: SandboxProvider): ObservedDriver {
  return new Proxy(driver, {
    get(target, key, receiver) {
      if (key !== 'runTask') return Reflect.get(target, key, receiver) as unknown;
      return async (req: TaskRequest): Promise<TaskResult> => {
        const wrote = await sandbox.exec(req.sandbox, ['node', '-e', "require('node:fs').writeFileSync('CLAUDE.md', 'r24-planted-marker\\n')"]);
        if (wrote.exitCode !== 0) throw new Error(`R24: the planted copy did not land: ${wrote.stderr}`);
        const result = await target.runTask(req);
        return { ...result, claim: { ...result.claim, filesChanged: [...new Set([...result.claim.filesChanged, 'CLAUDE.md'])] } };
      };
    },
  });
}

export const WORKSPACE_COPY_NOT_DELIVERED: LocalAssertion = runtime({
  id: 'I3.planted-workspace-copy-is-not-delivered',
  title: "a builder that rewrites CLAUDE.md in its workspace does not change what the review seat is given: the reviewer receives the base's copy as admitted, and never the planted one (R24, I3)",
  run: async () => {
    await withLine('r24-planted-', async (rig) => {
      await plant(rig.dirs.artifacts, PLANTED);
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const sandbox = new StubSandboxProvider();
      const builder = await stubDriver();
      const reviewer = await stubDriver({ family: 'reviewer-family' });
      const components = await rig.components({ sandbox, driver: plantingInWorkspace(builder, sandbox), reviewer });
      const { startRun } = await api();
      await startRun(await rig.request(components, { policy: await grantedPolicy() }));
      if (builder.requests.length === 0) throw new Error('R24 control: the builder never ran, so nothing was planted');
      const review = requestOf(reviewer.requests, REVIEWER, 'review');
      holds(review.stablePrefix, ['r24-claude-marker'], true, "the reviewer's prefix");
      holds(textOf([review]), ['r24-planted-marker'], false, "the reviewer's request");
    });
  },
});

/** Refused at admission as `instructions-refused`, naming `path` with `code`, with no run state left behind. */
async function refusesNaming(rig: LineRig, path: string, code: string, what: string): Promise<void> {
  const { startRun } = await api();
  const { builder, components } = await observed(rig);
  const outcome = await startRun(await rig.request(components, { policy: await grantedPolicy() }));
  if (outcome.ok || outcome.reason !== 'instructions-refused') throw new Error(`R24: ${what} was ${outcome.ok ? 'admitted' : `refused as ${outcome.reason}`}, not as instructions-refused`);
  if (!outcome.refused.some((r) => r.path === path && r.code === code)) throw new Error(`R24: ${what} was refused as ${JSON.stringify(outcome.refused)}, not naming ${path} as ${code}`);
  if (builder.requests.length > 0) throw new Error(`R24: ${what} reached the driver before it was refused`);
  const { isNoRunState } = await import('@olympus-ai/vault');
  try {
    await components.vault.readRunState(rig.runId);
  } catch (error) {
    if (isNoRunState(error)) return;
    throw error;
  }
  throw new Error(`R24: ${what} left run state behind`);
}

export const REFUSED_FILE_REFUSES_ADMISSION: LocalAssertion = runtime({
  id: 'I5.refused-instruction-file-refuses-admission',
  title:
    "an instruction file over the byte cap, one that is not UTF-8, a listed path that is a directory or a link, a set over the set's cap, and a set of empty files whose paths and headings alone pass that cap each refuse admission as instructions-refused naming the file, with nothing driven or stored; a file at the cap is admitted (R24, A-R24-04)",
  run: async () => {
    const { REPO_INSTRUCTION_FILE_MAX_BYTES, REPO_INSTRUCTIONS_MAX_BYTES } = await import('@olympus-ai/compiler');
    await withLine('r24-oversized-', async (rig) => {
      await plant(rig.dirs.artifacts, { 'CLAUDE.md': 'x'.repeat(REPO_INSTRUCTION_FILE_MAX_BYTES + 1) });
      await refusesNaming(rig, 'CLAUDE.md', 'too-large', 'an oversized CLAUDE.md');
    });
    await withLine('r24-not-utf8-', async (rig) => {
      await writeFile(join(rig.dirs.artifacts, 'AGENTS.md'), Uint8Array.from([0x68, 0x69, 0xff, 0xfe]));
      await refusesNaming(rig, 'AGENTS.md', 'not-utf8', 'an AGENTS.md that is not UTF-8');
    });
    await withLine('r24-directory-', async (rig) => {
      await mkdir(join(rig.dirs.artifacts, '.claude', 'rules', 'nested.md'), { recursive: true });
      await refusesNaming(rig, '.claude/rules/nested.md', 'not-regular', 'a rule that is a directory');
    });
    await withLine('r24-link-', async (rig) => {
      await writeFile(join(rig.dirs.artifacts, 'elsewhere.md'), 'r24-linked-marker\n');
      // No catch: a host that cannot make the link fails here rather than passing unexercised (D-R20-10).
      await symlink(join(rig.dirs.artifacts, 'elsewhere.md'), join(rig.dirs.artifacts, 'CLAUDE.md'), 'file');
      await refusesNaming(rig, 'CLAUDE.md', 'not-regular', 'a CLAUDE.md that is a link');
    });
    await withLine('r24-set-', async (rig) => {
      const half = 'y'.repeat(REPO_INSTRUCTIONS_MAX_BYTES / 2 + 1);
      await plant(rig.dirs.artifacts, { 'CLAUDE.md': half, 'AGENTS.md': half });
      await refusesNaming(rig, 'AGENTS.md', 'set-too-large', 'a set over its cap');
    });
    await withLine('r24-many-', async (rig) => {
      // Empty files cost nothing in bytes and everything in headings: each path reaches the seat (codex-1).
      const many: Record<string, string> = {};
      for (let i = 0; i < 1000; i++) many[`.claude/rules/${String(i).padStart(4, '0')}${'n'.repeat(200)}.md`] = '';
      await plant(rig.dirs.artifacts, many);
      const { startRun } = await api();
      const outcome = await startRun(await rig.request((await observed(rig)).components, { policy: await grantedPolicy() }));
      if (outcome.ok || outcome.reason !== 'instructions-refused' || !outcome.refused.some((x) => x.code === 'set-too-large')) {
        throw new Error(`R24: a thousand empty rules whose paths alone pass the set's cap were ${outcome.ok ? 'admitted' : `refused as ${outcome.reason}`}`);
      }
      if (outcome.refused.length !== 1) throw new Error(`R24: reading went on past the set's cap: ${String(outcome.refused.length)} refusals`);
    });
    await withLine('r24-at-cap-', async (rig) => {
      await plant(rig.dirs.artifacts, { 'CLAUDE.md': 'z'.repeat(REPO_INSTRUCTION_FILE_MAX_BYTES) });
      const { admitRun } = await api();
      const outcome = await admitRun(await rig.request((await observed(rig)).components, { policy: await grantedPolicy() }));
      if (!outcome.ok) throw new Error(`R24 control: a CLAUDE.md exactly at the cap was refused as ${outcome.reason}`);
    });
  },
});

export const FRONT_MATTER_CHANGES_NO_GRANT: LocalAssertion = runtime({
  id: 'I4.skill-front-matter-changes-no-grant',
  title:
    "a skill whose front matter declares allowed-tools and a model changes no grant: the builder is handed the same tools and tier as in the same run without the skill, the record marks the front matter dropped, and no seat is given the front matter's text (R24, I4)",
  run: async () => {
    const seen = async (prefix: string, files: Readonly<Record<string, string>>): Promise<TaskRequest> => withLine(prefix, async (rig) => {
      await plant(rig.dirs.artifacts, files);
      const { builder, components } = await observed(rig);
      const { startRun } = await api();
      await startRun(await rig.request(components, { policy: await grantedPolicy() }));
      if (Object.keys(files).length > 0) {
        const skill = (await admissionOf(rig, components.vault)).repoInstructions?.find((f) => f.path === '.claude/skills/greet/SKILL.md');
        if (skill?.frontMatterDropped !== true) throw new Error(`R24: the skill is recorded as ${JSON.stringify(skill)}`);
      }
      return requestOf(builder.requests, BUILDER, 'builder');
    });
    const skill = { '.claude/skills/greet/SKILL.md': PLANTED['.claude/skills/greet/SKILL.md'] ?? '' };
    const withSkill = await seen('r24-front-', skill);
    const without = await seen('r24-front-control-', {});
    if (JSON.stringify(withSkill.tools) !== JSON.stringify(without.tools) || withSkill.tier !== without.tier) {
      throw new Error(`R24: the skill's front matter moved the builder from ${JSON.stringify([without.tools, without.tier])} to ${JSON.stringify([withSkill.tools, withSkill.tier])}`);
    }
    holds(withSkill.stablePrefix, ['r24-skill-marker'], true, "the builder's prefix");
    holds(textOf([withSkill]), ['allowed-tools', 'model: opus', 'name: greet'], false, "the builder's request");
  },
});

export const TEST_DESIGN_NEVER_GRANTED: LocalAssertion = runtime({
  id: 'I3.test-design-never-receives-repo-instructions',
  title:
    "test-design's seats never receive the target's instructions, whatever policy says: a contract table or critic table granting it there is refused and grantedContext throws on it, and in a run whose policy grants the set to every role the spec drafter is given it while the test drafter and the test critic are not (R24, I3)",
  run: async () => {
    const { STATION_CONTRACTS, CRITIC_CONTRACTS, contractTableProblems, criticContractProblems, grantedContext } = await core();
    const station = { ...STATION_CONTRACTS['test-design'], allowedContext: ['repo-instructions', 'locked-spec'] };
    const table = { ...STATION_CONTRACTS, 'test-design': station } as unknown as typeof STATION_CONTRACTS;
    if (contractTableProblems(table).length === 0) throw new Error('R24: a test-design contract granting the set passed the table check');
    const critics = { ...CRITIC_CONTRACTS, 'test-design': { ...CRITIC_CONTRACTS['test-design'], allowedContext: ['repo-instructions', 'locked-spec', 'draft', 'rubric'] } } as unknown as typeof CRITIC_CONTRACTS;
    if (criticContractProblems(critics).length === 0) throw new Error('R24: a test-design critic granted the set passed the critic check');
    let threw = false;
    try {
      grantedContext(station as unknown as typeof STATION_CONTRACTS['test-design'], { 'repo-instructions': 'r24-claude-marker', 'locked-spec': 'spec' });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('R24: grantedContext assembled a test-design context granting the set');

    await withLine('r24-test-design-', async (rig) => {
      await plant(rig.dirs.artifacts, PLANTED);
      const r = await drafting(rig);
      const everyRole = Object.fromEntries(Object.entries(draftingScopes()).map(([id, scope]) => [id, granted(scope)]));
      const policy = await draftingPolicy({}, { ...everyRole, [BUILDER]: granted(lineScope(['build', 'verify'], 'standard')), [REVIEWER]: granted(lineScope(['review'], 'deep')) });
      awaiting(await admitAndDrive(r, { artifacts: artifactsFor(true, true), policy }), 'spec:1', 'a drafted spec');
      holds(textOf(r.drivers.specDrafter.requests), ['r24-claude-marker'], true, 'what the spec drafter was given');
      const spec = lastAttempt(await rig.state(), 'spec');
      awaiting(await approveAndResume(rig, r, 'spec:1', spec.sha256 ?? ''), 'test-design:1', 'drafted tests');
      if (r.drivers.testDrafter.requests.length === 0) throw new Error('R24 control: the test drafter never ran');
      holds(textOf([...r.drivers.testDrafter.requests, ...r.drivers.testCritic.requests]), MARKERS, false, 'what test-design was given');
    });
  },
});

export const UNGRANTED_ROLE_RECEIVES_NOTHING: LocalAssertion = runtime({
  id: 'I4.role-without-repo-instructions-receives-nothing',
  title:
    "a role whose scope does not set repoInstructions receives nothing of the set at a station whose contract allows it: with the grant absent from policy no seat is given a file the record holds, and with only the builder granted the reviewer is given nothing while the builder is given the set (R24, D-A-RI-03, I4)",
  run: async () => {
    await withLine('r24-ungranted-', async (rig) => {
      await plant(rig.dirs.artifacts, PLANTED);
      const { builder, reviewer, components } = await observed(rig);
      const { startRun } = await api();
      await startRun(await rig.request(components, { policy: await linePolicy() }));
      if ((await admissionOf(rig, components.vault)).repoInstructions?.length !== ORDER.length) throw new Error('R24 control: the record does not hold the planted set');
      if (builder.requests.length === 0 || reviewer.requests.length === 0) throw new Error('R24 control: a seat never ran');
      holds(textOf([...builder.requests, ...reviewer.requests]), MARKERS, false, 'what an ungranted seat was given');
    });
    await withLine('r24-builder-only-', async (rig) => {
      await plant(rig.dirs.artifacts, PLANTED);
      const { builder, reviewer, components } = await observed(rig);
      const { startRun } = await api();
      await startRun(await rig.request(components, { policy: await grantedPolicy(true, false) }));
      holds(requestOf(builder.requests, BUILDER, 'builder').stablePrefix, MARKERS, true, "the granted builder's prefix");
      holds(textOf(reviewer.requests), MARKERS, false, 'what the ungranted reviewer was given');
    });
  },
});

/**
 * No run above L2 can be admitted in M2, and none above L1 resumed on
 * components the graph builder cannot attest (D-I1a-06), so this clause is
 * the api package's test of the line's own delivery and `runTask` over the
 * context a resume builds for a real admitted run, read at L3. It is in the
 * paid suite, the api package's one reported suite, and calls no model (D-R24-09).
 */
export const ABOVE_L2_NARROWS_AND_RIDES_THE_SUFFIX = external({
  id: 'I7.above-l2-repo-instructions-narrow-the-run-and-ride-the-suffix',
  title:
    "a run above L2 granted the set is narrowed through narrowRun with source repo-instructions, the narrowing recorded and committed before any model is called with the set, which arrives in the granted seat's variable suffix and never its stable prefix; at L2 it is offered as granted context with nothing narrowed; a run whose seated roles declare no narrowed scope stops with the set withheld (R24, D-A-RI-02, D-A-RI-04, D-R10-06)",
  level: 'runtime',
  package: '@olympus-ai/api',
  file: 'test/paid/repo-instructions.test.ts',
});

export const R24_I3: readonly LocalAssertion[] = [SET_RECORDED_BY_PATH_AND_HASH, LATER_BASE_COMMIT_CHANGES_NOTHING, WORKSPACE_COPY_NOT_DELIVERED, TEST_DESIGN_NEVER_GRANTED];
export const R24_I4: readonly LocalAssertion[] = [FRONT_MATTER_CHANGES_NO_GRANT, UNGRANTED_ROLE_RECEIVES_NOTHING];
export const R24_I5: readonly LocalAssertion[] = [REFUSED_FILE_REFUSES_ADMISSION];
export const R24_I7 = [ABOVE_L2_NARROWS_AND_RIDES_THE_SUFFIX] as const;
