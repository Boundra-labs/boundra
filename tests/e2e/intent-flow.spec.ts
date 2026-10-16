import { expect, test, type Page } from '@playwright/test';
import { mockIntents, mockPublicConfig, mockSignedIn } from './support/mock-api';
import { installTestWallet } from './support/wallet';

async function signedInAt(page: Page, path: string) {
  const wallet = await installTestWallet(page);
  await mockSignedIn(page, wallet.address);
  await mockPublicConfig(page);
  await page.goto(path);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
}

const question = (page: Page, text: RegExp) => page.getByRole('group', { name: text });

test('a goal typed on the homepage carries into the app', async ({ page }) => {
  const wallet = await installTestWallet(page);
  await mockSignedIn(page, wallet.address);
  await mockPublicConfig(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start with this goal' }).click();
  await expect(page).toHaveURL(/\/app\?goal=Manage\+300\+MockUSDC\+safely/);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByLabel('Your goal')).toHaveValue('Manage 300 MockUSDC safely');
  await expect(page.getByLabel('Amount to delegate')).toHaveValue('300');
});

test('amounts are validated before anything is sent', async ({ page }) => {
  await signedInAt(page, '/app');
  await page.getByLabel('Your goal').fill('Keep 50 MockUSDC liquid');
  await page.getByLabel('Amount to delegate').fill('1.1234567');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Use a number with up to 6 decimals')).toBeVisible();
  await page.getByLabel('Amount to delegate').fill('0');
  await expect(page.getByText('The amount must be more than zero.')).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
});

test('an amount above the fundable balance is explained with the next step', async ({ page }) => {
  await signedInAt(page, '/app');
  await mockIntents(page, { fundable: 100_000_000n });
  await page.getByLabel('Your goal').fill('Manage 300 MockUSDC safely');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Claim MockUSDC from the faucet or lower the amount.' }),
  ).toBeVisible();
});

test('accepting the lockup and not needing the funds selects TimedVault', async ({ page }) => {
  await signedInAt(page, '/app?goal=Manage%20300%20MockUSDC%20safely');
  await mockIntents(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(/\/app\/intents\/[0-9a-f-]+$/);
  const timed = page.getByRole('listitem').filter({ hasText: 'TimedVault' }).first();
  await expect(timed).toContainText('Not eligible');

  await question(page, /30 days in exchange/)
    .getByLabel('Yes, a lockup of up to 30 days is fine')
    .check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await question(page, /within the next 30 days/)
    .getByLabel('No, not for at least 30 days')
    .check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Clarification complete' })).toBeVisible();
  await expect(page.getByText('Deposit into TimedVault.')).toBeVisible();
  await expect(timed).toContainText('Eligible');
  await expect(page.getByRole('list', { name: 'Your answers' })).toContainText(
    'Yes, a lockup of up to 30 days is fine',
  );
});

test('“I am not sure” never makes the lockup vault eligible', async ({ page }) => {
  await signedInAt(page, '/app?goal=Grow%20200%20MockUSDC');
  await mockIntents(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await question(page, /30 days in exchange/)
    .getByLabel('Yes, a lockup of up to 30 days is fine')
    .check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await question(page, /within the next 30 days/)
    .getByLabel(/I am not sure/)
    .check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Deposit into LiquidVault.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'TimedVault' }).first()).toContainText(
    'Not eligible',
  );
  await expect(page.getByText('Most cautious limit applied')).toBeVisible();
  await expect(
    page.getByText('You were not sure, so the most conservative limit applies.'),
  ).toBeVisible();
});

test('when nothing is eligible, nothing is delegated', async ({ page }) => {
  await signedInAt(page, '/app?goal=Grow%20200%20MockUSDC');
  await mockIntents(page, { escalateAfterFirstAnswer: true });
  await page.getByRole('button', { name: 'Continue' }).click();
  await question(page, /30 days in exchange/)
    .getByLabel('No, I need to be able to withdraw')
    .check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing will be delegated' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start a different goal' })).toBeVisible();
});

test('an answer given in another tab first is reported and the view refreshes', async ({
  page,
}) => {
  await signedInAt(page, '/app?goal=Grow%20200%20MockUSDC');
  const api = await mockIntents(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  api.answerElsewhereFirst();
  await question(page, /30 days in exchange/)
    .getByLabel('Yes, a lockup of up to 30 days is fine')
    .check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(question(page, /within the next 30 days/)).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'already answered, perhaps in another tab' }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Your answers' })).toContainText(
    'No, I need to be able to withdraw',
  );
});

test('an unknown or foreign intent is not shown', async ({ page }) => {
  await signedInAt(page, '/app/intents/00000000-0000-0000-0000-000000000000');
  await mockIntents(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This goal isn’t available' })).toBeVisible();
});
