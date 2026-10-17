'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Address, Hash } from 'viem';
import { VAULTS } from '@/lib/acce-copy';
import { describeActivity } from '@/lib/activity-copy';
import { formatMockUsdc } from '@/lib/amount';
import { executorAbi } from '@/lib/contracts';
import {
  ACTIVITY_KEY,
  DASHBOARD_KEY,
  useActivity,
  useDashboard,
  type ChainSnapshot,
  type Dashboard as DashboardData,
} from '@/lib/dashboard';
import {
  isBusy,
  useOwnerTransaction,
  type ContractRequest,
  type RevertExplainer,
} from '@/lib/transactions';
import { useOwnerSession } from './access-gate';
import { shortAddress } from './format';
import { TransactionStatus, TxLink } from './transaction-status';

const dateText = (seconds: string | number) =>
  new Date(Number(seconds) * 1000).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

const explainOwnerAction: RevertExplainer = (name) =>
  ({
    OwnerOnly: 'Only the wallet that created this executor can do this. Switch back to it.',
    InactiveMandate:
      'This mandate can’t be resumed: it was revoked or has expired. Draft a new mandate instead.',
    PositionLocked: 'This vault position is still locked, so it can’t be withdrawn yet.',
    InsufficientCapacity:
      'The vault can’t pay out this amount right now. Try a smaller amount or again later.',
    InsufficientPrincipal: 'Your executor has less in this vault than that amount.',
    TargetNotAllowed: 'That vault is not one of Boundra’s reviewed vaults.',
    InvalidAmount: 'The amount must be more than zero.',
  })[name];

type AgentState = { label: string; tone: 'good' | 'warn' | 'neutral'; detail: string };

/** What the agent may do right now, from the API's record and the confirmed chain state. */
function agentState(data: DashboardData): AgentState {
  const m = data.mandate!;
  const chain = data.chain;
  if (m.status === 'PREVIEWED')
    return { label: 'Draft awaiting review', tone: 'neutral', detail: 'Nothing is active yet.' };
  if (m.status === 'APPROVED')
    return {
      label: 'Approved · not yet authorized',
      tone: 'neutral',
      detail: 'Authorize it in your wallet; the agent cannot act before then.',
    };
  if (m.status === 'REVOKED' || chain?.revoked)
    return {
      label: 'Revoked',
      tone: 'warn',
      detail: 'The agent can never act on this mandate again.',
    };
  if (m.status === 'EXPIRED' || Number(m.tuple.expiresAt) * 1000 <= Date.now())
    return {
      label: 'Expired',
      tone: 'neutral',
      detail: 'The agent can no longer act. Locked funds stay locked until they unlock.',
    };
  if (chain?.paused)
    return {
      label: 'Paused',
      tone: 'warn',
      detail: 'The agent takes no new actions until you resume.',
    };
  if (m.status === 'AUTHORIZED')
    return {
      label: 'Active',
      tone: 'good',
      detail: `The agent may act within your mandate until ${dateText(m.tuple.expiresAt)}.`,
    };
  return { label: m.status.toLowerCase(), tone: 'neutral', detail: '' };
}

