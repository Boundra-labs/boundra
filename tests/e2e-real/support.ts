import { expect, type Locator, type Page } from '@playwright/test';
import type { Hex } from 'viem';
import { prepareOwner } from '../e2e/support/chain';
import { installTestWallet } from '../e2e/support/wallet';

/** Opens the app with a test wallet and signs in for real: SIWE challenge, signature, session. */
export async function signInAt(page: Page, path: string, privateKey: Hex) {
  await installTestWallet(page, { privateKey });
  await page.goto(path);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Sign in with wallet' }).click();
}

/** A brand-new owner with only test ETH: no MockUSDC, no executor, nothing in the database. */
export async function newOwner(page: Page) {
  const owner = await prepareOwner({ claim: false, executor: false });
  await signInAt(page, '/app', owner.privateKey);
  return owner;
}

/** One-time account setup through the UI: faucet claim, executor creation and registration. */
export async function setUpAccount(page: Page) {
  await page.getByRole('button', { name: 'Claim 1,000 MockUSDC' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'MockUSDC claimed.' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Create executor' }).click();
  await expect(page.getByRole('heading', { name: 'What should your agent do?' })).toBeVisible({
    timeout: 60_000,
  });
}

/** Enters a goal and answers the real ACCE questions by their visible labels, in order. */
export async function clarify(page: Page, goal: string, answers: string[]) {
  await page.getByLabel('Your goal').fill(goal);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/app\/intents\/[0-9a-f-]+$/, { timeout: 30_000 });
  for (const answer of answers) {
    await page.getByLabel(answer).check();
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Clarification complete' })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * The agent acts on its own schedule, so keep reloading until `target` shows up. Reloading is
 * what an owner would do; the page itself never claims what the API has not confirmed.
 */
export async function waitOnAgent(page: Page, target: Locator, timeoutMs = 120_000) {
  await expect(async () => {
    await page.reload();
    await expect(target).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: timeoutMs, intervals: [2_000] });
}
