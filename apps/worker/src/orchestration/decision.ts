import type { Address } from 'viem';
import type { ExecutorSnapshot, VaultSnapshot } from '@boundra/chain';

export const POLICY_VERSION = 'decision-v1';

/** Approved mandate limits as stored off-chain (already proven equal to the on-chain tuple). */
export interface MandateLimits {
  selectedVault: 'LIQUID' | 'TIMED';
  onchainVersion: bigint;
  expiresAt: bigint;
  allowedActions: number;
  maxDepositPerAction: bigint;
  maxCumulativeDeposits: bigint;
  maxWithdrawPerAction: bigint;
  allocationTarget: bigint;
  /** Set once an ESCALATE happened: new deposits stay blocked until the owner reviews. */
  escalated: boolean;
}

export type Decision =
  | {
      kind: 'DEPOSIT' | 'WITHDRAW';
      target: Address;
      amount: bigint;
      reasonCode: string;
      reason: string;
    }
  | { kind: 'HOLD' | 'ESCALATE'; reasonCode: string; reason: string };

/** Mandate lifecycle observed on-chain; when set, no action is decided at all. */
export type MandateStatusChange = {
  status: 'REVOKED' | 'EXPIRED' | 'SUPERSEDED';
  reasonCode: string;
  reason: string;
} | null;

const min = (...values: bigint[]) => values.reduce((a, b) => (b < a ? b : a));

export function mandateStatus(
  snapshot: ExecutorSnapshot,
  limits: MandateLimits,
  nowSeconds: bigint,
): MandateStatusChange {
  if (snapshot.mandateVersion !== limits.onchainVersion)
    return {
      status: 'SUPERSEDED',
      reasonCode: 'MANDATE_REPLACED_ONCHAIN',
      reason: 'A different mandate version is now active on your executor.',
    };
  if (snapshot.revoked)
    return { status: 'REVOKED', reasonCode: 'REVOKED', reason: 'You revoked this mandate.' };
  if (nowSeconds >= limits.expiresAt)
    return {
      status: 'EXPIRED',
      reasonCode: 'EXPIRED',
      reason: 'The mandate expired; the agent can no longer act.',
    };
  return null;
}

export function candidatesOf(snapshot: ExecutorSnapshot) {
  const describe = (key: 'LIQUID' | 'TIMED', vault: VaultSnapshot) => ({
    vault: key,
    address: vault.address,
    risk: vault.riskLevel === 0 ? 'NORMAL' : 'DEGRADED',
    principal: vault.principal.toString(),
    withdrawable: vault.maxWithdraw.toString(),
    unlockAt: vault.unlockAt.toString(),
  });
  return [describe('LIQUID', snapshot.liquid), describe('TIMED', snapshot.timed)];
}

/**
 * Deterministic agent policy (PRD §7.2, §13.1). The chain guard (`prepareAction`) and the
 * contract still re-check every limit; this only chooses which bounded action to propose.
 */
export function decide(
  snapshot: ExecutorSnapshot,
  limits: MandateLimits,
  nowSeconds: bigint,
): Decision {
  const vault = limits.selectedVault === 'LIQUID' ? snapshot.liquid : snapshot.timed;
  const degraded = vault.riskLevel !== 0;
  const canWithdraw = (limits.allowedActions & 2) !== 0;
  const canDeposit = (limits.allowedActions & 1) !== 0;

  if (snapshot.paused)
    return {
      kind: 'HOLD',
      reasonCode: 'PAUSED',
      reason: 'You paused the agent; no transaction is sent until you resume.',
    };

  if (vault.principal > 0n) {
    if (!degraded)
      return {
        kind: 'HOLD',
        reasonCode: 'POSITION_HEALTHY',
        reason:
          'Funds are allocated and the vault reports normal conditions; monitoring continues.',
      };
    if (!canWithdraw)
      return {
        kind: 'ESCALATE',
        reasonCode: 'WITHDRAW_NOT_AUTHORIZED',
        reason:
          'The vault reports degraded conditions but this mandate does not allow withdrawals.',
      };
    if (nowSeconds < vault.unlockAt)
      return {
        kind: 'ESCALATE',
        reasonCode: 'POSITION_LOCKED',
        reason: 'The vault reports degraded conditions but your position is still locked.',
      };
    const amount = min(vault.principal, vault.maxWithdraw, limits.maxWithdrawPerAction);
    if (amount === 0n)
      return {
        kind: 'ESCALATE',
        reasonCode: 'NO_WITHDRAWAL_CAPACITY',
        reason: 'The vault reports degraded conditions and has no withdrawal capacity right now.',
      };
    return {
      kind: 'WITHDRAW',
      target: vault.address,
      amount,
      reasonCode: amount < vault.principal ? 'RISK_PARTIAL_EXIT' : 'RISK_EXIT',
      reason:
        amount < vault.principal
          ? 'The vault reports degraded conditions; withdrawing what capacity and your limits allow. The rest stays monitored.'
          : 'The vault reports degraded conditions; withdrawing your position to your wallet.',
    };
  }

  if (snapshot.allocationCompleted)
    return {
      kind: 'HOLD',
      reasonCode: 'ALLOCATION_COMPLETED',
      reason: 'The single allocation for this mandate is complete; funds are not re-deposited.',
    };
  if (limits.escalated)
    return {
      kind: 'HOLD',
      reasonCode: 'AWAITING_OWNER_REVIEW',
      reason: 'An earlier escalation blocks new deposits until you review the mandate.',
    };
  if (!canDeposit)
    return {
      kind: 'HOLD',
      reasonCode: 'DEPOSIT_NOT_AUTHORIZED',
      reason: 'This mandate allows withdrawals only.',
    };
  if (degraded)
    return {
      kind: 'HOLD',
      reasonCode: 'VAULT_DEGRADED',
      reason: 'The vault reports degraded conditions, which blocks new deposits.',
    };
  const remaining = limits.maxCumulativeDeposits - snapshot.cumulativeDeposited;
  const amount = min(limits.allocationTarget, limits.maxDepositPerAction, remaining);
  if (amount <= 0n)
    return {
      kind: 'HOLD',
      reasonCode: 'BUDGET_EXHAUSTED',
      reason: 'The deposit budget is used up.',
    };
  if (snapshot.idleBalance < amount)
    return {
      kind: 'HOLD',
      reasonCode: 'AWAITING_FUNDING',
      reason: 'Waiting for your executor to be funded with the approved amount.',
    };
  return {
    kind: 'DEPOSIT',
    target: vault.address,
    amount,
    reasonCode:
      limits.selectedVault === 'TIMED' ? 'LOCKUP_ACCEPTED_FOR_YIELD' : 'LIQUIDITY_PRESERVED',
    reason:
      limits.selectedVault === 'TIMED'
        ? 'Depositing into TimedVault: you accepted its 30-day lockup.'
        : 'Depositing into LiquidVault: funds stay withdrawable at any time.',
  };
}
