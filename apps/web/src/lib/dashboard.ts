'use client';

import type { MandateTuple } from '@boundra/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Position {
  address: string;
  principal: string;
  display: string;
  /** Unix seconds; 0 when nothing is locked. */
  unlockAt: string;
  withdrawable: string;
  risk: 'NORMAL' | 'DEGRADED';
}

/** Confirmed on-chain state of the owner's executor, read at the API's confirmation depth. */
export interface ChainSnapshot {
  blockNumber: string;
  blockHash: string;
  mandateVersion: string;
  paused: boolean;
  revoked: boolean;
  allocationCompleted: boolean;
  cumulativeDeposited: string;
  idle: { baseUnits: string; display: string };
  /** LiquidVault first, then TimedVault. */
  positions: [Position, Position];
}

/** `GET /dashboard`: what the API has registered and confirmed for this owner. */
export interface Dashboard {
  labels: string[];
  owner: string;
  /** The executor the API verified for this owner, or null before registration. */
  executor: string | null;
  /** The latest mandate that is not superseded or rejected. */
  mandate: {
    id: string;
    status: string;
    revision: number;
    selectedVault: 'LIQUID' | 'TIMED' | null;
    tuple: MandateTuple;
    onchainVersion: string | null;
    escalationReason: string | null;
  } | null;
  chainStatus: 'ok' | 'degraded' | 'unconfigured' | 'no_executor';
  chain: ChainSnapshot | null;
}

export const DASHBOARD_KEY = ['dashboard'] as const;

/** `pollMs` keeps re-reading, e.g. while a just-confirmed owner action reaches the API's depth. */
export function useDashboard({ pollMs }: { pollMs?: number } = {}) {
  return useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: () => api<Dashboard>('dashboard'),
    refetchInterval: pollMs ?? false,
  });
}

export interface ActivityItem {
  id: string;
  type: string;
  intentId: string | null;
  mandateId: string | null;
  actionId: string | null;
  /** Only real transactions have one; HOLD, ESCALATE and pre-broadcast rejections never do. */
  txHash: string | null;
  explorerUrl: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export const ACTIVITY_KEY = ['activity'] as const;

/** The owner's timeline, newest first, in pages of 20. */
export function useActivity({ pollMs }: { pollMs?: number } = {}) {
  return useInfiniteQuery({
    queryKey: ACTIVITY_KEY,
    queryFn: ({ pageParam }) =>
      api<{ items: ActivityItem[]; nextBefore: string | null }>(
        `activity?limit=20${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextBefore,
    refetchInterval: pollMs ?? false,
  });
}
