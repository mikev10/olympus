import fs from 'fs-extra';
import path from 'path';
import type { ValidatorResult, Finding } from '../../phase-types.js';
import type { ValidatorFn, ValidatorConfig, RiskKeywordConfig } from './types.js';
import { applyAllowFailures } from './pipeline.js';

export interface CoverageFileData {
  filePath: string;
  lineCoverage?: number;
  branchCoverage?: number;
  functionCoverage?: number;
  uncoveredLines?: number[];
}

export interface CoverageData {
  source: 'instrumentation' | 'static-analysis';
  files: CoverageFileData[];
}

export interface ThresholdResult {
  tier: string;
  coverage: number;
  threshold: number;
  met: boolean;
  enforcement: 'block' | 'warn' | 'info';
}

const DEFAULT_THRESHOLDS: Record<'critical' | 'moderate' | 'low', number> = {
  critical: 80,
  moderate: 60,
  low: 40,
};

const DEFAULT_KEYWORDS: RiskKeywordConfig = {
  critical: ['auth', 'payment', 'security', 'encrypt', 'token', 'credential', 'password', 'session', 'permission'],
  moderate: ['validate', 'transform', 'process', 'persist', 'database', 'query', 'transaction', 'migrate', 'cache'],
  low: ['log', 'format', 'display', 'util', 'helper', 'config', 'constant', 'mock', 'fixture'],
};

export function loadRiskKeywords(projectPath: string): RiskKeywordConfig {
  let defaults: RiskKeywordConfig = DEFAULT_KEYWORDS;

  try {
    const candidates = [
      path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../../resources/config/risk-keywords.json'),
      path.resolve(process.cwd(), 'resources/config/risk-keywords.json'),
    ];

    for (const candidate of candidates) {
      const normalized = candidate.startsWith('/') && candidate[2] === ':' ? candidate.slice(1) : candidate;
      if (fs.existsSync(normalized)) {
        defaults = JSON.parse(fs.readFileSync(normalized, 'utf-8')) as RiskKeywordConfig;
        break;
      }
    }
  } catch (_) {
    void _;
  }

  const projectConfigPath = path.join(projectPath, '.olympus', 'config.json');
  if (fs.existsSync(projectConfigPath)) {
    try {
      const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8')) as Record<string, unknown>;
      const overrides = projectConfig['risk-keywords'] as Partial<RiskKeywordConfig> | undefined;
      if (overrides) {
        return {
          critical: overrides.critical ?? defaults.critical,
          moderate: overrides.moderate ?? defaults.moderate,
          low: overrides.low ?? defaults.low,
        };
      }
    } catch (_) {
      void _;
    }
  }

  return defaults;
}

export function classifyByRiskTier(
  filePath: string,
  content: string,
  keywords: RiskKeywordConfig
): 'critical' | 'moderate' | 'low' {
  const combined = `${filePath.toLowerCase()}\n${content.toLowerCase()}`;

  for (const keyword of keywords.critical) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(combined)) return 'critical';
  }

  for (const keyword of keywords.moderate) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(combined)) return 'moderate';
  }

  return 'low';
}

