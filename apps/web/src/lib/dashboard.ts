'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** `GET /dashboard`: what the API has registered and confirmed for this owner. */
export interface Dashboard {
  labels: string[];
  owner: string;
  /** The executor the API verified for this owner, or null before registration. */
  executor: string | null;
  mandate: {
    id: string;
    status: string;
    revision: number;
    selectedVault: string | null;
    onchainVersion: string | null;
    escalationReason: string | null;
  } | null;
  chainStatus: 'ok' | 'degraded' | 'unconfigured' | 'no_executor';
  chain: Record<string, unknown> | null;
}

export const DASHBOARD_KEY = ['dashboard'] as const;

export function useDashboard() {
  return useQuery({ queryKey: DASHBOARD_KEY, queryFn: () => api<Dashboard>('dashboard') });
}
