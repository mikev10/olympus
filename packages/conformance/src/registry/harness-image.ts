/**
 * R53: the agent CLI by content, and the image in evidence (A-R53-01).
 *
 * Each driver's image installs its CLI from a lockfile that pins every
 * tarball by sha512, and a build whose install does not match it fails
 * (external, in each driver package: they need Docker and npm, and call no
 * model). `ensureImage` refuses a tag the daemon holds as an image this host
 * did not record building. And the runtime records the content ID every
 * driver call ran in, beside `driverProvenanceId`, read from the engine and
 * never from a driver (I2); a call or a bundle that cannot name one is
 * refused (I5).
 */
import type { TaskId } from '@olympus-ai/core';
import type { SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import type { EvidenceBundle, UsageRecord, Vault } from '@olympus-ai/vault';
import { external, runtime } from '../kit/assert.js';
import type { ExternalAssertion, LocalAssertion } from '../kit/types.js';
import { readRecord, stubDriver, withLine } from './line.js';

const api = async () => import('@olympus-ai/api');

const CLAUDE_CODE = '@olympus-ai/driver-claude-code';
const CODEX = '@olympus-ai/driver-codex';
const IMAGE_TESTS = 'test/image.test.ts';

/** Two content IDs no engine holds: the stub sandbox runs no image, so the line records what it was given. */
const BUILD_IMAGE = `sha256:${'b'.repeat(64)}`;
const REVIEW_IMAGE = `sha256:${'d'.repeat(64)}`;
/** An image no profile names: what a build call's record says it ran in when it differs from the profile now. */
const RECORDED_IMAGE = `sha256:${'e'.repeat(64)}`;
const LIMITS = { cpus: 1, memoryMb: 512, pids: 64 };

function installsByContent(driver: 'claude-code' | 'codex', pkg: string): ExternalAssertion {
  return external({
    id: `I5.${driver}-image-installs-the-cli-by-content`,
    title:
      "the image installs its CLI from the lockfile and never by name: a build whose lockfile alters one platform package's sha512 fails and names it, "
      + 'the built image holds every package the lockfile pins for its platform at its locked version and integrity, and its CLI reports CLI_VERSION',
    level: 'runtime',
    package: pkg,
    file: IMAGE_TESTS,
  });
}

function replacedIsRefused(driver: 'claude-code' | 'codex', pkg: string): ExternalAssertion {
  return external({
    id: `I5.${driver}-image-replaced-is-refused`,
    title:
      'ensureImage returns the content ID of an image this host recorded building under the tag, and refuses, without rebuilding, a tag the daemon holds '
      + 'as an image with no record or another record',
    level: 'runtime',
    package: pkg,
    file: IMAGE_TESTS,
  });
}

/** A sandbox that records the image of every spec it is asked to provision, so a record is compared with what ran, not with the profile. */
async function provisionsSeen(): Promise<{ sandbox: SandboxProvider; images: string[] }> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const target = new StubSandboxProvider();
  const images: string[] = [];
  const sandbox = new Proxy(target, {
    get(t, prop) {
      if (prop === 'provision') {
        return async (spec: SandboxSpec) => {
          images.push(spec.image);
          return t.provision(spec);
        };
      }
      const value: unknown = Reflect.get(t, prop, t);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value;
    },
  });
  return { sandbox, images };
}

