'use client';

import { BASE_SEPOLIA_CHAIN_ID } from '@boundra/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

export type IntentState = 'CLARIFYING' | 'MANDATE_PENDING' | 'ESCALATED' | (string & {});
export type VaultKey = 'LIQUID' | 'TIMED';

export interface Alternative {
  id: string;
  label: string;
}

export interface ActiveQuestion {
  questionId: string;
  order: number;
  dimension: string;
  text: string;
  alternatives: Alternative[];
  wordingSource: 'TEMPLATE' | 'LLM';
}

export interface AnsweredQuestion {
  questionId: string;
  order: number;
  dimension: string;
  text: string;
  answerId: string | null;
  status: 'ANSWERED' | 'UNKNOWN';
}

export type Selection =
  | { action: 'DEPOSIT'; vault: VaultKey; reasonCode: string; reason: string }
  | { action: 'ESCALATE'; reasonCode: string; reason: string };

export interface Candidate {
  vault: VaultKey;
  eligible: boolean;
  illustrativeYieldBps: number;
  lockupSeconds: string;
  reasons: { code: string; message: string }[];
}

/** `GET /intents/:id`: the API recomputes everything below from persisted answers. */
export interface IntentView {
  id: string;
  state: IntentState;
  objective: string;
  amount: { baseUnits: string; display: string };
  chainId: number;
  createdAt: string;
  question: ActiveQuestion | null;
  answered: AnsweredQuestion[];
  questionsAsked: number;
  selection: Selection;
  candidates: Candidate[];
  narrowed: { dimension: string; reason: string }[];
  conflicts: { code: string; message: string }[];
}

const intentKey = (id: string) => ['intent', id] as const;

export function useIntent(id: string) {
  return useQuery({
    queryKey: intentKey(id),
    queryFn: () => api<IntentView>(`intents/${encodeURIComponent(id)}`),
    retry: (count, error) => count < 1 && !(error instanceof ApiError && error.status < 500),
  });
}

export function useCreateIntent(csrfToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { objective: string; amount: string }) =>
      api<IntentView>('intents', {
        method: 'POST',
        csrfToken,
        body: { ...input, chainId: BASE_SEPOLIA_CHAIN_ID },
      }),
    onSuccess: (view) => queryClient.setQueryData(intentKey(view.id), view),
  });
}

export function useAnswer(intentId: string, csrfToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answer: { questionId: string; alternativeId: string }) =>
      api<IntentView>(`intents/${encodeURIComponent(intentId)}/answers`, {
        method: 'POST',
        csrfToken,
        body: answer,
      }),
    onSuccess: (view) => queryClient.setQueryData(intentKey(intentId), view),
    // A stale question or a concurrent answer means our copy is out of date: reload it.
    onError: () => queryClient.invalidateQueries({ queryKey: intentKey(intentId) }),
  });
}
