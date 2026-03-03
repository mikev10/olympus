import { describe, it, expect } from 'vitest';
import {
  SENTINEL_START,
  SENTINEL_END,
  hasAidlcRules,
  mergeAidlcRules,
  removeAidlcRules,
  getAidlcRulesContent,
} from '../../features/workflow-engine/claude-md-merger.js';

const SAMPLE_RULES = 'AI-DLC rules block content here.';
const EXISTING_CONTENT = '# My Project CLAUDE.md\n\nSome existing instructions.';

describe('hasAidlcRules', () => {
  it('returns false for empty string', () => {
    expect(hasAidlcRules('')).toBe(false);
  });

  it('returns false when only start sentinel present', () => {
    expect(hasAidlcRules(`${SENTINEL_START}\nrules`)).toBe(false);
  });

  it('returns false when only end sentinel present', () => {
    expect(hasAidlcRules(`rules\n${SENTINEL_END}`)).toBe(false);
  });

  it('returns false for normal CLAUDE.md content', () => {
    expect(hasAidlcRules(EXISTING_CONTENT)).toBe(false);
  });

  it('returns true when both sentinels are present', () => {
    const content = `${SENTINEL_START}\n${SAMPLE_RULES}\n${SENTINEL_END}`;
    expect(hasAidlcRules(content)).toBe(true);
  });

  it('returns true when sentinels are embedded in surrounding content', () => {
    const content = `Before\n${SENTINEL_START}\n${SAMPLE_RULES}\n${SENTINEL_END}\nAfter`;
    expect(hasAidlcRules(content)).toBe(true);
  });
});

describe('mergeAidlcRules — insert (no existing sentinels)', () => {
  it('wraps rules with sentinels on empty file', () => {
    const result = mergeAidlcRules('', SAMPLE_RULES);
    expect(result).toContain(SENTINEL_START);
    expect(result).toContain(SENTINEL_END);
    expect(result).toContain(SAMPLE_RULES);
  });

  it('places sentinel block at the top of empty content', () => {
    const result = mergeAidlcRules('', SAMPLE_RULES);
    expect(result.startsWith(SENTINEL_START)).toBe(true);
  });

  it('prepends sentinel block before existing content', () => {
    const result = mergeAidlcRules(EXISTING_CONTENT, SAMPLE_RULES);
    expect(result.startsWith(SENTINEL_START)).toBe(true);
    expect(result).toContain(EXISTING_CONTENT);
  });

  it('preserves all existing content outside sentinels', () => {
    const result = mergeAidlcRules(EXISTING_CONTENT, SAMPLE_RULES);
    const afterBlock = result.slice(result.indexOf(SENTINEL_END) + SENTINEL_END.length);
    expect(afterBlock).toContain('My Project CLAUDE.md');
    expect(afterBlock).toContain('Some existing instructions.');
  });

  it('separates sentinel block from existing content with a blank line', () => {
    const result = mergeAidlcRules(EXISTING_CONTENT, SAMPLE_RULES);
    expect(result).toContain(`${SENTINEL_END}\n\n`);
  });
});

describe('mergeAidlcRules — update (sentinels already present)', () => {
  it('replaces old rules content between existing sentinels', () => {
    const initial = mergeAidlcRules(EXISTING_CONTENT, 'OLD RULES');
    const updated = mergeAidlcRules(initial, 'NEW RULES');
    expect(updated).toContain('NEW RULES');
    expect(updated).not.toContain('OLD RULES');
  });

  it('still contains exactly one start sentinel after update', () => {
    const initial = mergeAidlcRules(EXISTING_CONTENT, 'OLD RULES');
    const updated = mergeAidlcRules(initial, 'NEW RULES');
    const startCount = (updated.split(SENTINEL_START).length - 1);
    expect(startCount).toBe(1);
  });

  it('still contains exactly one end sentinel after update', () => {
    const initial = mergeAidlcRules(EXISTING_CONTENT, 'OLD RULES');
    const updated = mergeAidlcRules(initial, 'NEW RULES');
    const endCount = (updated.split(SENTINEL_END).length - 1);
    expect(endCount).toBe(1);
  });

  it('preserves content that followed the sentinel block', () => {
    const initial = mergeAidlcRules(EXISTING_CONTENT, 'OLD RULES');
    const updated = mergeAidlcRules(initial, 'NEW RULES');
    expect(updated).toContain('My Project CLAUDE.md');
    expect(updated).toContain('Some existing instructions.');
  });
});

describe('mergeAidlcRules — idempotency', () => {
  it('merge(merge(x)) === merge(x) for empty content', () => {
    const once = mergeAidlcRules('', SAMPLE_RULES);
    const twice = mergeAidlcRules(once, SAMPLE_RULES);
    expect(twice).toBe(once);
  });

  it('merge(merge(x)) === merge(x) with existing content', () => {
    const once = mergeAidlcRules(EXISTING_CONTENT, SAMPLE_RULES);
    const twice = mergeAidlcRules(once, SAMPLE_RULES);
    expect(twice).toBe(once);
  });

  it('merge three times still equals merge once', () => {
    const once = mergeAidlcRules(EXISTING_CONTENT, SAMPLE_RULES);
    const twice = mergeAidlcRules(once, SAMPLE_RULES);
    const thrice = mergeAidlcRules(twice, SAMPLE_RULES);
    expect(thrice).toBe(once);
  });
});

