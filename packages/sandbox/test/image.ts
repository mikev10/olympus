/**
 * The image the Docker-backed suites provision, pinned by digest so the
 * container a reviewer gets is the container CI got. Alpine because it is
 * four megabytes and carries the POSIX shell the provider's keep-alive needs.
 *
 * `packages/conformance/src/registry/local-sandbox.ts` pins the same digest
 * for the registry assertions. The two are independent suites and each pins
 * its own; if one is moved to a new image the other does not have to follow.
 */
export const TEST_IMAGE = 'alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b';
