'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseSiweMessage } from 'viem/siwe';
import { useSignMessage } from 'wagmi';
import { api, ApiError, isApiError } from './api';

export interface Session {
  /** Lowercase owner address; the API always takes the owner from the session. */
  address: string;
  csrfToken: string;
  admin: boolean;
}

const SESSION_KEY = ['auth', 'session'] as const;

/**
 * The challenge is bound to the API's configured web origin. If this page was opened on a
 * different host (for example 127.0.0.1 instead of localhost), the wallet would warn about a
 * mismatched domain and the API would reject the signature, so stop before asking to sign.
 */
export class SignInOriginError extends Error {
  constructor(readonly expectedOrigin: string) {
    super(`Sign-in is set up for ${expectedOrigin}. Open Boundra there to sign in.`);
    this.name = 'SignInOriginError';
  }
}

/** The current session, `null` when signed out. Other failures surface as query errors. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<Session | null> => {
      try {
        return await api<Session>('auth/session');
      } catch (error) {
        if (isApiError(error, 'UNAUTHENTICATED')) return null;
        throw error;
      }
    },
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Sign-In with Ethereum: challenge → wallet signature (no transaction, no gas) → session. */
export function useSignIn() {
  const queryClient = useQueryClient();
  const signMessage = useSignMessage();
  return useMutation({
    mutationFn: async (address: `0x${string}`) => {
      const { message } = await api<{ message: string }>('auth/challenge', {
        method: 'POST',
        body: { address },
      });
      const fields = parseSiweMessage(message);
      if (fields.domain !== window.location.host)
        throw new SignInOriginError(fields.uri ?? `http://${fields.domain}`);
      const signature = await signMessage.mutateAsync({ account: address, message });
      return api<{ address: string; csrfToken: string }>('auth/verify', {
        method: 'POST',
        body: { message, signature },
      });
    },
    onSuccess: async (grant) => {
      queryClient.setQueryData<Session>(SESSION_KEY, { ...grant, admin: false });
      // The session route also reports whether this wallet is a demo admin.
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (session: Session) => {
      try {
        await api('auth/logout', { method: 'POST', csrfToken: session.csrfToken });
      } catch (error) {
        // An expired or already revoked session is signed out either way.
        if (!isApiError(error, 'UNAUTHENTICATED')) throw error;
      }
    },
    onSuccess: () => {
      queryClient.setQueryData(SESSION_KEY, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
    },
  });
}
