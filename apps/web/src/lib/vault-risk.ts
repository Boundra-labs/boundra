'use client';

import { BASE_SEPOLIA_CHAIN_ID } from '@boundra/shared';
import { maxUint256, type Address } from 'viem';
import { useReadContracts } from 'wagmi';
import { vaultAbi } from './contracts';

export type VaultCondition = {
  risk: 'NORMAL' | 'DEGRADED';
  /** null = unlimited (the contract's max value). */
  capacity: bigint | null;
  /** Principal held for every demo position in the vault. */
  totalPrincipal: bigint;
};

const FIELDS = ['riskLevel', 'withdrawalCapacity', 'totalPrincipal'] as const;

/** Current risk fixture state of both mock vaults, read from the chain (latest block). */
export function useVaultConditions(vaults: { liquid: Address; timed: Address } | undefined) {
  const read = useReadContracts({
    contracts: vaults
      ? [vaults.liquid, vaults.timed].flatMap((address) =>
          FIELDS.map((functionName) => ({
            address,
            abi: vaultAbi,
            functionName,
            chainId: BASE_SEPOLIA_CHAIN_ID,
          })),
        )
      : [],
    allowFailure: false,
    query: { enabled: Boolean(vaults) },
  });

  const condition = (offset: number): VaultCondition | undefined => {
    const values = read.data?.slice(offset, offset + FIELDS.length) as
      [number, bigint, bigint] | undefined;
    if (!values) return undefined;
    const [risk, capacity, totalPrincipal] = values;
    return {
      risk: risk === 0 ? 'NORMAL' : 'DEGRADED',
      capacity: capacity === maxUint256 ? null : capacity,
      totalPrincipal,
    };
  };

  return {
    liquid: condition(0),
    timed: condition(FIELDS.length),
    isPending: read.isPending,
    isError: read.isError,
    refetch: read.refetch,
  };
}
