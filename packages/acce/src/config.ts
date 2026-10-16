/** Reviewed vault metadata (PRD §13.1). Addresses are bound from the trusted manifest at runtime. */
export type VaultKey = 'LIQUID' | 'TIMED';

export interface VaultDescriptor {
  key: VaultKey;
  name: string;
  /** Executor `allowedVaults` bit. */
  mask: 1 | 2;
  lockupSeconds: bigint;
  /** Protocol withdrawal latency outside network inclusion. */
  withdrawalLatencySeconds: bigint;
  /** Fixture metadata only; never accrued or paid. */
  illustrativeYieldBps: number;
  leverage: boolean;
}

export const DESCRIPTOR_VERSION = 'v1';
export const THIRTY_DAYS = 2_592_000n;
export const ONE_DAY = 86_400n;

export const VAULTS: Record<VaultKey, VaultDescriptor> = {
  LIQUID: {
    key: 'LIQUID',
    name: 'LiquidVault',
    mask: 1,
    lockupSeconds: 0n,
    withdrawalLatencySeconds: 0n,
    illustrativeYieldBps: 300,
    leverage: false,
  },
  TIMED: {
    key: 'TIMED',
    name: 'TimedVault',
    mask: 2,
    lockupSeconds: THIRTY_DAYS,
    withdrawalLatencySeconds: 0n,
    illustrativeYieldBps: 600,
    leverage: false,
  },
};

export type DimensionId =
  'max_lockup_seconds' | 'withdrawal_latency_seconds' | 'permitted_vaults' | 'leverage';

export interface PreferenceValues {
  maxLockupSeconds: bigint;
  maxWithdrawalLatencySeconds: bigint;
  permittedVaults: 'ANY_REVIEWED' | 'LIQUID_ONLY';
  leverage: 'NONE' | 'ALLOWED';
}

export interface AlternativeDef {
  id: string;
  label: string;
  /** null marks the "not sure" option, resolved to the conservative value. */
  value: Partial<PreferenceValues> | null;
}

export interface DimensionDef {
  id: DimensionId;
  /** Deterministic tie-break order. */
  rank: number;
  materiality: 0 | 1 | 2 | 3;
  uncertainty: 0 | 1 | 2 | 3;
  friction: 0 | 1 | 2 | 3;
  /** Applied while unanswered; never broader than what the owner reviews in the preview. */
  defaultValue: Partial<PreferenceValues>;
  /** Applied for UNKNOWN answers and contradictions. */
  conservativeValue: Partial<PreferenceValues>;
  text: string;
  alternatives: AlternativeDef[];
  enforcement: string;
}

export const ACCE_CONFIG_VERSION = 'v1';
export const MAX_QUESTIONS = 5;

/**
 * Ordinal components are frozen per config version (PRD §7.1). Lockup and liquidity default to
 * their conservative values, so TimedVault is never reachable without an explicit answer.
 */
export const DIMENSIONS: Record<DimensionId, DimensionDef> = {
  max_lockup_seconds: {
    id: 'max_lockup_seconds',
    rank: 1,
    materiality: 3,
    uncertainty: 3,
    friction: 0,
    defaultValue: { maxLockupSeconds: 0n },
    conservativeValue: { maxLockupSeconds: 0n },
    text: 'Would you accept not being able to withdraw these funds for 30 days in exchange for a higher illustrative yield?',
    alternatives: [
      {
        id: 'no_lockup',
        label: 'No, I need to be able to withdraw',
        value: { maxLockupSeconds: 0n },
      },
      {
        id: 'up_to_30_days',
        label: 'Yes, a lockup of up to 30 days is fine',
        value: { maxLockupSeconds: THIRTY_DAYS },
      },
      { id: 'unsure', label: 'I am not sure', value: null },
    ],
    enforcement:
      'On-chain: the mandate maxLockupSeconds makes the executor reject deposits into vaults with a longer lockup.',
  },
  withdrawal_latency_seconds: {
    id: 'withdrawal_latency_seconds',
    rank: 2,
    materiality: 3,
    uncertainty: 3,
    friction: 1,
    defaultValue: { maxWithdrawalLatencySeconds: 0n },
    conservativeValue: { maxWithdrawalLatencySeconds: 0n },
    text: 'Might you need these funds back within the next 30 days?',
    alternatives: [
      {
        id: 'within_1_day',
        label: 'Yes, possibly as soon as tomorrow',
        value: { maxWithdrawalLatencySeconds: ONE_DAY },
      },
      {
        id: 'not_for_30_days',
        label: 'No, not for at least 30 days',
        value: { maxWithdrawalLatencySeconds: THIRTY_DAYS },
      },
      { id: 'unsure', label: 'I am not sure', value: null },
    ],
    enforcement:
      'Eligibility: vaults whose lockup exceeds your liquidity need are excluded from the mandate targets.',
  },
  permitted_vaults: {
    id: 'permitted_vaults',
    rank: 3,
    materiality: 1,
    uncertainty: 1,
    friction: 3,
    defaultValue: { permittedVaults: 'ANY_REVIEWED' },
    conservativeValue: { permittedVaults: 'LIQUID_ONLY' },
    text: 'Should the agent only use the instant-withdrawal vault?',
    alternatives: [
      {
        id: 'any_reviewed',
        label: 'Any reviewed mock vault that meets my other limits',
        value: { permittedVaults: 'ANY_REVIEWED' },
      },
      { id: 'liquid_only', label: 'Only LiquidVault', value: { permittedVaults: 'LIQUID_ONLY' } },
      { id: 'unsure', label: 'I am not sure', value: null },
    ],
    enforcement:
      'On-chain: the mandate allowedVaults mask makes the executor reject every other target.',
  },
  leverage: {
    id: 'leverage',
    rank: 4,
    materiality: 3,
    uncertainty: 1,
    friction: 1,
    defaultValue: { leverage: 'NONE' },
    conservativeValue: { leverage: 'NONE' },
    text: 'May the agent use leverage?',
    alternatives: [
      { id: 'no_leverage', label: 'No leverage', value: { leverage: 'NONE' } },
      { id: 'leverage_ok', label: 'Leverage is acceptable', value: { leverage: 'ALLOWED' } },
      { id: 'unsure', label: 'I am not sure', value: null },
    ],
    enforcement:
      'Structural: no reviewed vault offers leverage and the executor cannot call anything else.',
  },
};

export const DIMENSION_IDS = (Object.keys(DIMENSIONS) as DimensionId[]).sort(
  (a, b) => DIMENSIONS[a].rank - DIMENSIONS[b].rank,
);
