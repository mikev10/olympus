import type { Socket } from 'node:net';
import { createServer } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../gemini.ts';
import {
  GEMINI_MODEL,
  RequestTimeoutError,
  callGemini,
  geminiRequest,
  httpsFetch,
  isTimeout,
  parseGeminiResponse,
} from '../gemini.ts';

// A key-shaped-but-fake value, per the brief: realistic enough that a naive
// substring check would find it if it leaked anywhere it should not.
const FAKE_KEY = 'AIzaSyDummyDummyDummyDummyDummyDummy12';

// Supplied only to the transport, never to the builder: any appearance of it
// in a built URL or body is a leak.
const SENTINEL = 'AIzaSySentinelSentinelSentinelSentinel7';

describe('GEMINI_MODEL', () => {
  it('is pinned to the measured model id, with no fallback list anywhere', () => {
    expect(GEMINI_MODEL).toBe('gemini-3.1-pro-preview');
  });
});

describe('geminiRequest', () => {
  const request = geminiRequest('the whole review bundle');

  it('builds a URL ending in the pinned model\'s generateContent path, with no query string', () => {
    expect(request.url.endsWith('models/gemini-3.1-pro-preview:generateContent')).toBe(true);
    expect(request.url).not.toContain('?');
    expect(request.url).not.toContain('key=');
  });

  it('builds exactly the pinned endpoint, and no credential handed to the transport reaches the request', async () => {
    // Replaces an arity assertion that passed regardless of the code under
    // test (codex-6). The URL is asserted by its value, and the key by where
    // it ends up: SENTINEL is distinct from every other value in this file, so
    // if it reached the URL or the body these assertions would see it.
    expect(request.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent',
    );

    let capturedUrl = '';
    let capturedBody = '';
    let capturedHeaders: Readonly<Record<string, string>> = {};
    const fetchImpl: FetchLike = (url, init) => {
      capturedUrl = url;
      capturedBody = init.body;
      capturedHeaders = init.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }),
        text: () => Promise.resolve(''),
      });
    };

    await callGemini('the whole review bundle', { env: { GEMINI_API_KEY: SENTINEL }, fetchImpl });

    expect(capturedUrl).toBe(request.url);
    expect(capturedUrl).not.toContain(SENTINEL);
    expect(capturedBody).not.toContain(SENTINEL);
    expect(capturedBody).toContain('the whole review bundle');
    expect(capturedHeaders['x-goog-api-key']).toBe(SENTINEL);
  });

  it('carries exactly one user part with the payload text', () => {
    expect(request.body.contents).toHaveLength(1);
    expect(request.body.contents[0]).toEqual({
      role: 'user',
      parts: [{ text: 'the whole review bundle' }],
    });
  });

  it('has no tools field', () => {
    expect(request.body).not.toHaveProperty('tools');
  });

  it('has no toolConfig field', () => {
    expect(request.body).not.toHaveProperty('toolConfig');
  });

  it('sets generationConfig.maxOutputTokens to 32768, since Gemini otherwise applies its own default limit', () => {
    expect(request.body.generationConfig.maxOutputTokens).toBe(32768);
  });

  it('lists x-goog-api-key and content-type as header names, carrying no values', () => {
    expect(request.headerNames).toContain('x-goog-api-key');
    expect(request.headerNames).toContain('content-type');
    expect(JSON.stringify(request)).not.toContain(FAKE_KEY);
  });
});

