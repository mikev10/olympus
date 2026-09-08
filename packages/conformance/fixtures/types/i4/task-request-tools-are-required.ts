// I4: a task request must carry the policy-granted tool list. A driver
// cannot be handed a request with the grant left implicit.
import type { TaskRequest } from '@olympus-ai/core';

declare const request: TaskRequest;

export const withoutTools: TaskRequest = { // expect-error TS2741: Property 'tools' is missing
  taskId: request.taskId,
  role: request.role,
  stablePrefix: request.stablePrefix,
  variableSuffix: request.variableSuffix,
  tier: request.tier,
  sandbox: request.sandbox,
  timeoutMs: request.timeoutMs,
  budget: request.budget,
};

export const withoutSandbox: TaskRequest = { // expect-error TS2741: Property 'sandbox' is missing
  taskId: request.taskId,
  role: request.role,
  stablePrefix: request.stablePrefix,
  variableSuffix: request.variableSuffix,
  tier: request.tier,
  tools: request.tools,
  timeoutMs: request.timeoutMs,
  budget: request.budget,
};
