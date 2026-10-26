/**
 * The driver-alone arm: the same real driver, in one seat, handed the work
 * and what was asked, and asked whether it is done (D-R7-02). Nothing of the
 * line runs: no verification, no tamper analysis, no scanner, no lock. It is
 * what an agent checking its own kind of work would report.
 *
 * Its verdict is a model's claim, read strictly and reported as that, never
 * as status (I2). A verdict that is not exactly the shape is `unreadable`:
 * counted beside the rate, never in it, so a model that answers in prose is
 * neither a catch nor a pass (I5).
 *
 * The call is metered by the driver's relay, bound to the one model the tier
 * resolves to, with the budget the arm grants, as the line meters a task.
 */
import { boundTo, egressFor } from '@olympus-ai/api';
import type { CompiledRole, Driver, ModelTier, TaskId, TaskRequest } from '@olympus-ai/core';
import type { SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';

export type AloneVerdict =
  | { readonly kind: 'verdict'; readonly done: boolean; readonly reasons: readonly string[] }
  | { readonly kind: 'unreadable' };

/**
 * `{"done": boolean, "reasons": [string, …]}` and nothing else. One fenced
 * block around it is unwrapped, as a critic's is (D-R19-07). `done: true`
 * with reasons, or `done: false` with none, is not the shape: a verdict that
 * contradicts itself cannot be read.
 */
export function readVerdict(narrative: string): AloneVerdict {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(narrative);
  const text = (fenced?.[1] ?? narrative).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'unreadable' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'unreadable' };
  const keys = Object.keys(parsed).sort();
  if (keys.length !== 2 || keys[0] !== 'done' || keys[1] !== 'reasons') return { kind: 'unreadable' };
  const { done, reasons } = parsed as { done: unknown; reasons: unknown };
  if (typeof done !== 'boolean' || !Array.isArray(reasons) || !reasons.every((r) => typeof r === 'string' && r.trim() !== '')) return { kind: 'unreadable' };
  if (done === (reasons.length > 0)) return { kind: 'unreadable' };
  return { kind: 'verdict', done, reasons: reasons as string[] };
}

export interface AloneCall {
  readonly provider: SandboxProvider;
  readonly driver: Driver;
  readonly role: CompiledRole;
  /** The image the driver's tasks run in. */
  readonly image: string;
  readonly user: { readonly uid: number; readonly gid: number };
  readonly limits: Omit<SandboxSpec['limits'], 'wallClockMs'>;
  /** The tree the work is in, a copy the call may write and the arm throws away. */
  readonly tree: string;
  /** What was asked: the request the work answers. */
  readonly asked: string;
  readonly tier: ModelTier;
  readonly tools: readonly string[];
  readonly budget: TaskRequest['budget'];
}

export interface AloneOutcome {
  readonly verdict: AloneVerdict;
  /** What the relay counted, in US dollars. */
  readonly costUsd: number;
}

/** One driver-alone call. A call the relay did not meter is refused, never counted as free (I5). */
export async function aloneCall(call: AloneCall): Promise<AloneOutcome> {
  const relay = call.driver.relayRequest();
  if (relay === null) throw new Error('benchmark: the driver-alone arm needs a metered driver; this one has no relay, so its cost could not be counted against the cap');
  const model = call.driver.resolveModel(call.tier);
  const spec: SandboxSpec = {
    image: call.image,
    mounts: { workspace: { source: call.tree, target: '/workspace', mode: 'rw' }, others: [] },
    egress: egressFor({ egress: 'none' }),
    limits: { ...call.limits, wallClockMs: call.budget.maxWallClockMs },
    user: { uid: call.user.uid, gid: call.user.gid },
    relay: { ...relay, meter: boundTo(relay.meter, model.model), budget: { maxTokens: call.budget.maxTokens, maxCostUsd: call.budget.maxCostUsd } },
  };
  const handle = await call.provider.provision(spec);
  let narrative: string | null = null;
  let failure: unknown = null;
  try {
    const result = await call.driver.runTask({
      taskId: 'done-check' as TaskId,
      role: call.role,
      stablePrefix: call.asked,
      variableSuffix: 'done-check',
      tier: call.tier,
      tools: [...call.tools],
      sandbox: handle,
      timeoutMs: call.budget.maxWallClockMs,
      budget: { ...call.budget },
    });
    narrative = result.claim.narrative;
  } catch (error) {
    failure = error;
  }
  const teardown = await call.provider.destroy(handle);
  if (teardown.meter.kind !== 'metered') throw new Error('benchmark: the relay did not meter the driver-alone call, so its cost is unknown');
  const costUsd = teardown.meter.costUsd;
  // A call that failed to return is not a verdict, and is not a harness failure the arm can count either: it stops the run with its cost known.
  if (failure !== null) throw new Error(`benchmark: the driver-alone call failed after spending $${costUsd.toFixed(4)}: ${failure instanceof Error ? failure.message : JSON.stringify(failure)}`, { cause: failure });
  return { verdict: narrative === null ? { kind: 'unreadable' } : readVerdict(narrative), costUsd };
}
