import { expect, test, type Page } from '@playwright/test';
import { executorHolds, prepareOwner, tokenBalance } from './support/chain';
import { mockAccountApi, mockPublicConfig, mockSignedIn } from './support/mock-api';
import { mockMandates } from './support/mock-mandates';
import { installTestWallet, type TestWalletOptions } from './support/wallet';
import { e2eChain } from './support/chain';

/**
 * The owner's authorization transactions run against their real executor on the E2E chain, so
 * the contract itself checks the mandate. Only the API is stood in for; its verification reads
 * the chain the way the worker does.
 */
async function openApproved(
  page: Page,
  { amount = 300_000_000n, wallet = {} }: { amount?: bigint; wallet?: TestWalletOptions } = {},
) {
  const owner = await prepareOwner();
  const testWallet = await installTestWallet(page, { privateKey: owner.privateKey, ...wallet });
  await mockSignedIn(page, owner.address);
  await mockPublicConfig(page, e2eChain());
  await mockAccountApi(page, owner.address, { registered: owner.executor });
  const mandates = await mockMandates(page, {
    owner: owner.address,
    executor: owner.executor!,
    amount,
  });
  const id = mandates.seed({ status: 'APPROVED' });
  return { owner, testWallet, mandates, id };
}

async function visit(page: Page, id: string) {
  await page.goto(`/app/mandates/${id}`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Authorize in your wallet' })).toBeVisible();
}

const step = (page: Page, title: RegExp) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title }) });

test('an approved mandate is authorized in three wallet steps, then verified on chain', async ({
  page,
}) => {
  const { owner, mandates, id } = await openApproved(page);
  await visit(page, id);

  await expect(page.getByRole('button', { name: 'Approve 300 MockUSDC' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Fund 300 MockUSDC' })).toBeDisabled();

  await page.getByRole('button', { name: 'Set mandate' }).click();
  await expect(step(page, /Set the mandate/)).toContainText('Mandate set on your executor.', {
    timeout: 20_000,
  });
  expect(await executorHolds(owner.executor!, mandates.tuple(id))).toBe(true);

  await page.getByRole('button', { name: 'Approve 300 MockUSDC' }).click();
  await expect(step(page, /Allow exactly/)).toContainText('Allowance set.', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Fund 300 MockUSDC' }).click();
  await expect(step(page, /Fund your executor/)).toContainText('Executor funded.', {
    timeout: 20_000,
  });
  expect(await tokenBalance(owner.executor!)).toBe(300_000_000n);

  await expect(page.getByRole('heading', { name: 'Your mandate is active' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Your mandate' })).toBeVisible();
  await expect(
    page.getByText(/holds 300 MockUSDC\. The agent may now act within it/),
  ).toBeVisible();
});

test('declining in the wallet leaves the mandate unset', async ({ page }) => {
  const { owner, testWallet, mandates, id } = await openApproved(page, {
    wallet: { rejectTransactions: true },
  });
  await visit(page, id);
  await page.getByRole('button', { name: 'Set mandate' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'You declined in your wallet, so nothing was sent.' }),
  ).toBeVisible();
  expect(testWallet.transactionRequests()).toBe(1);
  expect(await executorHolds(owner.executor!, mandates.tuple(id))).toBe(false);
});

test('a mandate that does not match what was approved is never signed', async ({ page }) => {
  const { testWallet, mandates, id } = await openApproved(page);
  mandates.tamperMandateHash();
  await visit(page, id);
  await expect(
    page.getByRole('alert').filter({ hasText: 'does not match what you approved' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set mandate' })).toBeDisabled();
  expect(testWallet.transactionRequests()).toBe(0);
});

test('after a reload, steps already on chain are not asked for again', async ({ page }) => {
  const { owner, mandates, id } = await openApproved(page);
  await owner.setMandate(mandates.tuple(id));
  await owner.approve(300_000_000n);
  await visit(page, id);
  await expect(step(page, /Set the mandate/)).toContainText('(done)');
  await expect(step(page, /Allow exactly/)).toContainText('(done)');
  await expect(page.getByRole('button', { name: 'Set mandate' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fund 300 MockUSDC' })).toBeEnabled();
});

test('funding more than the wallet holds is explained, not attempted', async ({ page }) => {
  const { owner, testWallet, mandates, id } = await openApproved(page, {
    amount: 2_000_000_000n,
  });
  await owner.setMandate(mandates.tuple(id));
  await owner.approve(2_000_000_000n);
  await visit(page, id);
  await expect(
    page.getByText('Your wallet holds 1,000 MockUSDC, less than 2,000 MockUSDC.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fund 2,000 MockUSDC' })).toBeDisabled();
  expect(testWallet.transactionRequests()).toBe(0);
});
