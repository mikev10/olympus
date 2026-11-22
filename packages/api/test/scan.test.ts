/**
 * What a security check's copy of the tree holds (R36b, D-R36b-10). A check
 * runs over the runtime's install of the lockfile, and a task's writes to a
 * dependency tree are escalated and never carried into the tree the checks
 * judge (D-R15-05), so a dependency tree is the install's, never the change's.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STAND_IN_SECRET_SCANNER, type SecurityScanner } from '@olympus-ai/adapters';
import type { SecurityCheckSpec } from '@olympus-ai/integrity';
import { StubSandboxProvider, type ExecOptions, type ExecResult, type SandboxHandle } from '@olympus-ai/sandbox';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { scanTree } from '../src/index.js';

/** Every file under the working directory, as `/`-separated paths, one per line. */
const LIST = "const fs=require('fs'),p=require('path');const w=(d,r)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?w(p.join(d,e.name),r+e.name+'/'):[r+e.name]);process.stdout.write(w('.','').join('\\n'))";

class ListingSandbox extends StubSandboxProvider {
  listed = '';
  override async exec(h: SandboxHandle, cmd: string[], options?: ExecOptions): Promise<ExecResult> {
    const result = await super.exec(h, cmd, options);
    this.listed = result.stdout;
    return result;
  }
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scan-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function scanListing(files: readonly string[], installed: readonly string[]): Promise<string[]> {
  const tree = join(root, 'tree');
  for (const f of files) {
    await mkdir(join(tree, ...f.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(tree, ...f.split('/')), 'x');
  }
  const scanner: SecurityScanner = { ...STAND_IN_SECRET_SCANNER, invocation: () => ['node', '-e', LIST], parse: () => [] };
  const check: SecurityCheckSpec = { id: 'secret-scan', kind: 'secret-scan', image: scanner.image, config: null, required: true, timeoutMs: 60_000 };
  const sandbox = new ListingSandbox();
  const scratch = join(root, 'scratch');
  const outcome = await scanTree({
    sandbox, tree, scratch: { dir: scratch, tree: join(scratch, 'tree'), config: join(scratch, 'config') },
    check, scanner, limits: null, user: { uid: 1000, gid: 1000 }, installed,
  });
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return sandbox.listed.split('\n').sort();
}

test('a security check scans the tree without the dependency trees the install made, at any depth', async () => {
  const listed = await scanListing(
    ['src/app.ts', 'node_modules/left-pad/index.js', 'packages/a/node_modules/x/i.js', '.venv/lib/z.py'],
    ['node_modules', 'packages/a/node_modules', '.venv'],
  );
  expect(listed).toEqual(['src/app.ts']);
});

// A name is not provenance (R36b review, codex-1 and gemini-1): only what the install made is left out.
test('anything the install did not make is scanned, whatever it is named', async () => {
  const listed = await scanListing(
    ['src/app.ts', 'src/node_modules', 'src/__pycache__/payload.py', 'assets/site-packages/secret.txt', 'node_modules/left-pad/index.js'],
    ['node_modules'],
  );
  expect(listed).toEqual(['assets/site-packages/secret.txt', 'src/__pycache__/payload.py', 'src/app.ts', 'src/node_modules']);
});
