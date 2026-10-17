import { join } from 'node:path';
import { repo } from '../../scripts/lib/local-chain.mjs';
import type { E2EChain } from '../e2e/support/chain';

/**
 * Ports and files of the real-API suite. They differ from the mocked suite's (web 3000) and
 * from a developer's local API (3001), so the suites never talk to the wrong service.
 */
export const REAL_STACK = {
  webPort: 3200,
  webOrigin: 'http://localhost:3200',
  apiPort: 3201,
  providerPort: 3202,
  chainFile: join(repo, 'tmp', 'e2e-real', 'deployment.json'),
};

export type RealStack = E2EChain;

/** How many model calls the simulated provider outage has refused so far. */
export async function providerCallsRefused() {
  const response = await fetch(`http://127.0.0.1:${REAL_STACK.providerPort}/__refused`);
  return ((await response.json()) as { refused: number }).refused;
}
