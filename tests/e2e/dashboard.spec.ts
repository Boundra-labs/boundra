import { expect, test, type Page } from '@playwright/test';
import { executorSnapshot, tokenBalance } from './support/chain';
import { activeOwnerAt, mockActivity } from './support/mock-api';

// The overview reads the owner's real executor on the E2E chain, and every control is the
// owner's own transaction. Vault risk changes live in risk-admin.spec.ts.

const status = (page: Page) => page.locator('.agent-state');
const fundsItem = (page: Page, label: string) =>
  page.locator('.funds > div').filter({ hasText: label });

test('an active mandate shows its status, the agent’s deposit and idle funds', async ({ page }) => {
  await activeOwnerAt(page);
  await expect(status(page)).toContainText('Active');
  await expect(fundsItem(page, 'LiquidVault')).toContainText('300 MockUSDC');
  await expect(fundsItem(page, 'LiquidVault')).toContainText('300 MockUSDC withdrawable');
  await expect(fundsItem(page, 'Idle in your executor')).toContainText('0 MockUSDC');
  await expect(page.getByRole('link', { name: 'View mandate' })).toBeVisible();
});

test('pausing and resuming are the owner’s own transactions', async ({ page }) => {
  const owner = await activeOwnerAt(page, { deposit: false });
  await page.getByRole('button', { name: 'Pause the agent' }).click();
  await expect(status(page)).toContainText('Paused', { timeout: 20_000 });
  expect((await executorSnapshot(owner.executor!)).paused).toBe(true);

  await page.getByRole('button', { name: 'Resume the agent' }).click();
  await expect(status(page)).toContainText('Active', { timeout: 20_000 });
  expect((await executorSnapshot(owner.executor!)).paused).toBe(false);
});

test('revoking asks for confirmation, then ends the mandate for good', async ({ page }) => {
  const owner = await activeOwnerAt(page, { deposit: false });
  await page.getByRole('button', { name: 'Revoke the mandate…' }).click();
  const confirm = page.getByRole('group', { name: 'Confirm revoke' });
  await expect(confirm).toContainText('Revoke permanently?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect((await executorSnapshot(owner.executor!)).revoked).toBe(false);

  await page.getByRole('button', { name: 'Revoke the mandate…' }).click();
  await page.getByRole('button', { name: 'Yes, revoke' }).click();
  await expect(status(page)).toContainText('Revoked', { timeout: 20_000 });
  expect((await executorSnapshot(owner.executor!)).revoked).toBe(true);
  await expect(page.getByRole('button', { name: 'Resume the agent' })).toHaveCount(0);
});

test('the owner takes funds back from the vault and from idle', async ({ page }) => {
  const owner = await activeOwnerAt(page);
  const before = await tokenBalance(owner.address);
  await page.getByRole('button', { name: 'Withdraw 300 MockUSDC from LiquidVault' }).click();
  await expect(page.getByText('Withdrawn from LiquidVault to your wallet.')).toBeVisible({
    timeout: 20_000,
  });
  expect(await tokenBalance(owner.address)).toBe(before + 300_000_000n);
  await expect(fundsItem(page, 'LiquidVault')).toContainText('No position', { timeout: 20_000 });
});

test('idle funds in the executor can be recovered', async ({ page }) => {
  const owner = await activeOwnerAt(page, { deposit: false });
  await page.getByRole('button', { name: 'Withdraw 300 MockUSDC idle' }).click();
  await expect(page.getByText('Idle funds returned to your wallet.')).toBeVisible({
    timeout: 20_000,
  });
  expect(await tokenBalance(owner.executor!)).toBe(0n);
});

test('the timeline explains each event and links only real transactions', async ({ page }) => {
  await activeOwnerAt(page, { deposit: false });
  const tx = `0x${'ab'.repeat(32)}`;
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const base = { intentId: null, mandateId: null, actionId: null, txHash: null, explorerUrl: null };
  const items = [
    {
      ...base,
      id: '30',
      type: 'ACTION_CONFIRMED',
      txHash: tx,
      explorerUrl: `https://sepolia.basescan.org/tx/${tx}`,
      payload: { kind: 'DEPOSIT', amount: '300000000' },
      createdAt: at(1),
    },
    {
      ...base,
      id: '29',
      type: 'ACTION_REJECTED',
      payload: {
        kind: 'DEPOSIT',
        reasonCode: 'VAULT_DEGRADED',
        reason: 'The vault reports degraded conditions.',
      },
      createdAt: at(2),
    },
    {
      ...base,
      id: '28',
      type: 'DECISION_HOLD',
      payload: { reasonCode: 'NOT_FUNDED', reason: 'Waiting for the executor to be funded.' },
      createdAt: at(3),
    },
    ...Array.from({ length: 22 }, (_, i) => ({
      ...base,
      id: String(27 - i),
      type: 'QUESTION_ANSWERED',
      payload: {},
      createdAt: at(10 + i),
    })),
  ];
  await page.unroute('**/api/v1/activity*');
  await mockActivity(page, items);
  await page.reload();

  const timeline = page.locator('.timeline');
  const entry = (title: string) => timeline.locator('li').filter({ hasText: title });
  await expect(entry('Deposit confirmed')).toContainText('300 MockUSDC');
  await expect(entry('Deposit confirmed').getByRole('link')).toHaveAttribute(
    'href',
    /\/tx\/0xabab/,
  );
  await expect(entry('Deposit stopped before broadcast')).toContainText('degraded conditions');
  await expect(entry('Deposit stopped before broadcast').getByRole('link')).toHaveCount(0);
  await expect(entry('Agent held · no transaction')).toContainText(
    'Waiting for the executor to be funded.',
  );
  await expect(entry('Agent held · no transaction').getByRole('link')).toHaveCount(0);

  await expect(timeline.locator('li')).toHaveCount(20);
  await page.getByRole('button', { name: 'Show older activity' }).click();
  await expect(timeline.locator('li')).toHaveCount(25);
  await expect(page.getByRole('button', { name: 'Show older activity' })).toHaveCount(0);
});

test('“New goal” opens the goal form even when a mandate exists', async ({ page }) => {
  await activeOwnerAt(page, { deposit: false });
  await page.getByRole('banner').getByRole('link', { name: 'New goal' }).click();
  await expect(page.getByRole('heading', { name: 'What should your agent do?' })).toBeVisible();
  await page.getByRole('banner').getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByRole('heading', { name: 'Your agent' })).toBeVisible();
});
