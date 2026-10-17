import { expect, test, type Page } from '@playwright/test';
import { executorOf, executorSnapshot } from '../e2e/support/chain';
import { clarify, newOwner, setUpAccount, waitOnAgent } from './support';

/**
 * PRD §3.2 demo, with nothing mocked: two owners type the identical goal. ACCE asks what the
 * prompt cannot tell, so their different answers lead to different mandates, and the real
 * agent acts on each one differently.
 */
const PROMPT = 'Manage 300 MockUSDC safely.';
const row = (page: Page, label: string) =>
  page.locator('.mandate-row').filter({ has: page.getByText(label, { exact: true }) });

async function reviewAs(page: Page, answers: string[]) {
  const owner = await newOwner(page);
  await setUpAccount(page);
  await clarify(page, PROMPT, answers);
  await page.getByRole('button', { name: 'Review the mandate' }).click();
  await expect(page.getByRole('heading', { name: 'Review your mandate' })).toBeVisible({
    timeout: 30_000,
  });
  return owner;
}

test('the same goal becomes different mandates for owners with different needs', async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const needsCash = await contextA.newPage();
    const canWait = await contextB.newPage();

    // Owner A may need the money tomorrow: one question settles it.
    await reviewAs(needsCash, ['No, I need to be able to withdraw']);
    await expect(row(needsCash, 'Vault')).toContainText('LiquidVault');
    await expect(row(needsCash, 'Maximum lockup')).toContainText('None');

    // Owner B accepts a 30-day lockup and won't need the funds: TimedVault becomes eligible.
    const ownerB = await reviewAs(canWait, [
      'Yes, a lockup of up to 30 days is fine',
      'No, not for at least 30 days',
    ]);
    await expect(row(canWait, 'Vault')).toContainText('TimedVault');
    await expect(row(canWait, 'Maximum lockup')).toContainText('30 days');

    // B approves and authorizes; the agent deposits into TimedVault, where funds are locked.
    await canWait.getByRole('checkbox').check();
    await canWait.getByRole('button', { name: 'Approve mandate' }).click();
    await canWait.getByRole('button', { name: 'Set mandate' }).click();
    await canWait.getByRole('button', { name: 'Approve 300 MockUSDC' }).click({ timeout: 30_000 });
    await canWait.getByRole('button', { name: 'Fund 300 MockUSDC' }).click({ timeout: 30_000 });
    await expect(canWait.getByRole('heading', { name: 'Your mandate is active' })).toBeVisible({
      timeout: 90_000,
    });
    await canWait.goto('/app');
    const timed = canWait.locator('.funds > div').filter({ hasText: 'TimedVault' });
    await waitOnAgent(canWait, timed.getByText(/Locked until/));
    await expect(timed).toContainText('300 MockUSDC');

    // On chain: B's funds sit in TimedVault, locked for about 30 days, and LiquidVault is empty.
    const snapshot = await executorSnapshot((await executorOf(ownerB.address))!);
    const [liquid, timedPosition] = snapshot.positions;
    expect(timedPosition!.principal).toBe('300000000');
    expect(liquid!.principal).toBe('0');
    expect(Number(timedPosition!.unlockAt) * 1000).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
