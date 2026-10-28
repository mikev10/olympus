/**
 * R12: telemetry exported from the record and never read back (D-A-LC-09).
 * Each span is drawn from a record the runtime wrote and timed by the runtime's
 * clock (I2); a run that may still change, a time never recorded, and a
 * reading that was lost are refused or marked, never guessed (I5); only
 * allowlisted typed fields are exported, and nothing in the runtime reads the
 * export (I7).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunId, RunState } from '@olympus-ai/core';
import type { MeterReading, SandboxHandle } from '@olympus-ai/sandbox';
import type { UsageRecord, Vault } from '@olympus-ai/vault';
import type { OtlpSpan as Span, TelemetryExport as Export } from '@olympus-ai/api';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { walkFiles, workspaceRoot } from '../kit/workspace.js';
import { meteredProvider } from './line-assertions.js';
import { readRecord, stubDriver, withLine } from './line.js';

const api = async () => import('@olympus-ai/api');

/** A narrative no export may carry: the claim is text a model wrote (I7). */
const NARRATIVE = 'r12-narrative-that-must-not-leave-the-vault';

function spansOf(e: Export): readonly Span[] {
  return e.traces.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));
}

function attr(span: Span, key: string): unknown {
  const v = span.attributes.find((a) => a.key === key)?.value;
  return v === undefined ? undefined : (v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue);
}

const nanos = (iso: string): string => (BigInt(Date.parse(iso)) * 1_000_000n).toString();

/** A finished hello run on metered sandboxes: built, reviewed, then cancelled at the integrate exit. */
async function finishedRun<T>(prefix: string, body: (vault: Vault, runId: RunId, state: RunState) => Promise<T>): Promise<T> {
  const { cancelRun, startRun, telemetryOf } = await api();
  return withLine(prefix, async (rig) => {
    const readings = new Map<SandboxHandle, MeterReading>();
    const driver = await stubDriver({ narrative: NARRATIVE });
    const reviewer = await stubDriver({ family: 'other-family', narrative: NARRATIVE });
    const components = await rig.components({ driver, reviewer, sandbox: await meteredProvider(readings) });
    await startRun(await rig.request(components));
    // Waiting for a human at the integrate exit is unfinished: its records may still change (D-R12-04).
    const open = await telemetryOf(components.vault, rig.runId);
    if (open.ok) throw new Error('I5: a run waiting at the integrate exit was exported before it finished');
    const cancelled = await cancelRun({ runId: rig.runId, by: 'conformance', vault: components.vault });
    if (!cancelled.ok) throw new Error(`the rig's run could not be cancelled: ${JSON.stringify(cancelled)}`);
    return body(components.vault, rig.runId, cancelled.state);
  });
}

async function exported(vault: Vault, runId: RunId): Promise<Export> {
  const { telemetryOf } = await api();
  const result = await telemetryOf(vault, runId);
  if (!result.ok) throw new Error(`a finished run was not exported: ${result.reason}`);
  return result.export;
}

