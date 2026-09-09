// I2: the runtime derives status, and what it derived stays derived. RunState,
// TaskResult, and AgentClaim are read-only records: a consumer holding one
// cannot rewrite a task's status, move the run to another station, append a
// reference, or edit the model's claim after the runtime collected it. A new
// state is a new record, committed through the Vault.
import type { AgentClaim, RunState, TaskId, TaskResult, VaultRef } from '@olympus-ai/core';

declare const state: RunState;
declare const result: TaskResult;
declare const claim: AgentClaim;
declare const taskId: TaskId;
declare const ref: VaultRef;

export const next: RunState = {
  ...state,
  station: 'verify',
  tasks: { ...state.tasks, [taskId]: 'passed' },
  evidenceRefs: [...state.evidenceRefs, ref],
};

state.station = 'verify'; // expect-error TS2540: Cannot assign to 'station' because it is a read-only property
state.tasks[taskId] = 'passed'; // expect-error TS2542: only permits reading
state.evidenceRefs.push(ref); // expect-error TS2339: Property 'push' does not exist on type 'readonly VaultRef[]'
state.violations.length = 0; // expect-error TS2540: Cannot assign to 'length' because it is a read-only property

result.claim = claim; // expect-error TS2540: Cannot assign to 'claim' because it is a read-only property
result.events.push({ at: '', kind: 'command', detail: {} }); // expect-error TS2339: Property 'push' does not exist on type 'readonly DriverEvent[]'

claim.narrative = 'all tests pass'; // expect-error TS2540: Cannot assign to 'narrative' because it is a read-only property
claim.filesChanged.push('src/index.ts'); // expect-error TS2339: Property 'push' does not exist on type 'readonly string[]'
