import { expect, test } from '@playwright/test';

test('prototype makes its scope explicit and handles a missing wallet', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: /Autonomy that knows where to stop/ }),
  ).toBeVisible();
  await expect(page.getByText('Base Sepolia · Mock assets only')).toBeVisible();
  await expect(
    page.getByText(/Connecting a wallet does not authorize asset movement/),
  ).toBeAttached();
  await page.getByRole('banner').getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not connect' })).toBeVisible();
});

test('the intent field says plainly that nothing is sent yet', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start with this goal' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'nothing was sent or signed' }),
  ).toBeVisible();
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