export const TELEMETRY_IS_DRAWN_FROM_RUNTIME_RECORDS: LocalAssertion = runtime({
  id: 'I2.telemetry-is-drawn-from-runtime-records',
  title:
    "a finished run exports one trace: a run span over a station span for every station entry run state recorded, each at the time the runtime entered it; an invoke_agent span per driver call, timed by the usage record's runtime-stamped start and end, with the convention's input count the relay's input plus cache reads and writes; a check span per check result; and the same ids on a second export. The line stamps every usage record and every station entry",
  run: async () => {
    const { readUsage } = await api();
    await finishedRun('r12-i2-tree-', async (vault, runId, state) => {
      if (state.stations.length === 0 || state.stations[0]?.station !== 'intake') throw new Error('I2: admission recorded no station entry');
      const usage = (await readUsage(vault, state)).filter((r: UsageRecord) => r.reading.kind !== 'pending');
      if (usage.length === 0 || usage.some((r) => r.timing === 'not-recorded' || r.timing.endedAt === null)) {
        throw new Error('I2: the line wrote a usage record without the times it stamped on the call');
      }
      const first = await exported(vault, runId);
      const second = await exported(vault, runId);
      if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('I2: the same run exported twice is not the same export');

      const spans = spansOf(first);
      const roots = spans.filter((s) => s.parentSpanId === '');
      if (roots.length !== 1 || roots[0]?.name !== 'run' || new Set(spans.map((s) => s.traceId)).size !== 1) throw new Error('I2: the export is not one trace under one run span');
      const stations = spans.filter((s) => s.name.startsWith('station '));
      const expected = state.stations.map((e) => [`station ${e.station}`, nanos(e.enteredAt)]);
      if (JSON.stringify(stations.map((s) => [s.name, s.startTimeUnixNano])) !== JSON.stringify(expected)) {
        throw new Error(`I2: the station spans are not the station entries run state recorded: ${JSON.stringify(stations.map((s) => s.name))}`);
      }

      const calls = spans.filter((s) => s.name.startsWith('invoke_agent '));
      if (calls.length !== usage.length) throw new Error(`I2: ${String(usage.length)} driver calls exported as ${String(calls.length)} spans`);
      for (const record of usage) {
        if (record.timing === 'not-recorded' || record.timing.endedAt === null || record.reading.kind !== 'metered') throw new Error('I2: the rig recorded an unmetered call');
        const { startedAt, endedAt } = record.timing;
        const span = calls.find((s) => s.startTimeUnixNano === nanos(startedAt) && attr(s, 'factory.task.id') === record.taskId);
        if (span?.endTimeUnixNano !== nanos(endedAt) || span.kind !== 3) throw new Error(`I2: the call of ${record.taskId} at ${startedAt} is not a client span over its recorded times`);
        const r = record.reading;
        if (attr(span, 'gen_ai.usage.input_tokens') !== String(r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens) || attr(span, 'gen_ai.request.model') !== record.model.model || attr(span, 'gen_ai.agent.version') !== record.role.sha256) {
          throw new Error(`I2: the call span does not carry the usage record's model, role, and inclusive input count: ${JSON.stringify(span.attributes)}`);
        }
        const parent = spans.find((s) => s.spanId === span.parentSpanId);
        if (parent?.name !== `task ${record.taskId}`) throw new Error('I2: a call span is not under its task span');
      }
      if (!spans.some((s) => s.name.startsWith('check ') && spans.find((p) => p.spanId === s.parentSpanId)?.name.startsWith('task ') === true)) {
        throw new Error('I2: no check result was exported as a span under its task');
      }
      const points = first.metrics.resourceMetrics.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));
      const duration = points.find((m) => m.name === 'gen_ai.client.operation.duration');
      if (duration === undefined || !('histogram' in duration) || duration.histogram.dataPoints.length !== usage.length) throw new Error('I2: the duration metric does not hold one point per call');
    });
  },
});

