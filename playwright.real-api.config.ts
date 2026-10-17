import { defineConfig, devices } from '@playwright/test';
import { E2E_RPC_URL } from './tests/e2e/support/chain';
import { REAL_STACK } from './tests/e2e-real/stack';

// Shared helpers (owners, chain reads, the test wallet) read this suite's own contracts.
process.env.E2E_CHAIN_FILE = REAL_STACK.chainFile;

/**
 * Browser journeys against the real API, worker, PostgreSQL and contracts (no mocks). Needs
 * PostgreSQL (DATABASE_URL); the chain, API and worker are started by global setup. One worker:
 * the journeys wait on the real agent loop and share its operator. Next allows one dev server
 * per project, so stop any other `next dev` of the app (e.g. the mocked suite's) first.
 */
export default defineConfig({
  testDir: './tests/e2e-real',
  globalSetup: './tests/e2e-real/global-setup.ts',
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: { baseURL: REAL_STACK.webOrigin, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Production build in CI, next dev locally (scripts/e2e-web-server.mjs).
    command: `node scripts/e2e-web-server.mjs ${REAL_STACK.webPort}`,
    url: `http://127.0.0.1:${REAL_STACK.webPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: E2E_RPC_URL,
      API_INTERNAL_URL: `http://127.0.0.1:${REAL_STACK.apiPort}`,
    },
  },
});
