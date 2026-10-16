import { ArrowRight, Sparkle } from './icons';
import { RibbonAnchor } from './ribbon-anchor';

/**
 * The intent field sits on the ribbon. Submitting opens the app with the goal filled in; nothing
 * is sent to Boundra until the owner signs in and continues there.
 */
export function IntentField() {
  return (
    <form id="intent" className="intent" action="/app" method="get">
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
        />
        <button type="submit" className="intent-submit" aria-label="Start with this goal">
          <ArrowRight />
        </button>
      </div>
      <p className="intent-disclosure">Base Sepolia · Mock assets only</p>
    </form>
  );
}
