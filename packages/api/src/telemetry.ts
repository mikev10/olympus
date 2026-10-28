/**
 * A finished run's records as OpenTelemetry traces and metrics, in the OTLP/HTTP
 * JSON encoding, for an operator's dashboard (R12, D-A-LC-09).
 *
 * Everything here is read from the records an auditor reads — run state, the
 * usage records the relay's meter produced, evidence, and the enforcement
 * record — so what is exported can be recomputed from them. Nothing reads it
 * back: no gate, level, or rate imports this module. Every attribute is a
 * typed field from the allowlist below; no prompt, completion, claim
 * narrative, check output, or payload text is exported (I7).
 *
 * Ids are derived from the run and the record a span is drawn from, so the
 * same run exported twice is the same export.
 */
import { createHash } from 'node:crypto';
import type { RunId, RunState, StationEntry, StationId, TaskId, TaskResult } from '@olympus-ai/core';
import type { EnforcementDecision, EvidenceBundle, UsageRecord, Vault } from '@olympus-ai/vault';
import { readRunRecords, type RunRecords } from './outcomes.js';

/** The GenAI semantic conventions the names below are read from. */
export const SEMCONV_GENAI = 'open-telemetry/semantic-conventions-genai@51a0f580f8a6ad804ca4de5e033683c6fbbe5906';

/**
 * Every attribute key an export may carry. A key not listed here is never
 * emitted; the conformance scan reads every key an export holds against it.
 */
export const TELEMETRY_ATTRIBUTES = [
  'service.name',
  'gen_ai.operation.name',
  'gen_ai.provider.name',
  'gen_ai.request.model',
  'gen_ai.agent.name',
  'gen_ai.agent.version',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.cache_read.input_tokens',
  'gen_ai.usage.cache_write.input_tokens',
  'error.type',
  'factory.run.id',
  'factory.run.ending',
  'factory.run.requested_level',
  'factory.stations.recorded',
  'factory.calls.untimed',
  'factory.station',
  'factory.task.id',
  'factory.task.status',
  'factory.attempt',
  'factory.usage.reading',
  'factory.usage.cost_usd',
  'factory.relay.calls',
  'factory.relay.refused',
  'factory.relay.exhausted',
  'factory.call.ended',
  'factory.check.id',
  'factory.check.exit_code',
  'factory.check.held',
  'factory.claim.tool_calls',
  'factory.decision.cause',
  'factory.decision.decided_by',
  'factory.token.kind',
] as const;

export type TelemetryAttribute = (typeof TELEMETRY_ATTRIBUTES)[number];

export interface OtlpValue {
  readonly stringValue?: string;
  readonly intValue?: string;
  readonly doubleValue?: number;
  readonly boolValue?: boolean;
}

export interface OtlpAttribute {
  readonly key: TelemetryAttribute;
  readonly value: OtlpValue;
}

export interface OtlpSpanEvent {
  readonly timeUnixNano: string;
  readonly name: string;
  readonly attributes: readonly OtlpAttribute[];
}

/** `kind`: 1 internal, 3 client. `status.code`: 0 unset, 1 ok, 2 error. */
export interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string;
  readonly name: string;
  readonly kind: 1 | 3;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly OtlpAttribute[];
  readonly events: readonly OtlpSpanEvent[];
  readonly status: { readonly code: 0 | 1 | 2 };
}

interface OtlpResource {
  readonly attributes: readonly OtlpAttribute[];
}

interface OtlpScope {
  readonly name: string;
}

/** The body of `POST /v1/traces`: an `ExportTraceServiceRequest`. */
export interface OtlpTraces {
  readonly resourceSpans: ReadonlyArray<{ readonly resource: OtlpResource; readonly scopeSpans: ReadonlyArray<{ readonly scope: OtlpScope; readonly spans: readonly OtlpSpan[] }> }>;
}

export interface OtlpNumberPoint {
  readonly startTimeUnixNano: string;
  readonly timeUnixNano: string;
  readonly attributes: readonly OtlpAttribute[];
  readonly asInt?: string;
  readonly asDouble?: number;
}

export interface OtlpHistogramPoint {
  readonly startTimeUnixNano: string;
  readonly timeUnixNano: string;
  readonly attributes: readonly OtlpAttribute[];
  readonly count: string;
  readonly sum: number;
  readonly bucketCounts: readonly string[];
  readonly explicitBounds: readonly number[];
}

