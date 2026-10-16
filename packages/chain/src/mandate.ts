import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from 'viem';
import { mandateTupleSchema, type MandateTuple } from '@boundra/shared';
import type { Mandate } from './policy';

/** Same component order and types as `BoundraExecutor.Mandate`. */
const mandateComponents = [
  { name: 'chainId', type: 'uint256' },
  { name: 'asset', type: 'address' },
  { name: 'operator', type: 'address' },
  { name: 'beneficiary', type: 'address' },
  { name: 'expiresAt', type: 'uint64' },
  { name: 'allowedVaults', type: 'uint8' },
  { name: 'allowedActions', type: 'uint8' },
  { name: 'maxLockupSeconds', type: 'uint32' },
  { name: 'maxDepositPerAction', type: 'uint256' },
  { name: 'maxCumulativeDeposits', type: 'uint256' },
  { name: 'maxWithdrawPerAction', type: 'uint256' },
  { name: 'allocationTarget', type: 'uint256' },
] as const;

/** Converts the wire tuple into the struct passed to `setMandate`. */
export function toMandateStruct(input: MandateTuple): Mandate {
  const t = mandateTupleSchema.parse(input);
  return {
    chainId: BigInt(t.chainId),
    asset: getAddress(t.asset),
    operator: getAddress(t.operator),
    beneficiary: getAddress(t.beneficiary),
    expiresAt: BigInt(t.expiresAt),
    allowedVaults: t.allowedVaults,
    allowedActions: t.allowedActions,
    maxLockupSeconds: Number(t.maxLockupSeconds),
    maxDepositPerAction: BigInt(t.maxDepositPerAction),
    maxCumulativeDeposits: BigInt(t.maxCumulativeDeposits),
    maxWithdrawPerAction: BigInt(t.maxWithdrawPerAction),
    allocationTarget: BigInt(t.allocationTarget),
  };
}

/** `keccak256(abi.encode(mandate))`, the hash the executor emits in `MandateSet`. */
export function hashMandate(input: MandateTuple): Hex {
  const m = toMandateStruct(input);
  return keccak256(
    encodeAbiParameters(
      [{ type: 'tuple', components: mandateComponents }],
      [{ ...m, operator: m.operator as Address }],
    ),
  );
}

/** Field-by-field equality between an on-chain mandate and an approved tuple. */
export function sameMandate(onchain: Mandate, approved: MandateTuple): boolean {
  const expected = toMandateStruct(approved);
  return (
    onchain.chainId === expected.chainId &&
    onchain.asset.toLowerCase() === expected.asset.toLowerCase() &&
    onchain.operator.toLowerCase() === expected.operator.toLowerCase() &&
    onchain.beneficiary.toLowerCase() === expected.beneficiary.toLowerCase() &&
    onchain.expiresAt === expected.expiresAt &&
    onchain.allowedVaults === expected.allowedVaults &&
    onchain.allowedActions === expected.allowedActions &&
    onchain.maxLockupSeconds === expected.maxLockupSeconds &&
    onchain.maxDepositPerAction === expected.maxDepositPerAction &&
    onchain.maxCumulativeDeposits === expected.maxCumulativeDeposits &&
    onchain.maxWithdrawPerAction === expected.maxWithdrawPerAction &&
    onchain.allocationTarget === expected.allocationTarget
  );
}
