/**
 * R55 (#176): the start-up key check against the real provider.
 *
 * **This file needs `ANTHROPIC_API_KEY` and is never skipped.** It spends
 * nothing: the check is one `GET` of the model list. It is in the paid suite
 * because that suite is the only place a real key exists, so this is where
 * "the provider accepts a valid key at this route" is run rather than read
 * from the provider's documentation (D-R55-04, C8).
 */
import { expect, test } from 'vitest';
import { probeModelKey } from '../../src/host/key-probe.js';

test('the real provider accepts the real key at the start-up check, and rejects a made-up one', async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key === undefined || key === '') throw new Error('the key check needs ANTHROPIC_API_KEY; it is never skipped');
  expect(await probeModelKey(key)).toBeNull();
  const refused = await probeModelKey(`${key.slice(0, 8)}-made-up-for-the-key-check`);
  expect(refused).toMatch(/^ANTHROPIC_API_KEY was rejected by api\.anthropic\.com \(401\)/u);
  expect(refused).not.toContain(key);
});
