'use client';

import type { Hash } from 'viem';
import { usePublicConfig } from '@/lib/public-config';
import type { TransactionState } from '@/lib/transactions';

function TxLink({ hash }: { hash: Hash }) {
  const config = usePublicConfig();
  const short = `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  if (!config.data?.explorer) return <code>{short}</code>;
  return (
    <a href={`${config.data.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
      {short}
    </a>
  );
}

/**
 * One line that says exactly where an owner transaction is. Nothing reads as success before the
 * receipt confirms it.
 */
export function TransactionStatus({
  state,
  confirmedText,
}: {
  state: TransactionState;
  confirmedText: string;
}) {
  switch (state.phase) {
    case 'idle':
      return null;
    case 'checking':
      return (
        <p className="tx-status" role="status">
          Checking the transaction…
        </p>
      );
    case 'wallet':
      return (
        <p className="tx-status" role="status">
          Confirm in your wallet…
        </p>
      );
    case 'pending':
      return (
        <p className="tx-status is-pending" role="status">
          Sent · waiting for the network to confirm (<TxLink hash={state.hash} />)
        </p>
      );
    case 'confirmed':
      return (
        <p className="tx-status is-confirmed" role="status">
          {confirmedText} (<TxLink hash={state.hash} />)
        </p>
      );
    case 'reverted':
      return (
        <p className="tx-status is-problem" role="alert">
          The transaction was included but reverted, so nothing changed (
          <TxLink hash={state.hash} />
          ).
        </p>
      );
    case 'rejected':
      return (
        <p className="tx-status is-problem" role="alert">
          You declined in your wallet, so nothing was sent.
        </p>
      );
    case 'failed':
      return (
        <p className="tx-status is-problem" role="alert">
          {state.message}
          {state.hash && (
            <>
              {' '}
              (<TxLink hash={state.hash} />)
            </>
          )}
        </p>
      );
  }
}
