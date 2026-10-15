import { encodeFunctionData, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { addressSchema, hashSchema, tokenAmountSchema } from '@boundra/shared';
import { boundraExecutorAbi } from './abis/BoundraExecutor';

export const actionRequestSchema = z
  .object({
    actionId: hashSchema.refine((value) => !/^0x0{64}$/i.test(value)),
    kind: z.enum(['DEPOSIT', 'WITHDRAW']),
    mandateVersion: tokenAmountSchema,
    nonce: tokenAmountSchema,
    deadline: tokenAmountSchema.refine((value) => BigInt(value) <= (1n << 64n) - 1n),
    target: addressSchema,
    amount: tokenAmountSchema.refine((value) => value !== '0'),
  })
  .strict();
export type ActionRequest = z.infer<typeof actionRequestSchema>;

export interface Mandate {
  chainId: bigint;
  asset: Address;
  operator: Address;
  beneficiary: Address;
  expiresAt: bigint;
  allowedVaults: number;
  allowedActions: number;
  maxLockupSeconds: number;
  maxDepositPerAction: bigint;
  maxCumulativeDeposits: bigint;
  maxWithdrawPerAction: bigint;
  allocationTarget: bigint;
}
export interface VaultSnapshot {
  address: Address;
  principal: bigint;
  unlockAt: bigint;
  maxWithdraw: bigint;
  lockupSeconds: bigint;
  riskLevel: number;
}
export interface ExecutorSnapshot {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
  observedAtMs: number;
  owner: Address;
  executor: Address;
  token: Address;
  mandate: Mandate;
  mandateVersion: bigint;
  nextActionNonce: bigint;
  cumulativeDeposited: bigint;
  idleBalance: bigint;
  paused: boolean;
  revoked: boolean;
  allocationCompleted: boolean;
  liquid: VaultSnapshot;
  timed: VaultSnapshot;
}

export class ChainPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ChainPolicyError';
  }
}
function check(condition: boolean, code: string): asserts condition {
  if (!condition) throw new ChainPolicyError(code);
}
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** Typed deterministic guard. Simulation/on-chain enforcement are still mandatory. */
export function prepareAction(
  snapshot: ExecutorSnapshot,
  input: unknown,
  operator: Address,
  nowMs = Date.now(),
  maxAgeMs = 30_000,
) {
  const action = actionRequestSchema.parse(input);
  const now = BigInt(Math.floor(nowMs / 1000));
  const mandate = snapshot.mandate;
  const amount = BigInt(action.amount);
  check(snapshot.chainId === 84532 && mandate.chainId === 84532n, 'WRONG_CHAIN');
  check(
    nowMs >= snapshot.observedAtMs &&
      nowMs - snapshot.observedAtMs <= maxAgeMs &&
      now >= snapshot.blockTimestamp &&
      now - snapshot.blockTimestamp <= BigInt(Math.floor(maxAgeMs / 1000)),
    'STALE_OBSERVATION',
  );
  check(
    snapshot.mandateVersion > 0n &&
      !snapshot.paused &&
      !snapshot.revoked &&
      now < mandate.expiresAt,
    'INACTIVE_MANDATE',
  );
  check(same(operator, mandate.operator) && !same(operator, snapshot.owner), 'WRONG_OPERATOR');
  check(
    same(mandate.asset, snapshot.token) && same(mandate.beneficiary, snapshot.owner),
    'INVALID_AUTHORITY',
  );
  check(BigInt(action.mandateVersion) === snapshot.mandateVersion, 'WRONG_VERSION');
  check(BigInt(action.nonce) === snapshot.nextActionNonce, 'WRONG_NONCE');
  check(
    BigInt(action.deadline) > now && BigInt(action.deadline) <= mandate.expiresAt,
    'INVALID_DEADLINE',
  );
  const isLiquid = same(action.target, snapshot.liquid.address);
  const isTimed = same(action.target, snapshot.timed.address);
  check(isLiquid || isTimed, 'UNKNOWN_TARGET');
  check((mandate.allowedVaults & (isLiquid ? 1 : 2)) !== 0, 'TARGET_NOT_ALLOWED');
  const vault = isLiquid ? snapshot.liquid : snapshot.timed;
  check((mandate.allowedActions & (action.kind === 'DEPOSIT' ? 1 : 2)) !== 0, 'ACTION_NOT_ALLOWED');
  if (action.kind === 'DEPOSIT') {
    check(!snapshot.allocationCompleted, 'ALLOCATION_COMPLETED');
    check(vault.riskLevel === 0, 'VAULT_DEGRADED');
    check(amount <= mandate.maxDepositPerAction, 'DEPOSIT_LIMIT');
    check(
      snapshot.cumulativeDeposited + amount <= mandate.maxCumulativeDeposits &&
        amount <= mandate.allocationTarget,
      'BUDGET_EXCEEDED',
    );
    check(amount <= snapshot.idleBalance, 'INSUFFICIENT_FUNDING');
    check(vault.lockupSeconds <= BigInt(mandate.maxLockupSeconds), 'LOCKUP_NOT_ALLOWED');
    check(
      vault.lockupSeconds === 0n || mandate.expiresAt > now + vault.lockupSeconds + 86400n,
      'EXPIRY_BEFORE_UNLOCK',
    );
  } else {
    check(amount <= mandate.maxWithdrawPerAction, 'WITHDRAWAL_LIMIT');
    check(
      now >= vault.unlockAt && amount <= vault.maxWithdraw && amount <= vault.principal,
      'WITHDRAWAL_UNAVAILABLE',
    );
  }
  const args = [
    action.actionId as Hex,
    BigInt(action.mandateVersion),
    BigInt(action.nonce),
    BigInt(action.deadline),
    action.target as Address,
    amount,
  ] as const;
  const functionName = action.kind === 'DEPOSIT' ? 'executeDeposit' : 'executeWithdraw';
  return {
    action,
    address: snapshot.executor,
    abi: boundraExecutorAbi,
    functionName,
    args,
    data: encodeFunctionData({ abi: boundraExecutorAbi, functionName, args }),
  } as const;
}
