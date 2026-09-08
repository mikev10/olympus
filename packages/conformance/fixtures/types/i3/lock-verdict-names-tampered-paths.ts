// I3: a failed lock verification must say which paths changed and how. A
// bare failure is not representable, and success has no room for a warning.
import type { LockEntry, LockManifest, LockVerdict } from '@olympus-ai/vault';

export const clean: LockVerdict = { ok: true };
export const tampered: LockVerdict = { ok: false, tampered: [{ path: 'spec.md', expected: 'a', actual: 'b' }] };
export const bare: LockVerdict = { ok: false }; // expect-error TS2322: Property 'tampered' is missing in type '{ ok: false; }'
export const warned: LockVerdict = { ok: true, warnings: ['spec.md changed'] }; // expect-error TS2353: 'warnings' does not exist in type '{ ok: true; }'

declare const manifest: LockManifest;
export const entries: LockEntry[] = manifest.entries;
export const hash: string = entries.map((e) => e.sha256).join(',');
