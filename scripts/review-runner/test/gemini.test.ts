import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GEMINI_MODEL,
  callGemini,
  geminiRequest,
  parseGeminiResponse,
} from '../gemini.ts';

// A key-shaped-but-fake value, per the brief: realistic enough that a naive
// substring check would find it if it leaked anywhere it should not.
const FAKE_KEY = 'AIzaSyDummyDummyDummyDummyDummyDummy12';

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

  it('goes through keylessUrl, so a URL carrying a query string is impossible to construct here', () => {
    // geminiRequest takes no key parameter at all — there is no argument by
    // which a caller could even attempt to smuggle one into the URL.
    expect(geminiRequest.length).toBe(1);
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
