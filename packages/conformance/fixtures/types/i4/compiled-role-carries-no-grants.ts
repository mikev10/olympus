// I4: grants reach a driver only through TaskRequest, which policy fills. A
// compiled role has no field for them, so the compiler cannot become a
// second source of truth for what a role may do.
import type { CompiledRole } from '@olympus-ai/core';

declare const role: CompiledRole;

export const withTools: CompiledRole = { ...role, tools: ['bash'] }; // expect-error TS2353: 'tools' does not exist in type 'CompiledRole'
export const withNetwork: CompiledRole = { ...role, network: { egress: 'none' } }; // expect-error TS2353: 'network' does not exist in type 'CompiledRole'
export const withGlobs: CompiledRole = { ...role, writableGlobs: ['**'] }; // expect-error TS2353: 'writableGlobs' does not exist in type 'CompiledRole'
export const withLevel: CompiledRole = { ...role, autonomyCeiling: 3 }; // expect-error TS2353: 'autonomyCeiling' does not exist in type 'CompiledRole'
