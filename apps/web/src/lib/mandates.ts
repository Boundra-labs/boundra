'use client';

import type { MandateTuple } from '@boundra/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { VaultKey } from './intents';

export type MandateStatus =
  'PREVIEWED' | 'APPROVED' | 'AUTHORIZED' | 'SUPERSEDED' | 'REVOKED' | 'EXPIRED' | (string & {});

export type { MandateTuple };

/** The structured preview the owner approves; its hash binds the approval to these values. */
export interface MandatePreview {
  version: string;
  labels: string[];
  network: { chainId: number; name: string };
  owner: string;
  operator: string;
  executor: string | null;
  beneficiary: string;
  token: { address: string; symbol: string; decimals: number };
  amount: { baseUnits: string; display: string };
  target: {
    vault: VaultKey;
    name: string;
    address: string;
    lockupSeconds: string;
    illustrativeYieldBps: number;
  };
  allowedActions: ('DEPOSIT' | 'WITHDRAW')[];
  limits: {
    maxDepositPerAction: string;
    maxCumulativeDeposits: string;
    allocationTarget: string;
    maxWithdrawPerAction: string;
    maxLockupSeconds: string;
  };
  expiresAt: string;
  expiresAtIso: string;
  selection: { reasonCode: string; reason: string };
  candidates: { vault: VaultKey; eligible: boolean; reasons: string[] }[];
  preferences: {
    dimension: string;
    source: 'ANSWERED' | 'UNKNOWN' | 'DEFAULT';
    answer: string | null;
    enforcement: string;
  }[];
  narrowed: { dimension: string; reason: string }[];
  notices: string[];
  plainSummary?: { text: string; source: 'TEMPLATE' | 'LLM' };
}

export interface MandateView {
  id: string;
  intentId: string;
  revision: number;
  status: MandateStatus;
  executor: `0x${string}` | null;
  tuple: MandateTuple;
  preview: MandatePreview;
  previewHash: `0x${string}`;
  mandateHash: `0x${string}` | null;
  approvedAt: string | null;
  authorizedAt: string | null;
  onchainVersion: string | null;
  authorizationTxHash: string | null;
  fundedAtBlock: string | null;
  escalationReason: string | null;
}

/** Drafting can end in escalation when nothing eligible remains; nothing is delegated then. */
export type DraftResult = MandateView | { status: 'ESCALATED'; reasonCode: string; reason: string };
export const isEscalation = (
  result: DraftResult,
): result is Extract<DraftResult, { status: 'ESCALATED' }> => result.status === 'ESCALATED';

/** The owner-editable limits. Every draft is built from scratch, so edits always send all three. */
export interface DraftLimits {
  expiryDays: number;
  maxDepositPerAction: string;
  maxWithdrawPerAction: string;
}

export const DAY_SECONDS = 86_400;
/** Mirrors ACCE: a lockup vault needs its 30-day lockup plus 2 days; at most 60 days. */
export const expiryBounds = (lockupSeconds: string) => ({
  min: Number(lockupSeconds) > 0 ? Math.ceil(Number(lockupSeconds) / DAY_SECONDS) + 2 : 1,
  max: 60,
});

const mandateKey = (id: string) => ['mandate', id] as const;

/** `poll` re-reads every few seconds, e.g. while the worker verifies an approved mandate. */
export function useMandate(id: string, { poll = false }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: mandateKey(id),
    queryFn: () => api<MandateView>(`mandate-drafts/${encodeURIComponent(id)}`),
    retry: (count, error) => count < 1 && !(error instanceof ApiError && error.status < 500),
    refetchInterval: poll ? 3000 : false,
  });
}

export function useCreateDraft(intentId: string, csrfToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<DraftResult>(`intents/${encodeURIComponent(intentId)}/mandate-drafts`, {
        method: 'POST',
        csrfToken,
        body: {},
      }),
    onSuccess: (result) => {
      if (!isEscalation(result)) queryClient.setQueryData(mandateKey(result.id), result);
      else void queryClient.invalidateQueries({ queryKey: ['intent', intentId] });
    },
  });
}

/** An edit is a new revision with a new ID; the old one is superseded. */
export function useReviseDraft(id: string, csrfToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (limits: DraftLimits) =>
      api<DraftResult>(`mandate-drafts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        csrfToken,
        body: limits,
      }),
    onSuccess: (result) => {
      if (!isEscalation(result)) queryClient.setQueryData(mandateKey(result.id), result);
      void queryClient.invalidateQueries({ queryKey: mandateKey(id) });
    },
  });
}

/** Approval binds the exact previewed revision through its preview hash. */
export function useApprove(id: string, csrfToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (previewHash: string) =>
      api<MandateView>(`mandate-drafts/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        csrfToken,
        body: { previewHash },
      }),
    onSuccess: (view) => queryClient.setQueryData(mandateKey(id), view),
    onError: () => queryClient.invalidateQueries({ queryKey: mandateKey(id) }),
  });
}
