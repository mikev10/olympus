// I1: WriteBoundary.vault admits exactly one value. A station contract cannot
// grant Vault access by construction, at any level, for any role.
import type { WriteBoundary } from '@olympus-ai/core';

export const workspaceOnly: WriteBoundary = {
  workspaceGlobs: ['src/**'],
  vault: 'never',
  protectedPathPolicy: 'escalate',
};

export const append: WriteBoundary = {
  workspaceGlobs: ['src/**'],
  vault: 'append', // expect-error TS2322: Type '"append"' is not assignable to type '"never"'
  protectedPathPolicy: 'escalate',
};

export const readWrite: WriteBoundary = {
  workspaceGlobs: ['src/**'],
  vault: 'rw', // expect-error TS2322: Type '"rw"' is not assignable to type '"never"'
  protectedPathPolicy: 'escalate',
};

export const evidenceOnly: WriteBoundary = {
  workspaceGlobs: ['src/**'],
  vault: 'evidence', // expect-error TS2322: Type '"evidence"' is not assignable to type '"never"'
  protectedPathPolicy: 'escalate',
};
