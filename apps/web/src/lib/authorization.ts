'use client';

import { BASE_SEPOLIA_CHAIN_ID } from '@boundra/shared';
import { useMutation } from '@tanstack/react-query';
import type { Address } from 'viem';
import { useReadContract } from 'wagmi';
import { api } from './api';
import { executorAbi, hashMandate, sameMandate, tokenAbi } from './contracts';
import type { MandateView } from './mandates';

const chainId = BASE_SEPOLIA_CHAIN_ID;

/**
 * Where an approved mandate stands on chain: whether the executor holds exactly this mandate,
 * and whether the exact allowance and funding are in place. Every value is read from the chain,
 * so a reload resumes at the right step.
 */
export function useAuthorizationState(view: MandateView, owner: Address) {
  const executor = view.executor ?? undefined;
  const token = view.tuple.asset as Address;
  const enabled = Boolean(executor);
  const target = BigInt(view.tuple.allocationTarget);

  const version = useReadContract({
    address: executor,
    abi: executorAbi,
    functionName: 'mandateVersion',
    chainId,
    query: { enabled },
  });
  const onchain = useReadContract({
    address: executor,
    abi: executorAbi,
    functionName: 'mandate',
    chainId,
    query: { enabled },
  });
  const revoked = useReadContract({
    address: executor,
    abi: executorAbi,
    functionName: 'revoked',
    chainId,
    query: { enabled },
  });
  const allowance = useReadContract({
    address: token,
    abi: tokenAbi,
    functionName: 'allowance',
    args: [owner, executor!],
    chainId,
    query: { enabled },
  });
  const executorBalance = useReadContract({
    address: token,
    abi: tokenAbi,
    functionName: 'balanceOf',
    args: [executor!],
    chainId,
    query: { enabled },
  });
  const walletBalance = useReadContract({
    address: token,
    abi: tokenAbi,
    functionName: 'balanceOf',
    args: [owner],
    chainId,
    query: { enabled },
  });

  const reads = [version, onchain, revoked, allowance, executorBalance, walletBalance];
  const refresh = () => Promise.all(reads.map((read) => read.refetch()));

  const loaded = reads.every((read) => read.data !== undefined);
  const mandateSet =
    loaded &&
    (version.data as bigint) > 0n &&
    !(revoked.data as boolean) &&
    sameMandate(onchain.data as never, view.tuple);
  const funded = loaded && (executorBalance.data as bigint) >= target;
  const allowed = funded || (loaded && (allowance.data as bigint) >= target);

  return {
    loading: !loaded && !reads.some((read) => read.isError),
    failed: reads.some((read) => read.isError),
    /** The tuple about to be signed hashes to what the API recorded at approval. */
    hashMatches: view.mandateHash === null || hashMandate(view.tuple) === view.mandateHash,
    mandateSet,
    allowed,
    funded,
    target,
    walletBalance: walletBalance.data as bigint | undefined,
    executorBalance: executorBalance.data as bigint | undefined,
    refresh,
  };
}

/** Asks the API to verify the on-chain mandate now; the worker alone sets AUTHORIZED. */
export function useAuthorizationCheck(id: string, csrfToken: string) {
  return useMutation({
    mutationFn: (txHash?: string) =>
      api<{ status: string }>(`mandate-drafts/${encodeURIComponent(id)}/authorization-check`, {
        method: 'POST',
        csrfToken,
        body: txHash ? { txHash } : {},
      }),
  });
}
