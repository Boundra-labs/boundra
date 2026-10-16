import { expect, test, type Page } from '@playwright/test';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { fundGas } from '../../scripts/lib/local-chain.mjs';
import { E2E_RPC_URL, e2eChain, executorOf, prepareOwner, workerFunder } from './support/chain';
import { mockAccountApi, mockPublicConfig, mockSignedIn } from './support/mock-api';
import { installTestWallet, type TestWalletOptions } from './support/wallet';

/**
 * Account setup sends real transactions to Person 1's contracts on the E2E chain; only the API is
 * stood in for.
 */
async function openApp(page: Page, privateKey: Hex, wallet: TestWalletOptions = {}) {
  const testWallet = await installTestWallet(page, { privateKey, ...wallet });
  await mockSignedIn(page, testWallet.address);
  await mockPublicConfig(page, e2eChain());
  await mockAccountApi(page, testWallet.address);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  return testWallet;
}

const setupHeading = (page: Page) => page.getByRole('heading', { name: 'Get your wallet ready' });
const goalHeading = (page: Page) =>
  page.getByRole('heading', { name: 'What should your agent do?' });
const item = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });

test('a new owner claims MockUSDC, creates an executor and gets it verified', async ({ page }) => {
  const owner = await prepareOwner({ claim: false, executor: false });
  await openApp(page, owner.privateKey);
  await expect(setupHeading(page)).toBeVisible();

  await expect(item(page, 'Test ETH for network fees')).toContainText('ETH available for fees');
  await page.getByRole('button', { name: 'Claim 1,000 MockUSDC' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'MockUSDC claimed.' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(item(page, 'MockUSDC to delegate')).toContainText('1,000 MockUSDC available');
  await expect(
    item(page, 'MockUSDC to delegate').getByRole('link', { name: /^0x[0-9a-f]{8}…/ }),
  ).toHaveAttribute('href', /sepolia\.basescan\.org\/tx\/0x[0-9a-f]{64}$/);

  await page.getByRole('button', { name: 'Create executor' }).click();
  await expect(goalHeading(page)).toBeVisible({ timeout: 30_000 });
  const executor = await executorOf(owner.address);
  expect(executor).not.toBeNull();
  const short = `${executor!.slice(0, 6)}…${executor!.slice(-4)}`.toLowerCase();
  await expect(page.getByRole('complementary')).toContainText(short);
  await expect(page.getByText('Available to delegate:')).toContainText('1,000 MockUSDC');
});

test('without test ETH the owner is told why nothing can be sent yet', async ({ page }) => {
  const privateKey = generatePrivateKey();
  await openApp(page, privateKey);
  await expect(item(page, 'Test ETH for network fees')).toContainText('no Base Sepolia ETH');
  await expect(page.getByRole('button', { name: 'Claim 1,000 MockUSDC' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Create executor' })).toBeDisabled();

  const address = privateKeyToAccount(privateKey).address;
  await fundGas({ rpc: E2E_RPC_URL, addresses: [address], ether: '1', funder: workerFunder() });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'Claim 1,000 MockUSDC' })).toBeEnabled();
});

test('declining a transaction in the wallet sends nothing', async ({ page }) => {
  const owner = await prepareOwner({ claim: false, executor: false });
  const wallet = await openApp(page, owner.privateKey, { rejectTransactions: true });
  await page.getByRole('button', { name: 'Create executor' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'You declined in your wallet, so nothing was sent.' }),
  ).toBeVisible();
  expect(wallet.transactionRequests()).toBe(1);
  expect(await executorOf(owner.address)).toBeNull();
});

test('an owner who already claimed today sees when the faucet opens again', async ({ page }) => {
  const owner = await prepareOwner({ claim: true, executor: false });
  await owner.emptyWallet();
  await openApp(page, owner.privateKey);
  await expect(item(page, 'MockUSDC to delegate')).toContainText('You can claim again on');
  await expect(page.getByRole('button', { name: /Claim/ })).toHaveCount(0);
});

test('an executor created earlier is verified without another transaction', async ({ page }) => {
  const owner = await prepareOwner({ claim: true, executor: true });
  const wallet = await openApp(page, owner.privateKey);
  await expect(goalHeading(page)).toBeVisible({ timeout: 20_000 });
  expect(wallet.transactionRequests()).toBe(0);
});
