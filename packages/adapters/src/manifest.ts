import { isConfigFile } from './config-files.js';
import { diffTrees, VCS_DIRECTORIES } from './files.js';
import { isDependencyTree } from './trees.js';
import type { ManifestAdapter } from './types.js';

/**
 * Names every config file added, removed, or modified between two trees, by
 * content: a file rewritten to the same bytes is unchanged, and a symbolic
 * link is compared by its target text, never followed. No dependency tree is
 * walked (D-R29-10): what is installed is decided by the manifests and lockfiles this
 * adapter does report, and by the install the verification run performs.
 */
export class ConfigManifestAdapter implements ManifestAdapter {
  async detectConfigChanges(base: string, head: string): Promise<string[]> {
    const changes = await diffTrees(base, head, isConfigFile, {
      skipDirectory: (name) => isDependencyTree(name) || VCS_DIRECTORIES.has(name),
    });
    return changes.map((c) => c.path);
  }
}