describe('parseGeminiResponse', () => {
  it('extracts the reply joined from candidates[0].content.parts[*].text, modelVersion, and promptTokenCount', () => {
    const response = {
      candidates: [
        {
          content: { parts: [{ text: 'Finding one. ' }, { text: 'Finding two.' }] },
          finishReason: 'STOP',
        },
      ],
      modelVersion: 'gemini-3.1-pro-preview',
      usageMetadata: { promptTokenCount: 126_072 },
    };

    const result = parseGeminiResponse(response);

    expect(result.reply).toBe('Finding one. Finding two.');
    expect(result.modelVersion).toBe('gemini-3.1-pro-preview');
    expect(result.promptTokenCount).toBe(126_072);
    expect(result.complete).toBe(true);
    expect(result.incompleteReason).toBeNull();
  });

  it('returns null, not a guess, for modelVersion and promptTokenCount when they are absent', () => {
    const response = {
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    };

    const result = parseGeminiResponse(response);

    expect(result.modelVersion).toBeNull();
    expect(result.promptTokenCount).toBeNull();
  });

  it('returns responseId and usageMetadata verbatim from the top level of the response', () => {
    const usageMetadata = {
      promptTokenCount: 126_072,
      candidatesTokenCount: 4_210,
      totalTokenCount: 131_902,
      serviceTier: 'standard',
    };
    const response = {
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      responseId: 'resp-abc123',
      usageMetadata,
    };

    const result = parseGeminiResponse(response);

    expect(result.responseId).toBe('resp-abc123');
    expect(result.usageMetadata).toEqual(usageMetadata);
  });

  it('returns null, not a guess, for responseId and usageMetadata when they are absent', () => {
    const response = {
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    };

    const result = parseGeminiResponse(response);

    expect(result.responseId).toBeNull();
    expect(result.usageMetadata).toBeNull();
  });

  it('reports plainly, rather than an empty reply, when there are no candidates at all', () => {
    const result = parseGeminiResponse({ modelVersion: 'gemini-3.1-pro-preview' });

    expect(result.complete).toBe(false);
    expect(result.reply).toBeNull();
    expect(result.incompleteReason).toBe('no candidates');
    // Fields independent of candidates are still read.
    expect(result.modelVersion).toBe('gemini-3.1-pro-preview');
  });

  it('reports plainly, rather than an empty reply, when candidates is an empty array', () => {
    const result = parseGeminiResponse({ candidates: [] });

    expect(result.complete).toBe(false);
    expect(result.reply).toBeNull();
    expect(result.incompleteReason).toBe('no candidates');
  });

  for (const finishReason of ['MAX_TOKENS', 'SAFETY', 'RECITATION']) {
    it(`treats finishReason "${finishReason}" as an incomplete reply, not a complete one`, () => {
      const response = {
        candidates: [{ content: { parts: [{ text: 'partial text' }] }, finishReason }],
      };

      const result = parseGeminiResponse(response);

      expect(result.complete).toBe(false);
      expect(result.reply).toBeNull();
      expect(result.incompleteReason).toBe(finishReason);
    });
  }

  it('reports plainly when the candidate has no text parts', () => {
    const response = {
      candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
    };

    const result = parseGeminiResponse(response);

    expect(result.complete).toBe(false);
    expect(result.reply).toBeNull();
    expect(result.incompleteReason).toBe('no text parts');
  });

  it('excludes a thought part\'s text from the reply, keeping only the answer part', () => {
    const response = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'the model privately reasoning about the bundle', thought: true },
              { text: 'the actual review findings' },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    };

    const result = parseGeminiResponse(response);

    expect(result.reply).toBe('the actual review findings');
    expect(result.reply).not.toContain('privately reasoning');
  });

  it('includes a part explicitly marked thought: false', () => {
    const response = {
      candidates: [
        { content: { parts: [{ text: 'the actual review findings', thought: false }] }, finishReason: 'STOP' },
      ],
    };

    const result = parseGeminiResponse(response);

    expect(result.reply).toBe('the actual review findings');
  });

  it('reports plainly, rather than an empty reply, when every text part is a thought part', () => {
    const response = {
      candidates: [
        {
          content: { parts: [{ text: 'only private reasoning here', thought: true }] },
          finishReason: 'STOP',
        },
      ],
    };

    const result = parseGeminiResponse(response);

    expect(result.complete).toBe(false);
    expect(result.reply).toBeNull();
    expect(result.incompleteReason).toBe('no text parts');
  });

  it('treats a candidate whose finishReason is absent as an incomplete reply, not a complete one', () => {
    const response = {
      candidates: [{ content: { parts: [{ text: 'text with no finish reason' }] } }],
    };

    const result = parseGeminiResponse(response);

    expect(result.complete).toBe(false);
    expect(result.reply).toBeNull();
    expect(result.incompleteReason).toBe('no finishReason');
  });

  it('reports plainly when the candidate has no content.parts at all', () => {
    const response = {
      candidates: [{ finishReason: 'STOP' }],
    };

    const result = parseGeminiResponse(response);

    expect(result.complete).toBe(false);
    expect(result.reply).toBeNull();
  });
});

