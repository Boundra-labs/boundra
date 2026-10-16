'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { isApiError } from '@/lib/api';
import { answerLabel, DIMENSION_TITLES, illustrativeYield, UNSURE, VAULTS } from '@/lib/acce-copy';
import { useAnswer, useIntent, type ActiveQuestion, type IntentView } from '@/lib/intents';
import { useOwnerSession } from './access-gate';

const STALE_NOTICE =
  'That question was already answered, perhaps in another tab, so your choice was not saved. Here is the latest state.';

function QuestionForm({
  intent,
  question,
  onStale,
}: {
  intent: IntentView;
  question: ActiveQuestion;
  /** The answer lost to one given elsewhere; the parent keeps the notice across the refresh. */
  onStale: (stale: boolean) => void;
}) {
  const session = useOwnerSession();
  const answer = useAnswer(intent.id, session.csrfToken);
  const [choice, setChoice] = useState<string | null>(null);
  const options = question.alternatives.filter((alt) => alt.id !== UNSURE);
  const unsure = question.alternatives.find((alt) => alt.id === UNSURE);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!choice) return;
    answer.mutate(
      { questionId: question.questionId, alternativeId: choice },
      {
        onSuccess: () => {
          setChoice(null);
          onStale(false);
        },
        onError: (error) =>
          onStale(isApiError(error, 'QUESTION_NOT_ACTIVE') || isApiError(error, 'INVALID_STATE')),
      },
    );
  }

  const option = (alt: { id: string; label: string }, hint?: string) => (
    <label key={alt.id} className={`option${choice === alt.id ? ' is-chosen' : ''}`}>
      <input
        type="radio"
        name={question.questionId}
        value={alt.id}
        checked={choice === alt.id}
        onChange={() => setChoice(alt.id)}
      />
      <span className="option-text">
        <span>{alt.label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );

  return (
    <form className="question" onSubmit={submit} aria-busy={answer.isPending}>
      <fieldset disabled={answer.isPending}>
        <legend>
          <span className="question-count">Question {question.order}</span>
          {question.text}
        </legend>
        <div className="options">
          {options.map((alt) => option(alt))}
          {unsure && option(unsure, 'Boundra will use the more cautious limit.')}
        </div>
      </fieldset>
      {question.wordingSource === 'LLM' && (
        <p className="field-note">Worded by AI from a reviewed template; the options are fixed.</p>
      )}
      {answer.isError &&
        !isApiError(answer.error, 'QUESTION_NOT_ACTIVE') &&
        !isApiError(answer.error, 'INVALID_STATE') && (
          <p role="alert" className="gate-problem">
            {isApiError(answer.error)
              ? (answer.error.recovery ?? answer.error.message)
              : 'Your answer was not saved. Try again.'}
          </p>
        )}
      <button className="button" disabled={!choice || answer.isPending}>
        {answer.isPending ? 'Saving…' : 'Continue'}
      </button>
    </form>
  );
}

function Outcome({ intent }: { intent: IntentView }) {
  if (intent.state === 'ESCALATED' || intent.selection.action === 'ESCALATE')
    return (
      <section className="outcome is-escalated" aria-labelledby="outcome-heading">
        <h2 id="outcome-heading">Nothing will be delegated</h2>
        <p>{intent.selection.reason}</p>
        <Link className="button button-quiet" href="/app">
          Start a different goal
        </Link>
      </section>
    );
  return (
    <section className="outcome" aria-labelledby="outcome-heading">
      <h2 id="outcome-heading">Clarification complete</h2>
      <p>
        {intent.selection.action === 'DEPOSIT' && (
          <strong>Deposit into {VAULTS[intent.selection.vault].name}. </strong>
        )}
        {intent.selection.reason}
      </p>
      <p className="field-note">
        Next, you review the exact mandate. Nothing is approved or funded until you sign it.
      </p>
    </section>
  );
}

