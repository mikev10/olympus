import type { Finding, ValidatorFindingSeverity } from '../../phase-types.js';

export type AntiPatternCategory =
  | 'tautological'
  | 'empty-body'
  | 'trivially-true'
  | 'surface-assertion'
  | 'excessive-mocking'
  | 'snapshot-overuse';

export interface AntiPatternRule {
  category: AntiPatternCategory;
  severity: ValidatorFindingSeverity;
  pattern: RegExp;
  description: string;
}

export const REJECTION_PATTERNS: AntiPatternRule[] = [
  {
    category: 'tautological',
    severity: 'error',
    pattern: /mockReturnValue\((['"`]?)(\w+)\1\)[^]*?\.toBe\((['"`]?)\2\3\)/,
    description: 'Mock return value is asserted against itself (tautological assertion)',
  },
  {
    category: 'tautological',
    severity: 'error',
    pattern: /mockResolvedValue\((['"`]?)(\w+)\1\)[^]*?\.resolves\.toBe\((['"`]?)\2\3\)/,
    description: 'Mock resolved value is asserted against itself (tautological assertion)',
  },
  {
    category: 'trivially-true',
    severity: 'error',
    pattern: /expect\((true|false)\)\.toBe\(\1\)/,
    description: 'Literal boolean asserted against itself (trivially true assertion)',
  },
  {
    category: 'trivially-true',
    severity: 'error',
    pattern: /expect\((true|1)\)\.toBeTruthy\(\)/,
    description: 'Always-truthy literal asserted as truthy (trivially true assertion)',
  },
  {
    category: 'trivially-true',
    severity: 'error',
    pattern: /expect\((false|0)\)\.toBeFalsy\(\)/,
    description: 'Always-falsy literal asserted as falsy (trivially true assertion)',
  },
  {
    category: 'trivially-true',
    severity: 'error',
    pattern: /expect\(null\)\.toBeNull\(\)/,
    description: 'Null literal asserted as null (trivially true assertion)',
  },
  {
    category: 'trivially-true',
    severity: 'error',
    pattern: /expect\(undefined\)\.toBeUndefined\(\)/,
    description: 'Undefined literal asserted as undefined (trivially true assertion)',
  },
];

export const WARNING_PATTERNS: AntiPatternRule[] = [
  {
    category: 'surface-assertion',
    severity: 'warning',
    pattern: /(?:expect\([^)]+\)\.(?:toBeInTheDocument|toBeDefined|toBeNull|toExist|toBeVisible)\(\)[\s;,]*)+/,
    description: 'All assertions use only surface-level existence matchers without behavioral checks',
  },
  {
    category: 'snapshot-overuse',
    severity: 'warning',
    pattern: /expect\([^)]+\)\.toMatchSnapshot\(\)/,
    description: 'Test relies exclusively on snapshot assertions without behavioral checks',
  },
  {
    category: 'snapshot-overuse',
    severity: 'warning',
    pattern: /expect\([^)]+\)\.toMatchInlineSnapshot\(/,
    description: 'Test relies exclusively on inline snapshot assertions without behavioral checks',
  },
];

const NEGATIVE_CASE_PATTERNS: RegExp[] = [
  /\bthrow\b/i,
  /\breject\b/i,
  /\berror\b/i,
  /\binvalid\b/i,
  /\bfail\b/i,
  /\bboundary\b/i,
  /\bedge\b/i,
  /\bnegative\b/i,
  /\bmissing\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\bnot.?found\b/i,
  /\.toThrow\b/,
  /\.rejects\b/,
  /\.toThrowError\b/,
];

const BEHAVIORAL_ASSERTION_PATTERN =
  /\.(?:toBe|toEqual|toStrictEqual|toMatchObject|toHaveBeenCalledWith|toHaveBeenCalled|toHaveReturnedWith|toThrow|toResolve|toReject|toHaveLength|toBeGreaterThan|toBeLessThan|toBeCloseTo)\s*\(/g;

const SURFACE_ASSERTION_PATTERN =
  /\.(?:toContain|toBeInTheDocument|toBeDefined|toBeNull|toExist|toBeVisible|toBeUndefined|toBeTruthy|toBeFalsy)\s*\(/g;

const NON_SNAPSHOT_ASSERTION_PATTERN =
  /\.(?:toBe|toEqual|toStrictEqual|toMatchObject|toContain|toHaveBeenCalled|toHaveBeenCalledWith|toThrow|toReject|toBeInTheDocument|toBeDefined|toHaveLength|toBeGreaterThan|toBeLessThan)\s*\(/;

const MOCK_PATTERNS: RegExp[] = [
  /\bvi\.fn\s*\(/g,
  /\bjest\.fn\s*\(/g,
  /\bmock\s*\(/g,
  /\bstub\s*\(/g,
  /\.mockReturnValue\s*\(/g,
  /\.mockResolvedValue\s*\(/g,
  /\.mockImplementation\s*\(/g,
  /vi\.mock\s*\(/g,
  /jest\.mock\s*\(/g,
];

function extractTestBlocks(content: string): Array<{ name: string; body: string }> {
  const blocks: Array<{ name: string; body: string }> = [];
  const testStartPattern = /(?:^|\n)\s*(?:it|test)\s*\(\s*(['"`])([\s\S]*?)\1/g;
  let match: RegExpExecArray | null;

  while ((match = testStartPattern.exec(content)) !== null) {
    const name = match[2] ?? '';
    const startIdx = match.index + match[0].length;
    const afterMatch = content.slice(startIdx);
    const braceIdx = afterMatch.search(/\{/);
    if (braceIdx === -1) continue;

    let depth = 0;
    let bodyStart = startIdx + braceIdx;
    let bodyEnd = bodyStart;

    for (let i = braceIdx; i < afterMatch.length; i++) {
      const ch = afterMatch[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          bodyEnd = startIdx + i + 1;
          break;
        }
      }
    }

    const body = content.slice(bodyStart, bodyEnd);
    blocks.push({ name, body });
  }

  return blocks;
}

function hasAssertion(body: string): boolean {
  return /\bexpect\s*\(/.test(body) || /\bassert\s*\(/.test(body) || /\bassert\.\w+\s*\(/.test(body);
}

function hasOnlySurfaceAssertions(body: string): boolean {
  if (!hasAssertion(body)) return false;
  if (BEHAVIORAL_ASSERTION_PATTERN.test(body)) return false;
  return SURFACE_ASSERTION_PATTERN.test(body);
}

function hasOnlySnapshotAssertions(body: string): boolean {
  if (!hasAssertion(body)) return false;
  if (!/\.toMatchSnapshot\s*\(|\.toMatchInlineSnapshot\s*\(/.test(body)) return false;
  return !NON_SNAPSHOT_ASSERTION_PATTERN.test(body);
}

function countMocks(content: string): number {
  let count = 0;
  for (const p of MOCK_PATTERNS) {
    const matches = content.match(p);
    if (matches) count += matches.length;
  }
  return count;
}

function countRealCalls(body: string): number {
  let count = 0;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//') || trimmed[0] === '*') continue;
    if (/\bvi\.fn\b|\bjest\.fn\b|\bvi\.mock\b|\bjest\.mock\b|\bmockReturnValue\b|\bmockResolvedValue\b|\bmockImplementation\b|\bstub\b/.test(trimmed)) continue;
    if (/^\s*expect\s*\(|^\s*assert\s*[.(]/.test(line)) continue;
    if (/\b\w+\s*\(/.test(trimmed)) count++;
  }
  return count;
}

export function detectAntiPatterns(
  testContent: string,
  testName: string,
  filePath: string
): Finding[] {
  const findings: Finding[] = [];
  const blocks = extractTestBlocks(testContent);

  for (const block of blocks) {
    const { name: blockName, body } = block;
    const location = { file: filePath, testName: blockName || testName };

    if (!hasAssertion(body)) {
      findings.push({
        id: `empty-body:${filePath}:${blockName}`,
        severity: 'error',
        category: 'empty-body',
        message: `Test "${blockName}" has no assertions (empty test body)`,
        location,
      });
      continue;
    }

    for (const rule of REJECTION_PATTERNS) {
      if (rule.pattern.test(body)) {
        findings.push({
          id: `${rule.category}:${filePath}:${blockName}`,
          severity: rule.severity,
          category: rule.category,
          message: `Test "${blockName}": ${rule.description}`,
          location,
        });
        break;
      }
    }

    if (hasOnlySurfaceAssertions(body)) {
      findings.push({
        id: `surface-assertion:${filePath}:${blockName}`,
        severity: 'warning',
        category: 'surface-assertion',
        message: `Test "${blockName}": ${WARNING_PATTERNS.find(r => r.category === 'surface-assertion')?.description ?? 'Only surface assertions found'}`,
        location,
      });
    }

    if (hasOnlySnapshotAssertions(body)) {
      findings.push({
        id: `snapshot-overuse:${filePath}:${blockName}`,
        severity: 'warning',
        category: 'snapshot-overuse',
        message: `Test "${blockName}": Test relies exclusively on snapshot assertions without behavioral checks`,
        location,
      });
    }

    const mockCount = countMocks(body);
    const realCallCount = countRealCalls(body);
    if (mockCount > 3 && mockCount > realCallCount * 2) {
      findings.push({
        id: `excessive-mocking:${filePath}:${blockName}`,
        severity: 'warning',
        category: 'excessive-mocking',
        message: `Test "${blockName}": Excessive mocking detected (${mockCount} mocks vs ${realCallCount} real calls)`,
        location: { ...location, testName: blockName },
      });
    }
  }

  return findings;
}

export interface NegativeCaseResult {
  ratio: number;
  totalTests: number;
  negativeTests: number;
}

export function calculateNegativeCaseRatio(testContent: string): NegativeCaseResult {
  const blocks = extractTestBlocks(testContent);
  const totalTests = blocks.length;

  if (totalTests === 0) {
    return { ratio: 0, totalTests: 0, negativeTests: 0 };
  }

  let negativeTests = 0;
  for (const block of blocks) {
    const combined = `${block.name}\n${block.body}`;
    if (NEGATIVE_CASE_PATTERNS.some(p => p.test(combined))) {
      negativeTests++;
    }
  }

  return { ratio: negativeTests / totalTests, totalTests, negativeTests };
}
