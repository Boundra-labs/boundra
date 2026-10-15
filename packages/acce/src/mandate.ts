import { keccak256, stringToHex } from 'viem';
import {
  BASE_SEPOLIA_CHAIN_ID,
  MAX_UINT256,
  mandateTupleSchema,
  MOCK_USDC_DECIMALS,
  type MandateTuple,
} from '@boundra/shared';
import {
  DESCRIPTOR_VERSION,
  DIMENSION_IDS,
  DIMENSIONS,
  ONE_DAY,
  VAULTS,
  type VaultKey,
} from './config';
import {
  detectConflicts,
  effectiveValues,
  evaluateCandidates,
  selectAction,
  type Candidate,
  type PreferenceState,
  type Selection,
} from './eligibility';
import { narrowedDimensions } from './planner';

export const DEFAULT_EXPIRY_SECONDS = 7n * ONE_DAY;
/** Executor rule: a timed deposit needs expiry > deposit + lockup + 1 day; one more day covers inclusion. */
export const TIMED_MIN_EXPIRY_SECONDS = VAULTS.TIMED.lockupSeconds + 2n * ONE_DAY;
export const MAX_EXPIRY_SECONDS = 60n * ONE_DAY;
export const PREVIEW_VERSION = 'preview-v1';

export class MandateBuildError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'MandateBuildError';
  }
}

export interface MandateBuildInput {
  owner: string;
  operator: string;
  asset: string;
  executor?: string;
  vaultAddresses: Record<VaultKey, string>;
  amount: bigint;
  state: PreferenceState;
  nowSeconds: bigint;
  /** Owner-edited duration; defaults to 7 days, or the minimum a timed deposit needs. */
  expirySeconds?: bigint;
  maxDepositPerAction?: bigint;
  maxWithdrawPerAction?: bigint;
}

export interface MandatePreview {
  version: typeof PREVIEW_VERSION;
  descriptorVersion: string;
  labels: string[];
  network: { chainId: number; name: string };
  owner: string;
  operator: string;
  executor: string | null;
  beneficiary: string;
  token: { address: string; symbol: 'MockUSDC'; decimals: number };
  amount: { baseUnits: string; display: string };
  target: {
    vault: VaultKey;
    name: string;
    address: string;
    lockupSeconds: string;
    illustrativeYieldBps: number;
  };
  allowedActions: ('DEPOSIT' | 'WITHDRAW')[];
  limits: {
    maxDepositPerAction: string;
    maxCumulativeDeposits: string;
    allocationTarget: string;
    maxWithdrawPerAction: string;
    maxLockupSeconds: string;
  };
  expiresAt: string;
  expiresAtIso: string;
  selection: { reasonCode: string; reason: string };
  candidates: { vault: VaultKey; eligible: boolean; reasons: string[] }[];
  preferences: {
    dimension: string;
    source: 'ANSWERED' | 'UNKNOWN' | 'DEFAULT';
    answer: string | null;
    enforcement: string;
  }[];
  narrowed: { dimension: string; reason: string }[];
  notices: string[];
}

export type MandateBuildResult =
  | {
      ok: true;
      selection: Extract<Selection, { action: 'DEPOSIT' }>;
      tuple: MandateTuple;
      preview: MandatePreview;
      previewHash: `0x${string}`;
    }
  | { ok: false; selection: Extract<Selection, { action: 'ESCALATE' }> };

const lower = (value: string) => value.toLowerCase();

