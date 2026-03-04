#!/usr/bin/env node
/**
 * Extracts markdown content from TypeScript template literals in
 * src/installer/index.ts and src/installer/rule-content.ts into
 * individual .md files under resources/ at the project root.
 *
 * Usage: node scripts/extract-content.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const CONTENT_DIR = join(ROOT, 'resources');
const stats = { agents: 0, skills: 0, rules: 0, other: 0, errors: [] };

function unescape(content) {
  // Single-pass: resolve all TS template-literal escapes (\\, \`, \$)
  return content.replace(/\\([\\\`\$])/g, '$1');
}

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function writeContent(filePath, content) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, content, 'utf-8');
  console.log(`  Created: ${filePath.replace(ROOT + '/', '').replace(ROOT + '\\', '')}`);
}

/**
 * Scans forward from `start` (just after opening backtick) to find the
 * matching unescaped closing backtick, handling \\` escapes and ${} nesting.
 */
function findTemplateEnd(source, start) {
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      return i;
    }
    if (ch === '$' && i + 1 < source.length && source[i + 1] === '{') {
      let braceDepth = 1;
      i += 2;
      while (i < source.length && braceDepth > 0) {
        if (source[i] === '{') braceDepth++;
        else if (source[i] === '}') braceDepth--;
        else if (source[i] === '\\') { i++; }
        i++;
      }
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Parses a TS Record<string, string> block with template-literal values.
 * Matches keys like `'some-key.md': \`` and extracts the content between backticks.
 */
function parseRecordEntries(block) {
  const entries = [];
  const keyPattern = /^\s+'([^']+)'\s*:\s*`/gm;
  let match;
  const keyPositions = [];

  while ((match = keyPattern.exec(block)) !== null) {
    const backtickPos = block.indexOf('`', match.index + match[0].length - 1);
    keyPositions.push({ key: match[1], contentStart: backtickPos + 1 });
  }

  for (const { key, contentStart } of keyPositions) {
    const contentEnd = findTemplateEnd(block, contentStart);
    if (contentEnd === -1) {
      stats.errors.push(`Could not find end of template for key: ${key}`);
      continue;
    }
    entries.push([key, block.substring(contentStart, contentEnd)]);
  }

  return entries;
}

function extractAgents(sourceCode) {
  console.log('\n=== Extracting Agents ===');

  const agentStart = sourceCode.indexOf('export const AGENT_DEFINITIONS: Record<string, string> = {');
  if (agentStart === -1) {
    stats.errors.push('Could not find AGENT_DEFINITIONS');
    return;
  }

  const commandStart = sourceCode.indexOf('export const COMMAND_DEFINITIONS: Record<string, string> = {');
  const agentBlock = sourceCode.substring(agentStart, commandStart);
  const entries = parseRecordEntries(agentBlock);

  for (const [key, value] of entries) {
    writeContent(join(CONTENT_DIR, 'agents', key), unescape(value));
    stats.agents++;
  }
}

function extractCommands(sourceCode) {
  console.log('\n=== Extracting Skills/Commands ===');

  const commandStart = sourceCode.indexOf('export const COMMAND_DEFINITIONS: Record<string, string> = {');
  if (commandStart === -1) {
    stats.errors.push('Could not find COMMAND_DEFINITIONS');
    return;
  }

  const claudeMdStart = sourceCode.indexOf('export const CLAUDE_MD_CONTENT');
  const commandBlock = sourceCode.substring(commandStart, claudeMdStart);
  const entries = parseRecordEntries(commandBlock);

  for (const [key, value] of entries) {
    const content = unescape(value);
    let outPath;

    if (key.includes('/')) {
      outPath = join(CONTENT_DIR, 'skills', key.split('/')[0], 'SKILL.md');
    } else if (key.includes('\\')) {
      outPath = join(CONTENT_DIR, 'skills', key.split('\\')[0], 'SKILL.md');
    } else {
      outPath = join(CONTENT_DIR, 'skills', key.replace('.md', ''), 'SKILL.md');
    }

    writeContent(outPath, content);
    stats.skills++;
  }
}

