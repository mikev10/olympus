// Run in the image build, after `npm ci`, and fails the build unless every
// package the lockfile pins for this image's platform was installed as locked
// (R53).
//
// `npm ci` checks each tarball against the lockfile's integrity, but a CLI's
// platform packages are optional dependencies, and npm skips an optional
// package whose tarball fails the check rather than failing the install. A
// probe build with one platform package's hash altered warned "seems to be
// corrupted" and succeeded, and the CLI then ran from a sibling package
// (D-R53-02). So the build does not trust npm's exit code alone: a package
// the lockfile names for this platform that is not installed at its locked
// version and integrity is a build failure that names the package.
//
// usage: node check-install.js <directory holding package-lock.json and node_modules>
/* global require, process -- run by node during the image build, never imported */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS script: the image runs it with plain node, before any package exists */
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const dir = process.argv[2];
if (dir === undefined) {
  process.stderr.write('usage: node check-install.js <dir>\n');
  process.exit(2);
}

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const locked = read(join(dir, 'package-lock.json')).packages;
// npm's record of what it installed: written by `npm ci`, one entry per package on disk.
const installed = read(join(dir, 'node_modules', '.package-lock.json')).packages;

const libc = process.report.getReport().header.glibcVersionRuntime === undefined ? 'musl' : 'glibc';

// npm's platform fields: a list of allowed values, where `!x` excludes one.
function allows(list, value) {
  if (list === undefined) return true;
  const values = Array.isArray(list) ? list : [list];
  const allowed = values.filter((v) => !v.startsWith('!'));
  return (allowed.length === 0 || allowed.includes(value)) && !values.includes(`!${value}`);
}

const problems = [];
for (const [path, entry] of Object.entries(locked)) {
  if (path === '') continue;
  const forThisPlatform = allows(entry.os, process.platform) && allows(entry.cpu, process.arch) && allows(entry.libc, libc);
  const required = entry.optional !== true || forThisPlatform;
  const got = installed[path];
  if (got === undefined) {
    if (required) problems.push(`${path}@${entry.version} is pinned for ${process.platform}-${process.arch} and was not installed`);
    continue;
  }
  if (got.version !== entry.version || got.integrity !== entry.integrity) {
    problems.push(`${path} was installed as ${got.version} ${got.integrity}, not as locked, ${entry.version} ${entry.integrity}`);
    continue;
  }
  // The package on disk, not only npm's account of it.
  let onDisk;
  try {
    onDisk = read(join(dir, path, 'package.json')).version;
  } catch {
    onDisk = undefined;
  }
  if (onDisk !== entry.version) problems.push(`${path} on disk is ${String(onDisk)}, not ${entry.version}`);
}
for (const path of Object.keys(installed)) {
  if (path !== '' && locked[path] === undefined) problems.push(`${path} was installed and is not in the lockfile`);
}

if (problems.length > 0) {
  process.stderr.write(`check-install: the install does not match the lockfile, so the image is not built:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`check-install: ${String(Object.keys(locked).length - 1)} locked packages, every one for ${process.platform}-${process.arch} installed as locked\n`);