export function formatAmount(baseUnits: bigint): string {
  const scale = 10n ** BigInt(MOCK_USDC_DECIMALS);
  const whole = baseUnits / scale;
  const fraction = (baseUnits % scale)
    .toString()
    .padStart(MOCK_USDC_DECIMALS, '0')
    .replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} MockUSDC`;
}

/** Key-sorted JSON so the same preview always hashes identically. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  if (typeof value === 'bigint') throw new Error('Serialize bigint values as strings');
  return JSON.stringify(value);
}

export const hashPreview = (preview: MandatePreview) =>
  keccak256(stringToHex(canonicalJson(preview)));

/**
 * Deterministic mandate draft: exactly the contract tuple plus the preview the owner approves.
 * Only the selected vault is targeted and the lockup limit is that vault's own lockup, so the
 * mandate is never broader than the action it was built for.
 */
export function buildMandate(input: MandateBuildInput): MandateBuildResult {
  if (input.amount <= 0n || input.amount > MAX_UINT256)
    throw new MandateBuildError('INVALID_AMOUNT');
  const values = effectiveValues(input.state);
  const selection = selectAction(values);
  if (selection.action !== 'DEPOSIT') return { ok: false, selection };
  const vault = VAULTS[selection.vault];

  const minimumExpiry = vault.lockupSeconds > 0n ? TIMED_MIN_EXPIRY_SECONDS : ONE_DAY;
  const expiry =
    input.expirySeconds ??
    (vault.lockupSeconds > 0n ? TIMED_MIN_EXPIRY_SECONDS : DEFAULT_EXPIRY_SECONDS);
  if (expiry < minimumExpiry) throw new MandateBuildError('EXPIRY_TOO_SHORT');
  if (expiry > MAX_EXPIRY_SECONDS) throw new MandateBuildError('EXPIRY_TOO_LONG');

  const maxDepositPerAction = input.maxDepositPerAction ?? input.amount;
  const maxWithdrawPerAction = input.maxWithdrawPerAction ?? input.amount;
  if (maxDepositPerAction <= 0n || maxDepositPerAction > input.amount)
    throw new MandateBuildError('INVALID_DEPOSIT_CAP');
  if (maxWithdrawPerAction <= 0n || maxWithdrawPerAction > input.amount)
    throw new MandateBuildError('INVALID_WITHDRAW_CAP');

  const expiresAt = input.nowSeconds + expiry;
  const tuple = mandateTupleSchema.parse({
    chainId: BASE_SEPOLIA_CHAIN_ID,
    asset: lower(input.asset),
    operator: lower(input.operator),
    beneficiary: lower(input.owner),
    expiresAt: expiresAt.toString(),
    allowedVaults: vault.mask,
    allowedActions: 3,
    maxLockupSeconds: vault.lockupSeconds.toString(),
    maxDepositPerAction: maxDepositPerAction.toString(),
    maxCumulativeDeposits: input.amount.toString(),
    maxWithdrawPerAction: maxWithdrawPerAction.toString(),
    allocationTarget: input.amount.toString(),
  });
  if (tuple.operator === tuple.beneficiary) throw new MandateBuildError('OPERATOR_IS_OWNER');

  const candidates: Candidate[] = evaluateCandidates(values);
  const notices = [
    'Testnet only: MockUSDC and mock vaults on Base Sepolia. No real funds and no promised returns.',
    'Yield figures are illustrative fixture metadata; the vaults hold principal 1:1 and pay nothing.',
    'Withdrawals by the agent are paid directly to your wallet; the agent cannot change the recipient.',
    'Expiry stops the agent from acting. It does not unlock funds that a vault has locked.',
    'Pausing or revoking blocks new agent actions; confirmed transactions are not undone.',
    'Withdrawals never restore the deposit budget.',
  ];
  if (maxDepositPerAction < input.amount)
    notices.push(
      `The per-action cap is below the requested amount: the agent makes one deposit of ${formatAmount(maxDepositPerAction)} and the rest stays idle in your executor.`,
    );
  if (vault.lockupSeconds > 0n)
    notices.push(
      `${vault.name} locks deposits for 30 days with no early exit, even if a risk warning appears.`,
    );
  for (const conflict of detectConflicts(input.state)) notices.push(conflict.message);

  const preview: MandatePreview = {
    version: PREVIEW_VERSION,
    descriptorVersion: DESCRIPTOR_VERSION,
    labels: ['TESTNET', 'MockUSDC', 'Mock vault', 'Illustrative yield only'],
    network: { chainId: BASE_SEPOLIA_CHAIN_ID, name: 'Base Sepolia (testnet)' },
    owner: lower(input.owner),
    operator: tuple.operator,
    executor: input.executor ? lower(input.executor) : null,
    beneficiary: tuple.beneficiary,
    token: { address: tuple.asset, symbol: 'MockUSDC', decimals: MOCK_USDC_DECIMALS },
    amount: { baseUnits: input.amount.toString(), display: formatAmount(input.amount) },
    target: {
      vault: vault.key,
      name: vault.name,
      address: lower(input.vaultAddresses[vault.key]),
      lockupSeconds: vault.lockupSeconds.toString(),
      illustrativeYieldBps: vault.illustrativeYieldBps,
    },
    allowedActions: ['DEPOSIT', 'WITHDRAW'],
    limits: {
      maxDepositPerAction: tuple.maxDepositPerAction,
      maxCumulativeDeposits: tuple.maxCumulativeDeposits,
      allocationTarget: tuple.allocationTarget,
      maxWithdrawPerAction: tuple.maxWithdrawPerAction,
      maxLockupSeconds: tuple.maxLockupSeconds,
    },
    expiresAt: tuple.expiresAt,
    expiresAtIso: new Date(Number(expiresAt) * 1000).toISOString(),
    selection: { reasonCode: selection.reasonCode, reason: selection.reason },
    candidates: candidates.map((c) => ({
      vault: c.vault,
      eligible: c.eligible,
      reasons: c.reasons.map((r) => r.message),
    })),
    preferences: DIMENSION_IDS.map((id) => {
      const entry = input.state[id];
      return {
        dimension: id,
        source: entry.status === 'UNRESOLVED' ? ('DEFAULT' as const) : entry.status,
        answer: entry.alternativeId ?? null,
        enforcement: DIMENSIONS[id].enforcement,
      };
    }),
    narrowed: narrowedDimensions(input.state),
    notices,
  };
  return { ok: true, selection, tuple, preview, previewHash: hashPreview(preview) };
}
