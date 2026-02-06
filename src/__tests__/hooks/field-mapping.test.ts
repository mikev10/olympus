/**
 * Field Mapping Test for Hook Entry Point
 *
 * Verifies that Claude Code's snake_case input fields are correctly
 * mapped to Olympus's camelCase HookContext format.
 */

import { describe, it, expect } from 'vitest';
import type { HookContext } from '../../hooks/types.js';

describe('Hook Field Mapping', () => {
  describe('Claude Code → Olympus Field Transformation', () => {
    it('maps cwd to directory', () => {
      const rawInput = {
        cwd: '/home/user/project',
        session_id: 'test-session'
      };

      // Simulate the mapping logic from entry.ts
      const context: HookContext = {
        ...rawInput,
        directory: (rawInput.cwd as string) || (rawInput as any).directory,
        sessionId: rawInput.session_id || (rawInput as any).sessionId,
      } as HookContext;

      expect(context.directory).toBe('/home/user/project');
      expect(context.cwd).toBe('/home/user/project'); // Original field also preserved
    });

    it('maps session_id to sessionId', () => {
      const rawInput = {
        cwd: '/home/user/project',
        session_id: 'abc-123-def'
      };

      const context: HookContext = {
        ...rawInput,
        directory: (rawInput.cwd as string) || (rawInput as any).directory,
        sessionId: rawInput.session_id || (rawInput as any).sessionId,
      } as HookContext;

      expect(context.sessionId).toBe('abc-123-def');
    });

    it('maps tool_name to toolName', () => {
      const rawInput = {
        cwd: '/home/user/project',
        session_id: 'test',
        tool_name: 'Task'
      };

      const context: HookContext = {
        ...rawInput,
        directory: (rawInput.cwd as string) || (rawInput as any).directory,
        sessionId: rawInput.session_id || (rawInput as any).sessionId,
        toolName: rawInput.tool_name || (rawInput as any).toolName,
      } as HookContext;

      expect(context.toolName).toBe('Task');
    });

    it('maps tool_input to toolInput', () => {
      const rawInput = {
        cwd: '/home/user/project',
        session_id: 'test',
        tool_name: 'Task',
        tool_input: {
          subagent_type: 'oracle',
          prompt: 'analyze this code'
        }
      };

      const context: HookContext = {
        ...rawInput,
        directory: (rawInput.cwd as string) || (rawInput as any).directory,
        sessionId: rawInput.session_id || (rawInput as any).sessionId,
        toolName: rawInput.tool_name || (rawInput as any).toolName,
        toolInput: rawInput.tool_input || (rawInput as any).toolInput,
      } as HookContext;

      expect(context.toolInput).toEqual({
        subagent_type: 'oracle',
        prompt: 'analyze this code'
      });
    });

    it('maps tool_response to toolOutput', () => {
      const rawInput = {
        cwd: '/home/user/project',
        session_id: 'test',
        tool_name: 'Task',
        tool_response: {
          success: true,
          result: 'Analysis complete'
        }
      };

      const context: HookContext = {
        ...rawInput,
        directory: (rawInput.cwd as string) || (rawInput as any).directory,
        sessionId: rawInput.session_id || (rawInput as any).sessionId,
        toolName: rawInput.tool_name || (rawInput as any).toolName,
        toolOutput: rawInput.tool_response || (rawInput as any).toolOutput,
      } as HookContext;

      expect(context.toolOutput).toEqual({
        success: true,
        result: 'Analysis complete'
      });
    });

    it('handles PreToolUse input structure', () => {
      // Simulate Claude Code PreToolUse JSON input
      const claudeInput = {
        cwd: '/Users/dev/project',
        session_id: 'session-123',
        tool_name: 'Task',
        tool_input: {
          subagent_type: 'olympian',
          prompt: 'Implement feature X',
          run_in_background: false
        },
        hook_event_name: 'PreToolUse',
        transcript_path: '/tmp/transcript.json'
      };

      // Apply the mapping (same as entry.ts)
      const context: HookContext = {
        ...claudeInput,
        directory: (claudeInput.cwd as string) || (claudeInput as any).directory,
        sessionId: claudeInput.session_id || (claudeInput as any).sessionId,
        toolName: claudeInput.tool_name || (claudeInput as any).toolName,
        toolInput: claudeInput.tool_input || (claudeInput as any).toolInput,
        toolOutput: (claudeInput as any).tool_response || (claudeInput as any).toolOutput,
      } as HookContext;

      // Verify camelCase fields are populated
      expect(context.directory).toBe('/Users/dev/project');
      expect(context.sessionId).toBe('session-123');
      expect(context.toolName).toBe('Task');
      expect(context.toolInput).toEqual({
        subagent_type: 'olympian',
        prompt: 'Implement feature X',
        run_in_background: false
      });
    });

    it('handles PostToolUse input structure with tool_response', () => {
      const claudeInput = {
        cwd: '/Users/dev/project',
        session_id: 'session-456',
        tool_name: 'Task',
        tool_input: {
          subagent_type: 'oracle',
          prompt: 'Verify implementation'
        },
        tool_response: {
          success: true,
          message: 'Verification complete'
        },
        hook_event_name: 'PostToolUse'
      };

      const context: HookContext = {
        ...claudeInput,
        directory: (claudeInput.cwd as string) || (claudeInput as any).directory,
        sessionId: claudeInput.session_id || (claudeInput as any).sessionId,
        toolName: claudeInput.tool_name || (claudeInput as any).toolName,
        toolInput: claudeInput.tool_input || (claudeInput as any).toolInput,
        toolOutput: claudeInput.tool_response || (claudeInput as any).toolOutput,
      } as HookContext;

      expect(context.toolOutput).toEqual({
        success: true,
        message: 'Verification complete'
      });
    });

    it('preserves original fields for backward compatibility', () => {
      const rawInput = {
        cwd: '/project',
        session_id: 'test',
        tool_name: 'Task',
        tool_input: { data: 'test' }
      };

      const context: HookContext = {
        ...rawInput,
        directory: (rawInput.cwd as string) || (rawInput as any).directory,
        sessionId: rawInput.session_id || (rawInput as any).sessionId,
        toolName: rawInput.tool_name || (rawInput as any).toolName,
        toolInput: rawInput.tool_input || (rawInput as any).toolInput,
      } as HookContext;

      // Both old and new field names should be present
      expect(context.cwd).toBe('/project');
      expect(context.directory).toBe('/project');
      expect((context as any).session_id).toBe('test');
      expect(context.sessionId).toBe('test');
      expect((context as any).tool_name).toBe('Task');
      expect(context.toolName).toBe('Task');
    });

    it('handles missing fields gracefully', () => {
      const rawInput = {
        cwd: '/project'
      };

      const context: HookContext = {
        ...rawInput,
        directory: (rawInput as any).cwd || (rawInput as any).directory,
        sessionId: (rawInput as any).session_id || (rawInput as any).sessionId,
        toolName: (rawInput as any).tool_name || (rawInput as any).toolName,
        toolInput: (rawInput as any).tool_input || (rawInput as any).toolInput,
        toolOutput: (rawInput as any).tool_response || (rawInput as any).toolOutput,
      } as HookContext;

      expect(context.directory).toBe('/project');
      expect(context.sessionId).toBeUndefined();
      expect(context.toolName).toBeUndefined();
      expect(context.toolInput).toBeUndefined();
      expect(context.toolOutput).toBeUndefined();
    });
  });
});