/** `aggregationTemporality` 1 is delta: every point is one call's own contribution. */
export type OtlpMetric =
  | { readonly name: string; readonly unit: string; readonly sum: { readonly aggregationTemporality: 1; readonly isMonotonic: true; readonly dataPoints: readonly OtlpNumberPoint[] } }
  | { readonly name: string; readonly unit: string; readonly histogram: { readonly aggregationTemporality: 1; readonly dataPoints: readonly OtlpHistogramPoint[] } };

/** The body of `POST /v1/metrics`: an `ExportMetricsServiceRequest`. */
export interface OtlpMetrics {
  readonly resourceMetrics: ReadonlyArray<{ readonly resource: OtlpResource; readonly scopeMetrics: ReadonlyArray<{ readonly scope: OtlpScope; readonly metrics: readonly OtlpMetric[] }> }>;
}

export interface TelemetryExport {
  readonly traces: OtlpTraces;
  readonly metrics: OtlpMetrics;
}

/** A run that may still change is not exported: its spans would be sent again with other ends (D-R12-04). */
export type TelemetryResult = { readonly ok: true; readonly export: TelemetryExport } | { readonly ok: false; readonly reason: 'not-finished' };

const SERVICE = 'software-factory';
const SCOPE: OtlpScope = { name: 'factory.telemetry' };
const SPAN_INTERNAL = 1;
const SPAN_CLIENT = 3;

const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

function hex(text: string, chars: number): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, chars);
}

function nanos(iso: string): string {
  return (BigInt(Date.parse(iso)) * 1_000_000n).toString();
}

function str(key: TelemetryAttribute, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function int(key: TelemetryAttribute, value: number): OtlpAttribute {
  return { key, value: { intValue: String(Math.trunc(value)) } };
}

function dbl(key: TelemetryAttribute, value: number): OtlpAttribute {
  return { key, value: { doubleValue: value } };
}

function bool(key: TelemetryAttribute, value: boolean): OtlpAttribute {
  return { key, value: { boolValue: value } };
}

const latest = (times: readonly string[]): string => times.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
const earliest = (times: readonly string[]): string => times.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));

/** One driver call, its pending record and its reading paired, with the times the runtime stamped. */
interface Call {
  readonly record: UsageRecord;
  readonly startedAt: string;
  /** Null where no reading followed the pending record: the call was lost with the process. */
  readonly endedAt: string | null;
}

/**
 * The calls the run made that carry times, and the count of those that do not
 * (records written before A-R12-01). A pending record whose reading follows it
 * is the same call; one with none is a call whose end was never recorded.
 */
function callsOf(usage: readonly UsageRecord[]): { calls: Call[]; untimed: number } {
  const calls: Call[] = [];
  let untimed = 0;
  const settled = new Set<string>();
  const key = (r: UsageRecord, startedAt: string): string => JSON.stringify([r.taskId, r.station, r.attempt, startedAt]);
  for (const r of usage) {
    if (r.reading.kind === 'pending') continue;
    if (r.timing === 'not-recorded') {
      untimed += 1;
      continue;
    }
    settled.add(key(r, r.timing.startedAt));
    calls.push({ record: r, startedAt: r.timing.startedAt, endedAt: r.timing.endedAt });
  }
  for (const r of usage) {
    if (r.reading.kind !== 'pending') continue;
    if (r.timing === 'not-recorded') {
      untimed += 1;
      continue;
    }
    if (!settled.has(key(r, r.timing.startedAt))) calls.push({ record: r, startedAt: r.timing.startedAt, endedAt: null });
  }
  calls.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  return { calls, untimed };
}

/**
 * The index of the station entry a time at `station` falls in: the last entry
 * for that station entered at or before it, else the first entry for it, else
 * null where the run never recorded entering it.
 */
function entryAt(stations: readonly StationEntry[], station: StationId | null, at: string): number | null {
  if (station === null) return null;
  let found: number | null = null;
  for (const [i, e] of stations.entries()) {
    if (e.station !== station) continue;
    if (found === null || Date.parse(e.enteredAt) <= Date.parse(at)) found = i;
  }
  return found;
}