export const TELEMETRY_GUESSES_NOTHING: LocalAssertion = runtime({
  id: 'I5.telemetry-guesses-nothing',
  title:
    "a run that has not finished is refused, not exported; a run whose records predate the recorded times exports no station or call span, says its stations were not recorded and counts its untimed calls; a call whose reading was lost carries no token or cost attribute, is never a zero, and ends in error",
  run: async () => {
    const { readUsage, telemetryOf } = await api();
    await finishedRun('r12-i5-', async (vault, runId, finished) => {
      // Each call the run made, counted once: its terminal record, whose pending record is the same call (gemini-4).
      const madeCalls = (await readUsage(vault, finished)).filter((r: UsageRecord) => r.reading.kind !== 'pending').length;
      // The same records as written before R12: no station entries, no call times.
      const legacy: Vault = new Proxy(vault, {
        get(target, prop, receiver) {
          if (prop === 'readRunState') {
            return async (id: RunId) => ({ ...(await target.readRunState(id)), stations: [] });
          }
          if (prop === 'read') {
            return async (ref: Parameters<Vault['read']>[0]) => {
              const bytes = await target.read(ref);
              if (ref.kind !== 'usage') return bytes;
              const { timing: _timing, ...record } = JSON.parse(new TextDecoder().decode(bytes)) as UsageRecord;
              return new TextEncoder().encode(JSON.stringify(record));
            };
          }
          const value: unknown = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
      const old = await telemetryOf(legacy, runId);
      if (!old.ok) throw new Error('a finished run recorded before R12 was refused');
      const spans = spansOf(old.export);
      if (spans.some((s) => s.name.startsWith('station ') || s.name.startsWith('invoke_agent '))) throw new Error('I5: a span was given a time no record holds');
      const run = spans.find((s) => s.name === 'run');
      // The count is required and exact: a missing attribute is not a pass (codex-8).
      if (run === undefined || attr(run, 'factory.stations.recorded') !== false || attr(run, 'factory.calls.untimed') !== String(madeCalls)) {
        throw new Error(`I5: a run recorded before R12 does not say what was not recorded, ${String(madeCalls)} untimed calls: ${JSON.stringify(run?.attributes)}`);
      }

      // A run admitted before R12 and resumed after it holds only the entries made since: a partial history is not a recorded one (codex-5).
      const resumed: Vault = new Proxy(vault, {
        get(target, prop, receiver) {
          if (prop === 'readRunState') {
            return async (id: RunId) => {
              const s = await target.readRunState(id);
              return { ...s, stations: s.stations.slice(1) };
            };
          }
          const value: unknown = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
      const partial = await telemetryOf(resumed, runId);
      const partialRun = partial.ok ? spansOf(partial.export).find((s) => s.name === 'run') : undefined;
      if (partialRun === undefined || attr(partialRun, 'factory.stations.recorded') !== false) {
        throw new Error('I5: a station history that does not begin at admission was exported as recorded');
      }

      // Every reading lost: no token or cost figure on its span, and the span ends in error.
      const lost: Vault = new Proxy(vault, {
        get(target, prop, receiver) {
          if (prop === 'read') {
            return async (ref: Parameters<Vault['read']>[0]) => {
              const bytes = await target.read(ref);
              if (ref.kind !== 'usage') return bytes;
              const record = JSON.parse(new TextDecoder().decode(bytes)) as UsageRecord;
              const reading = record.reading.kind === 'pending' ? record.reading : { kind: 'lost', detail: 'conformance' };
              return new TextEncoder().encode(JSON.stringify({ ...record, reading }));
            };
          }
          const value: unknown = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
      const unread = await telemetryOf(lost, runId);
      if (!unread.ok) throw new Error('a finished run with lost readings was refused');
      const calls = spansOf(unread.export).filter((s) => s.name.startsWith('invoke_agent '));
      if (calls.length === 0 || calls.some((s) => s.status.code !== 2 || s.attributes.some((a) => a.key.startsWith('gen_ai.usage.') || a.key === 'factory.usage.cost_usd'))) {
        throw new Error('I5: a lost reading was exported with a figure, or without an error');
      }
      const metrics = unread.export.metrics.resourceMetrics.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));
      if (metrics.some((m) => m.name !== 'gen_ai.client.operation.duration' && 'sum' in m && m.sum.dataPoints.length > 0)) throw new Error('I5: a lost reading was counted as tokens or cost');
    });
  },
});

/** Modules that may import the exporter: itself, the package's index, and the route that serves it. */
const TELEMETRY_IMPORTERS: readonly string[] = ['packages/api/src/telemetry.ts', 'packages/api/src/index.ts', 'packages/api/src/http/server.ts'];

export const TELEMETRY_EXPORTS_NO_TEXT: LocalAssertion = runtime({
  id: 'I7.telemetry-exports-no-text',
  title:
    "every attribute an export carries is on the exporter's allowlist, and neither a claim's narrative nor a check's output appears anywhere in it; no runtime module but the exporter's route imports it, so no gate, level, or rate reads telemetry back",
  run: async () => {
    const { TELEMETRY_ATTRIBUTES } = await api();
    await finishedRun('r12-i7-', async (vault, runId, state) => {
      const e = await exported(vault, runId);
      const allowed = new Set<string>(TELEMETRY_ATTRIBUTES);
      const keys = new Set<string>();
      for (const span of spansOf(e)) {
        for (const a of span.attributes) keys.add(a.key);
        for (const ev of span.events) for (const a of ev.attributes) keys.add(a.key);
      }
      for (const m of e.metrics.resourceMetrics.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics))) {
        const points = 'sum' in m ? m.sum.dataPoints : m.histogram.dataPoints;
        for (const p of points) for (const a of p.attributes) keys.add(a.key);
      }
      const outside = [...keys].filter((k) => !allowed.has(k));
      if (outside.length > 0) throw new Error(`I7: the export carries attributes outside the allowlist: ${outside.join(', ')}`);
      const text = JSON.stringify(e);
      if (text.includes(NARRATIVE)) throw new Error("I7: a claim's narrative was exported");
      for (const ref of state.evidenceRefs) {
        const bundle = await readRecord<{ checks: Array<{ stdout: string; stderr: string }> }>(vault, ref);
        for (const c of bundle.checks) {
          for (const out of [c.stdout, c.stderr]) if (out.trim().length > 8 && text.includes(JSON.stringify(out).slice(1, -1))) throw new Error("I7: a check's output was exported");
        }
      }
    });

    const root = workspaceRoot();
    const readers: string[] = [];
    for (const file of walkFiles(join(root, 'packages'))) {
      const rel = file.slice(root.length + 1).replaceAll('\\', '/');
      if (!/^packages\/[^/]+(\/[^/]+)?\/src\/.*\.ts$/.test(rel) || rel.startsWith('packages/conformance/')) continue;
      if (TELEMETRY_IMPORTERS.includes(rel)) continue;
      if (/from\s+['"][./]+(?:[^'"]*\/)?telemetry\.js['"]/.test(readFileSync(file, 'utf8'))) readers.push(rel);
    }
    if (readers.length > 0) throw new Error(`I7: telemetry is read back by ${readers.join(', ')}`);
  },
});