describe('callGemini', () => {
  it('refuses when GEMINI_API_KEY is absent, without ever calling fetch', async () => {
    let called = false;
    const fetchImpl = (): Promise<never> => {
      called = true;
      throw new Error('fetch must not be called when the key is absent');
    };

    await expect(callGemini('bundle text', { env: {}, fetchImpl })).rejects.toThrow(/GEMINI_API_KEY/);
    expect(called).toBe(false);
  });

  it('sends the key only in the x-goog-api-key header, and it appears nowhere in the URL', async () => {
    let capturedUrl = '';
    let capturedHeaders: Readonly<Record<string, string>> = {};
    const fetchImpl = (url: string, init: { readonly headers: Readonly<Record<string, string>> }) => {
      capturedUrl = url;
      capturedHeaders = init.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          }),
        text: () => Promise.resolve(''),
      });
    };

    await callGemini('bundle text', { env: { GEMINI_API_KEY: FAKE_KEY }, fetchImpl });

    expect(capturedHeaders['x-goog-api-key']).toBe(FAKE_KEY);
    expect(capturedUrl).not.toContain(FAKE_KEY);
  });

  it('produces an error carrying the status and body but never the key, on a non-2xx response', async () => {
    const fetchImpl = () =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('model gemini-3.1-pro-preview not found'),
      });

    let error: unknown;
    try {
      await callGemini('bundle text', { env: { GEMINI_API_KEY: FAKE_KEY }, fetchImpl });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain('404');
    expect(message).toContain('model gemini-3.1-pro-preview not found');
    expect(String(error)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(error)).not.toContain(FAKE_KEY);
  });

  it('hands fetch an AbortSignal on init.signal, live when the call is made and fired at the time limit', async () => {
    const seen: { signal?: AbortSignal; abortedAtCall?: boolean } = {};
    const fetchImpl: FetchLike = (_url, init) => {
      seen.signal = init.signal;
      seen.abortedAtCall = init.signal.aborted;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('ended by the signal'));
        });
      });
    };

    await expect(
      callGemini('bundle text', { env: { GEMINI_API_KEY: FAKE_KEY }, fetchImpl, timeoutMs: 50 }),
    ).rejects.toThrow('ended by the signal');
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(seen.abortedAtCall).toBe(false);
    expect(seen.signal?.aborted).toBe(true);
  });

  it('does not retry with a different model on a non-2xx response — it just fails', async () => {
    let callCount = 0;
    const fetchImpl = () => {
      callCount += 1;
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('model not found'),
      });
    };

    await expect(
      callGemini('bundle text', { env: { GEMINI_API_KEY: FAKE_KEY }, fetchImpl }),
    ).rejects.toThrow();
    expect(callCount).toBe(1);
  });

  describe('when no env is injected', () => {
    const original = process.env.GEMINI_API_KEY;

    beforeEach(() => {
      delete process.env.GEMINI_API_KEY;
    });

    afterEach(() => {
      if (original === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = original;
    });

    it('reads GEMINI_API_KEY from process.env at call time', async () => {
      process.env.GEMINI_API_KEY = FAKE_KEY;
      let capturedHeaders: Readonly<Record<string, string>> = {};
      const fetchImpl = (_url: string, init: { readonly headers: Readonly<Record<string, string>> }) => {
        capturedHeaders = init.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () =>
            Promise.resolve({
              candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
            }),
          text: () => Promise.resolve(''),
        });
      };

      await callGemini('bundle text', { fetchImpl });

      expect(capturedHeaders['x-goog-api-key']).toBe(FAKE_KEY);
    });

    it('refuses when process.env carries no GEMINI_API_KEY and no env override is given', async () => {
      const fetchImpl = (): Promise<never> => {
        throw new Error('fetch must not be called');
      };

      await expect(callGemini('bundle text', { fetchImpl })).rejects.toThrow(/GEMINI_API_KEY/);
    });
  });
});

describe('httpsFetch', () => {
  it('gives up at the limit its signal carries, against a loopback server that accepts and never answers', async () => {
    // Loopback only: the server is this process, and nothing leaves the machine.
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      sockets.push(socket);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const started = Date.now();
      let caught: unknown;
      try {
        await httpsFetch(`https://127.0.0.1:${String(port)}/v1beta/models/m:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': FAKE_KEY, 'content-type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(200),
        });
      } catch (err) {
        caught = err;
      }
      const elapsed = Date.now() - started;

      expect(caught).toBeInstanceOf(RequestTimeoutError);
      expect(isTimeout(caught)).toBe(true);
      // It connected and waited on a silent peer until the signal, not less and not much more.
      expect(sockets).toHaveLength(1);
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(10_000);
      // Nothing about the request, its headers least of all, rides on the error.
      const error = caught instanceof Error ? caught : new Error('not an Error');
      expect(`${String(error)} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`).not.toContain(FAKE_KEY);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });
});