describe('removeAidlcRules', () => {
  it('returns unchanged content when no sentinels present', () => {
    expect(removeAidlcRules(EXISTING_CONTENT)).toBe(EXISTING_CONTENT);
  });

  it('returns empty string when only sentinel block exists', () => {
    const content = mergeAidlcRules('', SAMPLE_RULES);
    expect(removeAidlcRules(content)).toBe('');
  });

  it('removes sentinel block and leaves surrounding content intact', () => {
    const merged = mergeAidlcRules(EXISTING_CONTENT, SAMPLE_RULES);
    const removed = removeAidlcRules(merged);
    expect(removed).toContain('My Project CLAUDE.md');
    expect(removed).toContain('Some existing instructions.');
    expect(removed).not.toContain(SENTINEL_START);
    expect(removed).not.toContain(SENTINEL_END);
    expect(removed).not.toContain(SAMPLE_RULES);
  });

  it('leaves no double-blank-line artifacts at start', () => {
    const merged = mergeAidlcRules('', SAMPLE_RULES);
    const removed = removeAidlcRules(merged);
    expect(removed).toBe('');
  });

  it('is idempotent — remove(remove(x)) === remove(x)', () => {
    const merged = mergeAidlcRules(EXISTING_CONTENT, SAMPLE_RULES);
    const once = removeAidlcRules(merged);
    const twice = removeAidlcRules(once);
    expect(twice).toBe(once);
  });
});

describe('getAidlcRulesContent — greenfield', () => {
  const content = getAidlcRulesContent('my-workflow', 'greenfield');

  it('contains the workflow ID', () => {
    expect(content).toContain('my-workflow');
  });

  it('references prometheus agent', () => {
    expect(content).toContain('prometheus');
  });

  it('references momus agent', () => {
    expect(content).toContain('momus');
  });

  it('references olympian agent', () => {
    expect(content).toContain('olympian');
  });

  it('references oracle agent', () => {
    expect(content).toContain('oracle');
  });

  it('references explore agent', () => {
    expect(content).toContain('explore');
  });

  it('references librarian agent', () => {
    expect(content).toContain('librarian');
  });

  it('references document-writer agent', () => {
    expect(content).toContain('document-writer');
  });

  it('references frontend-engineer agent', () => {
    expect(content).toContain('frontend-engineer');
  });

  it('does not contain the forbidden OVERRIDES phrase', () => {
    expect(content).not.toContain('OVERRIDES all other built-in workflows');
  });

  it('mentions checkpoint.json state file', () => {
    expect(content).toContain('checkpoint.json');
  });

  it('mentions aidlc-state.md', () => {
    expect(content).toContain('aidlc-state.md');
  });

  it('mentions audit.md', () => {
    expect(content).toContain('audit.md');
  });

  it('lists greenfield inception stages without reverse-engineering', () => {
    expect(content).not.toContain('Reverse Engineering');
  });

  it('references ~/.claude/olympus/rules/ on-demand loading', () => {
    expect(content).toContain('~/.claude/olympus/rules/');
  });
});

describe('getAidlcRulesContent — brownfield', () => {
  const content = getAidlcRulesContent('my-workflow', 'brownfield-enhancement');

  it('labels pathway as brownfield', () => {
    expect(content).toContain('Brownfield');
  });

  it('includes reverse-engineering stage', () => {
    expect(content).toContain('Reverse Engineering');
  });

  it('still references explore agent for reverse engineering', () => {
    expect(content).toContain('explore');
  });

  it('does not contain the forbidden OVERRIDES phrase', () => {
    expect(content).not.toContain('OVERRIDES all other built-in workflows');
  });
});

describe('getAidlcRulesContent — directory layout', () => {
  const content = getAidlcRulesContent('test-wf-id', 'greenfield');

  it('includes aidlc-docs directory layout', () => {
    expect(content).toContain('aidlc-docs/test-wf-id/');
  });

  it('mentions inception/ subdirectory', () => {
    expect(content).toContain('inception/');
  });

  it('mentions construction/ subdirectory', () => {
    expect(content).toContain('construction/');
  });

  it('mentions operations/ subdirectory', () => {
    expect(content).toContain('operations/');
  });
});

describe('full round-trip', () => {
  it('merge then remove restores original content exactly', () => {
    const merged = mergeAidlcRules(EXISTING_CONTENT, SAMPLE_RULES);
    const restored = removeAidlcRules(merged);
    expect(restored).toBe(EXISTING_CONTENT);
  });

  it('merge then remove on empty string returns empty string', () => {
    const merged = mergeAidlcRules('', SAMPLE_RULES);
    const restored = removeAidlcRules(merged);
    expect(restored).toBe('');
  });

  it('sentinel block can be replaced and then removed cleanly', () => {
    const step1 = mergeAidlcRules(EXISTING_CONTENT, 'RULES V1');
    const step2 = mergeAidlcRules(step1, 'RULES V2');
    const step3 = removeAidlcRules(step2);
    expect(step3).toBe(EXISTING_CONTENT);
  });
});
