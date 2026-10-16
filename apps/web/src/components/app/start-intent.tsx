'use client';

import { BASE_SEPOLIA_CHAIN_ID } from '@boundra/shared';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { erc20Abi } from 'viem';
import { useReadContract } from 'wagmi';
import { isApiError } from '@/lib/api';
import { formatMockUsdc, parseMockUsdc } from '@/lib/amount';
import { useCreateIntent } from '@/lib/intents';
import { usePublicConfig } from '@/lib/public-config';
import { useOwnerSession } from './access-gate';

const EXAMPLE_GOAL = 'Manage 300 MockUSDC safely';

/** "Manage 300 MockUSDC safely" → "300", so a goal typed on the homepage pre-fills the amount. */
const amountFromGoal = (goal: string) =>
  goal.match(/(\d+(?:\.\d+)?)\s*(?:mock\s*)?usdc/i)?.[1] ?? '';

function WalletBalance({ owner, amount }: { owner: `0x${string}`; amount: bigint | null }) {
  const config = usePublicConfig();
  const token = config.data?.contracts?.mockUsdc;
  const balance = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
    chainId: BASE_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(token) },
  });

  if (config.data && !config.data.configured)
    return (
      <p className="field-note is-warning">
        The Boundra contracts are not configured on this server yet, so balances can’t be read and
        new intents can’t be checked against them.
      </p>
    );
  if (config.isError || balance.isError)
    return <p className="field-note">Your MockUSDC balance could not be read right now.</p>;
  if (balance.data === undefined) return <p className="field-note">Reading your balance…</p>;
  return (
    <p className={`field-note${amount !== null && amount > balance.data ? ' is-warning' : ''}`}>
      Wallet balance: <strong>{formatMockUsdc(balance.data)}</strong>
      {amount !== null &&
        amount > balance.data &&
        ' · This is more than your wallet holds; MockUSDC already in your executor also counts.'}
    </p>
  );
}

function createProblem(error: unknown) {
  if (isApiError(error, 'VALIDATION_FAILED')) return 'Check the goal and amount, then try again.';
  if (isApiError(error))
    return error.recovery ? `${error.message}. ${error.recovery}` : error.message;
  return 'Something went wrong. Try again.';
}

export function StartIntent({ initialGoal }: { initialGoal: string }) {
  const session = useOwnerSession();
  const router = useRouter();
  const create = useCreateIntent(session.csrfToken);
  const [objective, setObjective] = useState(initialGoal);
  const [amountText, setAmountText] = useState(() => amountFromGoal(initialGoal));
  const [touched, setTouched] = useState(false);
  const goalId = useId();
  const amountId = useId();

  const amount = parseMockUsdc(amountText);
  const goalMissing = objective.trim().length === 0;
  const amountProblem = !amount.ok
    ? amount.reason === 'EMPTY'
      ? 'Enter how much MockUSDC to delegate.'
      : amount.reason === 'ZERO'
        ? 'The amount must be more than zero.'
        : 'Use a number with up to 6 decimals, like 300 or 12.5.'
    : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (goalMissing || !amount.ok) return;
    create.mutate(
      { objective: objective.trim(), amount: amount.baseUnits },
      { onSuccess: (view) => router.push(`/app/intents/${view.id}`) },
    );
  }

  return (
    <div className="flow">
      <section className="panel" aria-labelledby="start-heading">
        <p className="gate-eyebrow">New mandate · Step 1 of 3</p>
        <h1 id="start-heading" className="gate-title">
          What should your agent do?
        </h1>
        <p className="gate-lede">
          Describe the goal and the amount. Boundra then asks only the questions that change what
          the agent may do.
        </p>

        <form className="form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor={goalId}>Your goal</label>
            <textarea
              id={goalId}
              rows={3}
              maxLength={2000}
              placeholder={EXAMPLE_GOAL}
              value={objective}
              aria-invalid={touched && goalMissing}
              aria-describedby={touched && goalMissing ? `${goalId}-error` : undefined}
              onChange={(event) => {
                setObjective(event.target.value);
                if (!amountText) setAmountText(amountFromGoal(event.target.value));
              }}
            />
            {touched && goalMissing && (
              <p id={`${goalId}-error`} className="field-error">
                Describe what you want the agent to do.
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor={amountId}>Amount to delegate</label>
            <div className="amount-input">
              <input
                id={amountId}
                inputMode="decimal"
                autoComplete="off"
                placeholder="300"
                value={amountText}
                aria-invalid={touched && !amount.ok}
                aria-describedby={`${amountId}-note${touched && amountProblem ? ` ${amountId}-error` : ''}`}
                onChange={(event) => setAmountText(event.target.value)}
              />
              <span aria-hidden="true">MockUSDC</span>
            </div>
            {touched && amountProblem && (
              <p id={`${amountId}-error`} className="field-error">
                {amountProblem}
              </p>
            )}
            <div id={`${amountId}-note`}>
              <WalletBalance
                owner={session.address as `0x${string}`}
                amount={amount.ok ? BigInt(amount.baseUnits) : null}
              />
            </div>
          </div>

          {create.isError && (
            <p role="alert" className="gate-problem">
              {createProblem(create.error)}
            </p>
          )}

          <button className="button button-lg" disabled={create.isPending || create.isSuccess}>
            {create.isPending || create.isSuccess ? 'Checking your goal…' : 'Continue'}
          </button>
        </form>
      </section>

      <aside className="panel panel-quiet" aria-labelledby="how-heading">
        <h2 id="how-heading" className="panel-heading">
          How it works
        </h2>
        <ol className="how-list">
          <li>
            <strong>Clarify.</strong> Up to five questions, and only when your answer changes what
            the agent may do. “I am not sure” always picks the more cautious limit.
          </li>
          <li>
            <strong>Review.</strong> You see the exact mandate: vault, amounts and expiry.
          </li>
          <li>
            <strong>Authorize.</strong> Nothing is enforced until you sign it with your wallet.
          </li>
        </ol>
        <p className="field-note">
          Base Sepolia testnet · MockUSDC and mock vaults · yields are illustrative only.
        </p>
      </aside>
    </div>
  );
}
