'use client';

import { MOCK_USDC_DECIMALS } from '@boundra/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { formatUnits } from 'viem';
import { answerLabel, DIMENSION_TITLES, illustrativeYield, VAULTS } from '@/lib/acce-copy';
import { isApiError } from '@/lib/api';
import { formatMockUsdc, parseMockUsdc } from '@/lib/amount';
import {
  DAY_SECONDS,
  expiryBounds,
  isEscalation,
  useApprove,
  useMandate,
  useReviseDraft,
  type MandateView,
} from '@/lib/mandates';
import { useOwnerSession } from './access-gate';
import { Authorize } from './authorize';
import { shortAddress } from './format';

const STATUS_TEXT: Record<string, string> = {
  PREVIEWED: 'Ready for review',
  APPROVED: 'Approved · not yet authorized',
  AUTHORIZED: 'Authorized on chain',
  SUPERSEDED: 'Replaced by a newer revision',
  REVOKED: 'Revoked',
  EXPIRED: 'Expired',
};

const lockupText = (seconds: string) =>
  Number(seconds) === 0 ? 'None · withdraw at any time' : `${Number(seconds) / DAY_SECONDS} days`;

const dateText = (seconds: string) =>
  new Date(Number(seconds) * 1000).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

const daysFromNow = (seconds: string) =>
  Math.max(0, Math.round((Number(seconds) * 1000 - Date.now()) / (DAY_SECONDS * 1000)));

function Address({ value, you }: { value: string; you?: boolean }) {
  return (
    <span title={value} className="mono">
      {shortAddress(value)}
      {you && <span className="you"> · you</span>}
    </span>
  );
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mandate-row">
      <dt>{label}</dt>
      <dd>
        {children}
        {hint && <small>{hint}</small>}
      </dd>
    </div>
  );
}

/** Every field the owner is agreeing to, in the order they would ask about it. */
function MandateSheet({ view }: { view: MandateView }) {
  const p = view.preview;
  const amount = (value: string) => formatMockUsdc(value);
  return (
    <div className="mandate-sheet">
      <h2 className="review-heading">The mandate</h2>
      <dl>
        <Row label="Owner">
          <Address value={p.owner} you />
        </Row>
        {p.operatorSource === 'OWNER' ? (
          <Row
            label="Agent (operator)"
            hint="An agent you chose. Boundra does not run it or vouch for it; it can still only call deposit and withdraw within these limits."
          >
            <Address value={p.operator} /> · your own agent
          </Row>
        ) : (
          <Row
            label="Agent (operator)"
            hint="Boundra’s agent. Can only call deposit and withdraw on your executor."
          >
            <Address value={p.operator} />
          </Row>
        )}
        <Row label="Executor" hint="Holds the funds you delegate; only you control its mandate.">
          {p.executor ? <Address value={p.executor} /> : 'Not registered'}
        </Row>
        <Row label="Withdrawals go to" hint="The agent cannot change the recipient.">
          <Address value={p.beneficiary} you={p.beneficiary === p.owner} />
        </Row>
        <Row label="Network">
          {p.network.name} · chain {p.network.chainId}
        </Row>
        <Row label="Token">
          {p.token.symbol} <Address value={p.token.address} />
        </Row>
        <Row
          label="Vault"
          hint={`${illustrativeYield(p.target.illustrativeYieldBps)} illustrative · the mock vault pays nothing`}
        >
          {p.target.name} <Address value={p.target.address} />
        </Row>
        <Row label="Allowed actions">
          {p.allowedActions.map((a) => (a === 'DEPOSIT' ? 'Deposit' : 'Withdraw')).join(' · ')}
        </Row>
        <Row label="Amount to allocate">{amount(p.limits.allocationTarget)}</Row>
        <Row label="Per-deposit limit">{amount(p.limits.maxDepositPerAction)}</Row>
        <Row label="Total deposit budget" hint="Withdrawals never restore it.">
          {amount(p.limits.maxCumulativeDeposits)}
        </Row>
        <Row label="Per-withdrawal limit">{amount(p.limits.maxWithdrawPerAction)}</Row>
        <Row label="Maximum lockup">{lockupText(p.limits.maxLockupSeconds)}</Row>
        <Row label="Expires" hint="After this the agent cannot act; locked funds stay locked.">
          {dateText(p.expiresAt)} · in {daysFromNow(p.expiresAt)} days
        </Row>
        <Row label="Version">
          Revision {view.revision} · {p.version} ·{' '}
          <span className="mono" title={view.previewHash}>
            {view.previewHash.slice(0, 10)}…
          </span>
        </Row>
      </dl>
    </div>
  );
}

