import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import {
  boundraExecutorAbi,
  boundraFactoryAbi,
  mockUsdcAbi,
  mockUsdcFaucetAbi,
  toMandateStruct,
} from '@boundra/chain';
import type { ApprovedMandate } from './api';

/**
 * An unsigned transaction for the owner's own wallet. The SDK and MCP server only prepare these;
 * they never sign for the owner.
 */
export interface OwnerCall {
  to: Address;
  data: Hex;
  /** What the owner is agreeing to, in plain words. */
  description: string;
}

export type OwnerAction =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'revoke' }
  | { kind: 'recoverIdle'; amount: bigint }
  | { kind: 'ownerWithdraw'; vault: Address; amount: bigint };

/** The faucet's MockUSDC claim (testnet only). */
export function faucetClaimCall(faucet: Address): OwnerCall {
  return {
    to: getAddress(faucet),
    data: encodeFunctionData({ abi: mockUsdcFaucetAbi, functionName: 'claim' }),
    description: 'Claim test MockUSDC from the faucet. It has no value.',
  };
}

/** Creates the owner's executor through the trusted factory. */
export function createExecutorCall(factory: Address): OwnerCall {
  return {
    to: getAddress(factory),
    data: encodeFunctionData({ abi: boundraFactoryAbi, functionName: 'createExecutor' }),
    description: 'Create your Boundra executor, the contract that holds what you delegate.',
  };
}

/**
 * The owner transactions that activate an approved mandate, in order: set the mandate, allow
 * the executor to take the amount, then fund it. Built from the API's `ownerTransactions`.
 */
export function ownerAuthorizationCalls(approved: ApprovedMandate): OwnerCall[] {
  const { setMandate, approve, fund } = approved.ownerTransactions;
  const mandate = toMandateStruct(setMandate.args[0]);
  const executor = getAddress(setMandate.to);
  if (getAddress(fund.to) !== executor || getAddress(approve.args[0]) !== executor)
    throw new Error('Owner transactions do not target one executor');
  const amount = BigInt(fund.args[0]);
  if (BigInt(approve.args[1]) !== amount) throw new Error('Approval and funding amounts differ');
  return [
    {
      to: executor,
      data: encodeFunctionData({
        abi: boundraExecutorAbi,
        functionName: 'setMandate',
        args: [mandate],
      }),
      description: `Set the mandate: agent ${mandate.operator} may act within these limits until ${new Date(Number(mandate.expiresAt) * 1000).toISOString()}.`,
    },
    {
      to: getAddress(approve.to),
      data: encodeFunctionData({
        abi: mockUsdcAbi,
        functionName: 'approve',
        args: [executor, amount],
      }),
      description: `Allow your executor to take ${amount} MockUSDC base units from your wallet.`,
    },
    {
      to: executor,
      data: encodeFunctionData({ abi: boundraExecutorAbi, functionName: 'fund', args: [amount] }),
      description: `Move ${amount} MockUSDC base units into your executor.`,
    },
  ];
}

/** Owner-only controls on the executor. Each needs the owner's own wallet signature. */
export function ownerActionCall(executor: Address, action: OwnerAction): OwnerCall {
  const to = getAddress(executor);
  switch (action.kind) {
    case 'pause':
      return {
        to,
        data: encodeFunctionData({ abi: boundraExecutorAbi, functionName: 'pause' }),
        description: 'Pause the agent. It cannot act until you resume.',
      };
    case 'resume':
      return {
        to,
        data: encodeFunctionData({ abi: boundraExecutorAbi, functionName: 'resume' }),
        description: 'Resume the agent within the same mandate.',
      };
    case 'revoke':
      return {
        to,
        data: encodeFunctionData({ abi: boundraExecutorAbi, functionName: 'revoke' }),
        description: 'Revoke the mandate for good. The agent can never act on it again.',
      };
    case 'recoverIdle':
      return {
        to,
        data: encodeFunctionData({
          abi: boundraExecutorAbi,
          functionName: 'recoverIdle',
          args: [action.amount],
        }),
        description: `Take ${action.amount} idle MockUSDC base units back to your wallet.`,
      };
    case 'ownerWithdraw':
      return {
        to,
        data: encodeFunctionData({
          abi: boundraExecutorAbi,
          functionName: 'ownerWithdraw',
          args: [getAddress(action.vault), action.amount],
        }),
        description: `Withdraw ${action.amount} MockUSDC base units from the vault to your wallet.`,
      };
  }
}
