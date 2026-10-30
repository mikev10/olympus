/**
 * The daily schedule (D-A-TF-08). Each schedule in policy fires once a day at
 * its UTC time as a `scheduled` event whose one field is its id. A firing the
 * service missed while it was stopped is recorded as missed, once, naming the
 * first and last dates, and never run late: catching up would burst the
 * budget on restart.
 *
 * The scheduler is the service's, not the CLI's (I9): it is started and
 * stopped by whoever constructs the server, and touches no terminal.
 */
import type { Policy, TriggerSchedule } from '@olympus-ai/core';
import type { Vault } from '@olympus-ai/vault';
import type { Intake } from './intake.js';

const DAY_MS = 24 * 3_600_000;

/** The UTC date of a time, `YYYY-MM-DD`. */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** When `schedule` fires on the UTC date of `ms`. */
export function firingTime(schedule: TriggerSchedule, ms: number): number {
  const [hours = '0', minutes = '0'] = schedule.at.split(':');
  const day = Date.parse(`${utcDate(ms)}T00:00:00Z`);
  return day + Number(hours) * 3_600_000 + Number(minutes) * 60_000;
}

/** The latest date a schedule fired on or was recorded missed through, from its decisions; null if it never has. */
export async function lastCovered(vault: Vault, schedule: TriggerSchedule): Promise<string | null> {
  const source = `schedule:${schedule.id}`;
  let last: string | null = null;
  for (const entry of await vault.readTriggerDecisions()) {
    if (entry.decision.source !== source) continue;
    const date = entry.decision.outcome.kind === 'missed' ? entry.decision.outcome.last : entry.decision.key;
    if (last === null || date > last) last = date;
  }
  return last;
}

/**
 * The dates after `covered` whose firing time passed before `now`: what a
 * stopped service missed. A schedule that never fired misses nothing, since
 * there was no service to miss it.
 */
export function missedDates(schedule: TriggerSchedule, covered: string | null, now: number): { first: string; last: string } | null {
  if (covered === null) return null;
  const today = firingTime(schedule, now);
  const lastDue = today <= now ? utcDate(now) : utcDate(now - DAY_MS);
  const first = utcDate(Date.parse(`${covered}T00:00:00Z`) + DAY_MS);
  return first <= lastDue ? { first, last: lastDue } : null;
}

export interface Scheduler {
  stop(): void;
}

/**
 * Records what was missed, then sets a timer per schedule for its next
 * firing. The policy is read again at each firing, so a schedule removed from
 * it stops firing and one whose kind is disabled is refused and recorded.
 */
export async function startSchedules(
  policy: () => Promise<Policy | null>, vault: Vault, intake: Intake, now: () => number = Date.now,
): Promise<Scheduler> {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  const current = await policy();
  const schedules = current?.triggers.schedules ?? [];
  for (const schedule of schedules) {
    const missed = missedDates(schedule, await lastCovered(vault, schedule), now());
    if (missed !== null) await intake.missed(schedule, missed.first, missed.last);
  }
  const arm = (schedule: TriggerSchedule): void => {
    if (stopped) return;
    const at = now();
    const today = firingTime(schedule, at);
    const next = today > at ? today : firingTime(schedule, at + DAY_MS);
    const timer = setTimeout(() => {
      timers.delete(timer);
      void (async () => {
        const latest = await policy();
        const still = latest?.triggers.schedules?.find((s) => s.id === schedule.id);
        if (latest !== null && still !== undefined) await intake.fire(latest, still, utcDate(next));
      })().finally(() => { arm(schedule); });
    }, next - at);
    timer.unref();
    timers.add(timer);
  };
  for (const schedule of schedules) arm(schedule);
  return {
    stop: () => {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
