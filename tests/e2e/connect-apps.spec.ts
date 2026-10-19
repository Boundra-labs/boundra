import { expect, test, type Page } from '@playwright/test';
import { createSiweMessage } from 'viem/siwe';
import { readyOwnerAt } from './support/mock-api';

const TOKEN_STATEMENT =
  'Give an app or AI assistant an API token for your Boundra account. It can read your account and prepare mandates for you to review; it does not approve any mandate or transaction, and it cannot sign transactions or move funds.';

/** Token challenge, verify, list and revoke, like the API (docs/api.md, "API tokens"). */
async function mockTokens(page: Page, { domain = '127.0.0.1:3000' } = {}) {
  const tokens: { id: string; createdAt: string; expiresAt: string; lastSeenAt: string }[] = [];
  const requests: { challenge?: unknown; verified?: unknown; revoked: string[] } = { revoked: [] };
  await page.route('**/api/v1/auth/challenge', async (route) => {
    const body = route.request().postDataJSON() as { address: `0x${string}`; client?: string };
    requests.challenge = body;
    await route.fulfill({
      status: 201,
      json: {
        message: createSiweMessage({
          address: body.address,
          chainId: 84532,
          domain,
          uri: `http://${domain}`,
          version: '1',
          nonce: 'abcdefgh12345678',
          statement: TOKEN_STATEMENT,
          expirationTime: new Date(Date.now() + 300_000),
        }),
      },
    });
  });
  await page.route('**/api/v1/auth/verify', async (route) => {
    requests.verified = route.request().postDataJSON();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 12 * 3_600_000).toISOString();
    tokens.unshift({
      id: '6a2f4f3e-1111-4c43-9f37-7a1c1f0a0b01',
      createdAt: now.toISOString(),
      expiresAt,
      lastSeenAt: now.toISOString(),
    });
    await route.fulfill({
      json: { address: '0x0', token: 'tok_Q2xhdWRlIHdhcyBoZXJl_only-shown-once', expiresAt },
    });
  });
  await page.route('**/api/v1/auth/tokens', (route) => route.fulfill({ json: { items: tokens } }));
  await page.route('**/api/v1/auth/tokens/*/revoke', async (route) => {
    expect(route.request().headers()['x-csrf-token']).toBe('test-csrf');
    const id = route.request().url().split('/').at(-2)!;
    requests.revoked.push(id);
    tokens.splice(
      tokens.findIndex((t) => t.id === id),
      1,
    );
    await route.fulfill({ status: 204 });
  });
  return requests;
}

test('the owner creates an API token for an AI assistant, sees it once, then revokes it', async ({
  page,
}) => {
  const { wallet } = await readyOwnerAt(page, '/app/connect');
  const requests = await mockTokens(page);
  await expect(page.getByRole('heading', { name: 'Connect an app or AI assistant' })).toBeVisible();
  await expect(
    page.getByText(/cannot.*approve a mandate, sign a transaction or move funds/),
  ).toBeVisible();
  await expect(
    page.getByText('None. Apps and assistants have no access to your account.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Create an API token' }).click();
  await expect(page.getByLabel('API token')).toHaveText('tok_Q2xhdWRlIHdhcyBoZXJl_only-shown-once');
  expect(requests.challenge).toMatchObject({ client: 'token' });
  expect(wallet.signRequests()).toBe(1);
  expect(wallet.transactionRequests()).toBe(0);
  await expect(page.getByText(/cannot show it again/)).toBeVisible();
  await page.getByText('Use it with Claude or another MCP client').click();
  await expect(page.locator('.token-config pre')).toContainText(
    '"BOUNDRA_API_TOKEN": "tok_Q2xhdWRlIHdhcyBoZXJl_only-shown-once"',
  );
  await expect(page.locator('.token-config pre')).toContainText(
    '"BOUNDRA_APP_URL": "http://127.0.0.1:3000"',
  );

  const listed = page.locator('.token-item');
  await expect(listed).toHaveCount(1);
  await listed.getByRole('button', { name: 'Revoke' }).click();
  await expect(listed).toHaveCount(0);
  expect(requests.revoked).toEqual(['6a2f4f3e-1111-4c43-9f37-7a1c1f0a0b01']);
});

test('a token challenge for another origin is never signed', async ({ page }) => {
  const { wallet } = await readyOwnerAt(page, '/app/connect');
  const requests = await mockTokens(page, { domain: 'localhost:3000' });
  await page.getByRole('button', { name: 'Create an API token' }).click();
  await expect(page.getByText('Sign-in is set up for http://localhost:3000.')).toBeVisible();
  expect(wallet.signRequests()).toBe(0);
  expect(requests.verified).toBeUndefined();
});

test('the app menu links to apps and AI assistants', async ({ page }) => {
  await readyOwnerAt(page, '/app');
  await mockTokens(page);
  await page.getByRole('banner').getByRole('link', { name: 'Apps & AI' }).click();
  await expect(page).toHaveURL(/\/app\/connect$/);
  await expect(page.getByRole('heading', { name: 'Connect an app or AI assistant' })).toBeVisible();
});
