'use client';

import { BASE_SEPOLIA_CHAIN_ID } from '@boundra/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { zeroAddress, type Address } from 'viem';
import { usePublicClient, useReadContract } from 'wagmi';
import { factoryAbi, faucetAbi, tokenAbi } from './contracts';
import { useDashboard } from './dashboard';
import { usePublicConfig } from './public-config';

const chainId = BASE_SEPOLIA_CHAIN_ID;

/**
 * What an owner needs before drafting a mandate, read from the chain (gas, MockUSDC, the
 * factory's executor for this wallet) and from the API (whether it verified that executor).
 */
export function useAccountReadiness(owner: Address) {
  const config = usePublicConfig();
  const contracts = config.data?.contracts ?? undefined;
  const enabled = Boolean(contracts);

  // A plain eth_getBalance: with multicall batching on, viem would route this through
  // Multicall3's getEthBalance at its fixed address, which a local chain does not have.
  const client = usePublicClient({ chainId });
  const gas = useQuery({
    queryKey: ['eth-balance', chainId, owner],
    queryFn: async () => ({
      value: BigInt(await client!.request({ method: 'eth_getBalance', params: [owner, 'latest'] })),
    }),
    enabled: enabled && Boolean(client),
  });
  const walletUsdc = useReadContract({
    address: contracts?.mockUsdc,
    abi: tokenAbi,
    functionName: 'balanceOf',
    args: [owner],
    chainId,
    query: { enabled },
  });
  const executorOf = useReadContract({
    address: contracts?.factory,
    abi: factoryAbi,
    functionName: 'executorOf',
    args: [owner],
    chainId,
    query: { enabled },
  });
  const onchainExecutor =
    executorOf.data && executorOf.data !== zeroAddress ? (executorOf.data as Address) : null;
  const executorUsdc = useReadContract({
    address: contracts?.mockUsdc,
    abi: tokenAbi,
    functionName: 'balanceOf',
    args: [onchainExecutor ?? zeroAddress],
    chainId,
    query: { enabled: enabled && Boolean(onchainExecutor) },
  });
  const claimAmount = useReadContract({
    address: contracts?.faucet,
    abi: faucetAbi,
    functionName: 'CLAIM_AMOUNT',
    chainId,
    query: { enabled },
  });
  const nextClaimAt = useReadContract({
    address: contracts?.faucet,
    abi: faucetAbi,
    functionName: 'nextClaimAt',
    args: [owner],
    chainId,
    query: { enabled },
  });
  const dashboard = useDashboard();

  const reads = [gas, walletUsdc, executorOf, claimAmount, nextClaimAt];
  const usdcWallet = walletUsdc.data as bigint | undefined;
  const usdcExecutor = onchainExecutor ? (executorUsdc.data as bigint | undefined) : 0n;
  const registered = dashboard.data?.executor ?? null;

  const refresh = useCallback(async () => {
    await Promise.all([
      gas.refetch(),
      walletUsdc.refetch(),
      executorOf.refetch(),
      executorUsdc.refetch(),
      nextClaimAt.refetch(),
      dashboard.refetch(),
    ]);
  }, [gas, walletUsdc, executorOf, executorUsdc, nextClaimAt, dashboard]);

  const loading =
    config.isPending || (enabled && (reads.some((read) => read.isPending) || dashboard.isPending));
  const failed = config.isError || reads.some((read) => read.isError) || dashboard.isError;
  const usdcTotal =
    usdcWallet !== undefined && usdcExecutor !== undefined ? usdcWallet + usdcExecutor : undefined;
  const executorMismatch =
    Boolean(registered && onchainExecutor) &&
    registered!.toLowerCase() !== onchainExecutor!.toLowerCase();

  return {
    loading,
    failed,
    configured: config.data?.configured ?? false,
    contracts,
    gas: gas.data?.value,
    usdc: { wallet: usdcWallet, executor: usdcExecutor, total: usdcTotal },
    claim: {
      amount: claimAmount.data as bigint | undefined,
      nextAt: nextClaimAt.data as bigint | undefined,
    },
    executor: { onchain: onchainExecutor, registered, mismatch: executorMismatch },
    ready:
      !loading &&
      !failed &&
      Boolean(usdcTotal && usdcTotal > 0n) &&
      Boolean(registered && onchainExecutor) &&
      !executorMismatch,
    refresh,
  };
}

export type AccountReadiness = ReturnType<typeof useAccountReadiness>;
