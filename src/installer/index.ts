/**
 * Installer Module
 *
 * Handles installation of Olympus agents, skills, rules, and configuration
 * into the Claude Code config directory (~/.claude/).
 *
 * Content is read from the `resources/` directory at runtime rather than
 * being embedded as TypeScript constants. This keeps the installer small
 * and makes content easy to edit as standalone markdown files.
 *
 * Cross-platform support:
 * - Windows: Uses Node.js-based hook scripts (.mjs)
 * - Unix (macOS, Linux): Uses Bash scripts (.sh) by default
 *
 * Environment variables:
 * - OLYMPUS_USE_NODE_HOOKS=1: Force Node.js hooks on any platform
 * - OLYMPUS_USE_BASH_HOOKS=1: Force Bash hooks (Unix only)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, unlinkSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { execSync } from 'child_process';
// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Path to the content directory.
 * Compiled output lives at dist/installer/index.js, so ../../resources
 * resolves to the project-root resources/ directory.
 */
const CONTENT_DIR = resolve(__dirname, '../../resources');

import { mergeAidlcRules, getAidlcRulesContent, SENTINEL_START, SENTINEL_END } from '../features/workflow-engine/claude-md-merger.js';

import {
  HOOK_SCRIPTS,
  HOOK_SCRIPTS_BASH,
  HOOK_SCRIPTS_NODE,
  getHookScripts,
  getHooksSettingsConfig,
  isWindows,
  shouldUseNodeHooks,
  shouldUseBundledHooks,
  getBundledHooksSettingsConfig,
  MIN_NODE_VERSION
} from './hooks.js';

/** Claude Code configuration directory */
export const CLAUDE_CONFIG_DIR = join(homedir(), '.claude');
export const AGENTS_DIR = join(CLAUDE_CONFIG_DIR, 'agents');
export const SKILLS_DIR = join(CLAUDE_CONFIG_DIR, 'skills');
export const HOOKS_DIR = join(CLAUDE_CONFIG_DIR, 'hooks');
export const SETTINGS_FILE = join(CLAUDE_CONFIG_DIR, 'settings.json');
export const VERSION_FILE = join(CLAUDE_CONFIG_DIR, '.olympus-version.json');

/** Current version - MUST match package.json */
export const VERSION = '4.4.17';

/** Installation result */
export interface InstallResult {
  success: boolean;
  message: string;
  installedAgents: string[];
  installedSkills: string[];
  hooksConfigured: boolean;
  errors: string[];
}

/** Installation options */
export interface InstallOptions {
  force?: boolean;
  verbose?: boolean;
  skipClaudeCheck?: boolean;
  local?: boolean;  // Install to current directory instead of global ~/.claude/
}

/**
 * Read a content file from the resources/ directory.
 *
 * @param relPath - Path relative to the resources/ directory (e.g. 'agents/oracle.md')
 * @returns File contents as a UTF-8 string.
 */
function readContent(relPath: string): string {
  return readFileSync(join(CONTENT_DIR, relPath), 'utf-8');
}

/**
 * Check if the current Node.js version meets the minimum requirement
 */
export function checkNodeVersion(): { valid: boolean; current: number; required: number } {
  const current = parseInt(process.versions.node.split('.')[0], 10);
  return {
    valid: current >= MIN_NODE_VERSION,
    current,
    required: MIN_NODE_VERSION
  };
}

/**
 * Check if Claude Code is installed
 * Uses 'where' on Windows, 'which' on Unix
 */
