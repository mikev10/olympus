/**
 * Quest State Constants
 *
 * Core Olympus feature for quest state management and plan tracking.
 */

/** Olympus state directory */
export const OLYMPUS_DIR = '.olympus';

/** Quest state file name */
export const QUEST_FILE = 'quest.json';

/** Full path pattern for quest state */
export const QUEST_STATE_PATH = `${OLYMPUS_DIR}/${QUEST_FILE}`;

/** Notepad directory for learnings */
export const NOTEPAD_DIR = 'notepads';

/** Full path for notepads */
export const NOTEPAD_BASE_PATH = `${OLYMPUS_DIR}/${NOTEPAD_DIR}`;

/** Prometheus plan directory */
export const PROMETHEUS_PLANS_DIR = '.olympus/plans';

/** Plan file extension */
export const PLAN_EXTENSION = '.md';
