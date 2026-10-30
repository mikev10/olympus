/**
 * How a trigger event becomes an intake candidate (R22). A delivery arrives
 * on `POST /events/<subscription>`, the one route outside the local token, and
 * is refused at the first check it fails:
 *
 * 1. the subscription is one the policy names, before the body is read (I4);
 * 2. the body is within its byte cap, held to it while it is read;
 * 3. its HMAC-SHA256 under the subscription's secret verifies, in constant
 *    time, before anything parses it;
 * 4. its digest is not one the Vault holds, so a body sent again is refused
 *    before it is parsed (D-R22-02);
 * 5. its own signed time is within the policy's age, and its fields are the
 *    kind's schema, checked whole (I7);
 * 6. the budget has room.
 *
 * The first three, and a replay, are counted per subscription and hour and
 * never written one by one: anyone can send them (D-R22-03). Every other
 * outcome is written once, under the body's digest, with its candidate in the
 * same write. A candidate starts nothing: a person reads it and may admit a
 * run from it through `POST /runs` (D-A-TF-01).
 *
 * The secret is resolved on the host, from a variable the subscription names
 * and only one with the webhook prefix (D-A-TF-05). No sandbox spec carries
 * it, and no driver request carries any byte of a body.
 */
import {
  WEBHOOK_SECRET_PREFIX, checkFields, type AuthorTrust, type CandidateId, type Policy, type RunId,
  type TemplateId, type TriggerLineage, type TriggerSchedule, type TriggerSubscription,
} from '@olympus-ai/core';
import { bodyDigest, extractGithub, signatureVerifies, untrustedBody } from '@olympus-ai/triggers';
import {
  intakeId, type AdmissionRecord, type CandidateRecord, type CountedRefusalCause,
  type TriggerDecision, type Vault,
} from '@olympus-ai/vault';
import { readIntegration } from './line.js';

/** Where a host's secrets come from. Only a name with the webhook prefix is ever asked for. */
export type SecretSource = (name: string) => string | undefined;

export interface IntakeOptions {
  readonly vault: Vault;
  readonly secrets: SecretSource;
  /** The runtime's clock, in ms. */
  readonly now?: () => number;
}

/** What a delivery came to, as the route answers it. Nothing here is the body's text. */
export type DeliveryOutcome =
  | { readonly outcome: 'candidate'; readonly candidate: CandidateId }
  | { readonly outcome: 'ignored' }
  | { readonly outcome: 'refused'; readonly cause: CountedRefusalCause | 'stale' | 'schema' | 'budget' | 'not-enabled' };

/** The UTC hour a count is kept under. */
export function utcHour(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13);
}

/**
 * One delivery at a time per service: the budget is read and the candidate
 * written under one turn, so two deliveries cannot both take the last place.
 */
export class Intake {
  readonly #vault: Vault;
  readonly #secrets: SecretSource;
  readonly #now: () => number;
  #turn: Promise<unknown> = Promise.resolve();

  constructor(options: IntakeOptions) {
    this.#vault = options.vault;
    this.#secrets = options.secrets;
    this.#now = options.now ?? Date.now;
  }

  /** The subscription a delivery names, or null; null is counted as `not-subscribed` and the body is never read. */
  subscription(policy: Policy, id: string): TriggerSubscription | null {
    return (policy.triggers.subscriptions ?? []).find((s) => s.id === id) ?? null;
  }

  /** Counts a refusal that writes no record of its own (D-R22-03). */
  async count(bucket: string, cause: CountedRefusalCause): Promise<DeliveryOutcome> {
    await this.#vault.countRefusedDelivery(bucket, utcHour(this.#now()), cause);
    return { outcome: 'refused', cause };
  }

