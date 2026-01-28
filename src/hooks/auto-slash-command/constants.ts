/**
 * Auto Slash Command Constants
 *
 * Configuration values for slash command detection.
 *
 * Olympus auto-slash-command hook for extending Claude Code behavior.
 */

export const HOOK_NAME = 'auto-slash-command' as const;

/** XML tags to mark auto-expanded slash commands */
export const AUTO_SLASH_COMMAND_TAG_OPEN = '<auto-slash-command>';
export const AUTO_SLASH_COMMAND_TAG_CLOSE = '</auto-slash-command>';

/** Pattern to detect slash commands at start of message */
export const SLASH_COMMAND_PATTERN = /^\/([a-zA-Z][\w-]*)\s*(.*)/;

/**
 * Commands that should NOT be auto-expanded
 * (they have special handling elsewhere)
 */
export const EXCLUDED_COMMANDS = new Set([
  'ascent',
  'cancel-ascent',
  // Claude Code built-in commands that shouldn't be expanded
  'help',
  'clear',
  'history',
  'exit',
  'quit',
]);