function callAttributes(call: Call): OtlpAttribute[] {
  const { record } = call;
  const attributes: OtlpAttribute[] = [
    str('gen_ai.operation.name', 'invoke_agent'),
    str('gen_ai.provider.name', record.model.provider),
    str('gen_ai.request.model', record.model.model),
    str('gen_ai.agent.name', record.role.id),
    str('gen_ai.agent.version', record.role.sha256),
    str('factory.task.id', record.taskId),
    str('factory.station', record.station),
    int('factory.attempt', record.attempt),
    bool('factory.call.ended', call.endedAt !== null),
  ];
  const { reading } = record;
  // A call with no reading after it was lost with the process that made it (D-I1a-12).
  attributes.push(str('factory.usage.reading', call.endedAt === null ? 'lost' : reading.kind));
  if (reading.kind === 'metered' && call.endedAt !== null) {
    // The relay counts input apart from cached input; the convention's input count includes it.
    attributes.push(
      int('gen_ai.usage.input_tokens', reading.inputTokens + reading.cacheReadTokens + reading.cacheWriteTokens),
      int('gen_ai.usage.output_tokens', reading.outputTokens),
      int('gen_ai.usage.cache_read.input_tokens', reading.cacheReadTokens),
      int('gen_ai.usage.cache_write.input_tokens', reading.cacheWriteTokens),
      dbl('factory.usage.cost_usd', reading.costUsd),
      int('factory.relay.calls', reading.calls),
      int('factory.relay.refused', reading.refused),
      str('factory.relay.exhausted', reading.exhausted),
    );
  }
  if (reading.kind === 'lost' || call.endedAt === null) attributes.push(str('error.type', 'meter-lost'));
  return attributes;
}

function decisionEvent(d: EnforcementDecision): OtlpSpanEvent {
  return {
    timeUnixNano: nanos(d.decidedAt),
    name: 'decision',
    attributes: [str('factory.decision.cause', d.decision.cause), str('factory.decision.decided_by', d.decision.decidedBy)],
  };
}

function runStatus(ending: RunRecords['ending']): 0 | 1 | 2 {
  if (ending === 'merged' || ending === 'passed') return 1;
  return ending === 'halted' ? 2 : 0;
}

function resource(): OtlpResource {
  return { attributes: [str('service.name', SERVICE)] };
}

/**
 * The run's export, or `not-finished` for a run whose ending R2 reads as
 * `unfinished`. Throws where the Vault holds no record of the run at all.
 */
