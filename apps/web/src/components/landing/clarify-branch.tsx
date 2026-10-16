'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Check } from './icons';
import { Mascot } from './mascot';
import { RibbonAnchor } from './ribbon-anchor';

type Answer = 'no_lockup' | 'up_to_30_days' | 'unsure';

/** Labels and outcomes mirror ACCE's `max_lockup_seconds` dimension (packages/acce). */
const answers: { id: Answer; label: string }[] = [
  { id: 'no_lockup', label: 'No, I need to be able to withdraw' },
  { id: 'up_to_30_days', label: 'Yes, a lockup of up to 30 days is fine' },
  { id: 'unsure', label: 'I am not sure' },
];

const timedOutcome: Record<
  Answer,
  { tone: 'amber' | 'pending'; status: string; reason: string; result: string }
> = {
  no_lockup: {
    tone: 'amber',
    status: 'Not eligible · 30-day lockup',
    reason: 'Conflicts with your need to withdraw.',
    result: 'Mandate target: LiquidVault only.',
  },
  up_to_30_days: {
    tone: 'pending',
    status: 'Needs one more answer',
    reason: 'Eligible only if you won’t need these funds within 30 days.',
    result: 'Next question: how soon might you need the funds?',
  },
  unsure: {
    tone: 'amber',
    status: 'Not eligible · 30-day lockup',
    reason: 'An unknown answer narrows authority. Lockup vaults stay excluded.',
    result: 'Mandate target: LiquidVault only.',
  },
};

export function ClarifyBranch() {
  const [answer, setAnswer] = useState<Answer>('no_lockup');
  const [thinking, setThinking] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const outcome = timedOutcome[answer];

  // Switch to the thinking pose only after the question is on screen.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let timer = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        timer = window.setTimeout(() => setThinking(true), 450);
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(stage);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="clarify-grid">
      <div className="clarify-copy" data-reveal>
        <p className="eyebrow">Clarification</p>
        <h2 className="display">Only ask what changes the action.</h2>
        <p className="lede">
          Boundra asks about a preference only when the answer changes what the agent may do.
          Everything else stays at its most conservative default.
        </p>
        <fieldset className="question-card">
          <legend>Example question · try an answer</legend>
          <p className="question-text">
            Would you accept not being able to withdraw these funds for 30 days in exchange for a
            higher illustrative yield?
          </p>
          <div className="answers">
            {answers.map(({ id, label }) => (
              <label key={id} className="answer">
                <input
                  type="radio"
                  name="lockup"
                  value={id}
                  checked={answer === id}
                  onChange={() => setAnswer(id)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="branch-stage" ref={stageRef}>
        <RibbonAnchor order={400} x="40%" y="20%" only="desktop" />
        <RibbonAnchor order={410} x="40%" y="31%" only="desktop" dir="v" />
        <RibbonAnchor order={420} x="22%" y="58%" only="desktop" />
        <RibbonAnchor order={430} x="46%" y="94%" only="desktop" dir="v" />
        <RibbonAnchor
          ribbon="branch"
          order={10}
          x="40%"
          y="31%"
          only="desktop"
          dir="v"
          tone={outcome.tone}
        />
        <RibbonAnchor ribbon="branch" order={20} x="76%" y="58%" only="desktop" />
        <RibbonAnchor ribbon="branch" order={30} x="46%" y="94%" only="desktop" dir="v" />

        <div className="branch-mascot" data-ambient>
          <Mascot id="clarify" pose={thinking ? 'thinking' : 'neutral'} />
        </div>

        <div className="branch-results" aria-live="polite">
          <article className="vault-card vault-eligible">
            <span className="vault-icon">
              <Check />
            </span>
            <div>
              <h3>
                LiquidVault <span>· Eligible</span>
              </h3>
              <p>No lockup — you can withdraw any time.</p>
            </div>
          </article>
          <article
            key={answer}
            className={`vault-card vault-${outcome.tone === 'amber' ? 'ineligible' : 'pending'}`}
          >
            <span className="vault-icon">
              {outcome.tone === 'amber' ? <Alert /> : <span className="vault-ellipsis">…</span>}
            </span>
            <div>
              <h3>
                TimedVault <span>· {outcome.status}</span>
              </h3>
              <p>{outcome.reason}</p>
            </div>
          </article>
          <p className="branch-result">{outcome.result}</p>
        </div>
      </div>
    </div>
  );
}
