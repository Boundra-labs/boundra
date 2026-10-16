import { expect, test, type Page } from '@playwright/test';
import { createSiweMessage, generateSiweNonce } from 'viem/siwe';
import { installTestWallet } from './support/wallet';

/** Next.js also renders an (empty) route announcer with role=alert, so match by text. */
const problem = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });

const signedOut = { error: { code: 'UNAUTHENTICATED', message: 'Sign in with your wallet first' } };

/** Stands in for the auth API: challenge → verify flips the session on. */
async function mockAuthApi(page: Page, { domain }: { domain?: string } = {}) {
  let session: { address: string; csrfToken: string; admin: boolean } | null = null;
  await page.route('**/api/v1/auth/session', (route) =>
    session ? route.fulfill({ json: session }) : route.fulfill({ status: 401, json: signedOut }),
  );
  await page.route('**/api/v1/auth/challenge', async (route) => {
    const { address } = route.request().postDataJSON() as { address: `0x${string}` };
    const origin = new URL(page.url()).origin;
    const message = createSiweMessage({
      address,
      chainId: 84532,
      domain: domain ?? new URL(origin).host,
      uri: domain ? `http://${domain}` : origin,
      version: '1',
      nonce: generateSiweNonce(),
      statement: 'Sign in to Boundra.',
    });
    await route.fulfill({ status: 201, json: { message } });
  });
  await page.route('**/api/v1/auth/verify', async (route) => {
    const { message } = route.request().postDataJSON() as { message: string };
    const address = message.split('\n')[1]!.toLowerCase();
    session = { address, csrfToken: 'test-csrf', admin: false };
    await route.fulfill({ json: { address, csrfToken: 'test-csrf', expiresAt: '2099-01-01' } });
  });
}

test('the landing page sends owners to the app', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Open app' }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test('without a browser wallet the app explains what is missing', async ({ page }) => {
  await mockAuthApi(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(problem(page, 'No browser wallet was found')).toBeVisible();
});

test('an unreachable API is reported instead of a sign-in prompt', async ({ page }) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Unavailable' } },
    }),
  );
  await page.goto('/app');
  await expect(
    page.getByRole('heading', { name: 'Boundra is unavailable right now' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('owners switch to Base Sepolia, then sign in with a signature', async ({ page }) => {
  const wallet = await installTestWallet(page, { chainId: 1 });
  await mockAuthApi(page);
  await page.goto('/app');

  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByText('Your wallet is on another network (chain 1)')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Base Sepolia' }).click();

  await expect(page.getByText('It is not a transaction and costs no gas.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with wallet' }).click();

  await expect(page.getByRole('heading', { name: 'What should your agent do?' })).toBeVisible();
  const short = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`.toLowerCase();
  await expect(page.getByRole('banner')).toContainText(short);
  await expect(page.getByRole('banner').getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('declining the signature leaves the owner signed out', async ({ page }) => {
  await installTestWallet(page, { rejectSignatures: true });
  await mockAuthApi(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Sign in with wallet' }).click();
  await expect(
    problem(page, 'You declined the request in your wallet, so nothing was signed.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in to Boundra' })).toBeVisible();
});

test('a challenge for another origin is stopped before the wallet is asked', async ({ page }) => {
  const wallet = await installTestWallet(page);
  await mockAuthApi(page, { domain: 'boundra.example' });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Sign in with wallet' }).click();
  const alert = problem(page, 'Sign-in is set up for');
  await expect(alert.getByRole('link', { name: 'http://boundra.example' })).toBeVisible();
  expect(wallet.signRequests()).toBe(0);
});

test('a wallet that switched accounts must match the session', async ({ page }) => {
  await installTestWallet(page);
  const other = '0x1111111111111111111111111111111111111111';
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: { address: other, csrfToken: 'test-csrf', admin: false } }),
  );
  await page.goto('/app');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet switched accounts' })).toBeVisible();
});
