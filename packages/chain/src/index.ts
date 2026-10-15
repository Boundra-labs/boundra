import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

export { baseSepolia };

export * from './manifest';
export * from './policy';
export * from './reader';
export * from './mandate';
export { boundraExecutorAbi } from './abis/BoundraExecutor';
export { boundraFactoryAbi } from './abis/BoundraFactory';
export { mockUSDCAbi as mockUsdcAbi } from './abis/MockUSDC';
export { mockUSDCFaucetAbi as mockUsdcFaucetAbi } from './abis/MockUSDCFaucet';
export { liquidVaultAbi } from './abis/LiquidVault';
export { timedVaultAbi } from './abis/TimedVault';

// Read-only client; signing lives behind the worker execution/reconciliation port.
export function createReadOnlyChainClient(rpcUrl: string) {
  const url = new URL(rpcUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported RPC protocol');
  return createPublicClient({
    chain: baseSepolia,
    // Aggregates concurrent reads at the same block into Multicall3 calls to stay under RPC limits.
    batch: { multicall: true },
    transport: http(url.toString(), { timeout: 10_000, retryCount: 2 }),
  });
}
