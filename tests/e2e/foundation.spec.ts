import { expect, test } from '@playwright/test';

test('prototype makes its scope explicit', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: /Autonomy that knows where to stop/ }),
  ).toBeVisible();
  await expect(page.getByText('Base Sepolia · Mock assets only')).toBeVisible();
  await expect(
    page.getByText(/Connecting a wallet does not authorize asset movement/),
  ).toBeAttached();
  await expect(page.getByText(/Signing in only identifies your wallet/)).toBeAttached();
});

test('an unknown preference never makes the lockup vault eligible', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('I am not sure').check();
  const timed = page.getByRole('article').filter({ hasText: 'TimedVault' });
  await expect(timed).toContainText('Not eligible');
  await expect(timed).toContainText('An unknown answer narrows authority');
});

test('service status reports unavailable dependencies honestly', async ({ page }) => {
  await page.route('**/status', (route) =>
    route.fulfill({ status: 503, json: { status: 'degraded' } }),
  );
  await page.goto('/');
  await expect(page.getByText(/Services unavailable/)).toBeVisible();
});

test('a connected stack whose agent cannot execute says so, with the release', async ({ page }) => {
  await page.route('**/status', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        worker: 'monitor_only',
        executionEnabled: false,
        release: { web: 'v0.4.0-3-gabc1234', api: 'v0.4.0-3-gabc1234' },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByText('the agent is not executing transactions right now')).toBeVisible();
  await expect(page.getByText('Release v0.4.0-3-gabc1234')).toBeVisible();
});

test('a fully connected stack in execute mode reports it', async ({ page }) => {
  await page.route('**/status', (route) =>
    route.fulfill({
      json: {
        status: 'ok',
        worker: 'execute',
        executionEnabled: true,
        release: { web: 'dev', api: 'dev' },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByText('API, database & worker connected')).toBeVisible();
  await expect(page.getByText(/^Release /)).toHaveCount(0);
});
