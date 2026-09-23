import { describe, expect, it } from 'vitest';
import { assertCleanRoom } from '../cleanroom.ts';

const allowed = {
  configFiles: ['auth.json'],
  workFiles: ['2026-09-19-P5-driver-claude-code-review-bundle.txt'],
} as const;

describe('assertCleanRoom', () => {
  it('accepts a config home holding exactly the credential and a work dir holding exactly the bundle', () => {
    expect(() => {
      assertCleanRoom(
        { configHome: ['auth.json'], workDir: [allowed.workFiles[0]] },
        allowed,
      );
    }).not.toThrow();
  });

  it('refuses a global instruction file in the config home', () => {
    expect(() => {
      assertCleanRoom(
        { configHome: ['auth.json', 'AGENTS.md'], workDir: [allowed.workFiles[0]] },
        allowed,
      );
    }).toThrow(/AGENTS\.md/);
  });

  it('refuses declared MCP servers reachable through settings.json', () => {
    expect(() => {
      assertCleanRoom(
        { configHome: ['oauth_creds.json', 'settings.json'], workDir: [] },
        { configFiles: ['oauth_creds.json'], workFiles: [] },
      );
    }).toThrow(/settings\.json/);
  });

  it('refuses prior session history', () => {
    expect(() => {
      assertCleanRoom(
        { configHome: ['auth.json', 'sessions/2026/09/rollout-x.jsonl'], workDir: [] },
        { configFiles: ['auth.json'], workFiles: [] },
      );
    }).toThrow(/sessions/);
  });

  it('refuses a stray file in the work directory', () => {
    expect(() => {
      assertCleanRoom(
        { configHome: ['auth.json'], workDir: [allowed.workFiles[0], 'GEMINI.md'] },
        allowed,
      );
    }).toThrow(/GEMINI\.md/);
  });

  it('refuses when the credential is absent, because the CLI would hang on a login prompt', () => {
    expect(() => {
      assertCleanRoom({ configHome: [], workDir: [allowed.workFiles[0]] }, allowed);
    }).toThrow(/auth\.json/);
  });

  it('refuses when the bundle is absent, because the reviewer would review nothing', () => {
    expect(() => {
      assertCleanRoom({ configHome: ['auth.json'], workDir: [] }, allowed);
    }).toThrow(/bundle/);
  });
});
