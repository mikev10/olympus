/**
 * Tests for Agent Usage Reminder Hook
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAgentUsageReminderHook } from './index.js';
import { writeAscentState, clearAscentState } from '../ascent/index.js';
import { writeUltraworkState, deactivateUltrawork } from '../ultrawork-state/index.js';
import { writeOlympusState, deactivateOlympus } from '../olympus-state/index.js';
import type { AscentLoopState } from '../ascent/index.js';
import type { UltraworkState } from '../ultrawork-state/index.js';
import type { OlympusState } from '../olympus-state/index.js';

describe('Agent Usage Reminder Hook - Strict Conductor Mode', () => {
  const testDir = process.cwd();

  afterEach(() => {
    // Clean up state files
    clearAscentState(testDir);
    deactivateUltrawork(testDir);
    deactivateOlympus(testDir);
  });

  it('should not trigger strict mode when no persistent mode is active', async () => {
    const hook = createAgentUsageReminderHook();
    const toolExecuteAfter = hook['tool.execute.after'];

    const input = {
      tool: 'Edit',
      sessionID: 'test-session-1',
      callID: 'call-1',
      properties: { file_path: '/test/file.ts' }
    };

    const output = {
      title: 'Edit',
      output: 'File edited successfully',
      metadata: {}
    };

    await toolExecuteAfter(input, output);

    // Should not add strict conductor violation
    expect(output.output).not.toContain('CONDUCTOR MODE VIOLATION');
  });

  it('should trigger strict mode after 3 consecutive edits in ascent mode', async () => {
    // Activate ascent mode
    const ascentState: AscentLoopState = {
      active: true,
      iteration: 1,
      max_iterations: 10,
      completion_promise: 'TASK_COMPLETE',
      started_at: new Date().toISOString(),
      prompt: 'Test task',
      session_id: 'test-session-2'
    };
    writeAscentState(testDir, ascentState);

    const hook = createAgentUsageReminderHook();
    const toolExecuteAfter = hook['tool.execute.after'];

    const sessionID = 'test-session-2';

    // First edit
    await toolExecuteAfter(
      { tool: 'Edit', sessionID, callID: 'call-1', properties: { file_path: '/test/file1.ts' } },
      { title: 'Edit', output: '', metadata: {} }
    );

    // Second edit
    await toolExecuteAfter(
      { tool: 'Edit', sessionID, callID: 'call-2', properties: { file_path: '/test/file2.ts' } },
      { title: 'Edit', output: '', metadata: {} }
    );

    // Third edit - should trigger warning
    const output3 = { title: 'Edit', output: '', metadata: {} };
    await toolExecuteAfter(
      { tool: 'Edit', sessionID, callID: 'call-3', properties: { file_path: '/test/file3.ts' } },
      output3
    );

    expect(output3.output).toContain('CONDUCTOR MODE VIOLATION');
    expect(output3.output).toContain('WARNING');
    expect(output3.output).toContain('ASCENT ACTIVE');
  });

  it('should trigger critical mode after 5 consecutive edits', async () => {
    // Activate ultrawork mode
    const ultraworkState: UltraworkState = {
      active: true,
      started_at: new Date().toISOString(),
      original_prompt: 'Test task',
      session_id: 'test-session-3',
      reinforcement_count: 0,
      last_checked_at: new Date().toISOString()
    };
    writeUltraworkState(ultraworkState, testDir);

    const hook = createAgentUsageReminderHook();
    const toolExecuteAfter = hook['tool.execute.after'];

    const sessionID = 'test-session-3';

    // Make 5 consecutive edits
    for (let i = 1; i <= 5; i++) {
      const output = { title: 'Edit', output: '', metadata: {} };
      await toolExecuteAfter(
        { tool: 'Edit', sessionID, callID: `call-${i}`, properties: { file_path: `/test/file${i}.ts` } },
        output
      );

      if (i >= 5) {
        expect(output.output).toContain('CRITICAL');
        expect(output.output).toContain('Too many direct operations');
      }
    }
  });

  it('should reset counter when Task tool is used', async () => {
    // Activate olympus mode
    const olympusState: OlympusState = {
      active: true,
      started_at: new Date().toISOString(),
      original_prompt: 'Test task',
      session_id: 'test-session-4',
      reinforcement_count: 0,
      last_checked_at: new Date().toISOString(),
      requires_oracle_verification: false,
      oracle_approved: false
    };
    writeOlympusState(olympusState, testDir);

    const hook = createAgentUsageReminderHook();
    const toolExecuteAfter = hook['tool.execute.after'];

    const sessionID = 'test-session-4';

    // Make 2 edits
    await toolExecuteAfter(
      { tool: 'Edit', sessionID, callID: 'call-1', properties: { file_path: '/test/file1.ts' } },
      { title: 'Edit', output: '', metadata: {} }
    );
    await toolExecuteAfter(
      { tool: 'Edit', sessionID, callID: 'call-2', properties: { file_path: '/test/file2.ts' } },
      { title: 'Edit', output: '', metadata: {} }
    );

    // Use Task tool (delegation)
    await toolExecuteAfter(
      { tool: 'Task', sessionID, callID: 'call-3', properties: {} },
      { title: 'Task', output: '', metadata: {} }
    );

    // Make 2 more edits - should not trigger yet since counter was reset
    const output4 = { title: 'Edit', output: '', metadata: {} };
    await toolExecuteAfter(
      { tool: 'Edit', sessionID, callID: 'call-4', properties: { file_path: '/test/file4.ts' } },
      output4
    );

    const output5 = { title: 'Edit', output: '', metadata: {} };
    await toolExecuteAfter(
      { tool: 'Edit', sessionID, callID: 'call-5', properties: { file_path: '/test/file5.ts' } },
      output5
    );

    // Should not trigger yet (only 2 consecutive after reset)
    expect(output5.output).not.toContain('CONDUCTOR MODE VIOLATION');
  });

  it('should identify correct mode name in violation message', async () => {
    // Activate olympus mode
    const olympusState: OlympusState = {
      active: true,
      started_at: new Date().toISOString(),
      original_prompt: 'Test task',
      session_id: 'test-session-5',
      reinforcement_count: 0,
      last_checked_at: new Date().toISOString(),
      requires_oracle_verification: false,
      oracle_approved: false
    };
    writeOlympusState(olympusState, testDir);

    const hook = createAgentUsageReminderHook();
    const toolExecuteAfter = hook['tool.execute.after'];

    const sessionID = 'test-session-5';

    // Make 3 consecutive edits
    for (let i = 1; i <= 3; i++) {
      const output = { title: 'Edit', output: '', metadata: {} };
      await toolExecuteAfter(
        { tool: 'Edit', sessionID, callID: `call-${i}`, properties: { file_path: `/test/file${i}.ts` } },
        output
      );

      if (i === 3) {
        expect(output.output).toContain('OLYMPUS ACTIVE');
        expect(output.output).toContain('In olympus mode, you are a CONDUCTOR');
      }
    }
  });
});
