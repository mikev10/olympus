import fs from 'fs-extra';
import path from 'path';
import type { ValidatorResult, Finding } from '../../phase-types.js';
import type { ValidatorFn, ValidatorConfig } from './types.js';
import { applyAllowFailures } from './pipeline.js';

export interface InferredContract {
  exports: Array<{ name: string; parameterCount: number; returnType: string }>;
  endpoints: Array<{ method: string; path: string; statusCodes: number[] }>;
  types: Array<{ name: string; definition: string }>;
}

export interface BreakingChange {
  category:
    | 'removed-export'
    | 'changed-params'
    | 'changed-return-type'
    | 'removed-endpoint'
    | 'narrowed-enum';
  name: string;
  before: string;
  after: string;
}

const JS_TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const API_SURFACE_PATTERNS = [
  /[/\\]routes[/\\]/,
  /[/\\]controllers[/\\]/,
  /[/\\]api[/\\]/,
  /[/\\]handlers[/\\]/,
];

export function detectApiSurfaces(files: string[]): { surfaces: string[]; nonJsFiles: string[] } {
  const surfaces: string[] = [];
  const nonJsFiles: string[] = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!JS_TS_EXTENSIONS.has(ext)) {
      nonJsFiles.push(file);
      console.warn(`[ContractValidator] Skipping non-JS/TS file: ${file}`);
      continue;
    }

    const isApiSurface =
      API_SURFACE_PATTERNS.some(p => p.test(file)) ||
      path.basename(file) === 'index.ts' ||
      path.basename(file) === 'index.js';

    if (isApiSurface) {
      surfaces.push(file);
    }
  }

  return { surfaces, nonJsFiles };
}

export function inferContract(content: string, _filePath: string): InferredContract {
  const exports: InferredContract['exports'] = [];
  const endpoints: InferredContract['endpoints'] = [];
  const types: InferredContract['types'] = [];

  // export function / export async function — regex parses name, param list, return type annotation
  const exportFnRegex =
    /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\s{;]+(?:\s*<[^>]*>)?(?:\[\])?(?:\s*\|\s*[^\s{;]+)*))?/g;

  let match: RegExpExecArray | null;

  while ((match = exportFnRegex.exec(content)) !== null) {
    const name = match[1];
    const paramsStr = match[2].trim();
    const returnType = (match[3] ?? 'void').trim();
    const parameterCount = paramsStr === '' ? 0 : paramsStr.split(',').length;
    exports.push({ name, parameterCount, returnType });
  }

  // export const name = (params) => ...
  const exportConstFnRegex =
    /export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*([^\s=>]+))?\s*=>/g;

  while ((match = exportConstFnRegex.exec(content)) !== null) {
    const name = match[1];
    const paramsStr = match[2].trim();
    const returnType = (match[3] ?? 'void').trim();
    const parameterCount = paramsStr === '' ? 0 : paramsStr.split(',').length;
    exports.push({ name, parameterCount, returnType });
  }

  // Express/Fastify/Koa route patterns: app.get('/path', ...) or router.post('/path', ...)
  const routeRegex =
    /(?:app|router|server|fastify)\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    const statusCodes = extractStatusCodes(content, match.index);
    endpoints.push({ method, path: routePath, statusCodes });
  }

  // export interface / export type
  const typeInterfaceRegex = /export\s+(?:interface|type)\s+(\w+)\s*(?:<[^>]*>)?\s*([=\{][^}]*\}?)/gs;

  while ((match = typeInterfaceRegex.exec(content)) !== null) {
    const name = match[1];
    const definition = match[2].slice(0, 200).replace(/\s+/g, ' ').trim();
    types.push({ name, definition });
  }

  // export enum / export const enum — stored with "enum:" prefix for narrowed-enum detection
  const enumRegex = /export\s+(?:const\s+)?enum\s+(\w+)\s*\{([^}]*)\}/gs;

  while ((match = enumRegex.exec(content)) !== null) {
    const name = match[1];
    const members = match[2]
      .split(',')
      .map(m => m.trim().split('=')[0].trim())
      .filter(m => m.length > 0);
    types.push({ name: `enum:${name}`, definition: members.join(',') });
  }

  return { exports, endpoints, types };
}

function extractStatusCodes(content: string, nearIndex: number): number[] {
  const searchWindow = content.slice(nearIndex, nearIndex + 500);
  const statusRegex = /\.status\s*\(\s*(\d{3})\s*\)/g;
  const codes: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = statusRegex.exec(searchWindow)) !== null) {
    const code = parseInt(m[1], 10);
    if (!codes.includes(code)) {
      codes.push(code);
    }
  }
  return codes;
}

