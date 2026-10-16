'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

type Address = `0x${string}`;

/** `GET /config/public`: reviewed contract addresses; `configured: false` without a manifest. */
export interface PublicConfig {
  chainId: number;
  network: string;
  explorer: string;
  configured: boolean;
  contracts: {
    factory: Address;
    mockUsdc: Address;
    faucet: Address;
    liquidVault: Address;
    timedVault: Address;
    riskAdmin: Address;
  } | null;
  operator: Address | null;
}

export function usePublicConfig() {
  return useQuery({
    queryKey: ['config', 'public'],
    queryFn: () => api<PublicConfig>('config/public'),
    staleTime: 5 * 60_000,
  });
}