export async function telemetryOf(vault: Vault, runId: RunId): Promise<TelemetryResult> {
  const records = await readRunRecords(vault, runId);
  if (records.ending === 'unfinished') return { ok: false, reason: 'not-finished' };
  const traceId = hex(`trace\0${runId}`, 32);
  const spanId = (key: string): string => hex(`span\0${runId}\0${key}`, 16);
  const runSpanId = spanId('run');
  const runAttributes: OtlpAttribute[] = [str('factory.run.id', runId), str('factory.run.ending', records.ending)];
  if (records.requestedLevel !== null) runAttributes.push(int('factory.run.requested_level', records.requestedLevel));

  if (records.ending === 'refused') {
    // Refused at admission: no state, one instant, the refusal its event.
    const at = records.startedAt ?? earliest(records.decisions.map((d) => d.decidedAt));
    const span: OtlpSpan = {
      traceId, spanId: runSpanId, parentSpanId: '', name: 'run', kind: SPAN_INTERNAL,
      startTimeUnixNano: nanos(at), endTimeUnixNano: nanos(at),
      attributes: runAttributes, events: records.decisions.map(decisionEvent), status: { code: 0 },
    };
    return { ok: true, export: { traces: tracesOf([span]), metrics: metricsOf([]) } };
  }

  const state = await vault.readRunState(runId);
  const bundles: EvidenceBundle[] = [];
  for (const ref of state.evidenceRefs) bundles.push(decode(await vault.read(ref)) as EvidenceBundle);
  const { calls, untimed } = callsOf(records.usage);
  const stations = state.stations;

  const start = records.startedAt ?? stations[0]?.enteredAt;
  if (start === undefined) throw new Error(`telemetry: run ${runId} records no time it was admitted`);
  const end = latest([start, ...endTimes(state, records, calls, bundles)]);

  const spans: OtlpSpan[] = [];
  const stationSpanIds = stations.map((e, i) => spanId(`station\0${String(i)}\0${e.station}`));
  const stationEnd = (i: number): string => stations[i + 1]?.enteredAt ?? end;

  // Tasks grouped under the station entry they acted in; a task span covers its calls and checks.
  interface TaskGroup { readonly entry: number | null; readonly taskId: TaskId; readonly times: string[]; readonly children: OtlpSpan[] }
  const groups = new Map<string, TaskGroup>();
  const groupOf = (entry: number | null, taskId: TaskId): TaskGroup => {
    const key = JSON.stringify([entry, taskId]);
    let group = groups.get(key);
    if (group === undefined) {
      group = { entry, taskId, times: [], children: [] };
      groups.set(key, group);
    }
    return group;
  };
  const taskSpanId = (g: TaskGroup): string => spanId(`task\0${String(g.entry)}\0${g.taskId}`);

  for (const call of calls) {
    const group = groupOf(entryAt(stations, call.record.station, call.startedAt), call.record.taskId);
    const callEnd = call.endedAt ?? call.startedAt;
    group.times.push(call.startedAt, callEnd);
    const lost = call.endedAt === null || call.record.reading.kind === 'lost';
    group.children.push({
      traceId,
      spanId: spanId(`call\0${call.record.taskId}\0${call.record.station}\0${String(call.record.attempt)}\0${call.startedAt}`),
      parentSpanId: taskSpanId(group),
      name: `invoke_agent ${call.record.role.id}`,
      kind: SPAN_CLIENT,
      startTimeUnixNano: nanos(call.startedAt),
      endTimeUnixNano: nanos(callEnd),
      attributes: callAttributes(call),
      events: [],
      status: { code: lost ? 2 : 0 },
    });
  }

  for (const [b, bundle] of bundles.entries()) {
    for (const [c, check] of bundle.checks.entries()) {
      const checkEnd = new Date(Date.parse(check.startedAt) + check.durationMs).toISOString();
      const group = groupOf(entryAt(stations, 'verify', check.startedAt), bundle.taskId);
      group.times.push(check.startedAt, checkEnd);
      const attributes = [str('factory.check.id', check.checkId), int('factory.check.exit_code', check.exitCode), str('factory.task.id', bundle.taskId)];
      if (check.expectation !== null) attributes.push(bool('factory.check.held', check.expectation.held));
      group.children.push({
        traceId, spanId: spanId(`check\0${String(b)}\0${String(c)}`), parentSpanId: taskSpanId(group),
        name: `check ${check.checkId}`, kind: SPAN_INTERNAL,
        startTimeUnixNano: nanos(check.startedAt), endTimeUnixNano: nanos(checkEnd),
        attributes, events: [], status: { code: 0 },
      });
    }
  }

  const toolCalls = await toolCallCounts(vault, state);
  const taskStatus = new Map(records.tasks.map((t) => [t.taskId, t]));
  for (const group of groups.values()) {
    const parent = group.entry === null ? runSpanId : (stationSpanIds[group.entry] ?? runSpanId);
    const attributes = [str('factory.task.id', group.taskId)];
    const task = taskStatus.get(group.taskId);
    if (task !== undefined) attributes.push(str('factory.task.status', task.status));
    if (group.entry !== null) attributes.push(str('factory.station', stations[group.entry]?.station ?? ''));
    // The driver's own account of its tool calls, on the task's span at the station its calls were made: a claim, never the runtime's count (I2).
    const claimed = toolCalls.get(group.taskId);
    if (claimed !== undefined && group.entry !== null && stations[group.entry]?.station === task?.station) attributes.push(int('factory.claim.tool_calls', claimed));
    spans.push({
      traceId, spanId: taskSpanId(group), parentSpanId: parent,
      name: `task ${group.taskId}`, kind: SPAN_INTERNAL,
      startTimeUnixNano: nanos(earliest(group.times)), endTimeUnixNano: nanos(latest(group.times)),
      attributes, events: [], status: { code: 0 },
    }, ...group.children);
  }

  // Each decision on the span of the station it names, where the run recorded entering it; else on the run's.
  const eventsBySpan = new Map<string, OtlpSpanEvent[]>();
  for (const d of records.decisions) {
    const entry = entryAt(stations, d.station, d.decidedAt);
    const target = entry === null ? runSpanId : (stationSpanIds[entry] ?? runSpanId);
    eventsBySpan.set(target, [...(eventsBySpan.get(target) ?? []), decisionEvent(d)]);
  }

  for (const [i, e] of stations.entries()) {
    const id = stationSpanIds[i] ?? spanId(`station\0${String(i)}`);
    spans.push({
      traceId, spanId: id, parentSpanId: runSpanId, name: `station ${e.station}`, kind: SPAN_INTERNAL,
      startTimeUnixNano: nanos(e.enteredAt), endTimeUnixNano: nanos(stationEnd(i)),
      attributes: [str('factory.station', e.station)], events: eventsBySpan.get(id) ?? [], status: { code: 0 },
    });
  }

  runAttributes.push(bool('factory.stations.recorded', stations.length > 0));
  if (untimed > 0) runAttributes.push(int('factory.calls.untimed', untimed));
  spans.unshift({
    traceId, spanId: runSpanId, parentSpanId: '', name: 'run', kind: SPAN_INTERNAL,
    startTimeUnixNano: nanos(start), endTimeUnixNano: nanos(end),
    attributes: runAttributes, events: eventsBySpan.get(runSpanId) ?? [], status: { code: runStatus(records.ending) },
  });

  return { ok: true, export: { traces: tracesOf(spans), metrics: metricsOf(calls) } };
}

