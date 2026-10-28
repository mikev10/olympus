/**
 * The operator's configuration of one endpoint, and the one function that
 * accepts it.
 *
 * Every field is required and nothing is inferred (D-R6-02). The family above
 * all: it is what reviewer independence is graded on (I6), and the driver has
 * no way to see one, so it is the operator's statement or it is nothing. A
 * default here would be a family nobody declared, a price nobody stated, or a
 * bound nobody chose.
 */
import type { ModelFamily, ModelTier } from '@olympus-ai/core';
import type { LocalUpstream, ModelPrice, RelayScheme } from '@olympus-ai/sandbox';
import { refuse } from './refusal.js';

/** The request field a call's output ceiling is sent in. Newer OpenAI models take only the second. */
export type CeilingField = 'max_tokens' | 'max_completion_tokens';

export interface EndpointConfig {
  /**
   * The relay's only upstream: an `https` origin with no path,
   * `'https://api.example.com'`, or a model on the Docker host,
   * `{ local: 'docker-host', port }` (A-R21-04). An `http` URL is never read as local.
   */
  readonly upstream: string | LocalUpstream;
  /** The chat-completions path, ending `/chat/completions`: `'/v1/chat/completions'`. The relay's only grant. */
  readonly path: string;
  /** The header the endpoint reads its credential from, such as `authorization` or `api-key`. */
  readonly header: string;
  /**
   * How the credential is written into it (A-R6-02), or `'none'`: the endpoint
   * takes no credential, which only a local upstream may declare (A-R21-04).
   * Under `'none'` the relay deletes whatever the sandbox sent in `header`.
   */
  readonly scheme: RelayScheme;
  /** Who serves the model, as the run records it: `'openai'`, `'together'`, `'self-hosted'`. */
  readonly provider: string;
  /** The model family, as the operator declares it (I6). Lower-case letters, digits, `.`, `_`, `-`. */
  readonly family: string;
  /** A label for what the endpoint serves, recorded on every result: a date, a deployment, a server version. */
  readonly version: string;
  /** The exact model id each tier sends, never an alias (D-R6-03, D-R14-01). */
  readonly models: Readonly<Record<ModelTier, string>>;
  /** A price for every model in `models`, in US dollars per million tokens. Zero is a price; absent is not. */
  readonly prices: Readonly<Record<string, ModelPrice>>;
  /** The most output one call may generate, sent on every request in `ceilingField`. */
  readonly maxOutputTokens: number;
  readonly ceilingField: CeilingField;
  /** The most tasks this driver runs at once, each on its own sandbox (A-R4-04). */
  readonly parallelism: number;
  /** The most model calls one task may make before it is refused. */
  readonly maxTurns: number;
}

/** The configuration as the driver holds it: checked, frozen, and with the family branded once. */
export interface CheckedConfig extends Omit<EndpointConfig, 'family'> {
  readonly family: ModelFamily;
}

const TIERS: readonly ModelTier[] = ['fast', 'standard', 'deep'];
const PRICE_FIELDS: ReadonlyArray<keyof ModelPrice> = ['inputPerMTok', 'outputPerMTok', 'cacheReadPerMTok', 'cacheWritePerMTok', 'cacheWrite1hPerMTok'];
const FIELDS: ReadonlyArray<keyof EndpointConfig> = [
  'upstream', 'path', 'header', 'scheme', 'provider', 'family', 'version', 'models', 'prices',
  'maxOutputTokens', 'ceilingField', 'parallelism', 'maxTurns',
];

/** A path as the relay matches one: plain segments, no dot segment, no encoding, no trailing slash. */
const PATH = /^(?:\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$/u;
/** An HTTP header name (RFC 9110 token). */
const HEADER = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u;
const FAMILY = /^[a-z0-9][a-z0-9._-]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shown(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function text(config: Record<string, unknown>, field: keyof EndpointConfig): string {
  const value = config[field];
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    refuse('configuration', `${field} must be a non-empty string with no surrounding space, not ${shown(value)}`);
  }
  return value;
}

function count(config: Record<string, unknown>, field: keyof EndpointConfig): number {
  const value = config[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    refuse('configuration', `${field} must be a positive integer, not ${shown(value)}`);
  }
  return value;
}

/**
 * The upstream as A-R21-04 takes one: an `https` origin with no path, or
 * exactly `{ local: 'docker-host', port }`. An `http` URL is refused whatever
 * host it names, so local is never inferred from one.
 */
function checkUpstream(value: unknown): string | LocalUpstream {
  if (typeof value === 'string') {
    let origin: URL | undefined;
    try {
      origin = new URL(value);
    } catch {
      origin = undefined;
    }
    if (origin?.protocol !== 'https:' || origin.origin !== value) {
      refuse(
        'configuration',
        `upstream must be an https origin with no path, query, credentials, or trailing slash, not ${shown(value)}. ` +
          "A model on the Docker host is { \"local\": \"docker-host\", \"port\": <port> }, never an http URL.",
      );
    }
    return value;
  }
  if (!isRecord(value)) refuse('configuration', `upstream must be an https origin or { local: 'docker-host', port }, not ${shown(value)}`);
  const extra = Object.keys(value).filter((key) => key !== 'local' && key !== 'port');
  if (extra.length > 0) refuse('configuration', `upstream holds ${extra.map((k) => `'${k}'`).join(', ')}; a local upstream is the Docker host and a port`);
  if (value.local !== 'docker-host') refuse('configuration', `upstream.local must be 'docker-host', not ${shown(value.local)}`);
  const port = value.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    refuse('configuration', `upstream.port must be an integer port from 1 to 65535, not ${shown(port)}`);
  }
  return Object.freeze({ local: 'docker-host', port });
}

