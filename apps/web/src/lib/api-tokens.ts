'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseSiweMessage } from 'viem/siwe';
import { useSignMessage } from 'wagmi';
import { api } from './api';
import { SignInOriginError } from './session';

export interface ApiTokenInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

/** A token as created: its value exists only here, once; the API keeps only a hash. */
export interface NewApiToken {
  token: string;
  expiresAt: string;
}

const TOKENS_KEY = ['auth', 'tokens'] as const;

/** The owner's live API tokens (never their values). */
export function useApiTokens() {
  return useQuery({
    queryKey: TOKENS_KEY,
    queryFn: () => api<{ items: ApiTokenInfo[] }>('auth/tokens'),
  });
}

/**
 * A new API token for an app or AI assistant: the owner's wallet signs a SIWE message whose
 * statement says what the token can and cannot do. Signing is not a transaction and costs no gas.
 */
export function useCreateApiToken() {
  const queryClient = useQueryClient();
  const signMessage = useSignMessage();
  return useMutation({
    mutationFn: async (address: `0x${string}`): Promise<NewApiToken> => {
      const { message } = await api<{ message: string }>('auth/challenge', {
        method: 'POST',
        body: { address, client: 'token' },
      });
      const fields = parseSiweMessage(message);
      if (fields.domain !== window.location.host)
        throw new SignInOriginError(fields.uri ?? `http://${fields.domain}`);
      const signature = await signMessage.mutateAsync({ account: address, message });
      return api<NewApiToken>('auth/verify', { method: 'POST', body: { message, signature } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TOKENS_KEY }),
  });
}

export function useRevokeApiToken(csrfToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`auth/tokens/${encodeURIComponent(id)}/revoke`, { method: 'POST', csrfToken }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TOKENS_KEY }),
  });
}