export function detectBreakingChanges(
  baseline: InferredContract,
  current: InferredContract
): BreakingChange[] {
  const changes: BreakingChange[] = [];

  for (const baseExport of baseline.exports) {
    const currentExport = current.exports.find(e => e.name === baseExport.name);

    if (!currentExport) {
      changes.push({
        category: 'removed-export',
        name: baseExport.name,
        before: `${baseExport.name}(${baseExport.parameterCount} params): ${baseExport.returnType}`,
        after: '(removed)',
      });
      continue;
    }

    if (currentExport.parameterCount !== baseExport.parameterCount) {
      changes.push({
        category: 'changed-params',
        name: baseExport.name,
        before: `${baseExport.parameterCount} params`,
        after: `${currentExport.parameterCount} params`,
      });
    }

    if (
      currentExport.returnType !== baseExport.returnType &&
      baseExport.returnType !== 'void' &&
      baseExport.returnType !== ''
    ) {
      changes.push({
        category: 'changed-return-type',
        name: baseExport.name,
        before: baseExport.returnType,
        after: currentExport.returnType,
      });
    }
  }

  for (const baseEndpoint of baseline.endpoints) {
    const currentEndpoint = current.endpoints.find(
      e => e.method === baseEndpoint.method && e.path === baseEndpoint.path
    );

    if (!currentEndpoint) {
      changes.push({
        category: 'removed-endpoint',
        name: `${baseEndpoint.method} ${baseEndpoint.path}`,
        before: `${baseEndpoint.method} ${baseEndpoint.path}`,
        after: '(removed)',
      });
    }
  }

  for (const baseType of baseline.types) {
    if (!baseType.name.startsWith('enum:')) continue;

    const currentType = current.types.find(t => t.name === baseType.name);
    if (!currentType) {
      changes.push({
        category: 'narrowed-enum',
        name: baseType.name.replace('enum:', ''),
        before: baseType.definition,
        after: '(removed)',
      });
      continue;
    }

    const baseMembers = baseType.definition.split(',').map(m => m.trim()).filter(Boolean);
    const currentMembers = currentType.definition.split(',').map(m => m.trim()).filter(Boolean);
    const removedMembers = baseMembers.filter(m => !currentMembers.includes(m));

    if (removedMembers.length > 0) {
      changes.push({
        category: 'narrowed-enum',
        name: baseType.name.replace('enum:', ''),
        before: baseMembers.join(', '),
        after: currentMembers.join(', '),
      });
    }
  }

  return changes;
}

