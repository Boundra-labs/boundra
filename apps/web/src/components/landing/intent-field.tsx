'use client';

import { useState } from 'react';
import { ArrowRight, Sparkle } from './icons';
import { RibbonAnchor } from './ribbon-anchor';

/**
 * The intent field sits on the ribbon. The mandate builder is not open yet, so submitting keeps
 * the goal in this tab, says plainly that nothing was sent, and points to the explained flow.
 */
export function IntentField() {
  const [submitted, setSubmitted] = useState(false);
  return (
    <form
      id="intent"
      className="intent"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <label className="intent-label" htmlFor="intent-goal">
        Create your mandate
      </label>
      <div className="intent-field">
        <RibbonAnchor order={110} x="0%" y="50%" dir="h" only="desktop" />
        <RibbonAnchor order={120} x="100%" y="50%" dir="h" only="desktop" />
        <Sparkle className="intent-spark" />
        <input
          id="intent-goal"
          name="goal"
          defaultValue="Manage 300 MockUSDC safely"
          autoComplete="off"
          maxLength={160}
          onChange={() => setSubmitted(false)}
        />
        <button type="submit" className="intent-submit" aria-label="Start with this goal">
          <ArrowRight />
        </button>
      </div>
      <p className="intent-disclosure">Base Sepolia · Mock assets only</p>
      <p className="intent-status" role="status">
        {submitted && (
          <>
            The mandate builder is coming next — nothing was sent or signed.{' '}
            <a href="#journey">See what Boundra will do with this goal</a>
          </>
        )}
      </p>
    </form>
  );
}
