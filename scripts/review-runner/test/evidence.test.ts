import { describe, expect, it } from 'vitest';
import type { KeylessUrl, RedactedEnv } from '../evidence.ts';
import { CODEX_KEEP, keylessUrl, outcomeOf, redactEnv, stripSessionLog } from '../evidence.ts';

describe('outcomeOf', () => {
  // An api run: no approval policy exists to record.
  const api = { invocation: { kind: 'api' }, recordedApprovalPolicy: null } as const;
  const ok = { ...api, exitCode: 0, timedOut: false } as const;
  const ingested = { kind: 'complete', inputTokens: 127_096, floor: 80_732 } as const;

  it('counts a clean run whose echo verified', () => {
    expect(outcomeOf({ ...ok, ingestion: ingested, integrity: { kind: 'verified' } })).toBe('counted');
  });

  it('fails a timeout regardless of everything else', () => {
    expect(
      outcomeOf({ ...api, exitCode: 0, timedOut: true, ingestion: ingested, integrity: { kind: 'verified' } }),
    ).toBe('FAILED');
  });

  it('fails a non-zero exit before looking at integrity', () => {
    expect(
      outcomeOf({ ...api, exitCode: 1, timedOut: false, ingestion: ingested, integrity: { kind: 'verified' } }),
    ).toBe('FAILED');
  });

  it('counts a cli run only when its recorded approval policy is exactly "never"', () => {
    const cli = { invocation: { kind: 'cli' }, exitCode: 0, timedOut: false, ingestion: ingested } as const;

    expect(outcomeOf({ ...cli, recordedApprovalPolicy: 'never', integrity: { kind: 'verified' } })).toBe('counted');
    for (const recordedApprovalPolicy of ['on-request', 'untrusted', 'on-failure', 'Never', '', null]) {
      expect(outcomeOf({ ...cli, recordedApprovalPolicy, integrity: { kind: 'verified' } })).toBe('FAILED');
    }
  });

  it('does not apply the approval rule to an api run, which has no policy to record', () => {
    expect(outcomeOf({ ...ok, recordedApprovalPolicy: null, ingestion: ingested, integrity: { kind: 'verified' } })).toBe(
      'counted',
    );
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
      ...api, exitCode: 0, timedOut: false,
      ingestion: { kind: 'short', inputTokens: 32_893, floor: 80_732 },
      integrity: { kind: 'verified' },
    })).toBe('INTEGRITY_FAILED');
  });

  it('fails a run whose vendor reported no token count', () => {
    expect(outcomeOf({
      ...api, exitCode: 0, timedOut: false,
      ingestion: { kind: 'unreported', floor: 80_732 },
      integrity: { kind: 'verified' },
    })).toBe('INTEGRITY_FAILED');
  });
});

describe('redactEnv', () => {
  it('keeps CODEX_HOME, HOME, and USERPROFILE verbatim', () => {
    const out = redactEnv({ CODEX_HOME: '/s', HOME: '/home/x', USERPROFILE: 'C:\\Users\\x' });
    expect(out.CODEX_HOME).toBe('/s');
    expect(out.HOME).toBe('/home/x');
    expect(out.USERPROFILE).toBe('C:\\Users\\x');
  });

  it('redacts key-shaped secrets and leaks their value nowhere in the result', () => {
    const secret = 'AIzaSyDummyDummyDummyDummyDummyDummy12';
    const out = redactEnv({ GEMINI_API_KEY: secret, OPENAI_API_KEY: 'sk-DummyDummyDummy', GH_TOKEN: 'ghp_DummyDummy' });
    expect(out.GEMINI_API_KEY).toBe('<redacted>');
    expect(out.OPENAI_API_KEY).toBe('<redacted>');
    expect(out.GH_TOKEN).toBe('<redacted>');
    // Asserting only the field equals "<redacted>" would miss a value leaked
    // under a different key; check the whole serialized result instead.
    expect(JSON.stringify(out)).not.toContain(secret);
    expect(JSON.stringify(out)).not.toContain('sk-DummyDummyDummy');
    expect(JSON.stringify(out)).not.toContain('ghp_DummyDummy');
  });

  it('redacts DATABASE_URL, the case the default-deny ruling exists for', () => {
    const out = redactEnv({ DATABASE_URL: 'postgres://user:pass@host/db' });
    expect(out.DATABASE_URL).toBe('<redacted>');
  });

  it('will not accept an unredacted environment map where a RedactedEnv is required', () => {
    const plain: Readonly<Record<string, string>> = { CODEX_HOME: '/s' };
    // @ts-expect-error a plain map must go through redactEnv
    const branded: RedactedEnv = plain;
    expect(branded).toBe(plain);
  });
});

describe('keylessUrl', () => {
  it('accepts a plain endpoint with no query string and no credentials', () => {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent';
    expect(keylessUrl(url)).toBe(url);
  });

  it('refuses a URL carrying a key in its query string, without echoing the key', () => {
    let message = '';
    try {
      keylessUrl('https://example.com/x?key=AIzaDummy');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('AIzaDummy');
  });

  it('refuses a URL carrying embedded credentials', () => {
    expect(() => keylessUrl('https://user:pass@host/x')).toThrow();
  });

  it('will not accept a plain string where a KeylessUrl is required', () => {
    const plain = 'https://example.com';
    // @ts-expect-error a plain string must go through keylessUrl
    const branded: KeylessUrl = plain;
    expect(branded).toBe(plain);
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
});
