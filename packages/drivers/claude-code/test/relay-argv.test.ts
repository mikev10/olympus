/**
 * The relay this driver ships starts on Windows (R66, #207).
 *
 * Every argument of the command that creates a relay shares one command line,
 * which Windows ends at 32767 characters and no other host does. The price
 * table is the part of it this driver owns, so a table grown past the limit
 * fails here, on any host, before a Windows operator finds it.
 */
import { expect, test } from 'vitest';
import { EGRESS_PROXY_IMAGE, WINDOWS_COMMAND_LINE_LIMIT, checkRelay, relayCreateArgs, windowsCommandLineLength } from '@olympus-ai/sandbox';
import { MODEL_RELAY, SERVER_TOOLS } from '../src/index.js';

test("the argument list for this driver's relay, with its whole price table, is under the Windows command-line limit", () => {
  if (MODEL_RELAY.credential === null) throw new Error('the shipped relay names no credential');
  const plan = checkRelay(
    { ...MODEL_RELAY, serverTools: Object.values(SERVER_TOOLS), budget: { maxTokens: Number.MAX_SAFE_INTEGER, maxCostUsd: Number.MAX_SAFE_INTEGER } },
    new Set([MODEL_RELAY.credential]),
    new Set(),
  );
  // Names as long as the provider makes them, a label, and Docker Desktop's own path to the executable.
  const args = relayCreateArgs(plan, {
    name: `model-relay-${'f'.repeat(64)}`,
    network: `relay-in-${'f'.repeat(64)}`,
    labels: ['--label', `dev.olympus.owner=${'f'.repeat(64)}`],
    image: EGRESS_PROXY_IMAGE,
    secrets: ['RELAY_CREDENTIAL', 'RELAY_TRUST'],
  });
  expect(args.some((arg) => arg.startsWith('RELAY_METER='))).toBe(true);
  expect(windowsCommandLineLength('C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe', args)).toBeLessThan(WINDOWS_COMMAND_LINE_LIMIT);
});
