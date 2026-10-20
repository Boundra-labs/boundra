import { defineConfig, devices } from '@playwright/test';
import { E2E_RPC_URL, GAS_FUNDERS } from './tests/e2e/support/chain';

export default defineConfig({
  testDir: './tests/e2e',
  // Deploys the contracts on a local anvil chain for the transaction tests.
  globalSetup: './tests/e2e/global-setup.ts',
  forbidOnly: Boolean(process.env.CI),
  // One gas-funding dev account per worker (see workerFunder), so never more workers than those.
  workers: GAS_FUNDERS,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Production build in CI, next dev locally (scripts/e2e-web-server.mjs).
    command: 'node scripts/e2e-web-server.mjs 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The browser reads the chain directly, so the web app must point at the E2E chain.
    env: { NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: E2E_RPC_URL },
  },
});