export function isClaudeInstalled(): boolean {
  try {
    const command = isWindows() ? 'where claude' : 'which claude';
    execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Sentinel marker in CLAUDE.md that identifies the Olympus section */
const OLYMPUS_CLAUDE_MD_SENTINEL = '# Olympus Multi-Agent System';

/**
 * When installing locally (--local), rewrite global paths to project-relative paths.
 * This ensures rule file references point to .claude/olympus/ instead of ~/.claude/olympus/.
 */
function localizeContent(content: string, isLocal: boolean): string {
  if (!isLocal) return content;
  return content.replaceAll('~/.claude/olympus/', '.claude/olympus/');
}

/**
 * Clean up legacy command files that were previously installed to ~/.claude/commands/.
 * These have been migrated to ~/.claude/skills/.
 *
 * @param commandsDir - The commands directory to clean up.
 * @param log - Logging function.
 */
function cleanupLegacyCommands(commandsDir: string, log: (msg: string) => void): void {
  // Known legacy command file paths (relative to commands dir)
  const legacyCommandPaths = [
    'plan.md',
    'ascent/skill.md',
    'ultrawork/skill.md',
    'olympus/skill.md',
    'deepsearch/skill.md',
    'analyze/skill.md',
    'review/skill.md',
    'prometheus/skill.md',
    'complete-plan/skill.md',
    'cancel-ascent/skill.md',
    'update/skill.md',
    'workflow-status/skill.md',
    'workflow-start/skill.md',
    'workflow-approve/skill.md',
    'workflow-advance/skill.md',
    'workflow-reset/skill.md',
    'deploy/skill.md',
    'git-master/skill.md',
    'retro/skill.md'
  ];

  let removedCount = 0;
  for (const relPath of legacyCommandPaths) {
    const fullPath = join(commandsDir, relPath);
    if (existsSync(fullPath)) {
      try {
        unlinkSync(fullPath);
        removedCount++;
      } catch {
        // Silent on errors
      }
    }
  }

  // Clean up empty subdirectories left behind
  const subdirs = [
    'ascent', 'ultrawork', 'olympus', 'deepsearch', 'analyze',
    'review', 'prometheus', 'complete-plan', 'cancel-ascent',
    'update', 'workflow-status', 'workflow-start', 'workflow-approve',
    'workflow-advance', 'workflow-reset', 'deploy', 'git-master', 'retro'
  ];
  for (const subdir of subdirs) {
    const subdirPath = join(commandsDir, subdir);
    if (existsSync(subdirPath)) {
      try {
        // readdirSync will tell us if it's empty
        const entries = readdirSync(subdirPath);
        if (entries.length === 0) {
          rmSync(subdirPath, { recursive: true, force: true });
        }
      } catch {
        // Silent on errors
      }
    }
  }

  if (removedCount > 0) {
    log(`  Cleaned up ${removedCount} legacy command file(s)`);
  }

  // Also clean up old standalone command files (from even earlier versions)
  const legacyStandaloneFiles = [
    'analyze.md',
    'ascent.md',
    'deepsearch.md',
    'olympus.md',
    'prometheus.md',
    'review.md',
    'ultrawork.md',
    'workflow-status.md',
    'intent.md',
    'prd.md',
    'spec.md',
    'intents.md',
    'olympus-next.md',
    'cancel-ascent.md',
    'complete-plan.md',
    'deepinit.md',
    'doctor.md',
    'olympus-default.md',
    'smoke-test.md',
    'update.md',
    'workflow-test.md'
  ];
  for (const legacyFile of legacyStandaloneFiles) {
    const legacyPath = join(commandsDir, legacyFile);
    if (existsSync(legacyPath)) {
      try {
        unlinkSync(legacyPath);
        log(`  Removed legacy ${legacyFile}`);
      } catch {
        // Silent on errors
      }
    }
  }

  if (existsSync(commandsDir)) {
    try {
      const remaining = readdirSync(commandsDir);
      if (remaining.length === 0) {
        rmSync(commandsDir, { recursive: true, force: true });
        log('  Removed empty commands/ directory');
      }
    } catch {
      // Silent on errors
    }
  }
}

/**
 * Clean up legacy mega-rule files that have been replaced by individual rule files.
 *
 * @param rulesDir - The rules directory (e.g. ~/.claude/olympus/rules/).
 * @param log - Logging function.
 */
function cleanupLegacyRuleFiles(rulesDir: string, log: (msg: string) => void): void {
  const legacyRuleFiles = [
    'common-rules.md',
    'inception-rules.md',
    'construction-rules.md',
    'operations-rules.md'
  ];

  let removedCount = 0;
  for (const ruleFile of legacyRuleFiles) {
    const fullPath = join(rulesDir, ruleFile);
    if (existsSync(fullPath)) {
      try {
        unlinkSync(fullPath);
        removedCount++;
      } catch {
        // Silent on errors
      }
    }
  }

  if (removedCount > 0) {
    log(`  Cleaned up ${removedCount} legacy mega-rule file(s)`);
  }
}

/**
 * Install agents from resources/agents/*.md to the agents directory.
 *
 * Preserves existsSync guard: skip existing files unless --force.
 */
function installAgents(
  agentsDir: string,
  force: boolean,
  isLocal: boolean,
  log: (msg: string) => void
): string[] {
  const installed: string[] = [];
  const agentsContentDir = join(CONTENT_DIR, 'agents');
  const agentFiles = readdirSync(agentsContentDir).filter(f => f.endsWith('.md'));

  for (const filename of agentFiles) {
    const filepath = join(agentsDir, filename);
    if (existsSync(filepath) && !force) {
      log(`  Skipping ${filename} (already exists)`);
    } else {
      const content = localizeContent(readContent(`agents/${filename}`), isLocal);
      writeFileSync(filepath, content);
      installed.push(filename);
      log(`  Installed ${filename}`);
    }
  }

  return installed;
}

/**
 * Install skills from resources/skills/\*\/SKILL.md to the skills directory.
 *
 * Preserves existsSync guard: skip existing files unless --force.
 */
function installSkills(
  skillsDir: string,
  force: boolean,
  isLocal: boolean,
  log: (msg: string) => void
): string[] {
  const installed: string[] = [];
  const skillsContentDir = join(CONTENT_DIR, 'skills');
  const skillDirs = readdirSync(skillsContentDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const skillName of skillDirs) {
    const skillFile = join(skillsContentDir, skillName, 'SKILL.md');
    if (!existsSync(skillFile)) {
      continue; // skip directories without a SKILL.md
    }

    const destDir = join(skillsDir, skillName);
    const destFile = join(destDir, 'SKILL.md');

    if (existsSync(destFile) && !force) {
      log(`  Skipping ${skillName}/SKILL.md (already exists)`);
    } else {
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }
      const content = localizeContent(readContent(`skills/${skillName}/SKILL.md`), isLocal);
      writeFileSync(destFile, content);
      installed.push(`${skillName}/SKILL.md`);
      log(`  Installed ${skillName}/SKILL.md`);
    }
  }

  return installed;
}

/**
 * Install individual rule files from resources/rules/ to ~/.claude/olympus/rules/.
 *
 * Rules ALWAYS overwrite (no existsSync guard). This is intentional --
 * rule files are managed by Olympus and should stay in sync.
 */
function installRules(
  rulesDir: string,
  isLocal: boolean,
  log: (msg: string) => void
): void {
  const rulesContentDir = join(CONTENT_DIR, 'rules');
  const phases = readdirSync(rulesContentDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  let fileCount = 0;
  for (const phase of phases) {
    const phaseContentDir = join(rulesContentDir, phase);
    const phaseDestDir = join(rulesDir, phase);
    mkdirSync(phaseDestDir, { recursive: true });

    const ruleFiles = readdirSync(phaseContentDir).filter(f => f.endsWith('.md'));
    for (const ruleFile of ruleFiles) {
      const content = localizeContent(readContent(`rules/${phase}/${ruleFile}`), isLocal);
      writeFileSync(join(phaseDestDir, ruleFile), content);
      fileCount++;
    }
  }

  // Also install top-level rule files (e.g. core-workflow.md) if they exist
  const topLevelFiles = readdirSync(rulesContentDir).filter(f => f.endsWith('.md'));
  for (const ruleFile of topLevelFiles) {
    const content = localizeContent(readContent(`rules/${ruleFile}`), isLocal);
    writeFileSync(join(rulesDir, ruleFile), content);
    fileCount++;
  }

  log(`  Installed ${fileCount} rule file(s) to ${rulesDir}`);
}

/**
 * Install CLAUDE.md with smart detection.
 *
 * - File doesn't exist -> write it
 * - File exists with Olympus sentinel -> overwrite only Olympus section
 * - File exists WITHOUT sentinel and --force not set -> skip
 * - --force -> always overwrite entirely
 */
function installClaudeMd(
  baseDir: string,
  force: boolean,
  isLocal: boolean,
  log: (msg: string) => void
): void {
  const claudeMdPath = join(baseDir, 'CLAUDE.md');
  const claudeMdContent = readContent('claude-md.md');
  const location = isLocal ? './.claude/CLAUDE.md' : '~/.claude/CLAUDE.md';

  if (!existsSync(claudeMdPath)) {
    // File doesn't exist -- write fresh
    writeFileSync(claudeMdPath, claudeMdContent);
    log(`  Created ${location}`);
    return;
  }

  if (force) {
    // --force: always overwrite entirely
    writeFileSync(claudeMdPath, claudeMdContent);
    log(`  Updated ${location} (--force)`);
    return;
  }

  // File exists -- check for Olympus sentinel
  const existingContent = readFileSync(claudeMdPath, 'utf-8');
  if (existingContent.includes(OLYMPUS_CLAUDE_MD_SENTINEL)) {
    // Contains Olympus content -- overwrite the Olympus section
    // Find the sentinel line and replace from there to the end of the Olympus block
    const sentinelIdx = existingContent.indexOf(OLYMPUS_CLAUDE_MD_SENTINEL);
    const beforeOlympus = existingContent.slice(0, sentinelIdx).replace(/\s+$/, '');

    if (beforeOlympus) {
      writeFileSync(claudeMdPath, `${beforeOlympus}\n\n${claudeMdContent}`);
    } else {
      writeFileSync(claudeMdPath, claudeMdContent);
    }
    log(`  Updated Olympus section in ${location}`);
    return;
  }

  // File exists without sentinel -- don't overwrite user's custom CLAUDE.md
  log(`  ${location} already exists without Olympus content (use --force to overwrite)`);
}

/**
 * Install the bundled hooks file
 */
export function installBundledHooks(): boolean {
  const bundleSource = join(__dirname, '..', '..', 'dist', 'hooks', 'olympus-hooks.cjs');
  const bundleDest = join(HOOKS_DIR, 'olympus-hooks.cjs');

  if (!existsSync(bundleSource)) {
    console.warn('Warning: Bundled hooks not found. Run npm run build:hooks first.');
    return false;
  }

  if (!existsSync(HOOKS_DIR)) {
    mkdirSync(HOOKS_DIR, { recursive: true });
  }

  try {
    const content = readFileSync(bundleSource);
    writeFileSync(bundleDest, content);
    if (!isWindows()) {
      chmodSync(bundleDest, 0o755);
    }
    console.log(`Installed: ${bundleDest}`);
    return true;
  } catch (error) {
    console.error('Failed to install bundled hooks:', error);
    return false;
  }
}

/**
 * Install Olympus agents, skills, rules, and hooks
 */
export function install(options: InstallOptions = {}): InstallResult {
  const result: InstallResult = {
    success: false,
    message: '',
    installedAgents: [],
    installedSkills: [],
    hooksConfigured: false,
    errors: []
  };

  const log = (msg: string) => {
    if (options.verbose) {
      console.log(msg);
    }
  };

  // Determine installation paths based on --local flag
  const baseDir = options.local ? join(process.cwd(), '.claude') : CLAUDE_CONFIG_DIR;
  const agentsDir = join(baseDir, 'agents');
  const commandsDir = join(baseDir, 'commands');
  const skillsDir = join(baseDir, 'skills');
  const hooksDir = options.local ? join(process.cwd(), '.claude', 'hooks') : HOOKS_DIR;
  const settingsFile = options.local ? join(process.cwd(), '.claude', 'settings.json') : SETTINGS_FILE;
  const versionFile = options.local ? join(baseDir, '.olympus-version.json') : VERSION_FILE;

  if (options.local) {
    log('Installing locally to ./.claude/');
  }

  // Check Node.js version (required for Node.js hooks on Windows)
  const nodeCheck = checkNodeVersion();
  if (!nodeCheck.valid) {
    log(`Warning: Node.js ${nodeCheck.required}+ required, found ${nodeCheck.current}`);
    if (isWindows() && !options.local) {
      result.errors.push(`Node.js ${nodeCheck.required}+ is required for Windows support. Found: ${nodeCheck.current}`);
      result.message = `Installation failed: Node.js ${nodeCheck.required}+ required`;
      return result;
    }
    // On Unix, we can still use bash hooks, so just warn
  }

  // Log platform info
  if (!options.local) {
    log(`Platform: ${process.platform} (${shouldUseNodeHooks() ? 'Node.js hooks' : 'Bash hooks'})`);
  }

  // Check Claude installation (optional)
  if (!options.skipClaudeCheck && !isClaudeInstalled()) {
    log('Warning: Claude Code not found. Install it first:');
    if (isWindows()) {
      log('  Visit https://docs.anthropic.com/claude-code for Windows installation');
    } else {
      log('  curl -fsSL https://claude.ai/install.sh | bash');
    }
    // Continue anyway - user might be installing ahead of time
  }

  try {
    // Create directories
    log('Creating directories...');
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
    if (!existsSync(agentsDir)) {
      mkdirSync(agentsDir, { recursive: true });
    }
    if (!existsSync(skillsDir)) {
      mkdirSync(skillsDir, { recursive: true });
    }
    if (hooksDir && !existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }

    // Clean up legacy commands BEFORE installing new skills
    log('Cleaning up legacy commands...');
    cleanupLegacyCommands(commandsDir, log);

    // Clean up legacy skill directories from even older versions
    const legacySkillDirs = [
      'frontend-ui-ux'
    ];
    for (const legacySkill of legacySkillDirs) {
      const legacySkillPath = join(skillsDir, legacySkill);
      if (existsSync(legacySkillPath)) {
        rmSync(legacySkillPath, { recursive: true, force: true });
        log(`  Removed legacy skill ${legacySkill}/`);
      }
    }

    // Install agents
    log('Installing agent definitions...');
    result.installedAgents = installAgents(agentsDir, !!options.force, !!options.local, log);

    // Install skills (migrated from commands)
    log('Installing skills...');
    result.installedSkills = installSkills(skillsDir, !!options.force, !!options.local, log);

    // Clean up legacy mega-rule files BEFORE writing new individual rule files
    const rulesDir = join(baseDir, 'olympus', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    log('Cleaning up legacy rule files...');
    cleanupLegacyRuleFiles(rulesDir, log);

    // Install individual rule files (always overwrite)
    log('Installing AI-DLC rule files...');
    installRules(rulesDir, !!options.local, log);

    // Install CLAUDE.md with smart detection
    log('Installing CLAUDE.md...');
    installClaudeMd(baseDir, !!options.force, !!options.local, log);

    // Merge AI-DLC core-workflow into the installed CLAUDE.md
    log('Merging AI-DLC core workflow into CLAUDE.md...');
    try {
      const claudeMdPath = join(baseDir, 'CLAUDE.md');
      if (existsSync(claudeMdPath)) {
        const coreWorkflowContent = localizeContent(readContent('rules/core-workflow.md'), !!options.local);
        const currentContent = readFileSync(claudeMdPath, 'utf-8');
        const merged = mergeAidlcRules(currentContent, coreWorkflowContent);
        writeFileSync(claudeMdPath, merged, 'utf-8');
        const location = options.local ? './.claude/CLAUDE.md' : '~/.claude/CLAUDE.md';
        log(`  Merged AI-DLC core workflow into ${location}`);
      }
    } catch (error) {
      log(`  Warning: Could not merge AI-DLC core workflow (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
    }

    // Inject AI-DLC rules into project CLAUDE.md if an active workflow exists
    try {
      const aidlcDocsPath = join(process.cwd(), 'aidlc-docs');
      if (existsSync(aidlcDocsPath)) {
        const projectClaudeMdPath = join(process.cwd(), '.claude', 'CLAUDE.md');
        const workflowCheckpointPath = (() => {
          try {
            const entries = readdirSync(aidlcDocsPath, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory()) {
                const cpPath = join(aidlcDocsPath, entry.name, 'checkpoint.json');
                if (existsSync(cpPath)) {
                  return { workflowId: entry.name, cpPath };
                }
              }
            }
            return null;
          } catch {
            return null;
          }
        })();

        if (workflowCheckpointPath) {
          const { workflowId, cpPath } = workflowCheckpointPath;
          let pathwayType: 'greenfield' | 'brownfield-enhancement' | 'brownfield-refactor' | 'bugfix' | 'optimization' = 'greenfield';
          try {
            const cp = JSON.parse(readFileSync(cpPath, 'utf-8'));
            if (cp.pathway_type) {
              pathwayType = cp.pathway_type;
            }
          } catch {
          }

          const existingContent = existsSync(projectClaudeMdPath)
            ? readFileSync(projectClaudeMdPath, 'utf-8')
            : '';
          const workflowRules = localizeContent(getAidlcRulesContent(workflowId, pathwayType), !!options.local);
          // For global installs, core-workflow.md is already in ~/.claude/CLAUDE.md — don't duplicate.
          // For local installs, include it since there's no global CLAUDE.md.
          let rules: string;
          if (options.local) {
            const coreWorkflow = localizeContent(readContent('rules/core-workflow.md'), !!options.local);
            rules = `${coreWorkflow}\n\n---\n\n${workflowRules}`;
          } else {
            rules = workflowRules;
          }
          const merged = mergeAidlcRules(existingContent, rules);

          const projectClaudeDir = join(process.cwd(), '.claude');
          if (!existsSync(projectClaudeDir)) {
            mkdirSync(projectClaudeDir, { recursive: true });
          }
          writeFileSync(projectClaudeMdPath, merged, 'utf-8');
          log(`  Injected AI-DLC rules into .claude/CLAUDE.md (workflow: ${workflowId})`);
        }
      }
    } catch (error) {
      log(`  Warning: Could not inject AI-DLC rules into project CLAUDE.md (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
    }

    // Install hook scripts (platform-aware) - only for global install
    if (hooksDir) {
      if (shouldUseBundledHooks()) {
        // Install bundled hooks (includes all features like learning system)
        log('Installing bundled hook scripts...');
        const bundleInstalled = installBundledHooks();
        if (bundleInstalled) {
          log('  Installed olympus-hooks.cjs (bundled)');
        } else {
          log('  Warning: Could not install bundled hooks, falling back to individual scripts');
          // Fallback to individual scripts
          const hookScripts = getHookScripts();
          const hookType = shouldUseNodeHooks() ? 'Node.js' : 'Bash';
          log(`Installing ${hookType} hook scripts (fallback)...`);
          for (const [filename, content] of Object.entries(hookScripts)) {
            const filepath = join(hooksDir, filename);
            writeFileSync(filepath, content);
            if (!isWindows()) {
              chmodSync(filepath, 0o755);
            }
            log(`  Installed ${filename}`);
          }
        }
      } else {
        // Install individual hook scripts
        const hookScripts = getHookScripts();
        const hookType = shouldUseNodeHooks() ? 'Node.js' : 'Bash';
        log(`Installing ${hookType} hook scripts...`);

        for (const [filename, content] of Object.entries(hookScripts)) {
          const filepath = join(hooksDir, filename);
          if (existsSync(filepath) && !options.force) {
            log(`  Skipping ${filename} (already exists)`);
          } else {
            writeFileSync(filepath, content);
            // Make script executable (skip on Windows - not needed)
            if (!isWindows()) {
              chmodSync(filepath, 0o755);
            }
            log(`  Installed ${filename}`);
          }
        }
      }
    }

    // Handle legacy hooks.json file (only for bundled hooks on global install)
    if (hooksDir && shouldUseBundledHooks()) {
      const legacyHooksJson = join(hooksDir, 'hooks.json');
      if (existsSync(legacyHooksJson)) {
        try {
          const backupPath = join(hooksDir, 'hooks.json.old');
          // Read the legacy file to check if it's from individual scripts
          const legacyContent = readFileSync(legacyHooksJson, 'utf-8');
          const isLegacy = legacyContent.includes('keyword-detector.mjs') ||
                          legacyContent.includes('session-start.mjs') ||
                          legacyContent.includes('persistent-mode.mjs');

          if (isLegacy) {
            // Backup the old hooks.json
            writeFileSync(backupPath, legacyContent);
            unlinkSync(legacyHooksJson);
            log('Migrated legacy hooks.json to hooks.json.old');
            log('  (settings.json now controls hook configuration)');
          }
        } catch (e) {
          log('  Warning: Could not migrate legacy hooks.json (non-fatal)');
        }
      }

      // Also remove legacy plugin.json that points to hooks.json
      const legacyPluginJson = join(CLAUDE_CONFIG_DIR, '.claude-plugin', 'plugin.json');
      if (existsSync(legacyPluginJson)) {
        try {
          const pluginContent = readFileSync(legacyPluginJson, 'utf-8');
          if (pluginContent.includes('hooks.json')) {
            unlinkSync(legacyPluginJson);
            log('Removed legacy .claude-plugin/plugin.json');
            log('  (no longer needed with settings.json configuration)');
          }
        } catch (e) {
          log('  Warning: Could not remove legacy plugin.json (non-fatal)');
        }
      }

      // Clean up old individual hook scripts when using bundled hooks
      if (hooksDir) {
        const oldScripts = [
          'keyword-detector.mjs', 'keyword-detector.sh',
          'session-start.mjs', 'session-start.sh',
          'persistent-mode.mjs', 'persistent-mode.sh',
          'stop-continuation.mjs', 'stop-continuation.sh',
          'read-tool-limit-recovery.mjs',
          'diagnostic-test.mjs',
          'project-settings-template.json'
        ];

        let removedCount = 0;
        for (const script of oldScripts) {
          const scriptPath = join(hooksDir, script);
          if (existsSync(scriptPath)) {
            try {
              unlinkSync(scriptPath);
              removedCount++;
            } catch (e) {
              // Ignore errors
            }
          }
        }

        if (removedCount > 0) {
          log(`Cleaned up ${removedCount} old hook script(s)`);
        }
      }
    }

    // Configure settings.json for hooks (merge with existing settings) - only for global install
    if (settingsFile) {
      log('Configuring hooks in settings.json...');
      try {
        let existingSettings: Record<string, unknown> = {};
        if (existsSync(settingsFile)) {
          const settingsContent = readFileSync(settingsFile, 'utf-8');
          existingSettings = JSON.parse(settingsContent);
        }

        // Merge hooks configuration (platform-aware)
        const existingHooks = (existingSettings.hooks || {}) as Record<string, unknown>;
        const hooksConfig = getHooksSettingsConfig();
        const newHooks = hooksConfig.hooks;

        // Deep merge: add our hooks, or update if --force is used
        for (const [eventType, eventHooks] of Object.entries(newHooks)) {
          if (!existingHooks[eventType]) {
            existingHooks[eventType] = eventHooks;
            log(`  Added ${eventType} hook`);
          } else if (options.force) {
            existingHooks[eventType] = eventHooks;
            log(`  Updated ${eventType} hook (--force)`);
          } else {
            log(`  ${eventType} hook already configured, skipping`);
          }
        }

        existingSettings.hooks = existingHooks;

        // Write back settings
        writeFileSync(settingsFile, JSON.stringify(existingSettings, null, 2));
        log('  Hooks configured in settings.json');
        result.hooksConfigured = true;
      } catch (_e) {
        log('  Warning: Could not configure hooks in settings.json (non-fatal)');
        result.hooksConfigured = false;
      }
    }

    // Register as Claude Code plugin (for native installer) - only for global install
    if (!options.local) {
      log('Registering as Claude Code plugin...');
      try {
        // 1. Copy plugin.json to ~/.claude/.claude-plugin/
        const pluginDir = join(CLAUDE_CONFIG_DIR, '.claude-plugin');
        if (!existsSync(pluginDir)) {
          mkdirSync(pluginDir, { recursive: true });
        }

        const pluginJsonContent = {
          name: 'olympus-ai',
          version: VERSION,
          description: 'Olympus: Multi-agent orchestration for Claude Code. Summon the gods of code.',
          author: {
            name: 'mikev10',
            url: 'https://github.com/mikev10'
          },
          homepage: 'https://github.com/mikev10/olympus#readme',
          repository: 'https://github.com/mikev10/olympus',
          license: 'MIT',
          keywords: [
            'multi-agent',
            'orchestration',
            'olympus',
            'ultrawork',
            'ascent',
            'delegation',
            'productivity'
          ]
        };

        const pluginJsonPath = join(pluginDir, 'plugin.json');
        writeFileSync(pluginJsonPath, JSON.stringify(pluginJsonContent, null, 2));
        log('  Created .claude-plugin/plugin.json');

        // 2. Register in installed_plugins.json
        const pluginsDir = join(CLAUDE_CONFIG_DIR, 'plugins');
        if (!existsSync(pluginsDir)) {
          mkdirSync(pluginsDir, { recursive: true });
        }

        const installedPluginsPath = join(pluginsDir, 'installed_plugins.json');
        let installedPlugins: { version: number; plugins: Record<string, unknown> } = {
          version: 2,
          plugins: {}
        };

        if (existsSync(installedPluginsPath)) {
          const content = readFileSync(installedPluginsPath, 'utf-8');
          installedPlugins = JSON.parse(content);
        }

        installedPlugins.plugins['olympus-ai'] = {
          type: 'local',
          path: CLAUDE_CONFIG_DIR
        };

        writeFileSync(installedPluginsPath, JSON.stringify(installedPlugins, null, 2));
        log('  Registered in installed_plugins.json');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(`  Warning: Could not register plugin (non-fatal): ${errorMsg}`);
      }
    }

    // Save version metadata
    const versionMetadata = {
      version: VERSION,
      installedAt: new Date().toISOString(),
      installMethod: options.local ? 'npm-local' as const : 'npm' as const,
      lastCheckAt: new Date().toISOString()
    };
    writeFileSync(versionFile, JSON.stringify(versionMetadata, null, 2));
    log('Saved version metadata');

    result.success = true;
    const hookCount = Object.keys(HOOK_SCRIPTS).length;
    result.message = `Successfully installed ${result.installedAgents.length} agents, ${result.installedSkills.length} skills, and ${hookCount} hooks`;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMessage);
    result.message = `Installation failed: ${errorMessage}`;
  }

  return result;
}

/**
 * Check if Olympus is already installed
 */
export function isInstalled(): boolean {
  return existsSync(VERSION_FILE) && existsSync(AGENTS_DIR);
}

/**
 * Get installation info
 */
export function getInstallInfo(): { version: string; installedAt: string; method: string } | null {
  if (!existsSync(VERSION_FILE)) {
    return null;
  }
  try {
    const content = readFileSync(VERSION_FILE, 'utf-8');
    const data = JSON.parse(content);
    return {
      version: data.version,
      installedAt: data.installedAt,
      method: data.installMethod
    };
  } catch {
    return null;
  }
}

export interface UninstallOptions {
  verbose?: boolean;
  local?: boolean;
  dryRun?: boolean;
}

export interface UninstallResult {
  success: boolean;
  message: string;
  removedFiles: string[];
  errors: string[];
}

export function uninstall(options: UninstallOptions = {}): UninstallResult {
  const result: UninstallResult = {
    success: false,
    message: '',
    removedFiles: [],
    errors: []
  };

  const log = (msg: string) => { if (options.verbose) console.log(msg); };
  const baseDir = options.local ? join(process.cwd(), '.claude') : CLAUDE_CONFIG_DIR;

  const removeFile = (filePath: string, label: string) => {
    if (options.dryRun) {
      log(`[DRY RUN] Would remove ${label}: ${filePath}`);
    } else {
      unlinkSync(filePath);
      log(`  Removed ${label}: ${filePath}`);
    }
    result.removedFiles.push(filePath);
  };

  const removeDir = (dirPath: string, label: string) => {
    if (options.dryRun) {
      log(`[DRY RUN] Would remove ${label}: ${dirPath}`);
    } else {
      rmSync(dirPath, { recursive: true, force: true });
      log(`  Removed ${label}: ${dirPath}`);
    }
    result.removedFiles.push(dirPath);
  };

  try {
    const agentsResourceDir = join(CONTENT_DIR, 'agents');
    const agentsInstallDir = join(baseDir, 'agents');
    if (existsSync(agentsResourceDir) && existsSync(agentsInstallDir)) {
      for (const filename of readdirSync(agentsResourceDir).filter(f => f.endsWith('.md'))) {
        const targetPath = join(agentsInstallDir, filename);
        if (existsSync(targetPath)) {
          removeFile(targetPath, 'agent');
        }
      }
    }
  } catch (error) {
    result.errors.push(`Failed to remove agent files: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const skillsResourceDir = join(CONTENT_DIR, 'skills');
    const skillsInstallDir = join(baseDir, 'skills');
    if (existsSync(skillsResourceDir) && existsSync(skillsInstallDir)) {
      const skillDirs = readdirSync(skillsResourceDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
      for (const skillName of skillDirs) {
        const targetPath = join(skillsInstallDir, skillName);
        if (existsSync(targetPath)) {
          removeDir(targetPath, 'skill directory');
        }
      }
    }
  } catch (error) {
    result.errors.push(`Failed to remove skill directories: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const olympusDir = join(baseDir, 'olympus');
    if (existsSync(olympusDir)) {
      removeDir(olympusDir, 'olympus directory');
    }
  } catch (error) {
    result.errors.push(`Failed to remove olympus directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const hooksDir = options.local ? join(process.cwd(), '.claude', 'hooks') : join(CLAUDE_CONFIG_DIR, 'hooks');
    if (existsSync(hooksDir)) {
      const allHookFilenames = new Set<string>([
        ...Object.keys(HOOK_SCRIPTS_BASH),
        ...Object.keys(HOOK_SCRIPTS_NODE),
        'olympus-hooks.cjs'
      ]);
      for (const filename of allHookFilenames) {
        const targetPath = join(hooksDir, filename);
        if (existsSync(targetPath)) {
          removeFile(targetPath, 'hook script');
        }
      }
    }
  } catch (error) {
    result.errors.push(`Failed to remove hook scripts: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const settingsPath = options.local ? join(process.cwd(), '.claude', 'settings.json') : join(CLAUDE_CONFIG_DIR, 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      const existingHooks = settings.hooks as Record<string, unknown> | undefined;
      if (existingHooks) {
        const cleanedHooks: Record<string, unknown> = {};
        let removedCount = 0;
        for (const [eventType, eventValue] of Object.entries(existingHooks)) {
          if (Array.isArray(eventValue)) {
            const filtered = eventValue.filter((entry: unknown) => {
              if (typeof entry === 'object' && entry !== null && 'command' in entry) {
                const cmd = (entry as Record<string, unknown>).command;
                return typeof cmd !== 'string' || !cmd.includes('olympus');
              }
              return true;
            });
            removedCount += eventValue.length - filtered.length;
            if (filtered.length > 0) {
              cleanedHooks[eventType] = filtered;
            }
          } else {
            cleanedHooks[eventType] = eventValue;
          }
        }
        settings.hooks = cleanedHooks;
        if (options.dryRun) {
          log(`[DRY RUN] Would clean ${removedCount} olympus hook entries from settings.json`);
        } else {
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
          log(`  Cleaned ${removedCount} olympus hook entries from settings.json`);
        }
        if (removedCount > 0) {
          result.removedFiles.push(settingsPath + ' (cleaned)');
        }
      }
    }
  } catch (error) {
    result.errors.push(`Failed to clean settings.json: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const claudeMdPath = join(baseDir, 'CLAUDE.md');
    if (existsSync(claudeMdPath)) {
      let content = readFileSync(claudeMdPath, 'utf-8');
      let modified = false;

      const olympusIdx = content.indexOf(OLYMPUS_CLAUDE_MD_SENTINEL);
      if (olympusIdx !== -1) {
        content = content.slice(0, olympusIdx).replace(/\s+$/, '');
        modified = true;
      }

      if (content.includes(SENTINEL_START) && content.includes(SENTINEL_END)) {
        const startIdx = content.indexOf(SENTINEL_START);
        const endIdx = content.indexOf(SENTINEL_END) + SENTINEL_END.length;
        const before = content.slice(0, startIdx).replace(/\s+$/, '');
        const after = content.slice(endIdx).replace(/^\s+/, '');
        content = before && after ? `${before}\n\n${after}` : (before || after);
        modified = true;
      }

      if (modified) {
        if (options.dryRun) {
          log(`[DRY RUN] Would strip Olympus sections from CLAUDE.md`);
          result.removedFiles.push(claudeMdPath + ' (stripped)');
        } else {
          const trimmed = content.trim();
          if (trimmed.length === 0) {
            unlinkSync(claudeMdPath);
            log(`  Deleted empty CLAUDE.md`);
            result.removedFiles.push(claudeMdPath);
          } else {
            writeFileSync(claudeMdPath, trimmed + '\n', 'utf-8');
            log(`  Stripped Olympus sections from CLAUDE.md`);
            result.removedFiles.push(claudeMdPath + ' (stripped)');
          }
        }
      }
    }
  } catch (error) {
    result.errors.push(`Failed to strip CLAUDE.md: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const versionFile = join(baseDir, '.olympus-version.json');
    if (existsSync(versionFile)) {
      removeFile(versionFile, 'version file');
    }
  } catch (error) {
    result.errors.push(`Failed to remove version file: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!options.local) {
    try {
      const installedPluginsPath = join(CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json');
      if (existsSync(installedPluginsPath)) {
        const pluginsData = JSON.parse(readFileSync(installedPluginsPath, 'utf-8')) as { version: number; plugins: Record<string, unknown> };
        if (pluginsData.plugins && 'olympus-ai' in pluginsData.plugins) {
          delete pluginsData.plugins['olympus-ai'];
          if (options.dryRun) {
            log(`[DRY RUN] Would unregister olympus-ai from installed_plugins.json`);
          } else {
            if (Object.keys(pluginsData.plugins).length === 0) {
              unlinkSync(installedPluginsPath);
              log(`  Deleted empty installed_plugins.json`);
            } else {
              writeFileSync(installedPluginsPath, JSON.stringify(pluginsData, null, 2));
              log(`  Unregistered olympus-ai from installed_plugins.json`);
            }
          }
          result.removedFiles.push(installedPluginsPath + ' (cleaned)');
        }
      }
    } catch (error) {
      result.errors.push(`Failed to unregister from installed_plugins.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!options.local) {
    try {
      const pluginDir = join(CLAUDE_CONFIG_DIR, '.claude-plugin');
      if (existsSync(pluginDir)) {
        removeDir(pluginDir, '.claude-plugin directory');
      }
    } catch (error) {
      result.errors.push(`Failed to remove .claude-plugin directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  result.success = result.errors.length === 0;
  const actionWord = options.dryRun ? 'Would remove' : 'Removed';
  result.message = result.success
    ? `${actionWord} ${result.removedFiles.length} file(s)/directories. Olympus has been uninstalled.`
    : `Uninstall completed with ${result.errors.length} error(s). Removed ${result.removedFiles.length} file(s)/directories.`;

  return result;
}
