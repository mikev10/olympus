/**
 * Directory README Injector Constants
 *
 * Constants for finding and injecting README files from directories.
 *
 * Olympus directory-readme-injector hook for extending Claude Code behavior.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';

/** Storage directory for directory-readme-injector state */
export const OLYMPUS_STORAGE_DIR = join(homedir(), '.olympus');
export const README_INJECTOR_STORAGE = join(
  OLYMPUS_STORAGE_DIR,
  'directory-readme',
);

/** README filename to search for */
export const README_FILENAME = 'README.md';

/** Tools that trigger README injection */
export const TRACKED_TOOLS = ['read', 'write', 'edit', 'multiedit'];
