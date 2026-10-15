import {
  DIMENSION_IDS,
  DIMENSIONS,
  VAULTS,
  type DimensionId,
  type PreferenceValues,
  type VaultKey,
} from './config';

export type DimensionStatus = 'UNRESOLVED' | 'ANSWERED' | 'UNKNOWN';
export interface DimensionState {
  status: DimensionStatus;
  alternativeId?: string;
}
export type PreferenceState = Record<DimensionId, DimensionState>;

export function initialState(): PreferenceState {
  return Object.fromEntries(
    DIMENSION_IDS.map((id) => [id, { status: 'UNRESOLVED' as const }]),
  ) as PreferenceState;
}

/** Resolves answers; UNKNOWN uses the conservative value, unanswered dimensions their default. */
export function effectiveValues(state: PreferenceState): PreferenceValues {
  const values = {} as PreferenceValues;
  for (const id of DIMENSION_IDS) {
    const def = DIMENSIONS[id];
    const entry = state[id];
    if (entry.status === 'ANSWERED') {
      const alternative = def.alternatives.find((alt) => alt.id === entry.alternativeId);
      if (!alternative?.value) throw new Error(`Invalid answer for ${id}`);
      Object.assign(values, alternative.value);
    } else if (entry.status === 'UNKNOWN') {
      Object.assign(values, def.conservativeValue);
    } else {
      Object.assign(values, def.defaultValue);
    }
  }
  return values;
}

export interface Conflict {
  code: 'LOCKUP_CONFLICTS_WITH_LIQUIDITY_NEED';
  message: string;
}

/**
 * Explicit answers that contradict each other. Eligibility already resolves them toward less
 * authority (a liquidity need shorter than the lockup excludes the lockup vault); the conflict is
 * surfaced so the preview shows why the mandate was narrowed.
 */
export function detectConflicts(state: PreferenceState): Conflict[] {
  if (
    state.max_lockup_seconds.status !== 'ANSWERED' ||
    state.withdrawal_latency_seconds.status !== 'ANSWERED'
  )
    return [];
  const values = effectiveValues(state);
  if (values.maxLockupSeconds > 0n && values.maxWithdrawalLatencySeconds < values.maxLockupSeconds)
    return [
      {
        code: 'LOCKUP_CONFLICTS_WITH_LIQUIDITY_NEED',
        message:
          'You accepted a lockup but may need the funds sooner, so lockup vaults are excluded.',
      },
    ];
  return [];
}

export interface CandidateReason {
  code:
    | 'ELIGIBLE'
    | 'NOT_PERMITTED'
    | 'LOCKUP_EXCEEDS_TOLERANCE'
    | 'LATENCY_EXCEEDS_NEED'
    | 'LEVERAGE_NOT_ALLOWED';
  message: string;
}
export interface Candidate {
  action: 'DEPOSIT';
  vault: VaultKey;
  eligible: boolean;
  reasons: CandidateReason[];
  illustrativeYieldBps: number;
  lockupSeconds: bigint;
}

export function evaluateCandidates(values: PreferenceValues): Candidate[] {
  return (Object.keys(VAULTS) as VaultKey[]).map((key) => {
    const vault = VAULTS[key];
    const reasons: CandidateReason[] = [];
    if (values.permittedVaults === 'LIQUID_ONLY' && key !== 'LIQUID')
      reasons.push({
        code: 'NOT_PERMITTED',
        message: `${vault.name} is not in your permitted vaults.`,
      });
    if (vault.lockupSeconds > values.maxLockupSeconds)
      reasons.push({
        code: 'LOCKUP_EXCEEDS_TOLERANCE',
        message: `${vault.name} locks funds for ${vault.lockupSeconds / 86_400n} days, above your tolerance.`,
      });
    const latency =
      vault.lockupSeconds > vault.withdrawalLatencySeconds
        ? vault.lockupSeconds
        : vault.withdrawalLatencySeconds;
    if (latency > values.maxWithdrawalLatencySeconds)
      reasons.push({
        code: 'LATENCY_EXCEEDS_NEED',
        message: `${vault.name} could not return funds as quickly as you may need them.`,
      });
    if (vault.leverage && values.leverage === 'NONE')
      reasons.push({ code: 'LEVERAGE_NOT_ALLOWED', message: `${vault.name} uses leverage.` });
    return {
      action: 'DEPOSIT' as const,
      vault: key,
      eligible: reasons.length === 0,
      reasons: reasons.length
        ? reasons
        : [{ code: 'ELIGIBLE' as const, message: `${vault.name} meets every limit you set.` }],
      illustrativeYieldBps: vault.illustrativeYieldBps,
      lockupSeconds: vault.lockupSeconds,
    };
  });
}

export type Selection =
  | { action: 'DEPOSIT'; vault: VaultKey; reasonCode: string; reason: string }
  | { action: 'ESCALATE'; reasonCode: string; reason: string };

/**
 * PRD §7.2: hard constraints filter first. TimedVault (higher illustrative yield) is chosen only
 * when the owner explicitly accepted its lockup; otherwise, and on ties, LiquidVault.
 */
export function selectAction(values: PreferenceValues): Selection {
  const candidates = evaluateCandidates(values);
  const timed = candidates.find((c) => c.vault === 'TIMED');
  const liquid = candidates.find((c) => c.vault === 'LIQUID');
  if (timed?.eligible && values.maxLockupSeconds >= VAULTS.TIMED.lockupSeconds)
    return {
      action: 'DEPOSIT',
      vault: 'TIMED',
      reasonCode: 'LOCKUP_ACCEPTED_FOR_YIELD',
      reason: 'You accepted a 30-day lockup, so the higher illustrative yield vault is selected.',
    };
  if (liquid?.eligible)
    return {
      action: 'DEPOSIT',
      vault: 'LIQUID',
      reasonCode: 'LIQUIDITY_PRESERVED',
      reason: 'LiquidVault keeps funds withdrawable at any time and meets every limit you set.',
    };
  return {
    action: 'ESCALATE',
    reasonCode: 'NO_ELIGIBLE_VAULT',
    reason: 'No reviewed vault satisfies your constraints; nothing will be delegated.',
  };
}

export const selectionKey = (selection: Selection) =>
  selection.action === 'DEPOSIT' ? `DEPOSIT:${selection.vault}` : selection.action;
