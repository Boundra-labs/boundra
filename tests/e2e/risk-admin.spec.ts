import { expect, test, type Page } from '@playwright/test';
import { devAccount, devKey } from '../../scripts/lib/local-chain.mjs';
import { e2eChain, setVaultRisk, vaultCondition } from './support/chain';
import { activeOwnerAt, mockPublicConfig, mockSignedIn, readyOwnerAt } from './support/mock-api';
import { installTestWallet } from './support/wallet';

/**
 * Vault risk is global chain state shared by every worker, so every test that changes it lives
 * here and runs in order. Only TimedVault is changed: other specs deposit into LiquidVault.
 */
test.describe.configure({ mode: 'serial' });

const timed = () => e2eChain().manifest.timedVault;
const card = (page: Page, name: string | RegExp) =>
  page.locator('.vault-condition').filter({ has: page.getByRole('heading', { name }) });

test.afterEach(async () => {
  await setVaultRisk(timed(), false);
});

/** The demo's risk admin (anvil account 1), signed in, on the vault conditions page. */
async function riskAdminAt(page: Page, options: { rejectTransactions?: boolean } = {}) {
  const wallet = await installTestWallet(page, { privateKey: devKey(1), ...options });
  await mockSignedIn(page, devAccount(1).address);
  await mockPublicConfig(page, e2eChain());
  await page.goto('/app/risk');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Vault conditions' })).toBeVisible();
  return wallet;
}

test('the risk admin degrades a vault with a withdrawal limit, then restores it', async ({
  page,
}) => {
  await riskAdminAt(page);
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Vault conditions' }),
  ).toBeVisible();
  const vault = card(page, /TimedVault/);
  await expect(vault).toContainText('Normal');
  await expect(vault).toContainText('Unlimited');

  await vault.getByText('Limit total withdrawals').click();
  await vault.getByLabel('Capacity').fill('100');
  await vault.getByRole('button', { name: 'Mark TimedVault degraded' }).click();
  await expect(vault.getByText('TimedVault is now degraded.')).toBeVisible({ timeout: 20_000 });
  expect(await vaultCondition(timed())).toEqual({ degraded: true, capacity: 100_000_000n });
  await expect(vault).toContainText('Degraded');
  await expect(vault.locator('.funds')).toContainText('Refused');
  await expect(vault.locator('.funds')).toContainText('100 MockUSDC');

  await vault.getByRole('button', { name: 'Restore TimedVault to normal' }).click();
  await expect(vault.getByText('TimedVault is back to normal, withdrawals unlimited.')).toBeVisible(
    {
      timeout: 20_000,
    },
  );
  expect(await vaultCondition(timed())).toEqual({ degraded: false, capacity: null });
  await expect(vault.locator('.funds')).toContainText('Accepted');
  await expect(vault.locator('.funds')).toContainText('Unlimited');
});

test('a capacity of 0 refuses every withdrawal, and an empty one is caught first', async ({
  page,
}) => {
  const wallet = await riskAdminAt(page);
  const vault = card(page, /TimedVault/);
  await vault.getByText('Limit total withdrawals').click();
  await vault.getByRole('button', { name: 'Mark TimedVault degraded' }).click();
  await expect(vault.getByText('Enter a capacity, or choose unlimited withdrawals.')).toBeVisible();
  expect(wallet.transactionRequests()).toBe(0);

  await vault.getByLabel('Capacity').fill('0');
  await vault.getByRole('button', { name: 'Mark TimedVault degraded' }).click();
  await expect(vault.getByText('TimedVault is now degraded.')).toBeVisible({ timeout: 20_000 });
  expect(await vaultCondition(timed())).toEqual({ degraded: true, capacity: 0n });
});

test('a declined admin transaction changes nothing', async ({ page }) => {
  await riskAdminAt(page, { rejectTransactions: true });
  const vault = card(page, /TimedVault/);
  await vault.getByRole('button', { name: 'Mark TimedVault degraded' }).click();
  await expect(vault.getByText('You declined in your wallet, so nothing was sent.')).toBeVisible();
  expect(await vaultCondition(timed())).toEqual({ degraded: false, capacity: null });
  await expect(vault).toContainText('Normal');
});

test('owners can see vault conditions but not change them', async ({ page }) => {
  await readyOwnerAt(page, '/app/risk');
  await expect(page.getByRole('heading', { name: 'Vault conditions' })).toBeVisible();
  await expect(page.getByText(/Only the risk admin wallet .* can change these/)).toBeVisible();
  await expect(page.getByRole('button', { name: /degraded|Restore/ })).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Vault conditions' }),
  ).toHaveCount(0);
});

test('the admin’s change reaches owners as a risk warning, not a loss', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  try {
    const owner = await ownerContext.newPage();
    await activeOwnerAt(owner, { deposit: false });
    const ownerTimed = owner.locator('.funds > div').filter({ hasText: 'TimedVault' });
    await expect(ownerTimed).not.toContainText('Risk warning');

    const admin = await adminContext.newPage();
    await riskAdminAt(admin);
    await card(admin, /TimedVault/)
      .getByRole('button', { name: 'Mark TimedVault degraded' })
      .click();
    await expect(admin.getByText('TimedVault is now degraded.')).toBeVisible({ timeout: 20_000 });

    await owner.reload();
    await expect(ownerTimed).toContainText('Risk warning');
    await expect(
      owner.getByText(/a risk warning is a signal to re-evaluate, not proof of loss/),
    ).toBeVisible();
  } finally {
    await adminContext.close();
    await ownerContext.close();
  }
});
