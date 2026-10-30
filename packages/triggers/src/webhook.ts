/**
 * The signed-webhook transport (D-A-TF-06, D-R22-02). Every check here runs
 * on the exact bytes, before anything parses them.
 *
 * GitHub signs the body alone, with HMAC-SHA256 under the subscription's
 * secret, in `X-Hub-Signature-256: sha256=<hex>`. It signs no timestamp and no
 * delivery id, so neither is read: replay is the body's digest, and staleness
 * is the body's own time, checked by the extractor.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** The cap a body is held to before it is read (D-R22-10). */
export const MAX_DELIVERY_BYTES = 1024 * 1024;

const SIGNATURE = /^sha256=([0-9a-f]{64})$/u;

/**
 * Whether `header` is the HMAC-SHA256 of `body` under `secret`, compared in
 * constant time. A header that is absent or not the one shape is false, and
 * so is an empty secret: a subscription whose secret the host lacks verifies
 * nothing (I5).
 */
export function signatureVerifies(body: Uint8Array, header: string | undefined, secret: string): boolean {
  if (secret === '' || header === undefined) return false;
  const match = SIGNATURE.exec(header);
  const presented = match?.[1];
  if (presented === undefined) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(Buffer.from(presented, 'hex'), expected);
}

/** The SHA-256 of the exact body, hex: the replay key, stored in the same write as the delivery's outcome. */
export function bodyDigest(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

/** What a sender computes: for tests and fixtures, which sign as GitHub does. */
export function signBody(body: Uint8Array, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}