function Eligibility({ intent }: { intent: IntentView }) {
  return (
    <aside className="panel panel-quiet eligibility" aria-labelledby="eligibility-heading">
      <h2 id="eligibility-heading" className="panel-heading">
        What the agent may do
      </h2>
      <ul className="vaults" aria-live="polite">
        {intent.candidates.map((candidate) => (
          <li key={candidate.vault} className={`vault${candidate.eligible ? ' is-eligible' : ''}`}>
            <div className="vault-head">
              <strong>{VAULTS[candidate.vault].name}</strong>
              <span className={`pill ${candidate.eligible ? 'pill-ok' : 'pill-warn'}`}>
                {candidate.eligible ? 'Eligible' : 'Not eligible'}
              </span>
            </div>
            <p className="vault-meta">
              {VAULTS[candidate.vault].summary} ·{' '}
              {illustrativeYield(candidate.illustrativeYieldBps)} illustrative
            </p>
            {!candidate.eligible && (
              <ul className="reasons">
                {candidate.reasons.map((reason) => (
                  <li key={reason.code}>{reason.message}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {intent.conflicts.map((conflict) => (
        <p key={conflict.code} className="gate-problem">
          {conflict.message}
        </p>
      ))}

      {intent.narrowed.length > 0 && (
        <div className="narrowed">
          <h3>Kept cautious</h3>
          <ul>
            {intent.narrowed.map((item) => (
              <li key={item.dimension}>
                <strong>{DIMENSION_TITLES[item.dimension] ?? item.dimension}:</strong> {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="field-note">
        Recomputed after every answer. An unknown answer can only narrow what the agent may do. The
        mock vaults pay no yield.
      </p>
    </aside>
  );
}

export function Clarify({ intentId }: { intentId: string }) {
  const intent = useIntent(intentId);
  const [stale, setStale] = useState(false);

  if (intent.isPending)
    return (
      <div className="gate-loading" role="status">
        Loading your goal…
      </div>
    );
  if (intent.isError)
    return (
      <section className="gate-card" aria-labelledby="intent-missing">
        <h1 id="intent-missing" className="gate-title">
          {isApiError(intent.error, 'NOT_FOUND')
            ? 'This goal isn’t available'
            : 'Your goal could not be loaded'}
        </h1>
        <p className="gate-lede">
          {isApiError(intent.error, 'NOT_FOUND')
            ? 'It may belong to another wallet, or the link is wrong.'
            : 'Check your connection and try again.'}
        </p>
        <Link className="button" href="/app">
          Start a new goal
        </Link>
      </section>
    );

  const view = intent.data;
  const clarifying = view.state === 'CLARIFYING' && view.question;
  return (
    <div className="flow">
      <section className="panel" aria-labelledby="intent-heading">
        <p className="gate-eyebrow">New mandate · Step 2 of 3 · Clarify</p>
        <h1 id="intent-heading" className="gate-title intent-title">
          {view.objective}
        </h1>
        <p className="intent-meta">
          {view.amount.display} · Base Sepolia testnet ·{' '}
          <Link href="/app" className="text-link">
            Start over
          </Link>
        </p>

        {view.answered.length > 0 && (
          <ol className="answered" aria-label="Your answers">
            {view.answered.map((item) => (
              <li key={item.questionId}>
                <span className="answered-q">{item.text}</span>
                <span className="answered-a">
                  {answerLabel(item.answerId)}
                  {item.status === 'UNKNOWN' && (
                    <span className="pill pill-quiet">Most cautious limit applied</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}

        {stale && (
          <p role="alert" className="gate-problem">
            {STALE_NOTICE}
          </p>
        )}
        {clarifying ? (
          <QuestionForm
            key={view.question!.questionId}
            intent={view}
            question={view.question!}
            onStale={setStale}
          />
        ) : (
          <Outcome intent={view} />
        )}
      </section>
      <Eligibility intent={view} />
    </div>
  );
}
