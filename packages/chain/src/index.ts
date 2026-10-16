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
    // Aggregates concurrent reads at the same block into one eth_call to stay under RPC limits.
    // Deployless needs no pre-deployed Multicall3, so local chains behave like Base Sepolia.
    batch: { multicall: { deployless: true } },
    transport: http(url.toString(), { timeout: 10_000, retryCount: 2 }),
  });
}
