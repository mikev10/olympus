import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  createDefaultTrustState,
  loadTrustState,
  saveTrustState,
  evaluateTrustLevel,
  recordTransition,
  resetTrust,
  shouldAutoAdvance,
  checkTrustReset,
  decreaseTrust,
  checkConsecutiveRejections,
  recordContractViolation,
} from '../../features/workflow-engine/trust.js';
import type { TrustState, TrustLevel, RiskTier } from '../../features/workflow-engine/phase-types.js';

const TEST_DIR = join(process.cwd(), '.test-trust');

describe('Progressive Trust Engine', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_DIR, '.olympus'), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });

  describe('createDefaultTrustState', () => {
    it('returns state with level 0', () => {
      const state = createDefaultTrustState();
      expect(state.current_level).toBe(0);
    });

    it('all counters are zero', () => {
      const state = createDefaultTrustState();
      expect(state.total_transitions).toBe(0);
      expect(state.rejection_count).toBe(0);
      expect(state.rejection_rate).toBe(0);
      expect(state.incident_count).toBe(0);
    });

    it('level_history is empty', () => {
      const state = createDefaultTrustState();
      expect(state.level_history).toEqual([]);
    });

    it('last_level_change is null', () => {
      const state = createDefaultTrustState();
      expect(state.last_level_change).toBeNull();
    });
  });

  describe('loadTrustState', () => {
    it('returns default state when file does not exist', () => {
      const state = loadTrustState(TEST_DIR);
      expect(state).toEqual(createDefaultTrustState());
    });

    it('loads persisted state from file', () => {
      const savedState: TrustState = {
        current_level: 2,
        total_transitions: 25,
        rejection_count: 1,
        rejection_rate: 0.04,
        incident_count: 0,
        last_level_change: '2026-01-01T00:00:00.000Z',
        level_history: [
          { from: 0, to: 1, reason: 'Test', timestamp: '2026-01-01T00:00:00.000Z' },
        ],
        consecutive_rejections: 0,
        transition_history: [],
      };
      const filePath = join(TEST_DIR, '.olympus', 'trust-state.json');
      writeFileSync(filePath, JSON.stringify(savedState, null, 2), 'utf-8');

      const loaded = loadTrustState(TEST_DIR);
      expect(loaded).toEqual(savedState);
    });

    it('returns default state on corrupted JSON', () => {
      const filePath = join(TEST_DIR, '.olympus', 'trust-state.json');
      writeFileSync(filePath, '{invalid json}', 'utf-8');

      const state = loadTrustState(TEST_DIR);
      expect(state).toEqual(createDefaultTrustState());
    });
  });

  describe('saveTrustState', () => {
    it('creates .olympus directory and saves file', () => {
      const state = createDefaultTrustState();
      saveTrustState(state, TEST_DIR);

      const filePath = join(TEST_DIR, '.olympus', 'trust-state.json');
      expect(existsSync(filePath)).toBe(true);

      const loaded = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(loaded).toEqual(state);
    });

    it('overwrites existing file', () => {
      const state1: TrustState = { ...createDefaultTrustState(), current_level: 1 };
      saveTrustState(state1, TEST_DIR);

      const state2: TrustState = { ...createDefaultTrustState(), current_level: 2 };
      saveTrustState(state2, TEST_DIR);

      const loaded = loadTrustState(TEST_DIR);
      expect(loaded.current_level).toBe(2);
    });

    it('handles errors silently', () => {
      const state = createDefaultTrustState();
      // Invalid path should not throw
      expect(() => saveTrustState(state, '')).not.toThrow();
    });
  });

  describe('evaluateTrustLevel', () => {
    it('returns 0 for fresh state (0 transitions)', () => {
      const state = createDefaultTrustState();
      expect(evaluateTrustLevel(state)).toBe(0);
    });

    it('returns 0 for 9 transitions', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        total_transitions: 9,
      };
      expect(evaluateTrustLevel(state)).toBe(0);
    });

    it('returns 1 for 10+ transitions', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        total_transitions: 10,
        rejection_rate: 0,
      };
      expect(evaluateTrustLevel(state)).toBe(1);
    });

    it('returns 1 for 20 transitions with high rejection rate (>=5%)', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        total_transitions: 20,
        rejection_count: 1,
        rejection_rate: 0.05,
      };
      expect(evaluateTrustLevel(state)).toBe(1);
    });

    it('returns 2 for 20 transitions with low rejection rate (<5%)', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        total_transitions: 20,
        rejection_count: 0,
        rejection_rate: 0.04,
      };
      expect(evaluateTrustLevel(state)).toBe(2);
    });

    it('returns 2 for 50 transitions with rejection rate between 2-5%', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        total_transitions: 50,
        rejection_count: 2,
        rejection_rate: 0.04,
        incident_count: 0,
      };
      expect(evaluateTrustLevel(state)).toBe(2);
    });

    it('returns 3 for 50 transitions + <2% rejection + 0 incidents', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        total_transitions: 50,
        rejection_count: 0,
        rejection_rate: 0.01,
        incident_count: 0,
      };
      expect(evaluateTrustLevel(state)).toBe(3);
    });

    it('returns 2 for 50 transitions + <2% rejection + 1 incident (incident blocks L3)', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        total_transitions: 50,
        rejection_count: 0,
        rejection_rate: 0.01,
        incident_count: 1,
      };
      expect(evaluateTrustLevel(state)).toBe(2);
    });
  });

  describe('recordTransition', () => {
    it('increments total_transitions', () => {
      const state = createDefaultTrustState();
      const updated = recordTransition(state, true, false);
      expect(updated.total_transitions).toBe(1);
    });

    it('increments rejection_count when rejected=true', () => {
      const state = createDefaultTrustState();
      const updated = recordTransition(state, false, true);
      expect(updated.rejection_count).toBe(1);
    });

    it('does not increment rejection_count when rejected=false', () => {
      const state = createDefaultTrustState();
      const updated = recordTransition(state, true, false);
      expect(updated.rejection_count).toBe(0);
    });

    it('recomputes rejection_rate correctly', () => {
      const state = createDefaultTrustState();
      let updated = recordTransition(state, true, false);
      updated = recordTransition(updated, true, false);
      updated = recordTransition(updated, false, true);
      expect(updated.total_transitions).toBe(3);
      expect(updated.rejection_count).toBe(1);
      expect(updated.rejection_rate).toBeCloseTo(1 / 3, 5);
    });

    it('creates level_history entry when level changes', () => {
      let state = createDefaultTrustState();
      // Perform 10 successful transitions to reach level 1
      for (let i = 0; i < 10; i++) {
        state = recordTransition(state, true, false);
      }
      expect(state.level_history).toHaveLength(1);
      expect(state.level_history[0]).toMatchObject({
        from: 0,
        to: 1,
        reason: 'Qualification threshold met',
      });
      expect(state.level_history[0].timestamp).toBeDefined();
    });

    it('does NOT mutate original state (immutability check)', () => {
      const state = createDefaultTrustState();
      const updated = recordTransition(state, true, false);
      expect(state.total_transitions).toBe(0);
      expect(updated.total_transitions).toBe(1);
      expect(state).not.toBe(updated);
    });

    it('promotes from L0 to L1 after 10th successful transition', () => {
      let state = createDefaultTrustState();
      for (let i = 0; i < 9; i++) {
        state = recordTransition(state, true, false);
      }
      expect(state.current_level).toBe(0);

      state = recordTransition(state, true, false);
      expect(state.current_level).toBe(1);
      expect(state.total_transitions).toBe(10);
    });

    it('promotes from L1 to L2 at correct threshold', () => {
      let state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 1,
        total_transitions: 19,
        rejection_count: 0,
        rejection_rate: 0,
      };

      state = recordTransition(state, true, false);
      expect(state.current_level).toBe(2);
      expect(state.total_transitions).toBe(20);
    });
  });

  describe('resetTrust', () => {
    it('drops level to 0', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 3,
      };
      const reset = resetTrust(state, 'Test reset');
      expect(reset.current_level).toBe(0);
    });

    it('adds entry to level_history', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 2,
      };
      const reset = resetTrust(state, 'Security incident');
      expect(reset.level_history).toHaveLength(1);
      expect(reset.level_history[0]).toMatchObject({
        from: 2,
        to: 0,
        reason: 'Security incident',
      });
    });

    it('sets last_level_change', () => {
      const state = createDefaultTrustState();
      const reset = resetTrust(state, 'Test');
      expect(reset.last_level_change).toBeDefined();
      expect(typeof reset.last_level_change).toBe('string');
    });

    it('preserves counters (total_transitions, rejection_count unchanged)', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 2,
        total_transitions: 25,
        rejection_count: 3,
        rejection_rate: 0.12,
      };
      const reset = resetTrust(state, 'Test');
      expect(reset.total_transitions).toBe(25);
      expect(reset.rejection_count).toBe(3);
      expect(reset.rejection_rate).toBe(0.12);
    });

    it('does NOT mutate original state', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 2,
      };
      const reset = resetTrust(state, 'Test');
      expect(state.current_level).toBe(2);
      expect(reset.current_level).toBe(0);
      expect(state).not.toBe(reset);
    });
  });

  describe('shouldAutoAdvance', () => {
    const testCases: Array<{ trust: TrustLevel; tier: RiskTier; expected: boolean; desc: string }> = [
      { trust: 0, tier: 1, expected: false, desc: 'Trust 0, Tier 1: false' },
      { trust: 0, tier: 2, expected: false, desc: 'Trust 0, Tier 2: false' },
      { trust: 0, tier: 3, expected: false, desc: 'Trust 0, Tier 3: false' },
      { trust: 1, tier: 1, expected: true, desc: 'Trust 1, Tier 1: true' },
      { trust: 1, tier: 2, expected: false, desc: 'Trust 1, Tier 2: false' },
      { trust: 1, tier: 3, expected: false, desc: 'Trust 1, Tier 3: false' },
      { trust: 2, tier: 1, expected: true, desc: 'Trust 2, Tier 1: true' },
      { trust: 2, tier: 2, expected: true, desc: 'Trust 2, Tier 2: true' },
      { trust: 2, tier: 3, expected: false, desc: 'Trust 2, Tier 3: false' },
      { trust: 3, tier: 1, expected: true, desc: 'Trust 3, Tier 1: true' },
      { trust: 3, tier: 2, expected: true, desc: 'Trust 3, Tier 2: true' },
      { trust: 3, tier: 3, expected: true, desc: 'Trust 3, Tier 3: true' },
    ];

    testCases.forEach(({ trust, tier, expected, desc }) => {
      it(desc, () => {
        expect(shouldAutoAdvance(tier, trust)).toBe(expected);
      });
    });
  });

  describe('checkTrustReset', () => {
    it('no reset needed for fresh state', () => {
      const state = createDefaultTrustState();
      const result = checkTrustReset(state);
      expect(result.shouldReset).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('reset needed for incidents when level > 0', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 2,
        incident_count: 1,
      };
      const result = checkTrustReset(state);
      expect(result.shouldReset).toBe(true);
      expect(result.reason).toContain('Incidents detected');
      expect(result.reason).toContain('1');
    });

    it('no reset needed for incidents when level is 0 (already reset)', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 0,
        incident_count: 1,
      };
      const result = checkTrustReset(state);
      expect(result.shouldReset).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('reset needed for >10% rejection rate with 10+ transitions and level > 0', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 2,
        total_transitions: 20,
        rejection_count: 3,
        rejection_rate: 0.15,
      };
      const result = checkTrustReset(state);
      expect(result.shouldReset).toBe(true);
      expect(result.reason).toContain('high rejection rate');
      expect(result.reason).toContain('15.0%');
    });

    it('no reset needed for 10% rejection rate with <10 transitions', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 1,
        total_transitions: 8,
        rejection_count: 1,
        rejection_rate: 0.125,
      };
      const result = checkTrustReset(state);
      expect(result.shouldReset).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('no reset needed for <10% rejection rate', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 2,
        total_transitions: 30,
        rejection_count: 2,
        rejection_rate: 0.067,
      };
      const result = checkTrustReset(state);
      expect(result.shouldReset).toBe(false);
      expect(result.reason).toBeNull();
    });
  });

  describe('Integration: save + load roundtrip', () => {
    it('save a modified state, load it back, verify it matches', () => {
      let state = createDefaultTrustState();
      // Simulate progression to level 2
      for (let i = 0; i < 20; i++) {
        state = recordTransition(state, true, false);
      }
      state = { ...state, incident_count: 0 };

      saveTrustState(state, TEST_DIR);
      const loaded = loadTrustState(TEST_DIR);

      expect(loaded).toEqual(state);
      expect(loaded.current_level).toBe(2);
      expect(loaded.total_transitions).toBe(20);
      expect(loaded.level_history.length).toBeGreaterThan(0);
    });
  });

  describe('recordTransition with metadata', () => {
    it('accepts optional metadata parameter', () => {
      const state = createDefaultTrustState();
      const metadata = { gateNumber: 4, artifactId: 'BOLT-001', artifactType: 'bolt' };
      const updated = recordTransition(state, true, false, metadata);
      expect(updated.total_transitions).toBe(1);
    });

    it('stores metadata in transition_history', () => {
      const state = createDefaultTrustState();
      const metadata = { gateNumber: 4, artifactId: 'BOLT-001', artifactType: 'bolt' };
      const updated = recordTransition(state, true, false, metadata);
      expect(updated.transition_history).toHaveLength(1);
      expect(updated.transition_history[0].metadata).toEqual(metadata);
    });

    it('works without metadata (backward compatible)', () => {
      const state = createDefaultTrustState();
      const updated = recordTransition(state, true, false);
      expect(updated.transition_history).toHaveLength(1);
      expect(updated.transition_history[0].metadata).toBeUndefined();
    });

    it('per-BOLT tracking accelerates trust accumulation', () => {
      let state = createDefaultTrustState();
      // 7 BOLTs = 7 transitions, should get close to Level 1 (10 needed)
      for (let i = 0; i < 7; i++) {
        state = recordTransition(state, true, false, {
          gateNumber: 4,
          artifactId: `BOLT-00${i + 1}`,
          artifactType: 'bolt',
        });
      }
      expect(state.total_transitions).toBe(7);
      // 3 more transitions to reach Level 1
      for (let i = 0; i < 3; i++) {
        state = recordTransition(state, true, false);
      }
      expect(state.current_level).toBe(1);
    });

    it('caps transition_history at 100 entries', () => {
      let state = createDefaultTrustState();
      for (let i = 0; i < 105; i++) {
        state = recordTransition(state, true, false);
      }
      expect(state.transition_history.length).toBeLessThanOrEqual(100);
    });
  });

  describe('consecutive rejections tracking', () => {
    it('increments consecutive_rejections on rejection', () => {
      let state = createDefaultTrustState();
      state = recordTransition(state, false, true);
      expect(state.consecutive_rejections).toBe(1);
      state = recordTransition(state, false, true);
      expect(state.consecutive_rejections).toBe(2);
    });

    it('resets consecutive_rejections on success', () => {
      let state = createDefaultTrustState();
      state = recordTransition(state, false, true);
      state = recordTransition(state, false, true);
      expect(state.consecutive_rejections).toBe(2);
      state = recordTransition(state, true, false);
      expect(state.consecutive_rejections).toBe(0);
    });

    it('checkConsecutiveRejections returns true at 3+ rejections', () => {
      let state = createDefaultTrustState();
      state = recordTransition(state, false, true);
      state = recordTransition(state, false, true);
      expect(checkConsecutiveRejections(state).shouldDecrease).toBe(false);
      state = recordTransition(state, false, true);
      expect(checkConsecutiveRejections(state).shouldDecrease).toBe(true);
      expect(checkConsecutiveRejections(state).reason).toContain('3+ consecutive');
    });
  });

  describe('decreaseTrust', () => {
    it('decreases trust by 1', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 2,
      };
      const updated = decreaseTrust(state, 'Test reason');
      expect(updated.current_level).toBe(1);
    });

    it('does not go below 0', () => {
      const state = createDefaultTrustState(); // level 0
      const updated = decreaseTrust(state, 'Test reason');
      expect(updated.current_level).toBe(0);
    });

    it('adds entry to level_history', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 2,
      };
      const updated = decreaseTrust(state, 'Test decrease');
      expect(updated.level_history).toHaveLength(1);
      expect(updated.level_history[0]).toMatchObject({
        from: 2,
        to: 1,
        reason: 'Test decrease',
      });
    });

    it('does not add history entry when already at 0', () => {
      const state = createDefaultTrustState();
      const updated = decreaseTrust(state, 'Already at zero');
      expect(updated.level_history).toHaveLength(0);
    });
  });

  describe('recordContractViolation', () => {
    it('decreases trust by 1 with contract violation reason', () => {
      const state: TrustState = {
        ...createDefaultTrustState(),
        current_level: 2,
      };
      const updated = recordContractViolation(state, 'BOLT-003');
      expect(updated.current_level).toBe(1);
      expect(updated.level_history[0].reason).toContain('Contract violation');
      expect(updated.level_history[0].reason).toContain('BOLT-003');
    });
  });

  describe('backward compatibility', () => {
    it('loadTrustState initializes new fields for old data', () => {
      // Write old format without consecutive_rejections or transition_history
      const oldState = {
        current_level: 1,
        total_transitions: 15,
        rejection_count: 1,
        rejection_rate: 0.067,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      };
      // Save old format
      const filePath = join(TEST_DIR, '.olympus', 'trust-state.json');
      writeFileSync(filePath, JSON.stringify(oldState), 'utf-8');

      const loaded = loadTrustState(TEST_DIR);
      expect(loaded.consecutive_rejections).toBe(0);
      expect(loaded.transition_history).toEqual([]);
    });
  });
});
