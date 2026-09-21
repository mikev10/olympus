import { describe, expect, it } from 'vitest';
import { CODEX_KEEP, GEMINI_KEEP, outcomeOf, stripSessionLog } from '../evidence.ts';

describe('outcomeOf', () => {
  const ok = { exitCode: 0, timedOut: false } as const;
  const ingested = { kind: 'complete', inputTokens: 127_096, floor: 80_732 } as const;

  it('counts a clean run whose echo verified', () => {
    expect(outcomeOf({ ...ok, ingestion: ingested, integrity: { kind: 'verified' } })).toBe('counted');
  });

  it('fails a timeout regardless of everything else', () => {
    expect(
      outcomeOf({ exitCode: 0, timedOut: true, ingestion: ingested, integrity: { kind: 'verified' } }),
    ).toBe('FAILED');
  });

  it('fails a non-zero exit before looking at integrity', () => {
    expect(
      outcomeOf({ exitCode: 1, timedOut: false, ingestion: ingested, integrity: { kind: 'verified' } }),
    ).toBe('FAILED');
  });

  it('reports a mismatched echo as INTEGRITY_FAILED', () => {
    expect(
      outcomeOf({ ...ok, ingestion: ingested, integrity: { kind: 'failed', absent: ['head'] } }),
    ).toBe('INTEGRITY_FAILED');
  });

  it('reports an absent echo as INTEGRITY_UNVERIFIED, which still does not count', () => {
    const o = outcomeOf({
      ...ok,
      ingestion: ingested,
      integrity: { kind: 'unverified', absent: ['base', 'head', 'finalSection'] },
    });
    expect(o).toBe('INTEGRITY_UNVERIFIED');
    expect(o).not.toBe('counted');
  });

  it('fails a run whose vendor-reported ingestion fell short, even if the echo verified', () => {
    expect(outcomeOf({
      exitCode: 0, timedOut: false,
      ingestion: { kind: 'short', inputTokens: 32_893, floor: 80_732 },
      integrity: { kind: 'verified' },
    })).toBe('INTEGRITY_FAILED');
  });

  it('fails a run whose vendor reported no token count', () => {
    expect(outcomeOf({
      exitCode: 0, timedOut: false,
      ingestion: { kind: 'unreported', floor: 80_732 },
      integrity: { kind: 'verified' },
    })).toBe('INTEGRITY_FAILED');
  });
});

describe('stripSessionLog', () => {
  it('keeps only the metadata record types and drops message bodies', () => {
    const jsonl = [
      '{"type":"session_meta","id":"s1"}',
      '{"type":"response_item","text":"the entire 400KB bundle restated"}',
      '{"type":"event_msg","text":"also a message body"}',
      '{"type":"token_usage_record","payload":{"usage":{"total_tokens":98000}}}',
      '{"type":"turn_context","model_context_window":258400}',
      '{"type":"world_state","payload":{"state":{"collaboration_mode":{"model":"gpt-6-astra"}}}}',
    ].join('\n');

    const out = stripSessionLog(jsonl, CODEX_KEEP);

    expect(out).not.toContain('400KB bundle restated');
    expect(out).not.toContain('also a message body');
    expect(out.split('\n')).toHaveLength(4);
    expect(out).toContain('session_meta');
    expect(out).toContain('token_usage_record');
    expect(out).toContain('turn_context');
    // world_state is the only record carrying the resolved model id.
    expect(out).toContain('gpt-6-astra');
  });

  it('skips unparseable lines rather than throwing', () => {
    const out = stripSessionLog('{"type":"session_meta"}\nnot json\n\n', CODEX_KEEP);
    expect(out).toBe('{"type":"session_meta"}');
  });

  it('keeps Gemini stream-json init and result events', () => {
    const jsonl = ['{"type":"init","model":"m"}', '{"type":"chunk","text":"x"}', '{"type":"result","stats":{}}'].join('\n');
    const out = stripSessionLog(jsonl, GEMINI_KEEP);
    expect(out).toContain('init');
    expect(out).toContain('result');
    expect(out).not.toContain('chunk');
  });
});
