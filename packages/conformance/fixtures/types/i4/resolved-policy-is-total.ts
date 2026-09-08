// I4: the resolved Policy enumerates all forty station:level approvals, so a
// gate lookup can never miss and nothing downstream has a default to apply.
// Only the authored PolicyDocument may be sparse, and only resolvePolicy
// turns one into the other.
import type { ApprovalOutcome, Policy, PolicyDocument, PolicyEngine } from '@olympus-ai/core';

declare const authored: PolicyDocument;
declare const engine: PolicyEngine;

export const sparse: PolicyDocument['approvals'] = {};
export const resolved: Policy = engine.resolvePolicy(authored);
export const empty: Policy['approvals'] = {}; // expect-error TS2740: Type '{}' is missing the following properties from type 'Record<
export const partial: Policy['approvals'] = { 'intake:0': 'auto' }; // expect-error TS2740: is missing the following properties from type 'Record<
export const outcome: ApprovalOutcome = resolved.approvals['build:2'];
export const authoredAsPolicy: Policy = authored; // expect-error TS2322: Type 'PolicyDocument' is not assignable to type 'Policy'