/** Every time the run's records hold after admission: the run's span ends at the latest. */
function endTimes(state: RunState, records: RunRecords, calls: readonly Call[], bundles: readonly EvidenceBundle[]): string[] {
  const times: string[] = state.stations.map((e) => e.enteredAt);
  for (const c of calls) times.push(c.endedAt ?? c.startedAt);
  for (const b of bundles) for (const c of b.checks) times.push(new Date(Date.parse(c.startedAt) + c.durationMs).toISOString());
  for (const d of records.decisions) times.push(d.decidedAt);
  for (const g of state.approvals) times.push(g.usedAt ?? g.approvedAt);
  if (records.mergedAt !== null) times.push(records.mergedAt);
  if (state.cancelled !== null) times.push(state.cancelled.at);
  if (state.halted !== null) times.push(state.halted.at);
  return times.filter((t) => !Number.isNaN(Date.parse(t)));
}

/** The tool calls each task's latest recorded result says it made: the driver's account (I2). */
async function toolCallCounts(vault: Vault, state: RunState): Promise<Map<TaskId, number>> {
  const counts = new Map<TaskId, number>();
  for (const [taskId, ref] of Object.entries(state.results)) {
    const result = decode(await vault.read(ref)) as TaskResult;
    counts.set(taskId as TaskId, result.events.filter((e) => e.kind === 'tool-call').length);
  }
  return counts;
}

function tracesOf(spans: readonly OtlpSpan[]): OtlpTraces {
  return { resourceSpans: [{ resource: resource(), scopeSpans: [{ scope: SCOPE, spans }] }] };
}

/** One point per call that ended with a reading, each over the call's own start and end. */
function metricsOf(calls: readonly Call[]): OtlpMetrics {
  const duration: OtlpHistogramPoint[] = [];
  const tokens: OtlpNumberPoint[] = [];
  const cost: OtlpNumberPoint[] = [];
  for (const call of calls) {
    if (call.endedAt === null) continue;
    const { record } = call;
    const startTimeUnixNano = nanos(call.startedAt);
    const timeUnixNano = nanos(call.endedAt);
    const attributes = [
      str('gen_ai.operation.name', 'invoke_agent'),
      str('gen_ai.provider.name', record.model.provider),
      str('gen_ai.request.model', record.model.model),
      str('factory.station', record.station),
    ];
    const seconds = (Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000;
    duration.push({
      startTimeUnixNano, timeUnixNano,
      attributes: record.reading.kind === 'lost' ? [...attributes, str('error.type', 'meter-lost')] : attributes,
      count: '1', sum: seconds, bucketCounts: ['1'], explicitBounds: [],
    });
    const { reading } = record;
    // Only a metered reading has counts; an unmetered or lost one is absent, never a zero.
    if (reading.kind !== 'metered') continue;
    for (const [kind, value] of [['input', reading.inputTokens], ['output', reading.outputTokens], ['cache_read', reading.cacheReadTokens], ['cache_write', reading.cacheWriteTokens]] as const) {
      tokens.push({ startTimeUnixNano, timeUnixNano, attributes: [...attributes, str('factory.token.kind', kind)], asInt: String(value) });
    }
    cost.push({ startTimeUnixNano, timeUnixNano, attributes, asDouble: reading.costUsd });
  }
  const metrics: OtlpMetric[] = [
    { name: 'gen_ai.client.operation.duration', unit: 's', histogram: { aggregationTemporality: 1, dataPoints: duration } },
    { name: 'factory.usage.tokens', unit: '{token}', sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: tokens } },
    { name: 'factory.usage.cost', unit: '{USD}', sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: cost } },
  ];
  return { resourceMetrics: [{ resource: resource(), scopeMetrics: [{ scope: SCOPE, metrics }] }] };
}
