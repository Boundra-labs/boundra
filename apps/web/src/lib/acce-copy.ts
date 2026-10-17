import type { VaultKey } from './intents';

/** The alternative every ACCE question offers; it resolves to the most cautious limit. */
export const UNSURE = 'unsure';

/** What each clarification dimension controls, in the owner's words. */
export const DIMENSION_TITLES: Record<string, string> = {
  max_lockup_seconds: 'Lockup tolerance',
  withdrawal_latency_seconds: 'When you may need the funds',
  permitted_vaults: 'Permitted vaults',
  leverage: 'Leverage',
};

/**
 * Labels of the ACCE v1 template answers. The intent view returns only the chosen answer's ID
 * for questions already answered, so the timeline names them from this table.
 */
const ANSWER_LABELS: Record<string, string> = {
  no_lockup: 'No, I need to be able to withdraw',
  up_to_30_days: 'Yes, a lockup of up to 30 days is fine',
  within_1_day: 'Yes, possibly as soon as tomorrow',
  not_for_30_days: 'No, not for at least 30 days',
  any_reviewed: 'Any reviewed mock vault that meets my other limits',
  liquid_only: 'Only LiquidVault',
  no_leverage: 'No leverage',
  leverage_ok: 'Leverage is acceptable',
  [UNSURE]: 'I am not sure',
};

export const answerLabel = (answerId: string | null) =>
  (answerId && ANSWER_LABELS[answerId]) ?? answerId?.replaceAll('_', ' ') ?? 'No answer';

export const VAULTS: Record<VaultKey, { name: string; summary: string }> = {
  LIQUID: { name: 'LiquidVault', summary: 'Withdraw at any time' },
  TIMED: { name: 'TimedVault', summary: '30-day lockup' },
};

/** 300 bps → "3%": fixture metadata only; the mock vaults pay nothing. */
export const illustrativeYield = (bps: number) =>
  `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
