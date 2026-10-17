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
import { getPublicClient, simulateContract, writeContract } from 'wagmi/actions';
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

/** Headroom on our own gas estimate, so state changes between estimate and inclusion fit. */
const GAS_HEADROOM_PERCENT = 120n;

function revertOf(error: unknown) {
  if (!(error instanceof BaseError)) return null;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? revert : null;
}

/**
 * Sends one owner transaction: simulate first (so a revert is explained before the wallet is
 * asked and before any gas is spent), then wallet confirmation, broadcast and receipt.
 *
 * The gas limit comes from our own estimate against the app's configured chain, not the
 * wallet's: a wallet may estimate against a different endpoint for the same chain ID (MetaMask's
 * hosted services did, for a local chain impersonating Base Sepolia, and set a limit that made
 * the transaction run out of gas).
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
        const client = getPublicClient(config, { chainId: BASE_SEPOLIA_CHAIN_ID })!;
        const estimate = await client
          .estimateContractGas({ ...request, account } as never)
          .catch(() => undefined);

        setState({ phase: 'wallet' });
        const hash = await writeContract(config, {
          ...request,
          account,
          chainId: BASE_SEPOLIA_CHAIN_ID,
          ...(estimate ? { gas: (estimate * GAS_HEADROOM_PERCENT) / 100n } : {}),
        } as never);

        setState({ phase: 'pending', hash });
        let receipt: TransactionReceipt;
        try {
          // viem's wait, not wagmi's: wagmi's replays a reverted transaction to read its reason
          // and throws if that replay fails (e.g. out of gas), which hid real reverts as "could
          // not be confirmed". Wallets may also broadcast after returning the hash (MetaMask
          // smart transactions), so keep looking well past the default.
          receipt = await client.waitForTransactionReceipt({
            hash,
            retryCount: 20,
            timeout: 180_000,
          });
        } catch (error) {
          console.warn('Transaction receipt not found', hash, error);
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
