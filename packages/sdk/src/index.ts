/**
 * Boundra for developers and AI agents (Base Sepolia testnet only).
 *
 * - `BoundraClient`: the owner's API client. It reads the account and prepares mandates; it
 *   never holds the owner's key.
 * - `ownerAuthorizationCalls` / `ownerActionCall`: unsigned transactions for the owner's wallet.
 * - `BoundraOperator`: an agent acting within a mandate with its own key, bounded on chain by the
 *   owner's executor contract.
 */
import { parseUnits } from 'viem';
import { MOCK_USDC_DECIMALS } from '@boundra/shared';

export * from './api';
export * from './owner';
export * from './operator';
export { loadDeploymentManifest, type DeploymentManifest } from '@boundra/chain';

/** MockUSDC base units from a decimal string, e.g. `mockUsdc('12.5')` is 12_500_000n. */
export const mockUsdc = (amount: string) => parseUnits(amount, MOCK_USDC_DECIMALS);