/** A Vault whose usage records read back as `rewrite` gives them. */
function usageRead(vault: Vault, rewrite: (record: UsageRecord) => Partial<UsageRecord>): Vault {
  return new Proxy(vault, {
    get(target, prop, receiver) {
      if (prop === 'read') {
        return async (ref: Parameters<Vault['read']>[0]) => {
          const bytes = await target.read(ref);
          if (ref.kind !== 'usage') return bytes;
          return new TextEncoder().encode(JSON.stringify(rewrite(JSON.parse(new TextDecoder().decode(bytes)) as UsageRecord)));
        };
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** Every usage record the run wrote that is not a pending one, read back. */
async function calls(vault: Vault, refs: ReadonlyArray<Parameters<Vault['read']>[0]>): Promise<UsageRecord[]> {
  const records = await Promise.all(refs.map((ref) => readRecord<UsageRecord>(vault, ref)));
  return records.filter((r) => r.reading.kind !== 'pending');
}

export const HARNESS_IMAGE_RECORDED_BY_THE_RUNTIME: LocalAssertion = runtime({
  id: 'I2.harness-image-recorded-by-the-runtime',
  title:
    "every driver call's usage record names the content ID of the image its sandbox was provisioned from, the profile's for that driver and never anything "
    + "the driver returned; every evidence bundle names the image its build call's record names, even where the profile now names another; with no profile "
    + "they name no-sandbox; and a usage record read from before R53 is not-recorded",
  run: async () => {
    const { readUsage, startRun } = await api();
    await withLine('r53-i2-', async (rig) => {
      // A reviewer through a driver of its own, so the profile provisions it from its own image (R9, D-R9-06).
      const reviewer = { ...(await stubDriver({ family: 'other-family' })), provenanceId: () => 'r53-reviewer@1' };
      const seen = await provisionsSeen();
      const components = await rig.components({
        reviewer,
        sandbox: seen.sandbox,
        profile: { buildImage: BUILD_IMAGE, driverImages: { [reviewer.provenanceId()]: REVIEW_IMAGE }, checkImage: 'check-image-is-not-a-driver-call', limits: LIMITS },
      });
      await startRun(await rig.request(components));
      const state = await rig.state();
      const usage = await calls(components.vault, state.usage);
      const builds = usage.filter((r) => r.station === 'build');
      const reviews = usage.filter((r) => r.station === 'review');
      if (builds.length === 0 || reviews.length === 0) throw new Error('the rig made no build call and no review call to read');
      for (const r of builds) {
        if (typeof r.harnessImage !== 'object' || r.harnessImage.id !== BUILD_IMAGE) throw new Error(`I2: a build call recorded ${JSON.stringify(r.harnessImage)}, not the profile's build image`);
      }
      for (const r of reviews) {
        if (typeof r.harnessImage !== 'object' || r.harnessImage.id !== REVIEW_IMAGE) throw new Error(`I2: a review call recorded ${JSON.stringify(r.harnessImage)}, not the image its driver is provisioned from`);
      }
      // Each image is named by as many call records as sandboxes were provisioned from it: compared with what ran, not with the profile.
      for (const image of [BUILD_IMAGE, REVIEW_IMAGE]) {
        const ran = seen.images.filter((i) => i === image).length;
        const recorded = usage.filter((r) => typeof r.harnessImage === 'object' && r.harnessImage.id === image).length;
        if (ran !== recorded) throw new Error(`I2: ${String(ran)} sandboxes were provisioned from ${image}, and ${String(recorded)} call records name it`);
      }
      for (const r of usage) {
        if (typeof r.harnessImage !== 'object' || !seen.images.includes(r.harnessImage.id)) throw new Error(`I2: a call record names ${JSON.stringify(r.harnessImage)}, which no sandbox was provisioned from`);
      }
      const bundles = await Promise.all(state.evidenceRefs.map((ref) => readRecord<EvidenceBundle>(components.vault, ref)));
      if (bundles.length === 0) throw new Error('the rig wrote no evidence bundle to read');
      for (const b of bundles) {
        if (typeof b.harnessImage !== 'object' || b.harnessImage.id !== BUILD_IMAGE) throw new Error(`I2: a bundle names ${JSON.stringify(b.harnessImage)}, not the image its build call ran in`);
      }

      // A record from before R53 carries no image, and is read as not recorded rather than as any image.
      const legacy = usageRead(components.vault, ({ harnessImage: _image, ...record }) => record);
      const old = await readUsage(legacy, state);
      if (old.length === 0 || old.some((r: UsageRecord) => r.harnessImage !== 'not-recorded')) throw new Error('I5: a usage record from before R53 was read as naming an image');
    });

    // A bundle names the image its build call's record names, not the one the profile names now: the two differ, as after a resume on a rebuilt image.
    await withLine('r53-i2-record-', async (rig) => {
      const components = await rig.components({ profile: { buildImage: BUILD_IMAGE, checkImage: 'c', limits: LIMITS } });
      const ranElsewhere = usageRead(components.vault, (record) => ({ ...record, harnessImage: { id: RECORDED_IMAGE } }));
      await startRun(await rig.request({ ...components, vault: ranElsewhere }));
      const state = await rig.state();
      const bundles = await Promise.all(state.evidenceRefs.map((ref) => readRecord<EvidenceBundle>(components.vault, ref)));
      if (bundles.length === 0) throw new Error('the rig wrote no evidence bundle to read');
      for (const b of bundles) {
        if (typeof b.harnessImage !== 'object' || b.harnessImage.id !== RECORDED_IMAGE) throw new Error(`I2: a bundle names ${JSON.stringify(b.harnessImage)}, not the image its build call's record names`);
      }
    });

    await withLine('r53-i2-none-', async (rig) => {
      const components = await rig.components();
      await startRun(await rig.request(components));
      const state = await rig.state();
      const usage = await calls(components.vault, state.usage);
      if (usage.length === 0 || usage.some((r) => r.harnessImage !== 'no-sandbox')) throw new Error('I2: a call on a line with no profile did not record no-sandbox');
      const bundles = await Promise.all(state.evidenceRefs.map((ref) => readRecord<EvidenceBundle>(components.vault, ref)));
      if (bundles.length === 0 || bundles.some((b) => b.harnessImage !== 'no-sandbox')) throw new Error('I2: a bundle on a line with no profile did not name no-sandbox');
    });
  },
});

export const HARNESS_IMAGE_UNNAMED_IS_REFUSED: LocalAssertion = runtime({
  id: 'I5.harness-image-unnamed-is-refused',
  title:
    "a profile whose build image or a driver's image is not a content ID is refused when the graph is built; the Vault refuses a usage record or a bundle "
    + "naming not-recorded or a tag; and a build call whose record names no image leaves its task with no bundle and stops the run",
  run: async () => {
    const { startRun } = await api();
    await withLine('r53-i5-', async (rig) => {
      for (const profile of [
        { buildImage: 'factory-claude-code:2.1.330-0123456789abcdef', checkImage: 'c', limits: LIMITS },
        { buildImage: BUILD_IMAGE, driverImages: { 'codex@0.166.0': 'node@sha256:' + 'a'.repeat(64) }, checkImage: 'c', limits: LIMITS },
      ]) {
        const refused = await rig.components({ profile }).then(() => null, (error: unknown) => error);
        if (!(refused instanceof Error) || !refused.message.includes('content ID')) throw new Error(`I5: a profile naming ${JSON.stringify(profile)} was not refused as naming no content ID`);
      }

      const components = await rig.components({ profile: { buildImage: BUILD_IMAGE, checkImage: 'c', limits: LIMITS } });
      const call: UsageRecord = {
        runId: rig.runId, taskId: 'build-1' as TaskId, station: 'build', attempt: 1,
        model: { provider: 'p', family: 'f' as UsageRecord['model']['family'], model: 'm', version: '1' },
        role: { id: 'builder' as UsageRecord['role']['id'], sha256: 'a'.repeat(64) }, driver: 'stub@1',
        reading: { kind: 'unmetered' }, timing: { startedAt: '2026-11-22T10:00:00.000Z', endedAt: '2026-11-22T10:01:00.000Z' },
        harnessImage: { id: BUILD_IMAGE }, collectedBy: 'runtime',
      };
      for (const harnessImage of ['not-recorded', { id: 'factory-codex:0.166.0-0123456789abcdef' }] as const) {
        if (await components.vault.recordUsage({ ...call, harnessImage }).then(() => true, () => false)) throw new Error(`I5: the Vault stored a usage record naming ${JSON.stringify(harnessImage)}`);
      }

      // The build call's record, as the line reads it back at verify, with its image taken away.
      const unnamed = usageRead(components.vault, ({ harnessImage: _image, ...record }) => record);
      const outcome = await startRun(await rig.request({ ...components, vault: unnamed })).then((o) => o, (error: unknown) => error);
      const state = await rig.state();
      if (state.evidenceRefs.length > 0) throw new Error('I5: a bundle was written for a build call whose record names no image');
      if (!(outcome instanceof Error) || !outcome.message.includes('image')) throw new Error(`I5: the run did not stop on a build call with no image: ${JSON.stringify(outcome)}`);
    });
  },
});

/** R53's I2 assertions. */
export const R53_I2: readonly LocalAssertion[] = [HARNESS_IMAGE_RECORDED_BY_THE_RUNTIME];

/** R53's I5 assertions: the two drivers' images, and the runtime's refusals. */
export const R53_I5: ReadonlyArray<LocalAssertion | ExternalAssertion> = [
  installsByContent('claude-code', CLAUDE_CODE),
  replacedIsRefused('claude-code', CLAUDE_CODE),
  installsByContent('codex', CODEX),
  replacedIsRefused('codex', CODEX),
  HARNESS_IMAGE_UNNAMED_IS_REFUSED,
];
