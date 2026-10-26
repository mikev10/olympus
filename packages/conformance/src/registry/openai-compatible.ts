/**
 * The invariant assertions the OpenAI-compatible driver owes (R6), each
 * external in `@olympus-ai/driver-openai-compatible` and counted only after
 * reconciliation against that package's run report.
 *
 * Its suite drives real sandboxes, real relays, and a TLS endpoint it starts
 * itself, and calls no model, so the ordinary test run writes the report the
 * registry reconciles against.
 */
import { external } from '../kit/assert.js';

const PACKAGE = '@olympus-ai/driver-openai-compatible';
const FILE = 'test/invariants.test.ts';

/** I1: tools run in the sandbox and model calls through its relay; the agent loop holds no host filesystem access it hands the model. */
export const OPENAI_COMPATIBLE_EXECUTES_INSIDE_THE_SANDBOX = external({
  id: 'I1.openai-compatible-driver-executes-inside-the-sandbox',
  title:
    'every tool call of a task runs inside the provisioned sandbox through provider.exec and every model call through its relay, and a driver with no provider, or with one that cannot call the relay, cannot be constructed',
  level: 'runtime',
  package: PACKAGE,
  file: FILE,
});

/** I4: default deny reaches the model's own tool calls, not only the grant. */
export const OPENAI_COMPATIBLE_TOOL_INVENTORY_VALIDATED = external({
  id: 'I4.openai-compatible-driver-tool-inventory-validated',
  title:
    'the endpoint is offered exactly the tools the task granted and no others, a model call naming an ungranted tool is answered with an error and never run, ' +
    'and a grant outside the declared inventory is refused before anything runs in the sandbox',
  level: 'runtime',
  package: PACKAGE,
  file: FILE,
});

/** I4: the endpoint's credential is held by the relay and written in the operator's scheme (A-R6-02). */
export const OPENAI_COMPATIBLE_CREDENTIAL_NOT_READABLE = external({
  id: 'I4.openai-compatible-credential-not-readable-by-the-task',
  title:
    "the endpoint's credential never enters the sandbox: no process, file, environment entry, or argument of it holds the value, " +
    'while every model call reaches the endpoint carrying it as the bearer scheme the operator declared; the same search finds a value an exec was given',
  level: 'runtime',
  package: PACKAGE,
  file: FILE,
});

/**
 * I6: the family is the operator's declaration, and an answer from another model is not attributed to it (D-R6-03).
 * The `model` check is consistency, not authentication: that the endpoint serves the model it names is the operator's trust assumption.
 */
export const OPENAI_COMPATIBLE_FAMILY_IS_DECLARED = external({
  id: 'I6.openai-compatible-family-is-declared',
  title:
    "the family a result records is the operator's declaration, never derived; a configuration without one is refused; " +
    'an answer naming another model, or none, refuses the task rather than being attributed to the declared family; ' +
    'and a turn is answered by the relay even after the task replaces node in the sandbox, so nothing the task wrote is attributed to the model (A-R6-05)',
  level: 'runtime',
  package: PACKAGE,
  file: FILE,
});