/**
 * Accepts a configuration exactly as written or refuses it naming the field
 * (I5). Typed input is checked as strictly as parsed JSON: a caller arriving
 * from untyped code, or a file, gets the same answer.
 */
export function checkConfig(input: unknown): CheckedConfig {
  if (!isRecord(input)) refuse('configuration', 'the endpoint configuration is not an object');
  const unknown = Object.keys(input).filter((key) => !(FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    refuse('configuration', `the endpoint configuration holds ${unknown.map((k) => `'${k}'`).join(', ')}, which the driver does not read; a field it ignored would be a setting that did nothing`);
  }

  const upstream = checkUpstream(input.upstream);

  const path = text(input, 'path');
  if (!PATH.test(path) || !path.endsWith('/chat/completions')) {
    refuse('configuration', `path must be a plain path ending /chat/completions, such as '/v1/chat/completions', not ${shown(path)}`);
  }

  const header = text(input, 'header');
  if (!HEADER.test(header)) refuse('configuration', `header ${shown(header)} is not an HTTP header name`);

  const scheme = input.scheme;
  if (scheme !== 'raw' && scheme !== 'bearer' && scheme !== 'none') refuse('configuration', `scheme must be 'raw', 'bearer', or 'none', not ${shown(scheme)}`);
  if (scheme === 'none' && typeof upstream === 'string') {
    refuse('configuration', "scheme 'none' declares an endpoint with no credential, which only a local upstream on the Docker host may be; an https endpoint takes a key (A-R21-04)");
  }

  const provider = text(input, 'provider');
  const family = text(input, 'family');
  if (!FAMILY.test(family)) {
    refuse('configuration', `family ${shown(family)} must be lower-case letters, digits, '.', '_', and '-'; it is the operator's declaration and is compared as written (I6)`);
  }
  const version = text(input, 'version');

  const models = input.models;
  if (!isRecord(models)) refuse('configuration', 'models must map every tier to a model id');
  const extraTiers = Object.keys(models).filter((tier) => !(TIERS as readonly string[]).includes(tier));
  if (extraTiers.length > 0) refuse('configuration', `models names ${extraTiers.map((t) => `'${t}'`).join(', ')}, which is not a tier`);
  const tiers: Partial<Record<ModelTier, string>> = {};
  for (const tier of TIERS) {
    const model = models[tier];
    if (typeof model !== 'string' || model.trim() === '' || model !== model.trim()) {
      refuse('configuration', `models.${tier} must be the exact model id that tier sends, not ${shown(model)}`);
    }
    tiers[tier] = model;
  }

  const prices = input.prices;
  if (!isRecord(prices)) refuse('configuration', 'prices must give a price for every model');
  const table: Record<string, ModelPrice> = {};
  for (const [model, price] of Object.entries(prices)) {
    if (!isRecord(price)) refuse('configuration', `prices[${shown(model)}] is not a price`);
    const extra = Object.keys(price).filter((key) => !(PRICE_FIELDS as readonly string[]).includes(key));
    if (extra.length > 0) refuse('configuration', `prices[${shown(model)}] holds ${extra.join(', ')}, which is not a price field`);
    const at = (field: keyof ModelPrice): number => {
      const value = price[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        refuse('configuration', `prices[${shown(model)}].${field} must be a non-negative finite number, not ${shown(value)}`);
      }
      return value;
    };
    table[model] = Object.freeze({
      inputPerMTok: at('inputPerMTok'),
      outputPerMTok: at('outputPerMTok'),
      cacheReadPerMTok: at('cacheReadPerMTok'),
      cacheWritePerMTok: at('cacheWritePerMTok'),
      cacheWrite1hPerMTok: at('cacheWrite1hPerMTok'),
    });
  }
  for (const tier of TIERS) {
    const model = tiers[tier] ?? '';
    if (!Object.hasOwn(table, model)) {
      refuse('configuration', `models.${tier} is ${shown(model)}, which prices does not name; a call whose cost cannot be counted is not made (I5)`);
    }
  }

  const ceilingField = input.ceilingField;
  if (ceilingField !== 'max_tokens' && ceilingField !== 'max_completion_tokens') {
    refuse('configuration', `ceilingField must be 'max_tokens' or 'max_completion_tokens', not ${shown(ceilingField)}`);
  }

  return Object.freeze({
    upstream,
    path,
    header,
    scheme,
    provider,
    // I6: the one place the family is branded. It is the operator's string, checked for shape and nothing else.
    family: family as ModelFamily,
    version,
    models: Object.freeze(tiers as Record<ModelTier, string>),
    prices: Object.freeze(table),
    maxOutputTokens: count(input, 'maxOutputTokens'),
    ceilingField,
    parallelism: count(input, 'parallelism'),
    maxTurns: count(input, 'maxTurns'),
  });
}
