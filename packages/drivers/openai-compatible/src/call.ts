/**
 * The variable the provider sets in the sandbox to the relay's address
 * (D-R6-01). The driver's own model calls no longer read it: they are made
 * from the relay's container (A-R6-05). It stays in the relay spec because
 * the sandbox's address for the relay is the provider's to set, and a request
 * a process in the sandbox sends there is metered like any other.
 */
export const RELAY_URL_VARIABLE = 'MODEL_RELAY_URL';
