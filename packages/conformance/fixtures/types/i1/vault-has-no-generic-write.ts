// I1: the Vault exposes named, audited mutators the runtime calls. There is
// no generic write, put, or delete for anything to reach.
import type { VaultRef } from '@olympus-ai/core';
import type { Vault } from '@olympus-ai/vault';

declare const vault: Vault;
declare const ref: VaultRef;
declare const bytes: Uint8Array;

export const read = vault.read(ref);
export const write = vault.write(ref, bytes); // expect-error TS2339: Property 'write' does not exist on type 'Vault'
export const put = vault.put(ref, bytes); // expect-error TS2339: Property 'put' does not exist on type 'Vault'
export const remove = vault.delete(ref); // expect-error TS2339: Property 'delete' does not exist on type 'Vault'
export const overwrite = vault.writeRunState(ref); // expect-error TS2551: Property 'writeRunState' does not exist on type 'Vault'
