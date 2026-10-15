import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address } from 'viem';
import type { ExecutorSnapshot } from '@boundra/chain';
import { decide, mandateStatus, type MandateLimits } from '../src/orchestration/decision';

const now = 1_800_000_000n;
const liquid = '0x00000000000000000000000000000000000000b1' as Address;
const timed = '0x00000000000000000000000000000000000000b2' as Address;
function snapshot(overrides: Partial<ExecutorSnapshot> = {}): ExecutorSnapshot {
  return {
    chainId: 84532,
    blockNumber: 100n,
    blockHash: `0x${'1'.repeat(64)}`,
    blockTimestamp: now,
    observedAtMs: Number(now) * 1000,
    owner: '0x00000000000000000000000000000000000000a1',
    executor: '0x00000000000000000000000000000000000000a2',
    token: '0x00000000000000000000000000000000000000a3',
    mandate: {} as ExecutorSnapshot['mandate'],
    mandateVersion: 1n,
    nextActionNonce: 0n,
    cumulativeDeposited: 0n,
    idleBalance: 300_000_000n,
    paused: false,
    revoked: false,
    allocationCompleted: false,
    liquid: {
      address: liquid,
      principal: 0n,
      unlockAt: 0n,
      maxWithdraw: 0n,
      lockupSeconds: 0n,
      riskLevel: 0,
    },
    timed: {
      address: timed,
      principal: 0n,
      unlockAt: 0n,
      maxWithdraw: 0n,
      lockupSeconds: 2_592_000n,
      riskLevel: 0,
    },
    ...overrides,
  };
}
const limits: MandateLimits = {
  selectedVault: 'LIQUID',
  onchainVersion: 1n,
  expiresAt: now + 604_800n,
  allowedActions: 3,
  maxDepositPerAction: 300_000_000n,
  maxCumulativeDeposits: 300_000_000n,
  maxWithdrawPerAction: 300_000_000n,
  allocationTarget: 300_000_000n,
  escalated: false,
};
const withPosition = (
  riskLevel: number,
  maxWithdraw: bigint,
  extra: Partial<ExecutorSnapshot> = {},
) =>
  snapshot({
    idleBalance: 0n,
    cumulativeDeposited: 300_000_000n,
    allocationCompleted: true,
    liquid: {
      address: liquid,
      principal: 300_000_000n,
      unlockAt: 0n,
      maxWithdraw,
      lockupSeconds: 0n,
      riskLevel,
    },
    ...extra,
  });

test('T04: a funded, authorized mandate deposits the approved amount into the selected vault', () => {
  assert.deepEqual(decide(snapshot(), limits, now), {
    kind: 'DEPOSIT',
    target: liquid,
    amount: 300_000_000n,
    reasonCode: 'LIQUIDITY_PRESERVED',
    reason: 'Depositing into LiquidVault: funds stay withdrawable at any time.',
  });
  const timedDeposit = decide(snapshot(), { ...limits, selectedVault: 'TIMED' }, now);
  assert.equal(timedDeposit.kind === 'DEPOSIT' && timedDeposit.target, timed);
});

test('a cap below the target makes one partial deposit; never more than the remaining budget', () => {
  const capped = decide(snapshot(), { ...limits, maxDepositPerAction: 100_000_000n }, now);
  assert.equal(capped.kind === 'DEPOSIT' && capped.amount, 100_000_000n);
});

test('T15: missing funding or a degraded vault holds without a transaction', () => {
  assert.equal(
    decide(snapshot({ idleBalance: 299_999_999n }), limits, now).reasonCode,
    'AWAITING_FUNDING',
  );
  const degraded = snapshot({ liquid: { ...snapshot().liquid, riskLevel: 1 } });
  assert.equal(decide(degraded, limits, now).reasonCode, 'VAULT_DEGRADED');
});

test('periodic evaluation never re-deposits once the allocation is complete (also after an exit)', () => {
  assert.deepEqual(
    decide(withPosition(0, 300_000_000n), limits, now).reasonCode,
    'POSITION_HEALTHY',
  );
  const exited = snapshot({
    allocationCompleted: true,
    cumulativeDeposited: 300_000_000n,
    idleBalance: 0n,
  });
  assert.equal(decide(exited, limits, now).reasonCode, 'ALLOCATION_COMPLETED');
});

test('T05: a verified risk event withdraws the position within capacity and the per-action cap', () => {
  const full = decide(withPosition(1, 300_000_000n), limits, now);
  assert.equal(full.kind, 'WITHDRAW');
  assert.equal(full.kind === 'WITHDRAW' && full.amount, 300_000_000n);
  const partial = decide(withPosition(1, 120_000_000n), limits, now);
  assert.equal(partial.kind === 'WITHDRAW' && partial.amount, 120_000_000n);
  assert.equal(partial.reasonCode, 'RISK_PARTIAL_EXIT');
  const capped = decide(
    withPosition(1, 300_000_000n),
    { ...limits, maxWithdrawPerAction: 50_000_000n },
    now,
  );
  assert.equal(capped.kind === 'WITHDRAW' && capped.amount, 50_000_000n);
});

test('T06: a locked position or zero capacity escalates instead of bypassing the vault', () => {
  const locked = withPosition(1, 0n, {
    liquid: {
      address: liquid,
      principal: 300_000_000n,
      unlockAt: now + 10n,
      maxWithdraw: 0n,
      lockupSeconds: 0n,
      riskLevel: 1,
    },
  });
  assert.equal(decide(locked, limits, now).reasonCode, 'POSITION_LOCKED');
  assert.equal(decide(withPosition(1, 0n), limits, now).reasonCode, 'NO_WITHDRAWAL_CAPACITY');
  assert.equal(decide(withPosition(1, 1n), { ...limits, allowedActions: 1 }, now).kind, 'ESCALATE');
});

test('pause holds, escalation blocks only new deposits, and lifecycle changes stop all decisions', () => {
  assert.equal(decide(snapshot({ paused: true }), limits, now).reasonCode, 'PAUSED');
  assert.equal(
    decide(snapshot(), { ...limits, escalated: true }, now).reasonCode,
    'AWAITING_OWNER_REVIEW',
  );
  assert.equal(
    decide(withPosition(1, 300_000_000n), { ...limits, escalated: true }, now).kind,
    'WITHDRAW',
  );
  assert.equal(mandateStatus(snapshot(), limits, now), null);
  assert.equal(mandateStatus(snapshot({ revoked: true }), limits, now)?.status, 'REVOKED');
  assert.equal(mandateStatus(snapshot({ mandateVersion: 2n }), limits, now)?.status, 'SUPERSEDED');
  assert.equal(mandateStatus(snapshot(), limits, limits.expiresAt)?.status, 'EXPIRED');
});
