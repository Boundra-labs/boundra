import { expect, test, type Page } from '@playwright/test';
import { devKey } from '../../scripts/lib/local-chain.mjs';
import { executorOf, tokenBalance } from '../e2e/support/chain';
import { providerCallsRefused } from './stack';
import { clarify, newOwner, setUpAccount, signInAt, waitOnAgent } from './support';

/**
 * The required journey (task-assignment §5) through the browser, with nothing mocked: sign-in,
 * setup, goal, ACCE, review, approval, authorization and funding by the owner's wallet, the real
 * agent's deposit, a risk event set by the risk admin's wallet and the agent's response, and
 * revocation. The model provider is down for the whole run (see global-setup.ts).
 */
const timeline = (page: Page, title: string | RegExp) =>
  page.locator('.timeline li').filter({ hasText: title });
const funds = (page: Page, label: string) =>
  page.locator('.funds > div').filter({ hasText: label });

test('an owner delegates, the agent deposits and responds to a risk event, and revoking stops it', async ({
  page,
  browser,
}) => {
  const refusedBefore = await providerCallsRefused();
  const owner = await newOwner(page);
  // Monitoring and the footer report the real stack: worker executing, releases reported.
  const status = await (await page.request.get('/status')).json();
  expect(status).toMatchObject({
    status: 'ok',
    worker: 'execute',
    executionEnabled: true,
    release: { web: 'dev', api: 'dev' },
  });
  await expect(page.getByText('API, database & worker connected')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Get your wallet ready' })).toBeVisible({
    timeout: 30_000,
  });
  await setUpAccount(page);

  // Goal and clarification: the model is down, so questions use the reviewed template wording.
  await clarify(page, 'Manage 300 MockUSDC safely', ['No, I need to be able to withdraw']);
  await expect(page.getByText('Deposit into LiquidVault.')).toBeVisible();
  await expect(page.getByText(/Worded by AI/)).toHaveCount(0);

  // Review and approval of the exact values.
  await page.getByRole('button', { name: 'Review the mandate' }).click();
  await expect(page.getByRole('heading', { name: 'Review your mandate' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Plain-language summary of the exact values below.')).toBeVisible();
  await expect(page.getByText(/Summary written by AI/)).toHaveCount(0);
  expect(await providerCallsRefused()).toBeGreaterThan(refusedBefore);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Approve mandate' }).click();

  // Authorization: three owner transactions, then the worker verifies the mandate on chain.
  await expect(page.getByRole('heading', { name: 'Authorize in your wallet' })).toBeVisible();
  await page.getByRole('button', { name: 'Set mandate' }).click();
  await page.getByRole('button', { name: 'Approve 300 MockUSDC' }).click({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Fund 300 MockUSDC' }).click({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Your mandate is active' })).toBeVisible({
    timeout: 90_000,
  });

  // The agent deposits on its own, without another owner signature.
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Your agent' })).toBeVisible();
  await expect(page.locator('.agent-state')).toContainText('Active');
  await waitOnAgent(page, timeline(page, 'Deposit confirmed'));
  await expect(timeline(page, 'Deposit confirmed')).toContainText('300 MockUSDC');
  await expect(timeline(page, 'Deposit confirmed').getByRole('link')).toHaveAttribute(
    'href',
    /\/tx\/0x[0-9a-f]{64}$/,
  );
  await expect(funds(page, 'LiquidVault')).toContainText('300 MockUSDC');
  const executor = await executorOf(owner.address);
  expect(await tokenBalance(executor!)).toBe(0n);

  // The risk admin degrades LiquidVault from their own wallet, leaving 200 MockUSDC of capacity.
  const adminContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage();
    await signInAt(admin, '/app/risk', devKey(1));
    const liquid = admin
      .locator('.vault-condition')
      .filter({ has: admin.getByRole('heading', { name: /LiquidVault/ }) });
    await expect(liquid).toContainText('300 MockUSDC');
    await liquid.getByText('Limit total withdrawals').click();
    await liquid.getByLabel('Capacity').fill('200');
    await liquid.getByRole('button', { name: 'Mark LiquidVault degraded' }).click();
    await expect(liquid.getByText('LiquidVault is now degraded.')).toBeVisible({
      timeout: 30_000,
    });

    // The agent exits as far as capacity allows, then hands the rest back to the owner.
    const balanceBefore = await tokenBalance(owner.address);
    await waitOnAgent(page, timeline(page, 'Withdrawal confirmed'));
    await expect(timeline(page, 'Withdrawal confirmed')).toContainText('200 MockUSDC');
    await expect(funds(page, 'LiquidVault')).toContainText('Risk warning');
    await expect(funds(page, 'LiquidVault')).toContainText('100 MockUSDC');
    expect(await tokenBalance(owner.address)).toBe(balanceBefore + 200_000_000n);
    // With no capacity left the agent escalates in plain language, without a transaction.
    await waitOnAgent(page, page.getByRole('note').filter({ hasText: 'The agent needs you.' }));
    await expect(page.getByRole('note')).toContainText('can’t pay anything out right now');
    await expect(page.getByText('NO_WITHDRAWAL_CAPACITY')).toHaveCount(0);
    await expect(
      timeline(page, 'Agent needs you · no transaction').first().getByRole('link'),
    ).toHaveCount(0);

    // Revoking is the owner's own transaction; the agent can never act on this mandate again.
    await page.getByRole('button', { name: 'Revoke the mandate…' }).click();
    await page.getByRole('button', { name: 'Yes, revoke' }).click();
    await expect(page.locator('.agent-state')).toContainText('Revoked', { timeout: 30_000 });
    await waitOnAgent(page, timeline(page, 'Mandate revoked'));

    // Once the admin restores the vault, the owner takes the rest back.
    await liquid.getByRole('button', { name: 'Restore LiquidVault to normal' }).click();
    await expect(liquid.getByText(/LiquidVault is back to normal/)).toBeVisible({
      timeout: 30_000,
    });
    await waitOnAgent(
      page,
      page.getByRole('button', { name: 'Withdraw 100 MockUSDC from LiquidVault' }),
    );
    await page.getByRole('button', { name: 'Withdraw 100 MockUSDC from LiquidVault' }).click();
    await expect(page.getByText('Withdrawn from LiquidVault to your wallet.')).toBeVisible({
      timeout: 30_000,
    });
    expect(await tokenBalance(owner.address)).toBe(1_000_000_000n);
  } finally {
    await adminContext.close();
  }
});
