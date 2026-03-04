import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
  getDefaultCeremonyConfig,
  loadCeremonyConfig,
  formatForCeremony,
  getCeremonyArtifactTemplates,
} from '../../features/workflow-engine/ceremony.js';
import type { CeremonyConfig } from '../../features/workflow-engine/phase-types.js';

const testDir = join(process.cwd(), '.test-ceremony');

beforeEach(() => {
  fs.ensureDirSync(testDir);
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('getDefaultCeremonyConfig', () => {
  it('returns config with ceremony_mode false', () => {
    const config = getDefaultCeremonyConfig();
    expect(config.ceremony_mode).toBe(false);
  });

  it('returns config with all expected fields', () => {
    const config = getDefaultCeremonyConfig();
    expect(config).toHaveProperty('ceremony_mode');
    expect(config).toHaveProperty('pause_between_steps');
    expect(config).toHaveProperty('output_format');
    expect(config).toHaveProperty('review_prompt_style');
  });

  it('default output_format is standard', () => {
    const config = getDefaultCeremonyConfig();
    expect(config.output_format).toBe('standard');
  });
});

describe('loadCeremonyConfig', () => {
  it('returns defaults when config file does not exist', () => {
    const config = loadCeremonyConfig(testDir);
    const defaults = getDefaultCeremonyConfig();
    expect(config).toEqual(defaults);
  });

  it('returns defaults when ceremony key is missing', () => {
    const olympusDir = join(testDir, '.olympus');
    fs.ensureDirSync(olympusDir);
    fs.writeFileSync(join(olympusDir, 'config.json'), JSON.stringify({}), 'utf-8');
    const config = loadCeremonyConfig(testDir);
    const defaults = getDefaultCeremonyConfig();
    expect(config).toEqual(defaults);
  });

  it('merges ceremony config with defaults', () => {
    const olympusDir = join(testDir, '.olympus');
    fs.ensureDirSync(olympusDir);
    fs.writeFileSync(
      join(olympusDir, 'config.json'),
      JSON.stringify({ ceremony: { ceremony_mode: true } }),
      'utf-8'
    );
    const config = loadCeremonyConfig(testDir);
    const defaults = getDefaultCeremonyConfig();
    expect(config.ceremony_mode).toBe(true);
    expect(config.pause_between_steps).toBe(defaults.pause_between_steps);
    expect(config.output_format).toBe(defaults.output_format);
    expect(config.review_prompt_style).toBe(defaults.review_prompt_style);
  });

  it('handles malformed JSON gracefully', () => {
    const olympusDir = join(testDir, '.olympus');
    fs.ensureDirSync(olympusDir);
    fs.writeFileSync(join(olympusDir, 'config.json'), '{ not valid json ::::', 'utf-8');
    const defaults = getDefaultCeremonyConfig();
    expect(() => loadCeremonyConfig(testDir)).not.toThrow();
    const config = loadCeremonyConfig(testDir);
    expect(config).toEqual(defaults);
  });
});

describe('formatForCeremony', () => {
  it('returns content unchanged when ceremony_mode is false', () => {
    const config = getDefaultCeremonyConfig();
    const content = 'Some workflow content here.';
    expect(formatForCeremony(content, config)).toBe(content);
  });

  it('adds review markers when ceremony_mode is true', () => {
    const config: CeremonyConfig = {
      ...getDefaultCeremonyConfig(),
      ceremony_mode: true,
    };
    const output = formatForCeremony('Some content.', config);
    expect(output).toContain('TEAM REVIEW POINT');
    expect(output).toContain('Please review the above');
  });

  it('adds presentation separator when output_format is presentation', () => {
    const config: CeremonyConfig = {
      ...getDefaultCeremonyConfig(),
      ceremony_mode: true,
      output_format: 'presentation',
    };
    const output = formatForCeremony('Some content.', config);
    expect(output).toContain('========================================');
  });

  it('uses explicit review prompt when review_prompt_style is explicit', () => {
    const config: CeremonyConfig = {
      ...getDefaultCeremonyConfig(),
      ceremony_mode: true,
      review_prompt_style: 'explicit',
    };
    const output = formatForCeremony('Some content.', config);
    expect(output).toContain('ACTION REQUIRED');
    expect(output).not.toContain('TEAM REVIEW POINT');
  });

  it('is identity function when ceremony_mode is false regardless of other settings', () => {
    const config: CeremonyConfig = {
      ceremony_mode: false,
      pause_between_steps: false,
      output_format: 'presentation',
      review_prompt_style: 'explicit',
    };
    const content = 'Some workflow content here.';
    expect(formatForCeremony(content, config)).toBe(content);
  });
});

describe('getCeremonyArtifactTemplates', () => {
  it('returns templates for all expected keys', () => {
    const templates = getCeremonyArtifactTemplates();
    expect(templates).toHaveProperty('prfaq');
    expect(templates).toHaveProperty('nfr');
    expect(templates).toHaveProperty('risk');
    expect(templates).toHaveProperty('unit');
  });

  it('prfaq template contains Press Release section', () => {
    const templates = getCeremonyArtifactTemplates();
    expect(templates.prfaq).toContain('Press Release');
  });

  it('nfr template contains table headers', () => {
    const templates = getCeremonyArtifactTemplates();
    expect(templates.nfr).toContain('Category');
    expect(templates.nfr).toContain('Gate-Blocking');
  });

  it('risk template contains severity fields', () => {
    const templates = getCeremonyArtifactTemplates();
    expect(templates.risk).toContain('Likelihood');
    expect(templates.risk).toContain('Impact');
  });

  it('unit template contains Code Generation Plan section', () => {
    const templates = getCeremonyArtifactTemplates();
    const hasCodeGen =
      templates.unit.includes('Code Generation Plan') || templates.unit.includes('Code Generation');
    expect(hasCodeGen).toBe(true);
  });
});
