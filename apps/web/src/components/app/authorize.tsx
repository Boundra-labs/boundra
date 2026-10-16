'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { Address } from 'viem';
import { formatMockUsdc } from '@/lib/amount';
import { useAuthorizationCheck, useAuthorizationState } from '@/lib/authorization';
import { executorAbi, tokenAbi, toMandateStruct } from '@/lib/contracts';
import { useMandate, type MandateView } from '@/lib/mandates';
import { isBusy, useOwnerTransaction, type RevertExplainer } from '@/lib/transactions';
import { useOwnerSession } from './access-gate';
import { TransactionStatus } from './transaction-status';

const explainExecutor: RevertExplainer = (name) =>
  ({
    OwnerOnly: 'Only the wallet that created this executor can do this. Switch back to it.',
    OpenPosition:
      'Your executor still has funds in a vault, so its mandate can’t be replaced until they are withdrawn.',
    InvalidMandate:
      'The executor rejected this mandate as invalid, for example because it has expired. Draft a new one.',
    WrongChain: 'The executor rejected this mandate because it is for a different network.',
    InvalidAmount: 'The amount must be more than zero.',
    ERC20InsufficientAllowance:
      'Your executor is not allowed to take this amount yet. Complete the allowance step first.',
    ERC20InsufficientBalance: 'Your wallet holds less MockUSDC than this amount.',
  })[name];

function Step({
  index,
  done,
  title,
  detail,
  children,
}: {
  index: number;
  done: boolean;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <li className={`setup-item is-${done ? 'done' : 'action'}`}>
      <span className="setup-mark" aria-hidden="true">
        {done ? '✓' : index}
      </span>
      <div className="setup-body">
        <h3>
          {title}
          <span className="visually-hidden">{done ? ' (done)' : ' (to do)'}</span>
        </h3>
        <p>{detail}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * The owner's three wallet transactions for an approved mandate, then the API's on-chain
 * verification. Nothing reads as active until the worker has confirmed the exact mandate on
 * chain and marked it AUTHORIZED.
 */
export function Authorize({ view }: { view: MandateView }) {
  const session = useOwnerSession();
  const owner = session.address as Address;
  const executor = view.executor as Address;
  const chain = useAuthorizationState(view, owner);
  const setMandate = useOwnerTransaction(owner, explainExecutor);
  const allow = useOwnerTransaction(owner, explainExecutor);
  const fund = useOwnerTransaction(owner, explainExecutor);
  const check = useAuthorizationCheck(view.id, session.csrfToken);
  const amount = formatMockUsdc(chain.target);

  const approved = view.status === 'APPROVED';
  const authorized = view.status === 'AUTHORIZED';
  const verifying = approved && chain.mandateSet;
  // Shares the review's query; while verifying, it re-reads the mandate every few seconds.
  useMandate(view.id, { poll: verifying });

  // Once the exact mandate is on chain, ask the API to verify it (once per visit).
  const requested = useRef(false);
  useEffect(() => {
    if (!verifying || requested.current) return;
    requested.current = true;
    check.mutate(setMandate.state.phase === 'confirmed' ? setMandate.state.hash : undefined);
  }, [verifying, check, setMandate.state]);

  const expired = Number(view.tuple.expiresAt) * 1000 <= Date.now();
  if (chain.loading)
    return (
      <p className="field-note" role="status">
        Reading your executor…
      </p>
    );
  if (chain.failed)
    return (
      <div className="approve">
        <p role="alert" className="gate-problem">
          Your executor could not be read right now. Nothing was sent.
        </p>
        <button className="button button-quiet" onClick={() => void chain.refresh()}>
          Try again
        </button>
      </div>
    );

  const short = chain.walletBalance !== undefined && chain.walletBalance < chain.target;
  const after = (state: { phase: string }) => {
    if (state.phase === 'confirmed') void chain.refresh();
  };

  return (
    <div className="approve">
      <h2 className="panel-heading">
        {authorized ? 'Your mandate is active' : 'Authorize in your wallet'}
      </h2>
      <p className="field-note">
        {authorized
          ? chain.funded
            ? `Boundra verified the mandate on chain and your executor holds ${amount}. The agent may now act within it.`
            : `Boundra verified the mandate on chain. The agent can act once your executor holds ${amount}.`
          : 'Three transactions on Base Sepolia. The agent starts only after Boundra verifies the mandate on chain.'}
      </p>

      {!chain.hashMatches && (
        <p role="alert" className="gate-problem">
          This mandate does not match what you approved, so it can’t be signed. Reload the page; if
          it persists, draft a new mandate.
        </p>
      )}
      {approved && expired && (
        <p role="alert" className="gate-problem">
          This mandate expired before it was authorized. Draft a new one from your goal.
        </p>
      )}

      <ol className="setup-list">
        <Step
          index={1}
          done={chain.mandateSet || authorized}
          title="Set the mandate"
          detail="Stores exactly the mandate you reviewed on your executor."
        >
          {approved && !chain.mandateSet && (
            <button
              className="button"
              disabled={!chain.hashMatches || expired || isBusy(setMandate.state)}
              onClick={() =>
                void setMandate
                  .send({
                    address: executor,
                    abi: executorAbi,
                    functionName: 'setMandate',
                    args: [toMandateStruct(view.tuple)],
                  })
                  .then(after)
              }
            >
              Set mandate
            </button>
          )}
          <TransactionStatus
            state={setMandate.state}
            confirmedText="Mandate set on your executor."
          />
        </Step>

        <Step
          index={2}
          done={chain.allowed}
          title={`Allow exactly ${amount}`}
          detail="Lets your executor take this exact amount from your wallet, and nothing more."
        >
          {!chain.allowed && (
            <button
              className="button"
              disabled={!(chain.mandateSet || authorized) || isBusy(allow.state)}
              onClick={() =>
                void allow
                  .send({
                    address: view.tuple.asset as Address,
                    abi: tokenAbi,
                    functionName: 'approve',
                    args: [executor, chain.target],
                  })
                  .then(after)
              }
            >
              Approve {amount}
            </button>
          )}
          <TransactionStatus state={allow.state} confirmedText="Allowance set." />
        </Step>

        <Step
          index={3}
          done={chain.funded}
          title={`Fund your executor with ${amount}`}
          detail="Moves the MockUSDC into your executor. Only you can withdraw idle funds from it."
        >
          {!chain.funded && short && (
            <p className="field-note is-warning">
              Your wallet holds {formatMockUsdc(chain.walletBalance!)}, less than {amount}.
            </p>
          )}
          {!chain.funded && (
            <button
              className="button"
              disabled={!chain.allowed || short || isBusy(fund.state)}
              onClick={() =>
                void fund
                  .send({
                    address: executor,
                    abi: executorAbi,
                    functionName: 'fund',
                    args: [chain.target],
                  })
                  .then(after)
              }
            >
              Fund {amount}
            </button>
          )}
          <TransactionStatus state={fund.state} confirmedText="Executor funded." />
        </Step>
      </ol>

      {verifying && (
        <p className="tx-status is-pending" role="status">
          {check.isError
            ? 'Boundra could not queue the verification; it re-checks approved mandates on its own.'
            : 'Boundra is verifying the mandate on chain…'}
        </p>
      )}
    </div>
  );
}
