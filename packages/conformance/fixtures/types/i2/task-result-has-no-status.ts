// I2: TaskResult carries a claim and the inputs to evidence, never a verdict.
// A model cannot report success because the field to report it in does not
// exist, on the result or on the claim.
import type { AgentClaim, TaskResult } from '@olympus-ai/core';

declare const result: TaskResult;
declare const claim: AgentClaim;

export const status = result.status; // expect-error TS2339: Property 'status' does not exist on type 'TaskResult'
export const passed = result.passed; // expect-error TS2339: Property 'passed' does not exist on type 'TaskResult'
export const success = result.success; // expect-error TS2339: Property 'success' does not exist on type 'TaskResult'
export const verdict = result.verdict; // expect-error TS2339: Property 'verdict' does not exist on type 'TaskResult'
export const ok = result.ok; // expect-error TS2339: Property 'ok' does not exist on type 'TaskResult'
export const exitCode = result.exitCode; // expect-error TS2339: Property 'exitCode' does not exist on type 'TaskResult'

export const claimStatus = claim.status; // expect-error TS2339: Property 'status' does not exist on type 'AgentClaim'
export const claimPassed = claim.passed; // expect-error TS2339: Property 'passed' does not exist on type 'AgentClaim'
export const claimSuccess = claim.success; // expect-error TS2339: Property 'success' does not exist on type 'AgentClaim'
export const claimVerdict = claim.verdict; // expect-error TS2339: Property 'verdict' does not exist on type 'AgentClaim'

export const reported: TaskResult = {
  taskId: result.taskId,
  claim: result.claim,
  events: result.events,
  usage: result.usage,
  model: result.model,
  contractVersion: result.contractVersion,
  status: 'passed', // expect-error TS2353: 'status' does not exist in type 'TaskResult'
};

export const narrative: string = result.claim.narrative;
