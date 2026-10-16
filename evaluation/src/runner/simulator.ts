import type { DimensionId, MandatePreview } from '@boundra/acce';
import type { MandateTuple } from '@boundra/shared';
import type { ActionKey, HiddenPreferences, Persona } from '../fixtures';

/**
 * The only code that reads hidden preferences. Mandate generators receive answers through
 * `answer` and approvals through `consents`; they can never import this module (ESLint rule).
 */
export function answer(hidden: HiddenPreferences, dimension: DimensionId): string {
  switch (dimension) {
    case 'max_lockup_seconds':
      if (hidden.unsureAboutLockup) return 'unsure';
      return hidden.acceptsLockupDays >= 30 ? 'up_to_30_days' : 'no_lockup';
    case 'withdrawal_latency_seconds':
      if (hidden.needsFundsWithinDays === null) return 'unsure';
      return hidden.needsFundsWithinDays < 30 ? 'within_1_day' : 'not_for_30_days';
    case 'permitted_vaults':
      return hidden.permitsTimedVault ? 'any_reviewed' : 'liquid_only';
    case 'leverage':
      return 'no_leverage';
  }
}

export interface Violation {
  preference: 'LOCKUP' | 'LIQUIDITY' | 'PERMITTED_VAULTS' | 'AMOUNT';
  detail: string;
}

/** Evaluator: non-negotiable preferences a mandate breaks (empty = no mismatch). */
export function violations(persona: Persona, tuple: MandateTuple): Violation[] {
  const hidden = persona.hidden;
  const found: Violation[] = [];
  const timedAllowed = (tuple.allowedVaults & 2) !== 0;
  if (timedAllowed && (hidden.unsureAboutLockup || hidden.acceptsLockupDays < 30))
    found.push({
      preference: 'LOCKUP',
      detail: 'Mandate permits a 30-day lockup the persona did not accept',
    });
  if (timedAllowed && hidden.needsFundsWithinDays !== null && hidden.needsFundsWithinDays < 30)
    found.push({
      preference: 'LIQUIDITY',
      detail: 'Mandate can lock funds the persona may need sooner',
    });
  if (timedAllowed && hidden.needsFundsWithinDays === null)
    found.push({
      preference: 'LIQUIDITY',
      detail: 'Persona is unsure about liquidity but funds can be locked',
    });
  if (timedAllowed && !hidden.permitsTimedVault)
    found.push({
      preference: 'PERMITTED_VAULTS',
      detail: 'Mandate targets a vault the persona excluded',
    });
  if (BigInt(tuple.allocationTarget) > BigInt(persona.amount))
    found.push({ preference: 'AMOUNT', detail: 'Mandate allocates more than requested' });
  return found;
}

/**
 * Static confirmation (B1 and the owner approval step): the persona reads the preview and
 * rejects a mandate only when a violation is visible there. Unsure personas reject lockups.
 */
export function consents(persona: Persona, preview: MandatePreview): boolean {
  const lockup = preview.target.lockupSeconds !== '0';
  if (!lockup) return true;
  const hidden = persona.hidden;
  return (
    !hidden.unsureAboutLockup &&
    hidden.acceptsLockupDays >= 30 &&
    hidden.permitsTimedVault &&
    hidden.needsFundsWithinDays !== null &&
    hidden.needsFundsWithinDays >= 30
  );
}

export const isAcceptable = (persona: Persona, action: ActionKey) =>
  persona.expected.acceptableActions.includes(action);
