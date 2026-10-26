/**
 * @olympus-ai/driver-openai-compatible: the `Driver` contract over any
 * endpoint that speaks the OpenAI-compatible chat-completions API (R6).
 *
 * The package depends on `@olympus-ai/core` for the contract and on
 * `@olympus-ai/sandbox` for the provider, and on nothing else in the
 * workspace. The family a run records for it is the operator's declaration
 * (I6); every tool it runs, runs in the sandbox (I1).
 */
export * from './call.js';
export * from './config.js';
export * from './driver.js';
export * from './refusal.js';
export * from './tools.js';