function extractClaudeMd(sourceCode) {
  console.log('\n=== Extracting CLAUDE.md Template ===');

  const marker = 'export const CLAUDE_MD_CONTENT = `';
  const start = sourceCode.indexOf(marker);
  if (start === -1) {
    stats.errors.push('Could not find CLAUDE_MD_CONTENT');
    return;
  }

  const contentStart = start + marker.length;
  const contentEnd = findTemplateEnd(sourceCode, contentStart);
  if (contentEnd === -1) {
    stats.errors.push('Could not find end of CLAUDE_MD_CONTENT');
    return;
  }

  writeContent(join(CONTENT_DIR, 'claude-md.md'), unescape(sourceCode.substring(contentStart, contentEnd)));
  stats.other++;
}

function extractRules(ruleSource) {
  console.log('\n=== Extracting Rules ===');

  const phaseMap = {
    'COMMON_RULES': 'common',
    'INCEPTION_RULES': 'inception',
    'CONSTRUCTION_RULES': 'construction',
    'OPERATIONS_RULES': 'operations',
  };

  for (const [constName, phase] of Object.entries(phaseMap)) {
    const marker = `export const ${constName}: string = \``;
    const start = ruleSource.indexOf(marker);
    if (start === -1) {
      stats.errors.push(`Could not find ${constName}`);
      continue;
    }

    const contentStart = start + marker.length;
    const contentEnd = findTemplateEnd(ruleSource, contentStart);
    if (contentEnd === -1) {
      stats.errors.push(`Could not find end of ${constName}`);
      continue;
    }

    const fullContent = unescape(ruleSource.substring(contentStart, contentEnd));

    // Regex matches the 3-line delimiter block: ===... / Rule: name / Source: path / ===...
    const ruleDelimiter = /# ================================================================\n# Rule: ([^\n]+)\n# Source:[^\n]+\n# ================================================================\n*/g;
    const delimiterPositions = [];
    let match;

    while ((match = ruleDelimiter.exec(fullContent)) !== null) {
      delimiterPositions.push({
        name: match[1].trim(),
        matchStart: match.index,
        contentStart: match.index + match[0].length,
      });
    }

    for (let i = 0; i < delimiterPositions.length; i++) {
      const current = delimiterPositions[i];
      const nextStart = i + 1 < delimiterPositions.length
        ? delimiterPositions[i + 1].matchStart
        : fullContent.length;

      let ruleContent = fullContent.substring(current.contentStart, nextStart).trim();
      ruleContent = ruleContent.replace(/\n# ={10,}\s*$/, '').trim();

      writeContent(join(CONTENT_DIR, 'rules', phase, `${current.name}.md`), ruleContent + '\n');
      stats.rules++;
    }
  }
}

function main() {
  console.log('Content Extraction Script');
  console.log('========================');
  console.log(`Project root: ${ROOT}`);
  console.log(`Output directory: ${CONTENT_DIR}`);

  const indexPath = join(ROOT, 'src', 'installer', 'index.ts');
  const rulePath = join(ROOT, 'src', 'installer', 'rule-content.ts');

  console.log(`\nReading ${indexPath}...`);
  const indexSource = readFileSync(indexPath, 'utf-8');

  console.log(`Reading ${rulePath}...`);
  const ruleSource = readFileSync(rulePath, 'utf-8');

  ensureDir(CONTENT_DIR);

  extractAgents(indexSource);
  extractCommands(indexSource);
  extractClaudeMd(indexSource);
  extractRules(ruleSource);

  console.log('\n=== Extraction Summary ===');
  console.log(`Agents:    ${stats.agents}`);
  console.log(`Skills:    ${stats.skills}`);
  console.log(`Rules:     ${stats.rules}`);
  console.log(`Other:     ${stats.other}`);
  console.log(`Total:     ${stats.agents + stats.skills + stats.rules + stats.other}`);

  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    for (const err of stats.errors) {
      console.log(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log('\nExtraction complete!');
}

main();