function Why({ view }: { view: MandateView }) {
  const p = view.preview;
  return (
    <div className="review-section">
      <h2 className="review-heading">Why {p.target.name}</h2>
      <p>{p.selection.reason}</p>
      <ul className="review-list">
        {p.preferences.map((pref) => (
          <li key={pref.dimension}>
            <strong>{DIMENSION_TITLES[pref.dimension] ?? pref.dimension}: </strong>
            {pref.source === 'ANSWERED'
              ? answerLabel(pref.answer)
              : pref.source === 'UNKNOWN'
                ? 'Not sure · the most cautious limit applies'
                : 'Not asked · the default limit applies'}
            <small>{pref.enforcement}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notices({ notices }: { notices: string[] }) {
  return (
    <div className="review-section">
      <h2 className="review-heading">Before you approve</h2>
      <ul className="notices">
        {notices.map((notice) => (
          <li key={notice}>{notice}</li>
        ))}
      </ul>
    </div>
  );
}

const CAP_PROBLEM: Record<string, string> = {
  EXPIRY_TOO_SHORT: 'That expiry is too short for this vault.',
  EXPIRY_TOO_LONG: 'Expiry can be at most 60 days.',
  INVALID_DEPOSIT_CAP: 'The per-deposit limit must be more than zero and at most the amount.',
  INVALID_WITHDRAW_CAP: 'The per-withdrawal limit must be more than zero and at most the amount.',
};

function reviseProblem(error: unknown) {
  if (isApiError(error, 'VALIDATION_FAILED')) {
    const code = error.message.match(/Invalid mandate: (\w+)/)?.[1];
    return (code && CAP_PROBLEM[code]) ?? 'Check the limits and try again.';
  }
  if (isApiError(error))
    return error.recovery ? `${error.message}. ${error.recovery}` : error.message;
  return 'The revision could not be created. Try again.';
}

/** Expiry and per-action limits. Saving creates a new revision that must be reviewed again. */
function EditLimits({ view }: { view: MandateView }) {
  const session = useOwnerSession();
  const router = useRouter();
  const revise = useReviseDraft(view.id, session.csrfToken);
  const id = useId();
  const bounds = expiryBounds(view.preview.limits.maxLockupSeconds);
  const plain = (value: string) => formatUnits(BigInt(value), MOCK_USDC_DECIMALS);
  const [days, setDays] = useState(String(daysFromNow(view.tuple.expiresAt)));
  const [deposit, setDeposit] = useState(plain(view.tuple.maxDepositPerAction));
  const [withdraw, setWithdraw] = useState(plain(view.tuple.maxWithdrawPerAction));
  const [touched, setTouched] = useState(false);

  const amount = BigInt(view.preview.limits.allocationTarget);
  const dayCount = Number(days);
  const daysProblem =
    !Number.isInteger(dayCount) || dayCount < bounds.min || dayCount > bounds.max
      ? `Choose ${bounds.min}–${bounds.max} days${bounds.min > 1 ? ` (${view.preview.target.name} locks funds for 30 days)` : ''}.`
      : null;
  const cap = (text: string) => {
    const parsed = parseMockUsdc(text);
    return parsed.ok && BigInt(parsed.baseUnits) <= amount ? parsed.baseUnits : null;
  };
  const depositCap = cap(deposit);
  const withdrawCap = cap(withdraw);
  const capProblem = `Use more than 0 and at most ${formatMockUsdc(amount)}.`;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (daysProblem || !depositCap || !withdrawCap) return;
    revise.mutate(
      { expiryDays: dayCount, maxDepositPerAction: depositCap, maxWithdrawPerAction: withdrawCap },
      {
        onSuccess: (result) => {
          if (!isEscalation(result)) router.replace(`/app/mandates/${result.id}`);
        },
      },
    );
  }

  return (
    <details className="edit-limits">
      <summary>Change expiry or per-action limits</summary>
      {view.status === 'APPROVED' && (
        <p className="field-note is-warning">
          This replaces the revision you approved. You will review and approve the new one.
        </p>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={`${id}-days`}>Expires in (days)</label>
          <div className="amount-input">
            <input
              id={`${id}-days`}
              inputMode="numeric"
              value={days}
              aria-invalid={touched && Boolean(daysProblem)}
              onChange={(event) => setDays(event.target.value)}
            />
            <span aria-hidden="true">days</span>
          </div>
          {touched && daysProblem && <p className="field-error">{daysProblem}</p>}
        </div>
        <div className="field">
          <label htmlFor={`${id}-deposit`}>Per-deposit limit</label>
          <div className="amount-input">
            <input
              id={`${id}-deposit`}
              inputMode="decimal"
              value={deposit}
              aria-invalid={touched && !depositCap}
              onChange={(event) => setDeposit(event.target.value)}
            />
            <span aria-hidden="true">MockUSDC</span>
          </div>
          {touched && !depositCap && <p className="field-error">{capProblem}</p>}
        </div>
        <div className="field">
          <label htmlFor={`${id}-withdraw`}>Per-withdrawal limit</label>
          <div className="amount-input">
            <input
              id={`${id}-withdraw`}
              inputMode="decimal"
              value={withdraw}
              aria-invalid={touched && !withdrawCap}
              onChange={(event) => setWithdraw(event.target.value)}
            />
            <span aria-hidden="true">MockUSDC</span>
          </div>
          {touched && !withdrawCap && <p className="field-error">{capProblem}</p>}
        </div>
        {revise.isError && (
          <p role="alert" className="gate-problem">
            {reviseProblem(revise.error)}
          </p>
        )}
        {revise.data && isEscalation(revise.data) && (
          <p role="alert" className="gate-problem">
            {revise.data.reason}
          </p>
        )}
        <button className="button button-quiet" disabled={revise.isPending}>
          {revise.isPending ? 'Creating a new revision…' : 'Update the preview'}
        </button>
      </form>
    </details>
  );
}

function approveProblem(error: unknown) {
  if (isApiError(error, 'STALE_PREVIEW'))
    return 'This preview changed or is about to expire, so it was not approved. The latest version is shown; review it again.';
  if (isApiError(error, 'INVALID_STATE'))
    return 'This revision can no longer be approved. The latest state is shown.';
  if (isApiError(error))
    return error.recovery ? `${error.message}. ${error.recovery}` : error.message;
  return 'Approval was not recorded. Try again.';
}

/** Records the owner's consent to this exact preview. It does not activate anything. */
function Approve({ view }: { view: MandateView }) {
  const session = useOwnerSession();
  const approve = useApprove(view.id, session.csrfToken);
  const [reviewed, setReviewed] = useState(false);
  return (
    <div className="approve">
      <h2 className="panel-heading">Approve this exact mandate</h2>
      <p className="field-note">
        Approval records your consent to revision {view.revision}. It does not activate the agent or
        move funds: you authorize it in your wallet next.
      </p>
      <label className="consent">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(event) => setReviewed(event.target.checked)}
        />
        <span>
          I reviewed the vault, limits, expiry and notices, including that{' '}
          {view.preview.target.lockupSeconds !== '0'
            ? `${view.preview.target.name} locks funds for 30 days`
            : 'withdrawals always return to my wallet'}
          .
        </span>
      </label>
      <button
        className="button"
        disabled={!reviewed || approve.isPending}
        onClick={() => approve.mutate(view.previewHash)}
      >
        {approve.isPending ? 'Recording approval…' : 'Approve mandate'}
      </button>
      {approve.isError && (
        <p role="alert" className="gate-problem">
          {approveProblem(approve.error)}
        </p>
      )}
    </div>
  );
}

export function MandateReview({ mandateId }: { mandateId: string }) {
  const mandate = useMandate(mandateId);

  if (mandate.isPending)
    return (
      <div className="gate-loading" role="status">
        Loading your mandate…
      </div>
    );
  if (mandate.isError)
    return (
      <section className="gate-card" aria-labelledby="mandate-missing">
        <h1 id="mandate-missing" className="gate-title">
          {isApiError(mandate.error, 'NOT_FOUND')
            ? 'This mandate isn’t available'
            : 'Your mandate could not be loaded'}
        </h1>
        <p className="gate-lede">
          {isApiError(mandate.error, 'NOT_FOUND')
            ? 'It may belong to another wallet, or the link is wrong.'
            : 'Check your connection and try again.'}
        </p>
        <Link className="button" href="/app">
          Back to the app
        </Link>
      </section>
    );

  const view = mandate.data;
  const p = view.preview;
  const reviewable = view.status === 'PREVIEWED';
  return (
    <div className="flow">
      <section className="panel" aria-labelledby="mandate-heading">
        <p className="gate-eyebrow">
          {view.status === 'AUTHORIZED'
            ? 'Active mandate · Base Sepolia testnet'
            : `New mandate · Step 3 of 3 · ${view.status === 'APPROVED' ? 'Authorize' : 'Review'}`}
        </p>
        <h1 id="mandate-heading" className="gate-title">
          {view.status === 'AUTHORIZED'
            ? 'Your mandate'
            : view.status === 'APPROVED'
              ? 'Authorize your mandate'
              : 'Review your mandate'}
        </h1>
        <p className="intent-meta">
          <span className={`pill ${view.status === 'SUPERSEDED' ? 'pill-warn' : 'pill-quiet'}`}>
            {STATUS_TEXT[view.status] ?? view.status}
          </span>{' '}
          {p.labels.map((label) => (
            <span key={label} className="pill pill-quiet">
              {label}
            </span>
          ))}
        </p>

        {view.status === 'SUPERSEDED' && (
          <p role="alert" className="gate-problem">
            A newer revision replaced this one, so it can’t be approved.{' '}
            <Link href={`/app/intents/${view.intentId}`}>Open your goal</Link> to draft the latest
            version.
          </p>
        )}

        {p.plainSummary && (
          <blockquote className="plain-summary">
            <p>{p.plainSummary.text}</p>
            <footer>
              {p.plainSummary.source === 'LLM'
                ? 'Summary written by AI from the exact values below; the values are what you approve.'
                : 'Plain-language summary of the exact values below.'}
            </footer>
          </blockquote>
        )}

        <MandateSheet view={view} />
        <Why view={view} />
        <Notices notices={p.notices} />
      </section>

      <aside className="panel panel-quiet eligibility" aria-label="Approval">
        <p className="approve-amount">
          {p.amount.display}
          <small>
            into {VAULTS[p.target.vault].name} · {VAULTS[p.target.vault].summary.toLowerCase()}
          </small>
        </p>
        {reviewable && <Approve view={view} />}
        {(view.status === 'APPROVED' || view.status === 'AUTHORIZED') && <Authorize view={view} />}
        {(reviewable || view.status === 'APPROVED') && <EditLimits view={view} />}
      </aside>
    </div>
  );
}
