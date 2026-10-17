'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { isApiError } from '@/lib/api';
import { formatMockUsdc, parseMockUsdc } from '@/lib/amount';
import { useCreateIntent } from '@/lib/intents';
import { useOwnerSession } from './access-gate';

const EXAMPLE_GOAL = 'Manage 300 MockUSDC safely';

/** "Manage 300 MockUSDC safely" → "300", so a goal typed on the homepage pre-fills the amount. */
const amountFromGoal = (goal: string) =>
  goal.match(/(\d+(?:\.\d+)?)\s*(?:mock\s*)?usdc/i)?.[1] ?? '';

function Available({ available, amount }: { available?: bigint; amount: bigint | null }) {
  if (available === undefined) return null;
  const over = amount !== null && amount > available;
  return (
    <p className={`field-note${over ? ' is-warning' : ''}`}>
      Available to delegate: <strong>{formatMockUsdc(available)}</strong>
      {over && ' · This is more than you hold in your wallet and executor.'}
    </p>
  );
}

function createProblem(error: unknown) {
  if (isApiError(error, 'VALIDATION_FAILED')) return 'Check the goal and amount, then try again.';
  if (isApiError(error))
    return error.recovery ? `${error.message}. ${error.recovery}` : error.message;
  return 'Something went wrong. Try again.';
}

/** The owner's goal and amount; `available` is wallet plus executor MockUSDC, as the API counts it. */
export function StartIntent({
  initialGoal,
  available,
}: {
  initialGoal: string;
  available?: bigint;
}) {
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
    <section className="panel" aria-labelledby="start-heading">
      <p className="gate-eyebrow">New mandate · Step 1 of 3</p>
      <h1 id="start-heading" className="gate-title">
        What should your agent do?
      </h1>
      <p className="gate-lede">
        Describe the goal and the amount. Boundra then asks only the questions that change what the
        agent may do.
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
            <Available available={available} amount={amount.ok ? BigInt(amount.baseUnits) : null} />
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
  );
}