export async function collectCoverageData(
  projectPath: string,
  unitFiles: string[]
): Promise<CoverageData> {
  const coverageSummaryPath = path.join(projectPath, 'coverage', 'coverage-summary.json');

  if (await fs.pathExists(coverageSummaryPath)) {
    try {
      const summary = JSON.parse(await fs.readFile(coverageSummaryPath, 'utf-8')) as Record<string, {
        lines?: { pct?: number };
        branches?: { pct?: number };
        functions?: { pct?: number };
      }>;

      const files: CoverageFileData[] = [];
      for (const [filePath, data] of Object.entries(summary)) {
        if (filePath === 'total') continue;
        files.push({
          filePath,
          lineCoverage: data.lines?.pct,
          branchCoverage: data.branches?.pct,
          functionCoverage: data.functions?.pct,
        });
      }

      return { source: 'instrumentation', files };
    } catch (_) {
      void _;
    }
  }

  const files: CoverageFileData[] = [];
  for (const sourceFile of unitFiles) {
    const parsed = path.parse(sourceFile);
    const testCandidates = [
      path.join(parsed.dir, `${parsed.name}.test${parsed.ext}`),
      path.join(parsed.dir, `${parsed.name}.spec${parsed.ext}`),
      sourceFile.replace(/src\//, 'src/__tests__/').replace(/\.(ts|js)$/, '.test.$1'),
    ];

    let hasTest = false;
    for (const candidate of testCandidates) {
      if (await fs.pathExists(candidate)) {
        hasTest = true;
        break;
      }
    }

    files.push({
      filePath: sourceFile,
      lineCoverage: hasTest ? 100 : 0,
      branchCoverage: hasTest ? 100 : 0,
      functionCoverage: hasTest ? 100 : 0,
    });
  }

  return { source: 'static-analysis', files };
}

export function getQualityLabel(coverage: number): string {
  if (coverage >= 90) return 'Exemplary';
  if (coverage >= 75) return 'Commendable';
  if (coverage >= 60) return 'Acceptable';
  return '';
}

export function loadThresholds(projectPath: string): Record<'critical' | 'moderate' | 'low', number> {
  const projectConfigPath = path.join(projectPath, '.olympus', 'config.json');
  if (fs.existsSync(projectConfigPath)) {
    try {
      const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8')) as Record<string, unknown>;
      const thresholds = projectConfig['coverage-thresholds'] as Partial<Record<'critical' | 'moderate' | 'low', number>> | undefined;
      if (thresholds) {
        return {
          critical: thresholds.critical ?? DEFAULT_THRESHOLDS.critical,
          moderate: thresholds.moderate ?? DEFAULT_THRESHOLDS.moderate,
          low: thresholds.low ?? DEFAULT_THRESHOLDS.low,
        };
      }
    } catch (_) {
      void _;
    }
  }
  return { ...DEFAULT_THRESHOLDS };
}

export function evaluateThresholds(
  coverageByTier: Record<'critical' | 'moderate' | 'low', number>,
  depth: number,
  projectPath: string = ''
): ThresholdResult[] {
  const thresholds = loadThresholds(projectPath);

  return (['critical', 'moderate', 'low'] as const).map(tier => {
    const coverage = coverageByTier[tier];
    const threshold = thresholds[tier];
    const met = coverage >= threshold;

    let enforcement: 'block' | 'warn' | 'info';
    if (met) {
      enforcement = 'info';
    } else if (depth >= 3) {
      enforcement = 'block';
    } else if (depth === 2) {
      enforcement = 'warn';
    } else {
      enforcement = 'info';
    }

    return { tier, coverage, threshold, met, enforcement };
  });
}

export function buildCoverageArtifact(
  data: CoverageData,
  tierCoverage: Record<string, number>,
  thresholdResults: ThresholdResult[],
  keywords: RiskKeywordConfig,
  qualityLabel: string,
  tierClassifications: Map<string, string>
): string {
  const allFiles = data.files;
  const totalFiles = allFiles.length;

  const avgLine = totalFiles > 0 ? allFiles.reduce((sum, f) => sum + (f.lineCoverage ?? 0), 0) / totalFiles : 0;
  const avgBranch = totalFiles > 0 ? allFiles.reduce((sum, f) => sum + (f.branchCoverage ?? 0), 0) / totalFiles : 0;
  const avgFunction = totalFiles > 0 ? allFiles.reduce((sum, f) => sum + (f.functionCoverage ?? 0), 0) / totalFiles : 0;

  const summaryRows = [
    `| Source | ${data.source} |`,
    `| Total files | ${totalFiles} |`,
    `| Line coverage | ${avgLine.toFixed(1)}% |`,
    `| Branch coverage | ${avgBranch.toFixed(1)}% |`,
    `| Function coverage | ${avgFunction.toFixed(1)}% |`,
  ];
  if (qualityLabel) summaryRows.push(`| Quality label | ${qualityLabel} |`);

  const lines: string[] = [
    '# Coverage Report',
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    ...summaryRows,
    '',
    '## Threshold Results',
    '',
    '| Tier | Coverage | Threshold | Met | Enforcement |',
    '|------|----------|-----------|-----|-------------|',
    ...thresholdResults.map(r =>
      `| ${r.tier} | ${r.coverage.toFixed(1)}% | ${r.threshold}% | ${r.met ? 'yes' : 'no'} | ${r.met ? 'n/a' : r.enforcement} |`
    ),
    '',
  ];

  for (const tier of ['critical', 'moderate', 'low']) {
    const tierFiles = allFiles.filter(f =>
      tierClassifications.get(f.filePath) === tier && (f.lineCoverage ?? 0) < 100
    );

    if (tierFiles.length === 0) continue;

    const top20 = tierFiles.slice(0, 20);
    const hasMore = tierFiles.length > 20;
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);

    lines.push(`## Uncovered Files — ${tierLabel} Tier`, '');

    if (hasMore) {
      lines.push(`> Showing top 20 of ${tierFiles.length} files. Full list in \`coverage-detail.md\`.`, '');
    }

    lines.push('| File | Line % | Branch % | Function % |');
    lines.push('|------|--------|----------|------------|');

    for (const f of top20) {
      const shortPath = f.filePath.length > 60 ? `...${f.filePath.slice(-57)}` : f.filePath;
      lines.push(`| ${shortPath} | ${(f.lineCoverage ?? 0).toFixed(1)}% | ${(f.branchCoverage ?? 0).toFixed(1)}% | ${(f.functionCoverage ?? 0).toFixed(1)}% |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildCoverageDetail(
  data: CoverageData,
  tierClassifications: Map<string, string>
): string {
  const lines: string[] = [
    '# Coverage Detail',
    '',
    `Source: ${data.source}`,
    '',
    '## All Files',
    '',
    '| File | Tier | Line % | Branch % | Function % |',
    '|------|------|--------|----------|------------|',
  ];

  for (const f of data.files) {
    const tier = tierClassifications.get(f.filePath) ?? 'low';
    const shortPath = f.filePath.length > 70 ? `...${f.filePath.slice(-67)}` : f.filePath;
    lines.push(`| ${shortPath} | ${tier} | ${(f.lineCoverage ?? 0).toFixed(1)}% | ${(f.branchCoverage ?? 0).toFixed(1)}% | ${(f.functionCoverage ?? 0).toFixed(1)}% |`);
  }

  lines.push('');
  return lines.join('\n');
}

export function createCoverageValidator(): ValidatorFn {
  return async (config: ValidatorConfig): Promise<ValidatorResult> => {
    const keywords = loadRiskKeywords(config.projectPath);
    const coverageData = await collectCoverageData(config.projectPath, config.unitFiles);

    const tierClassifications = new Map<string, string>();
    for (const file of coverageData.files) {
      let content = '';
      try {
        if (await fs.pathExists(file.filePath)) {
          content = await fs.readFile(file.filePath, 'utf-8');
        }
      } catch (_) {
        void _;
      }
      tierClassifications.set(file.filePath, classifyByRiskTier(file.filePath, content, keywords));
    }

    const tierFiles: Record<'critical' | 'moderate' | 'low', CoverageFileData[]> = {
      critical: [],
      moderate: [],
      low: [],
    };

    for (const file of coverageData.files) {
      const tier = (tierClassifications.get(file.filePath) ?? 'low') as 'critical' | 'moderate' | 'low';
      tierFiles[tier].push(file);
    }

    function avgLineCoverage(files: CoverageFileData[]): number {
      if (files.length === 0) return 100;
      return files.reduce((sum, f) => sum + (f.lineCoverage ?? 0), 0) / files.length;
    }

    const coverageByTier: Record<'critical' | 'moderate' | 'low', number> = {
      critical: avgLineCoverage(tierFiles.critical),
      moderate: avgLineCoverage(tierFiles.moderate),
      low: avgLineCoverage(tierFiles.low),
    };

    const thresholdResults = evaluateThresholds(coverageByTier, config.workflowDepth, config.projectPath);
    const findings: Finding[] = [];

    for (const result of thresholdResults) {
      if (!result.met) {
        const severity = result.enforcement === 'block' ? 'error' : result.enforcement === 'warn' ? 'warning' : 'info';
        findings.push({
          id: `coverage-threshold:${result.tier}`,
          severity,
          category: 'coverage-threshold',
          message: `${result.tier.charAt(0).toUpperCase() + result.tier.slice(1)} tier coverage is ${result.coverage.toFixed(1)}% (threshold: ${result.threshold}%)`,
        });
      }
    }

    for (const file of tierFiles.critical) {
      if ((file.lineCoverage ?? 0) === 0) {
        findings.push({
          id: `uncovered-critical:${file.filePath}`,
          severity: 'warning',
          category: 'uncovered-critical-file',
          message: `Critical-tier file has 0% coverage: ${file.filePath}`,
          location: { file: file.filePath },
        });
      }
    }

    const hasBlocking = findings.some(f => f.severity === 'error');
    const hasWarnings = findings.some(f => f.severity === 'warning');
    let status: ValidatorResult['status'];
    if (hasBlocking) {
      status = 'failed';
    } else if (hasWarnings) {
      status = 'warned';
    } else {
      status = 'passed';
    }

    const allFiles = coverageData.files;
    const overallCoverage = allFiles.length > 0
      ? allFiles.reduce((sum, f) => sum + (f.lineCoverage ?? 0), 0) / allFiles.length
      : 100;
    const qualityLabel = getQualityLabel(overallCoverage);

    const artifactDir = path.join(
      config.projectPath,
      'aidlc-docs',
      config.workflowId,
      'construction',
      config.unitId,
      'testing'
    );
    await fs.ensureDir(artifactDir);

    const artifactPath = path.join(artifactDir, 'coverage-report.md');
    await fs.writeFile(
      artifactPath,
      buildCoverageArtifact(coverageData, coverageByTier, thresholdResults, keywords, qualityLabel, tierClassifications),
      'utf-8'
    );

    const hasOverflow = (['critical', 'moderate', 'low'] as const).some(
      tier => tierFiles[tier].filter(f => (f.lineCoverage ?? 0) < 100).length > 20
    );
    if (hasOverflow || coverageData.files.length > 20) {
      await fs.writeFile(
        path.join(artifactDir, 'coverage-detail.md'),
        buildCoverageDetail(coverageData, tierClassifications),
        'utf-8'
      );
    }

    const result: ValidatorResult & { coverage_percentage?: number } = {
      status,
      findings,
      artifactPath,
      coverage_percentage: Math.round(overallCoverage * 10) / 10,
    };

    if (config.allowFailures) return applyAllowFailures(result);
    return result;
  };
}