function Funds({ chain }: { chain: ChainSnapshot }) {
  const vaults = [
    { key: 'LIQUID' as const, position: chain.positions[0] },
    { key: 'TIMED' as const, position: chain.positions[1] },
  ];
  return (
    <div className="review-section">
      <h2 className="review-heading">Funds</h2>
      <dl className="funds">
        <div>
          <dt>Idle in your executor</dt>
          <dd>{formatMockUsdc(chain.idle.baseUnits)}</dd>
        </div>
        {vaults.map(({ key, position }) => {
          const locked = Number(position.unlockAt) * 1000 > Date.now();
          return (
            <div key={key}>
              <dt>
                {VAULTS[key].name}
                {position.risk === 'DEGRADED' && (
                  <span className="pill pill-warn">Risk warning</span>
                )}
              </dt>
              <dd>
                {formatMockUsdc(position.principal)}
                <small>
                  {BigInt(position.principal) === 0n
                    ? 'No position'
                    : locked
                      ? `Locked until ${dateText(position.unlockAt)}`
                      : `${formatMockUsdc(position.withdrawable)} withdrawable`}
                </small>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="field-note">
        Confirmed at block {chain.blockNumber}. Mock vaults hold principal 1:1 and pay no yield; a
        risk warning is a signal to re-evaluate, not proof of loss.
      </p>
    </div>
  );
}

function ControlButton({
  label,
  confirmedText,
  request,
  owner,
  onConfirmed,
  quiet,
}: {
  label: string;
  confirmedText: string;
  request: ContractRequest;
  owner: Address;
  onConfirmed: (text: string, hash: Hash) => void;
  quiet?: boolean;
}) {
  const tx = useOwnerTransaction(owner, explainOwnerAction);
  return (
    <div className="control">
      <button
        className={`button${quiet ? ' button-quiet' : ''}`}
        disabled={isBusy(tx.state)}
        onClick={() =>
          void tx.send(request).then((state) => {
            if (state.phase === 'confirmed') onConfirmed(confirmedText, state.hash);
          })
        }
      >
        {label}
      </button>
      {tx.state.phase !== 'confirmed' && (
        <TransactionStatus state={tx.state} confirmedText={confirmedText} />
      )}
    </div>
  );
}

/** Owner controls: always the owner's own wallet transactions; the agent cannot use them. */
function Controls({
  data,
  owner,
  onConfirmed,
  notice,
}: {
  data: DashboardData;
  owner: Address;
  onConfirmed: (text: string, hash: Hash) => void;
  /** The last confirmed owner action; kept even after its button disappears. */
  notice: { text: string; hash: Hash } | null;
}) {
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const chain = data.chain!;
  const executor = data.executor as Address;
  const m = data.mandate;
  const hasMandate = Number(chain.mandateVersion) > 0;
  const expired = m ? Number(m.tuple.expiresAt) * 1000 <= Date.now() : true;
  const idle = BigInt(chain.idle.baseUnits);
  const vaultTargets = [
    { key: 'LIQUID' as const, position: chain.positions[0] },
    { key: 'TIMED' as const, position: chain.positions[1] },
  ].filter(({ position }) => BigInt(position.withdrawable) > 0n);
  const common = { owner, onConfirmed };

  return (
    <aside className="panel panel-quiet controls" aria-labelledby="controls-heading">
      <h2 id="controls-heading" className="panel-heading">
        Your controls
      </h2>
      <p className="field-note">
        Only your wallet can use these. They stop new agent actions; confirmed transactions are not
        undone.
      </p>
      {notice && (
        <p className="tx-status is-confirmed" role="status">
          {notice.text} (<TxLink hash={notice.hash} />)
        </p>
      )}

      {hasMandate && !chain.revoked && !chain.paused && (
        <ControlButton
          {...common}
          label="Pause the agent"
          confirmedText="Paused."
          request={{ address: executor, abi: executorAbi, functionName: 'pause' }}
        />
      )}
      {hasMandate && !chain.revoked && chain.paused && !expired && (
        <ControlButton
          {...common}
          label="Resume the agent"
          confirmedText="Resumed."
          request={{ address: executor, abi: executorAbi, functionName: 'resume' }}
        />
      )}
      {hasMandate && !chain.revoked && (
        <div className="control">
          {confirmRevoke ? (
            <div className="confirm" role="group" aria-label="Confirm revoke">
              <p>
                Revoke permanently? The agent can never act on this mandate again. Your funds stay
                yours.
              </p>
              <ControlButton
                {...common}
                label="Yes, revoke"
                confirmedText="Revoked."
                request={{ address: executor, abi: executorAbi, functionName: 'revoke' }}
              />
              <button className="button button-quiet" onClick={() => setConfirmRevoke(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="button button-quiet" onClick={() => setConfirmRevoke(true)}>
              Revoke the mandate…
            </button>
          )}
        </div>
      )}

      <h3 className="controls-subheading">Take funds back</h3>
      {idle > 0n ? (
        <ControlButton
          {...common}
          quiet
          label={`Withdraw ${formatMockUsdc(idle)} idle`}
          confirmedText="Idle funds returned to your wallet."
          request={{
            address: executor,
            abi: executorAbi,
            functionName: 'recoverIdle',
            args: [idle],
          }}
        />
      ) : null}
      {vaultTargets.map(({ key, position }) => (
        <ControlButton
          key={key}
          {...common}
          quiet
          label={`Withdraw ${formatMockUsdc(position.withdrawable)} from ${VAULTS[key].name}`}
          confirmedText={`Withdrawn from ${VAULTS[key].name} to your wallet.`}
          request={{
            address: executor,
            abi: executorAbi,
            functionName: 'ownerWithdraw',
            args: [position.address as Address, BigInt(position.withdrawable)],
          }}
        />
      ))}
      {idle === 0n && vaultTargets.length === 0 && (
        <p className="field-note">Nothing is withdrawable right now.</p>
      )}
    </aside>
  );
}

function Activity() {
  const activity = useActivity();
  const items = activity.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="panel activity" aria-labelledby="activity-heading">
      <h2 id="activity-heading" className="panel-heading">
        Activity
      </h2>
      {activity.isPending && <p className="field-note">Loading activity…</p>}
      {activity.isError && <p className="field-note">Activity could not be loaded right now.</p>}
      {activity.isSuccess && items.length === 0 && (
        <p className="field-note">Nothing has happened yet.</p>
      )}
      <ol className="timeline">
        {items.map((item) => {
          const described = describeActivity(item);
          return (
            <li key={item.id} className={`timeline-item is-${described.tone}`}>
              <span className="timeline-dot" aria-hidden="true" />
              <div>
                <p className="timeline-title">{described.title}</p>
                {described.detail && <p className="timeline-detail">{described.detail}</p>}
                <p className="timeline-meta">
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString('en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </time>
                  {item.txHash && item.explorerUrl && (
                    <>
                      {' · '}
                      <a href={item.explorerUrl} target="_blank" rel="noreferrer" className="mono">
                        {item.txHash.slice(0, 10)}…
                      </a>
                    </>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {activity.hasNextPage && (
        <button
          className="button button-quiet"
          disabled={activity.isFetchingNextPage}
          onClick={() => void activity.fetchNextPage()}
        >
          {activity.isFetchingNextPage ? 'Loading…' : 'Show older activity'}
        </button>
      )}
    </section>
  );
}

/** The owner's overview once a mandate exists: agent status, funds, controls and activity. */
export function Dashboard() {
  const session = useOwnerSession();
  const queryClient = useQueryClient();
  // After an owner action, keep re-reading briefly: the API reads at its confirmation depth.
  const [catchingUp, setCatchingUp] = useState(false);
  const [notice, setNotice] = useState<{ text: string; hash: Hash } | null>(null);
  const dashboard = useDashboard({ pollMs: catchingUp ? 2000 : undefined });
  useEffect(() => {
    if (!catchingUp) return;
    const timer = setTimeout(() => setCatchingUp(false), 20_000);
    return () => clearTimeout(timer);
  }, [catchingUp]);
  const onConfirmed = (text: string, hash: Hash) => {
    setNotice({ text, hash });
    setCatchingUp(true);
    void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
    void queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY });
  };

  if (dashboard.isPending)
    return (
      <div className="gate-loading" role="status">
        Loading your overview…
      </div>
    );
  if (dashboard.isError || !dashboard.data.mandate)
    return (
      <section className="gate-card">
        <h1 className="gate-title">Your overview could not be loaded</h1>
        <p className="gate-lede">Check your connection and try again.</p>
        <button className="button" onClick={() => void dashboard.refetch()}>
          Try again
        </button>
      </section>
    );

  const data = dashboard.data;
  const m = data.mandate!;
  const state = agentState(data);
  const vault = m.selectedVault ? VAULTS[m.selectedVault] : null;
  return (
    <div className="flow">
      <section className="panel" aria-labelledby="overview-heading">
        <p className="gate-eyebrow">Overview · Base Sepolia testnet</p>
        <h1 id="overview-heading" className="gate-title">
          Your agent
        </h1>
        <div className={`agent-state is-${state.tone}`} role="status">
          <strong>{state.label}</strong>
          <span>{state.detail}</span>
        </div>
        {m.escalationReason && m.status === 'AUTHORIZED' && (
          <p className="gate-problem">
            The agent escalated a decision to you ({m.escalationReason}). It takes no action on it
            until you decide.
          </p>
        )}
        <p className="intent-meta">
          {formatMockUsdc(m.tuple.allocationTarget)}
          {vault && ` into ${vault.name} · ${vault.summary.toLowerCase()}`} · executor{' '}
          {shortAddress(data.executor!)} ·{' '}
          <Link className="text-link" href={`/app/mandates/${m.id}`}>
            {m.status === 'PREVIEWED' || m.status === 'APPROVED' ? 'Continue' : 'View mandate'}
          </Link>
        </p>
        {data.chain ? (
          <Funds chain={data.chain} />
        ) : (
          <p className="gate-problem">
            Chain data is unavailable right now, so balances and controls are hidden. Nothing was
            changed.
          </p>
        )}
        <p className="field-note">
          <Link className="text-link" href="/app?new=1">
            Start a new goal
          </Link>{' '}
          · a new mandate replaces this one once you authorize it.
        </p>
      </section>
      {data.chain && (
        <Controls
          data={data}
          owner={session.address as Address}
          onConfirmed={onConfirmed}
          notice={notice}
        />
      )}
      <Activity />
    </div>
  );
}