export function buildContractArtifact(
  breakingChanges: BreakingChange[],
  contract: InferredContract,
  skipped: boolean,
  nonJsFiles: string[]
): string {
  if (skipped) {
    return [
      '# Contract Validation Report',
      '',
      '## Result',
      '',
      'No API surfaces affected. Contract validation skipped.',
      '',
    ].join('\n');
  }

  const lines: string[] = [
    '# Contract Validation Report',
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Exports analyzed | ${contract.exports.length} |`,
    `| Endpoints analyzed | ${contract.endpoints.length} |`,
    `| Breaking changes found | ${breakingChanges.length} |`,
    `| Contract source | inferred from source code |`,
    '',
  ];

  if (breakingChanges.length > 0) {
    lines.push('## Breaking Changes', '');
    lines.push('| Category | Name | Before | After |');
    lines.push('|----------|------|--------|-------|');
    for (const change of breakingChanges) {
      lines.push(`| ${change.category} | ${change.name} | ${change.before} | ${change.after} |`);
    }
    lines.push('');
    lines.push(
      '> **Human Approval Required**: Breaking changes detected. Review before proceeding.',
      ''
    );
  }

  if (nonJsFiles.length > 0) {
    lines.push('## Non-JS/TS Files Skipped', '');
    lines.push('The following files were skipped (contract validation supports JS/TS only):', '');
    for (const f of nonJsFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  if (contract.exports.length > 0) {
    lines.push('## Exports', '');
    lines.push('| Name | Parameters | Return Type |');
    lines.push('|------|-----------|-------------|');
    for (const e of contract.exports) {
      lines.push(`| ${e.name} | ${e.parameterCount} | ${e.returnType} |`);
    }
    lines.push('');
  }

  if (contract.endpoints.length > 0) {
    lines.push('## Endpoints', '');
    lines.push('| Method | Path | Status Codes |');
    lines.push('|--------|------|-------------|');
    for (const e of contract.endpoints) {
      const codes = e.statusCodes.length > 0 ? e.statusCodes.join(', ') : 'N/A';
      lines.push(`| ${e.method} | ${e.path} | ${codes} |`);
    }
    lines.push('');
  }

  if (contract.types.length > 0) {
    lines.push('## Types', '');
    lines.push('| Name | Definition |');
    lines.push('|------|-----------|');
    for (const t of contract.types) {
      const displayName = t.name.startsWith('enum:') ? `enum ${t.name.slice(5)}` : t.name;
      lines.push(`| ${displayName} | ${t.definition} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function createContractValidator(): ValidatorFn {
  return async (config: ValidatorConfig): Promise<ValidatorResult> => {
    const artifactDir = path.join(
      config.projectPath,
      'aidlc-docs',
      config.workflowId,
      'construction',
      config.unitId,
      'testing'
    );
    const artifactPath = path.join(artifactDir, 'contract-validation.md');

    const allFiles = [...new Set([...config.unitFiles, ...config.apiSurfaceFiles])];
    const { surfaces, nonJsFiles } = detectApiSurfaces(allFiles);

    if (surfaces.length === 0) {
      const skippedResult: ValidatorResult = {
        status: 'skipped',
        findings: [
          {
            id: 'contract:no-api-surfaces',
            severity: 'info',
            category: 'skip',
            message: 'No API surfaces detected in unit files. Contract validation skipped.',
          },
        ],
        artifactPath,
      };
      await fs.ensureDir(artifactDir);
      await fs.writeFile(
        artifactPath,
        buildContractArtifact([], { exports: [], endpoints: [], types: [] }, true, nonJsFiles),
        'utf-8'
      );
      if (config.allowFailures) return applyAllowFailures(skippedResult);
      return skippedResult;
    }

    const allBreakingChanges: BreakingChange[] = [];
    const combinedContract: InferredContract = { exports: [], endpoints: [], types: [] };
    const findings: Finding[] = [];

    for (const nonJsFile of nonJsFiles) {
      findings.push({
        id: `contract:non-js-ts:${path.basename(nonJsFile)}`,
        severity: 'warning',
        category: 'non-js-ts-file',
        message: `File skipped (non-JS/TS): ${nonJsFile}`,
        location: { file: nonJsFile },
      });
    }

    for (const surface of surfaces) {
      let content: string;
      try {
        content = await fs.readFile(surface, 'utf-8');
      } catch {
        findings.push({
          id: `contract:read-error:${path.basename(surface)}`,
          severity: 'warning',
          category: 'read-error',
          message: `Could not read API surface file: ${surface}`,
          location: { file: surface },
        });
        continue;
      }

      const currentContract = inferContract(content, surface);
      combinedContract.exports.push(...currentContract.exports);
      combinedContract.endpoints.push(...currentContract.endpoints);
      combinedContract.types.push(...currentContract.types);

      // Breaking change detection: apiSurfaceFiles are the baseline (existing state),
      // unitFiles of the same basename are the proposed new state. Without git diff
      // access, this is the only deterministic comparison available.
      if (config.apiSurfaceFiles.includes(surface)) {
        for (const unitFile of config.unitFiles) {
          if (path.basename(unitFile) === path.basename(surface)) {
            let unitContent: string;
            try {
              unitContent = await fs.readFile(unitFile, 'utf-8');
            } catch {
              continue;
            }
            const unitContract = inferContract(unitContent, unitFile);
            allBreakingChanges.push(...detectBreakingChanges(currentContract, unitContract));
          }
        }
      }
    }

    for (const change of allBreakingChanges) {
      findings.push({
        id: `contract:breaking:${change.category}:${change.name}`,
        severity: 'error',
        category: change.category,
        message: `Breaking change detected (${change.category}): ${change.name} — before: ${change.before}, after: ${change.after}`,
      });
    }

    const errors = findings.filter(f => f.severity === 'error');
    const warnings = findings.filter(f => f.severity === 'warning');

    let status: ValidatorResult['status'];
    if (errors.length > 0) {
      status = 'failed';
    } else if (warnings.length > 0) {
      status = 'warned';
    } else {
      status = 'passed';
    }

    await fs.ensureDir(artifactDir);
    await fs.writeFile(
      artifactPath,
      buildContractArtifact(allBreakingChanges, combinedContract, false, nonJsFiles),
      'utf-8'
    );

    const result: ValidatorResult = { status, findings, artifactPath };
    if (config.allowFailures) return applyAllowFailures(result);
    return result;
  };
}
