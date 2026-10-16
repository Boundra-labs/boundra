'use client';

import { BASE_SEPOLIA_CHAIN_ID } from '@boundra/shared';
import { useCallback, useRef, useState } from 'react';
import {
  BaseError,
  ContractFunctionRevertedError,
  type Abi,
  type Address,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { useConfig } from 'wagmi';
import { simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import { isUserRejection, walletErrorMessage } from './wallet-errors';

export interface ContractRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

/**
 * Where an owner transaction is. Only `confirmed` means it happened: a hash alone is never
 * shown as success, and an included-but-reverted transaction changed nothing.
 */
export type TransactionState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'wallet' }
  | { phase: 'pending'; hash: Hash }
  | { phase: 'confirmed'; hash: Hash; receipt: TransactionReceipt }
  | { phase: 'reverted'; hash: Hash }
  | { phase: 'rejected' }
  | { phase: 'failed'; message: string; hash?: Hash };

export const isBusy = (state: TransactionState) =>
  state.phase === 'checking' || state.phase === 'wallet' || state.phase === 'pending';

/** Explains a revert found while simulating, by the contract's custom error name. */
export type RevertExplainer = (errorName: string, args: readonly unknown[]) => string | undefined;

function revertOf(error: unknown) {
  if (!(error instanceof BaseError)) return null;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? revert : null;
}

/**
 * Sends one owner transaction: simulate first (so a revert is explained before the wallet is
 * asked and before any gas is spent), then wallet confirmation, broadcast and receipt.
 */
export function useOwnerTransaction(account: Address | undefined, explain?: RevertExplainer) {
  const config = useConfig();
  const [state, setState] = useState<TransactionState>({ phase: 'idle' });
  const running = useRef(false);

  const send = useCallback(
    async (request: ContractRequest): Promise<TransactionState> => {
      if (running.current || !account) return { phase: 'idle' };
      running.current = true;
      const settle = (next: TransactionState) => {
        setState(next);
        running.current = false;
        return next;
      };
      try {
        setState({ phase: 'checking' });
        try {
          await simulateContract(config, {
            ...request,
            account,
            chainId: BASE_SEPOLIA_CHAIN_ID,
          } as never);
        } catch (error) {
          const revert = revertOf(error);
          if (revert) {
            const name = revert.data?.errorName ?? '';
            return settle({
              phase: 'failed',
              message:
                explain?.(name, revert.data?.args ?? []) ??
                `The contract would reject this${name ? ` (${name})` : ''}, so nothing was sent.`,
            });
          }
          throw error;
        }

        setState({ phase: 'wallet' });
        const hash = await writeContract(config, {
          ...request,
          account,
          chainId: BASE_SEPOLIA_CHAIN_ID,
        } as never);

        setState({ phase: 'pending', hash });
        let receipt: TransactionReceipt;
        try {
          receipt = await waitForTransactionReceipt(config, {
            hash,
            chainId: BASE_SEPOLIA_CHAIN_ID,
          });
        } catch {
          // It was broadcast; sending again could duplicate it.
          return settle({
            phase: 'failed',
            hash,
            message:
              'The transaction was sent, but its result could not be confirmed yet. Check it in the explorer before trying again.',
          });
        }
        return settle(
          receipt.status === 'success'
            ? { phase: 'confirmed', hash, receipt }
            : { phase: 'reverted', hash },
        );
      } catch (error) {
        if (isUserRejection(error)) return settle({ phase: 'rejected' });
        return settle({ phase: 'failed', message: walletErrorMessage(error, 'sent') });
      }
    },
    [account, config, explain],
  );

  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  return { state, send, reset };
}
