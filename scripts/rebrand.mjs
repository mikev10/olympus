#!/usr/bin/env node

/**
 * Rebrand Script: Olympus → Olympus
 *
 * Renames:
 * - olympus → olympus
 * - ascent (persistence loop) → ascent
 * - olympian → olympian
 *
 * Run: node rebrand.mjs
 */

import { readFileSync, writeFileSync, renameSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';

const ROOT = process.cwd();

// Text replacements (order matters - more specific first)
const TEXT_REPLACEMENTS = [
  // Ascent loop → Ascent (renamed from the-ascent)
  ['the-ascent', 'ascent'],
  ['the_ascent', 'ascent'],
  ['The-Ascent', 'Ascent'],
  ['The Ascent', 'Ascent'],
  ['THE_ASCENT', 'ASCENT'],
  ['THE-ASCENT', 'ASCENT'],
  ['cancel-ascent', 'cancel-ascent'],
  ['cancelAscent', 'cancelAscent'],

  // Ascent → Ascent (general)
  ['ascent', 'ascent'],
  ['Ascent', 'Ascent'],
  ['ASCENT', 'ASCENT'],

  // Olympus Junior → Olympian
  ['olympian', 'olympian'],
  ['olympian', 'olympian'],
  ['Olympian', 'Olympian'],
  ['OLYMPIAN', 'OLYMPIAN'],

  // Olympus → Olympus
  ['olympus-default', 'olympus-default'],
  ['/olympus', '/olympus'],
  ['olympus', 'olympus'],
  ['Olympus', 'Olympus'],
  ['OLYMPUS', 'OLYMPUS'],
];

// File/directory renames
const PATH_RENAMES = [
  ['.olympus', '.olympus'],
  ['olympian-high.md', 'olympian-high.md'],
  ['olympian-low.md', 'olympian-low.md'],
  ['olympian.md', 'olympian.md'],
  ['olympus-default.md', 'olympus-default.md'],
  ['the-ascent.md', 'ascent.md'],
  ['cancel-ascent.md', 'cancel-ascent.md'],
];

// Files to skip (binary, lock files, etc.)
const SKIP_PATTERNS = [
  'node_modules',
  '.git',
  'package-lock.json',
  '.png',
  '.jpg',
  '.ico',
  '.woff',
  'dist/',
];

function shouldSkip(path) {
  return SKIP_PATTERNS.some(pattern => path.includes(pattern));
}

function replaceInFile(filePath) {
  if (shouldSkip(filePath)) return false;

  const ext = filePath.split('.').pop();
  const textExtensions = ['md', 'json', 'js', 'ts', 'mjs', 'mts', 'txt', 'yaml', 'yml', 'sh', 'toml'];

  if (!textExtensions.includes(ext)) return false;

  try {
    let content = readFileSync(filePath, 'utf8');
    let originalContent = content;

    for (const [search, replace] of TEXT_REPLACEMENTS) {
      content = content.split(search).join(replace);
    }

    if (content !== originalContent) {
      writeFileSync(filePath, content, 'utf8');
      return true;
    }
  } catch (e) {
    console.error(`Error processing ${filePath}: ${e.message}`);
  }

  return false;
}

function renameIfNeeded(fullPath) {
  const name = basename(fullPath);

  for (const [oldName, newName] of PATH_RENAMES) {
    if (name === oldName) {
      const newPath = join(dirname(fullPath), newName);
      try {
        renameSync(fullPath, newPath);
        console.log(`  Renamed: ${name} → ${newName}`);
        return newPath;
      } catch (e) {
        console.error(`  Error renaming ${name}: ${e.message}`);
      }
    }
  }

  return fullPath;
}

function walkDir(dir, fileCallback, dirCallback) {
  if (shouldSkip(dir)) return;

  const entries = readdirSync(dir);

  // Process files first
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (shouldSkip(fullPath)) continue;

    try {
      const stat = statSync(fullPath);
      if (stat.isFile()) {
        fileCallback(fullPath);
      }
    } catch (e) {}
  }

  // Then process directories (and recurse)
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (shouldSkip(fullPath)) continue;

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath, fileCallback, dirCallback);
        dirCallback(fullPath);
      }
    } catch (e) {}
  }
}

// Main execution
console.log('🏛️  OLYMPUS REBRAND SCRIPT');
console.log('========================\n');

console.log('Step 1: Replacing text in files...');
let filesModified = 0;
walkDir(ROOT, (filePath) => {
  if (replaceInFile(filePath)) {
    filesModified++;
    console.log(`  Modified: ${filePath.replace(ROOT, '')}`);
  }
}, () => {});

console.log(`\n  ✓ Modified ${filesModified} files\n`);

console.log('Step 2: Renaming files and directories...');
walkDir(ROOT, () => {}, (dirPath) => {
  renameIfNeeded(dirPath);
});

// Rename files in key directories
const dirsToCheck = ['agents', 'commands', 'skills', 'hooks', '.'];
for (const dir of dirsToCheck) {
  const fullDir = join(ROOT, dir);
  if (existsSync(fullDir)) {
    try {
      const entries = readdirSync(fullDir);
      for (const entry of entries) {
        const fullPath = join(fullDir, entry);
        if (statSync(fullPath).isFile()) {
          renameIfNeeded(fullPath);
        }
      }
    } catch (e) {}
  }
}

// Rename .olympus directory
const olympusDir = join(ROOT, '.olympus');
const olympusDir = join(ROOT, '.olympus');
if (existsSync(olympusDir)) {
  renameSync(olympusDir, olympusDir);
  console.log('  Renamed: .olympus → .olympus');
}

console.log('\n✅ Rebrand complete!\n');
console.log('Next steps:');
console.log('1. Review the changes: git diff');
console.log('2. Update package.json with your details');
console.log('3. Update README.md with Olympus branding');
console.log('4. Commit: git add -A && git commit -m "Rebrand to Olympus"');
