import { expect, test, type Page } from '@playwright/test';
import { mockIntents, readyOwnerAt } from './support/mock-api';
import { mockMandates } from './support/mock-mandates';

const row = (page: Page, label: string) =>
  page.locator('.mandate-row').filter({ has: page.getByText(label, { exact: true }) });

async function clarify(page: Page, lockup: 'accept' | 'refuse') {
  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByLabel(
      lockup === 'accept'
        ? 'Yes, a lockup of up to 30 days is fine'
        : 'No, I need to be able to withdraw',
    )
    .check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('group', { name: /within the next 30 days/ })).toBeVisible();
  await page.getByLabel('No, not for at least 30 days').check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function openSeededDraft(page: Page, vault: 'LIQUID' | 'TIMED' = 'TIMED') {
  const { owner } = await readyOwnerAt(page, '/app');
  const mandates = await mockMandates(page, {
    owner: owner.address,
    executor: owner.executor!,
    vault,
  });
  const id = mandates.seed();
  await page.goto(`/app/mandates/${id}`);
  await expect(page.getByRole('heading', { name: 'Review your mandate' })).toBeVisible();
  return { mandates, id };
}

test('a clarified goal becomes a draft with every field to review, approved only with consent', async ({
  page,
}) => {
  const { owner } = await readyOwnerAt(page, '/app?goal=Manage%20300%20MockUSDC%20safely');
  await mockIntents(page);
  await mockMandates(page, { owner: owner.address, executor: owner.executor!, vault: 'TIMED' });
  await clarify(page, 'accept');
  await page.getByRole('button', { name: 'Review the mandate' }).click();

  await expect(page).toHaveURL(/\/app\/mandates\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Review your mandate' })).toBeVisible();
  const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`.toLowerCase();
  await expect(row(page, 'Owner')).toContainText(`${short(owner.address)} · you`);
  await expect(row(page, 'Executor')).toContainText(short(owner.executor!));
  await expect(row(page, 'Withdrawals go to')).toContainText('you');
  await expect(row(page, 'Network')).toContainText('chain 84532');
  await expect(row(page, 'Vault')).toContainText('TimedVault');
  await expect(row(page, 'Per-deposit limit')).toContainText('300 MockUSDC');
  await expect(row(page, 'Maximum lockup')).toContainText('30 days');
  await expect(row(page, 'Expires')).toContainText('in 32 days');
  await expect(row(page, 'Version')).toContainText('Revision 1');
  await expect(page.getByText(/TimedVault locks deposits for 30 days/)).toBeVisible();

  const approve = page.getByRole('button', { name: 'Approve mandate' });
  await expect(approve).toBeDisabled();
  await page
    .getByRole('checkbox', { name: /I reviewed the vault, limits, expiry and notices/ })
    .check();
  await approve.click();
  await expect(page.getByRole('heading', { name: 'Next: authorize in your wallet' })).toBeVisible();
  await expect(page.getByText('Approved · not yet authorized')).toBeVisible();
});

test('limits are checked before a new revision is drafted, and the old one is replaced', async ({
  page,
}) => {
  const { id } = await openSeededDraft(page);
  const patches: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH') patches.push(request.url());
  });

  await page.getByText('Change expiry or per-action limits').click();
  await page.getByLabel('Expires in (days)').fill('10');
  await page.getByRole('button', { name: 'Update the preview' }).click();
  await expect(
    page.getByText('Choose 32–60 days (TimedVault locks funds for 30 days).'),
  ).toBeVisible();
  await page.getByLabel('Per-deposit limit').fill('500');
  await expect(page.getByText(/at most 300 MockUSDC/).first()).toBeVisible();
  expect(patches).toHaveLength(0);

  await page.getByLabel('Expires in (days)').fill('40');
  await page.getByLabel('Per-deposit limit').fill('100');
  await page.getByRole('button', { name: 'Update the preview' }).click();
  await expect(page).not.toHaveURL(new RegExp(id));
  await expect(row(page, 'Version')).toContainText('Revision 2');
  await expect(row(page, 'Per-deposit limit')).toContainText('100 MockUSDC');
  await expect(row(page, 'Per-withdrawal limit')).toContainText('300 MockUSDC');
  await expect(row(page, 'Expires')).toContainText('in 40 days');
  await expect(page.getByText(/the rest stays idle in your executor/)).toBeVisible();
  expect(patches).toHaveLength(1);

  await page.goto(`/app/mandates/${id}`);
  await expect(
    page.getByRole('alert').filter({ hasText: 'A newer revision replaced this one' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve mandate' })).toHaveCount(0);
});

test('a preview that changed underneath is never approved', async ({ page }) => {
  const { mandates, id } = await openSeededDraft(page);
  mandates.staleNextApproval();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Approve mandate' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'This preview changed or is about to expire' }),
  ).toBeVisible();
  expect(mandates.status(id)).toBe('PREVIEWED');
});

test('editing an approved revision warns that approval starts over', async ({ page }) => {
  await openSeededDraft(page, 'LIQUID');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Approve mandate' }).click();
  await expect(page.getByRole('heading', { name: 'Next: authorize in your wallet' })).toBeVisible();
  await page.getByText('Change expiry or per-action limits').click();
  await expect(page.getByText('This replaces the revision you approved.')).toBeVisible();
  await expect(page.getByLabel('Expires in (days)')).toHaveValue('7');
});

test('when drafting finds nothing eligible, nothing is delegated', async ({ page }) => {
  const { owner } = await readyOwnerAt(page, '/app?goal=Grow%20200%20MockUSDC');
  await mockIntents(page);
  const mandates = await mockMandates(page, { owner: owner.address, executor: owner.executor! });
  mandates.escalateNextDraft();
  await clarify(page, 'refuse');
  await page.getByRole('button', { name: 'Review the mandate' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'nothing will be delegated' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/app\/intents\//);
});

test('a draft without a verified executor points back to account setup', async ({ page }) => {
  await readyOwnerAt(page, '/app?goal=Grow%20200%20MockUSDC');
  await mockIntents(page);
  await page.route('**/api/v1/intents/*/mandate-drafts', (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: { code: 'EXECUTOR_NOT_REGISTERED', message: 'Your executor is not registered yet' },
      },
    }),
  );
  await clarify(page, 'refuse');
  await page.getByRole('button', { name: 'Review the mandate' }).click();
  await expect(page.getByRole('link', { name: 'Finish account setup' })).toHaveAttribute(
    'href',
    '/app',
  );
});
