'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { formatEther, type Address } from 'viem';
import { api, isApiError } from '@/lib/api';
import { formatMockUsdc } from '@/lib/amount';
import { factoryAbi, faucetAbi } from '@/lib/contracts';
import { DASHBOARD_KEY } from '@/lib/dashboard';
import type { AccountReadiness } from '@/lib/readiness';
import { isBusy, useOwnerTransaction, type RevertExplainer } from '@/lib/transactions';
import { useOwnerSession } from './access-gate';
import { shortAddress } from './format';
import { TransactionStatus } from './transaction-status';

const dateTime = (seconds: bigint) =>
  new Date(Number(seconds) * 1000).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

const explainFaucet: RevertExplainer = (name, args) => {
  if (name === 'CooldownActive')
    return `You claimed recently. The faucet allows one claim per day; you can claim again on ${dateTime(args[0] as bigint)}.`;
  if (name === 'SupplyCapExceeded')
    return 'The faucet has reached MockUSDC’s fixed supply cap, so it cannot mint more.';
  return undefined;
};

const explainFactory: RevertExplainer = (name) =>
  name === 'ExecutorAlreadyExists' ? 'This wallet already has an executor.' : undefined;

type ItemState = 'done' | 'action' | 'blocked';

function Item({
  state,
  title,
  detail,
  children,
}: {
  state: ItemState;
  title: string;
  detail: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className={`setup-item is-${state}`}>
      <span className="setup-mark" aria-hidden="true">
        {state === 'done' ? '✓' : state === 'blocked' ? '!' : ''}
      </span>
      <div className="setup-body">
        <h3>
          {title}
          <span className="visually-hidden">{state === 'done' ? ' (done)' : ' (to do)'}</span>
        </h3>
        <p>{detail}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * One-time setup before a mandate can be drafted: test ETH for fees, MockUSDC from the faucet,
 * and the owner's executor contract, created from the wallet and then verified by the API.
 */
export function AccountSetup({
  owner,
  readiness,
}: {
  owner: Address;
  readiness: AccountReadiness;
}) {
  const session = useOwnerSession();
  const queryClient = useQueryClient();
  const faucet = useOwnerTransaction(owner, explainFaucet);
  const factory = useOwnerTransaction(owner, explainFactory);
  const { contracts, gas, usdc, claim, executor } = readiness;

  // The API verifies the executor at its confirmation depth, so a fresh one can take a few
  // blocks to be accepted: retry while it reports EXECUTOR_NOT_REGISTERED.
  const register = useMutation({
    mutationFn: () =>
      api<{ address: string }>('executors/register', {
        method: 'POST',
        csrfToken: session.csrfToken,
      }),
    retry: (count, error) => isApiError(error, 'EXECUTOR_NOT_REGISTERED') && count < 30,
    retryDelay: 2000,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY }),
  });
  const autoRegistered = useRef(false);
  useEffect(() => {
    if (executor.onchain && !executor.registered && !autoRegistered.current) {
      autoRegistered.current = true;
      register.mutate();
    }
  }, [executor.onchain, executor.registered, register]);

  const hasGas = gas !== undefined && gas > 0n;
  const hasUsdc = usdc.total !== undefined && usdc.total > 0n;
  // A public RPC endpoint can answer from a node a block or two behind the receipt, so keep
  // re-reading until the confirmed step shows, for at most a minute, with its button disabled.
  const [awaiting, setAwaiting] = useState<'usdc' | 'executor' | null>(null);
  const reread = useRef(readiness.refresh);
  reread.current = readiness.refresh;
  const shown =
    awaiting === 'usdc' ? hasUsdc : awaiting === 'executor' ? Boolean(executor.onchain) : true;
  useEffect(() => {
    if (awaiting === null) return;
    if (shown) {
      setAwaiting(null);
      return;
    }
    const timer = setInterval(() => void reread.current(), 2000);
    const stop = setTimeout(() => setAwaiting(null), 60_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [awaiting, shown]);

  if (!contracts) return null;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const coolingDown = claim.nextAt !== undefined && claim.nextAt > now;

  async function claimUsdc() {
    const result = await faucet.send({
      address: contracts!.faucet,
      abi: faucetAbi,
      functionName: 'claim',
    });
    if (result.phase !== 'confirmed') return;
    setAwaiting('usdc');
    await readiness.refresh();
  }

  async function createExecutor() {
    const result = await factory.send({
      address: contracts!.factory,
      abi: factoryAbi,
      functionName: 'createExecutor',
    });
    if (result.phase === 'confirmed') setAwaiting('executor');
    if (result.phase === 'confirmed' || result.phase === 'failed') await readiness.refresh();
  }

  return (
    <section className="panel" aria-labelledby="setup-heading">
      <p className="gate-eyebrow">One-time setup · Base Sepolia testnet</p>
      <h1 id="setup-heading" className="gate-title">
        Get your wallet ready
      </h1>
      <p className="gate-lede">
        Two quick testnet transactions: claim MockUSDC, then create the executor contract that will
        hold your mandate. Neither gives the agent any authority or moves funds to it.
      </p>

      <ol className="setup-list">
        <Item
          state={hasGas ? 'done' : 'blocked'}
          title="Test ETH for network fees"
          detail={
            hasGas
              ? `${Number(formatEther(gas!)).toLocaleString('en-US', { maximumFractionDigits: 4 })} ETH available for fees.`
              : 'Your wallet has no Base Sepolia ETH, which every transaction needs for fees. Get some from a Base Sepolia faucet, then refresh.'
          }
        >
          {!hasGas && (
            <button className="button button-quiet" onClick={() => void readiness.refresh()}>
              Refresh
            </button>
          )}
        </Item>

        <Item
          state={hasUsdc ? 'done' : 'action'}
          title="MockUSDC to delegate"
          detail={
            hasUsdc
              ? `${formatMockUsdc(usdc.total!)} available${usdc.executor ? ` (${formatMockUsdc(usdc.executor)} already in your executor)` : ''}.`
              : coolingDown
                ? `You can claim again on ${dateTime(claim.nextAt!)}.`
                : `Claim ${claim.amount ? formatMockUsdc(claim.amount) : 'MockUSDC'} from the test faucet. Mock tokens have no value.`
          }
        >
          {!hasUsdc && !coolingDown && (
            <button
              className="button"
              disabled={!hasGas || isBusy(faucet.state) || awaiting === 'usdc'}
              onClick={() => void claimUsdc()}
            >
              Claim {claim.amount ? formatMockUsdc(claim.amount) : 'MockUSDC'}
            </button>
          )}
          <TransactionStatus state={faucet.state} confirmedText="MockUSDC claimed." />
        </Item>

        <Item
          state={
            executor.registered && !executor.mismatch
              ? 'done'
              : executor.mismatch
                ? 'blocked'
                : 'action'
          }
          title="Your executor"
          detail={
            executor.mismatch
              ? 'Boundra has a different executor on record than the factory reports for this wallet. Nothing can be drafted until this is resolved.'
              : executor.registered
                ? `Executor ${shortAddress(executor.registered)} is verified. Only you can change its mandate or withdraw from it.`
                : executor.onchain
                  ? `Executor ${shortAddress(executor.onchain)} exists. Boundra is verifying it on chain…`
                  : 'A contract the factory creates for your wallet. It holds the funds you delegate and enforces your mandate.'
          }
        >
          {!executor.onchain && (
            <button
              className="button"
              disabled={!hasGas || isBusy(factory.state) || awaiting === 'executor'}
              onClick={() => void createExecutor()}
            >
              Create executor
            </button>
          )}
          <TransactionStatus state={factory.state} confirmedText="Executor created." />
          {executor.onchain && !executor.registered && register.isPending && (
            <p className="tx-status" role="status">
              Waiting for enough confirmations to verify it…
            </p>
          )}
          {register.isError && (
            <>
              <p className="tx-status is-problem" role="alert">
                {isApiError(register.error)
                  ? (register.error.recovery ?? register.error.message)
                  : 'Boundra could not verify your executor yet.'}
              </p>
              <button className="button button-quiet" onClick={() => register.mutate()}>
                Verify again
              </button>
            </>
          )}
        </Item>
      </ol>
    </section>
  );
}