  /** Steps 3 to 6, for a body already read within its cap. */
  async deliver(policy: Policy, subscription: TriggerSubscription, signature: string | undefined, body: Uint8Array): Promise<DeliveryOutcome> {
    return this.#serial(async () => {
      const name = subscription.secret;
      const secret = name.startsWith(WEBHOOK_SECRET_PREFIX) ? (this.#secrets(name) ?? '') : '';
      if (!signatureVerifies(body, signature, secret)) return this.count(subscription.id, 'unverified');
      const digest = bodyDigest(body);
      if (await this.#vault.hasTriggerDecision(subscription.id, digest)) return this.count(subscription.id, 'replayed');
      const now = this.#now();
      const decide = (outcome: TriggerDecision['outcome']): TriggerDecision => ({
        source: subscription.id, key: digest, decidedAt: new Date(now).toISOString(), outcome, collectedBy: 'runtime',
      });
      const write = async (decision: TriggerDecision, candidate: CandidateRecord | null, result: DeliveryOutcome): Promise<DeliveryOutcome> => {
        // A key written between the check and here is the same body sent twice: the second is a replay.
        if (!(await this.#vault.recordTriggerDecision(decision, candidate))) return this.count(subscription.id, 'replayed');
        return result;
      };
      if (!policy.triggers.enabled.includes(subscription.kind)) {
        return write(decide({ kind: 'refused', cause: 'not-enabled' }), null, { outcome: 'refused', cause: 'not-enabled' });
      }
      // The validator requires the age while a non-human kind is enabled; absent, nothing is fresh (I5).
      const maxAge = policy.triggers.maxDeliveryAgeMs ?? 0;
      const extracted = extractGithub(subscription, untrustedBody(body, `github:${subscription.id}`), now, maxAge);
      if (!extracted.ok) {
        if (extracted.outcome === 'ignored') return write(decide({ kind: 'ignored' }), null, { outcome: 'ignored' });
        if (extracted.cause === 'stale') {
          return write(decide({ kind: 'refused', cause: 'stale', signedAt: new Date(extracted.signedAt).toISOString() }), null, { outcome: 'refused', cause: 'stale' });
        }
        return write(decide({ kind: 'refused', cause: 'schema', defects: extracted.defects }), null, { outcome: 'refused', cause: 'schema' });
      }
      if (await this.#overBudget(policy, now)) return write(decide({ kind: 'refused', cause: 'budget' }), null, { outcome: 'refused', cause: 'budget' });
      const template = policy.triggers.taskTemplate[extracted.kind];
      if (template === undefined) return write(decide({ kind: 'refused', cause: 'not-enabled' }), null, { outcome: 'refused', cause: 'not-enabled' });
      const id = intakeId(subscription.id, digest);
      const candidate: CandidateRecord = {
        id,
        kind: extracted.kind,
        template,
        extracted: extracted.extracted,
        authorTrust: extracted.authorTrust,
        lineage: await this.#lineage(extracted.commit, now),
        signedAt: new Date(extracted.signedAt).toISOString(),
        body: { sha256: digest, base64: Buffer.from(body).toString('base64') },
        recordedAt: new Date(now).toISOString(),
        collectedBy: 'runtime',
      };
      return write(decide({ kind: 'candidate', candidate: id }), candidate, { outcome: 'candidate', candidate: id });
    });
  }

  /**
   * A schedule's firing for a UTC date: a candidate whose one field is the
   * schedule's id, written once under `schedule:<id>` and the date. Its
   * author is the policy's, so its trust is `owner`.
   */
  async fire(policy: Policy, schedule: TriggerSchedule, date: string): Promise<DeliveryOutcome | null> {
    return this.#serial(async () => {
      const source = `schedule:${schedule.id}`;
      const now = this.#now();
      const decision = (outcome: TriggerDecision['outcome']): TriggerDecision => ({ source, key: date, decidedAt: new Date(now).toISOString(), outcome, collectedBy: 'runtime' });
      const write = async (d: TriggerDecision, c: CandidateRecord | null, result: DeliveryOutcome): Promise<DeliveryOutcome | null> => ((await this.#vault.recordTriggerDecision(d, c)) ? result : null);
      if (!policy.triggers.enabled.includes('scheduled')) return write(decision({ kind: 'refused', cause: 'not-enabled' }), null, { outcome: 'refused', cause: 'not-enabled' });
      if (await this.#overBudget(policy, now)) return write(decision({ kind: 'refused', cause: 'budget' }), null, { outcome: 'refused', cause: 'budget' });
      const fields = checkFields('scheduled', { schedule: schedule.id });
      if (!fields.ok) return write(decision({ kind: 'refused', cause: 'schema', defects: fields.defects }), null, { outcome: 'refused', cause: 'schema' });
      const id = intakeId(source, date);
      const candidate: CandidateRecord = {
        id, kind: 'scheduled', template: schedule.template satisfies TemplateId, extracted: fields.fields, authorTrust: 'owner' satisfies AuthorTrust,
        lineage: { depth: 0, chain: [], windowStart: new Date(now).toISOString() }, signedAt: null, body: null,
        recordedAt: new Date(now).toISOString(), collectedBy: 'runtime',
      };
      return write(decision({ kind: 'candidate', candidate: id }), candidate, { outcome: 'candidate', candidate: id });
    });
  }

  /** Records firings a stopped service missed, as one entry, and never runs them (D-A-TF-08). */
  async missed(schedule: TriggerSchedule, first: string, last: string): Promise<void> {
    await this.#serial(async () => {
      await this.#vault.recordTriggerDecision({
        source: `schedule:${schedule.id}`, key: `missed:${first}:${last}`, decidedAt: new Date(this.#now()).toISOString(),
        outcome: { kind: 'missed', first, last }, collectedBy: 'runtime',
      }, null);
    });
  }

  async #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#turn.then(work, work);
    this.#turn = run.catch(() => undefined);
    return run;
  }

  /** Candidates recorded across every kind in the sliding window, against the policy's budget (D-R22-07). */
  async #overBudget(policy: Policy, now: number): Promise<boolean> {
    const { runs, windowMs } = policy.triggers.budgetPerWindow;
    const since = now - windowMs;
    let recorded = 0;
    for (const entry of await this.#vault.readTriggerDecisions()) {
      if (entry.candidate !== null && Date.parse(entry.candidate.recordedAt) > since) recorded += 1;
    }
    return recorded >= runs;
  }

  /**
   * An event naming a commit an Olympus run merged carries that run's chain
   * plus the run, one deeper. Read from the runtime's own integration and
   * admission records, never from the payload's say-so.
   */
  async #lineage(commit: string | null, now: number): Promise<TriggerLineage> {
    const windowStart = new Date(now).toISOString();
    if (commit === null) return { depth: 0, chain: [], windowStart };
    for (const runId of await this.#vault.listRuns()) {
      const merged = (await readIntegration(this.#vault, runId)).some((r) => r.kind === 'merged' && r.mergeCommit === commit);
      if (!merged) continue;
      const parent = await this.#parentLineage(runId);
      return { depth: parent.depth + 1, chain: [...parent.chain, runId], windowStart };
    }
    return { depth: 0, chain: [], windowStart };
  }

  async #parentLineage(runId: RunId): Promise<TriggerLineage> {
    const state = await this.#vault.readRunState(runId);
    const record = JSON.parse(new TextDecoder().decode(await this.#vault.read(state.admission))) as AdmissionRecord;
    return record.run.trigger.lineage;
  }
}
