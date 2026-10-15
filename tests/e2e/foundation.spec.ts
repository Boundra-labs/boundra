import { expect, test } from '@playwright/test';

test('prototype makes its scope explicit and handles a missing wallet', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Autonomy within your boundaries/ }),
  ).toBeVisible();
  await expect(page.getByText('Asset management is coming next')).toBeVisible();
  await expect(
    page.getByText(/Connecting a wallet does not authorize asset movement/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not connect' })).toBeVisible();
});

test('service status reports unavailable dependencies honestly', async ({ page }) => {
  await page.route('**/status', (route) =>
    route.fulfill({ status: 503, json: { status: 'degraded' } }),
  );
  await page.goto('/');
  await expect(page.getByText(/Services unavailable/)).toBeVisible();
});
