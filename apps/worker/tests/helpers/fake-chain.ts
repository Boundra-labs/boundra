import { randomBytes } from 'node:crypto';
import {
  keccak256,
  parseTransaction,
  toHex,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { BoundraChainReader, ExecutorSnapshot } from '@boundra/chain';

export const randomAddress = () => `0x${randomBytes(20).toString('hex')}` as Address;
export const randomHash = () => `0x${randomBytes(32).toString('hex')}` as Hash;

/**
 * In-memory chain for exercising the execution/monitor services against real persistence.
 * Network behaviour (timeouts, mempool, receipts) is scripted per test.
 */
export function fakeChain() {
  // Random per-run operator key: tests never share a signer lease or nonce space.
  const account = privateKeyToAccount(toHex(randomBytes(32)));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const blockHash = randomHash();
  const sent: string[] = [];
  const receipts = new Map<string, TransactionReceipt>();
  // Accepted-but-unmined transactions, as an RPC node's mempool would report them.
  const mempool = new Map<string, Address>();
  const state = { pendingNonce: 7, confirmedNonce: 7, failSend: false, chainTime: now };
  const snapshots = new Map<string, ExecutorSnapshot>();
  const liquid = randomAddress();
  const timed = randomAddress();

  function snapshotFor(owner: Address, executor: Address): ExecutorSnapshot {
    const key = executor.toLowerCase();
    let snapshot = snapshots.get(key);
    if (!snapshot) {
      const token = randomAddress();
      snapshot = {
        chainId: 84532,
        blockNumber: 100n,
        blockHash,
        blockTimestamp: now,
        observedAtMs: Date.now(),
        owner,
        executor,
        token,
        mandateVersion: 1n,
        nextActionNonce: 0n,
        cumulativeDeposited: 0n,
        idleBalance: 300000000n,
        paused: false,
        revoked: false,
        allocationCompleted: false,
        mandate: {
          chainId: 84532n,
          asset: token,
          operator: account.address,
          beneficiary: owner,
          expiresAt: now + 604800n,
          allowedVaults: 1,
          allowedActions: 3,
          maxLockupSeconds: 0,
          maxDepositPerAction: 300000000n,
          maxCumulativeDeposits: 300000000n,
          maxWithdrawPerAction: 300000000n,
          allocationTarget: 300000000n,
        },
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
          lockupSeconds: 2592000n,
          riskLevel: 0,
        },
      };
      snapshots.set(key, snapshot);
    }
    return { ...snapshot, observedAtMs: Date.now(), blockTimestamp: state.chainTime };
  }
  const client = {
    getChainId: async () => 84532,
    simulateContract: async () => ({}),
    estimateGas: async () => 100000n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }),
    getTransactionCount: async ({ blockTag }: { blockTag: string }) =>
      blockTag === 'pending' ? state.pendingNonce : state.confirmedNonce,
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hash }) => {
      sent.push(serializedTransaction);
      if (state.failSend) throw new Error('RPC timeout after accepting transaction');
      const hash = keccak256(serializedTransaction);
      if (!mempool.has(hash)) {
        mempool.set(hash, parseTransaction(serializedTransaction).to as Address);
        state.pendingNonce++;
      }
      return hash;
    },
    getTransactionReceipt: async ({ hash }: { hash: Hash }) => {
      const receipt = receipts.get(hash);
      if (!receipt) throw new TransactionReceiptNotFoundError({ hash });
      return receipt;
    },
    getTransaction: async ({ hash }: { hash: Hash }) => {
      const to = mempool.get(hash);
      if (!to) throw new TransactionNotFoundError({ hash });
      return { hash, from: account.address, to, blockNumber: null };
    },
    getBlock: async () => ({ hash: blockHash, timestamp: state.chainTime }),
    getBlockNumber: async () => 104n,
  };
  const reader = {
    manifest: { riskAdmin: randomAddress() },
    confirmations: 5,
    client,
    snapshot: async (owner: Address, executor: Address) => snapshotFor(owner, executor),
  } as unknown as BoundraChainReader;

  function depositAction(actionId: Hash = randomHash()) {
    return {
      actionId,
      kind: 'DEPOSIT',
      mandateVersion: '1',
      nonce: '0',
      deadline: (now + 300n).toString(),
      target: liquid,
      amount: '300000000',
    };
  }

  return {
    account,
    reader,
    client,
    state,
    sent,
    receipts,
    mempool,
    depositAction,
    liquid,
    timed,
    now,
  };
}
