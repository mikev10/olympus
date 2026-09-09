// I5: every stub in the walking skeleton, and the line itself, declares what
// it cannot enforce through an `unsafe` property. The entry point reads the
// property structurally and refuses to carry a run above L1 while any exists
// (I5.unsafe-component-refused-above-l1). This fixture pins each exported
// declaration to the DeclaresUnsafe shape, so removing one is a compile error
// here before it is a runtime failure there. The stubs live in vault,
// sandbox, and core, none of which may import api, which is why the pin is a
// fixture and not an `implements` clause.
import { SKELETON_LINE, type DeclaresUnsafe } from '@olympus-ai/api';
import { StubDriver } from '@olympus-ai/core';
import { StubSandboxProvider } from '@olympus-ai/sandbox';
import { StubVault } from '@olympus-ai/vault';

export const vault: DeclaresUnsafe = new StubVault('/');
export const sandbox: DeclaresUnsafe = new StubSandboxProvider();
export const driver: DeclaresUnsafe = new StubDriver();
export const line: DeclaresUnsafe = SKELETON_LINE;
