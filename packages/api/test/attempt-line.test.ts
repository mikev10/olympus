import { expect, test } from 'vitest';
import type { RunId, TaskId } from '@olympus-ai/core';
import { attemptLine } from '../src/http/server.js';

test('a failed attempt is one log line, whatever its task id, layer, or detail holds (gemini-2)', () => {
  const line = attemptLine('run-1' as RunId, 'task\nrun 2 task x: forged' as TaskId, {
    source: 'driver',
    layer: 'exit\r\nlayer',
    retries: 1,
    untrustedDetail: 'stderr\nmore',
  });
  // eslint-disable-next-line no-control-regex
  expect(line).not.toMatch(/[\u0000-\u001f\u007f]/u);
  expect(line).toContain('task run 2 task x: forged');
});
