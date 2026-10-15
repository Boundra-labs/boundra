import { randomBytes } from 'node:crypto';
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseTransaction,
  toHex,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { boundraExecutorAbi, type BoundraChainReader, type ExecutorSnapshot } from '@boundra/chain';

export const randomAddress = () => `0x${randomBytes(20).toString('hex')}` as Address;
export const randomHash = () => `0x${randomBytes(32).toString('hex')}` as Hash;

/**
 * In-memory chain for exercising the execution/monitor services and the orchestrator against
 * real persistence. `mine` applies a signed executor call to the snapshot like the contract
 * would and publishes a canonical receipt with the ActionExecuted event.
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
  const token = randomAddress();
  const manifest = {
    chainId: 84532,
    factory: randomAddress(),
    mockUsdc: token,
    faucet: randomAddress(),
    liquidVault: liquid,
    timedVault: timed,
    riskAdmin: randomAddress(),
    deploymentBlock: '1',
  };

  function snapshotOf(owner: Address, executor: Address): ExecutorSnapshot {
    const key = executor.toLowerCase();
    let snapshot = snapshots.get(key);
    if (!snapshot) {
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
    return snapshot;
  }
  const observed = (owner: Address, executor: Address) => ({
    ...snapshotOf(owner, executor),
    observedAtMs: Date.now(),
    blockTimestamp: state.chainTime,
  });

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
      if (!mempool.has(hash) && !receipts.has(hash)) {
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
    manifest,
    confirmations: 5,
    client,
    snapshot: async (owner: Address, executor: Address) => observed(owner, executor),
  } as unknown as BoundraChainReader;

  /** Includes a pending signed executor call in a block and applies its effect. */
  function mine(raw: Hex) {
    const hash = keccak256(raw);
    const tx = parseTransaction(raw);
    const executor = tx.to as Address;
    const { functionName, args } = decodeFunctionData({ abi: boundraExecutorAbi, data: tx.data! });
    const [actionId, version, nonce, , target, amount] = args as readonly [
      Hash,
      bigint,
      bigint,
      bigint,
      Address,
      bigint,
    ];
    const s = snapshots.get(executor.toLowerCase())!;
    const vault = target.toLowerCase() === liquid.toLowerCase() ? s.liquid : s.timed;
    if (functionName === 'executeDeposit') {
      s.idleBalance -= amount;
      s.cumulativeDeposited += amount;
      s.allocationCompleted = true;
      vault.principal += amount;
      vault.maxWithdraw = vault.principal;
    } else {
      vault.principal -= amount;
      vault.maxWithdraw = vault.maxWithdraw > amount ? vault.maxWithdraw - amount : 0n;
    }
    s.nextActionNonce++;
    mempool.delete(hash);
    state.confirmedNonce++;
    const topics = encodeEventTopics({
      abi: boundraExecutorAbi,
      eventName: 'ActionExecuted',
      args: { actionId, version, target },
    });
    const data = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }],
      [nonce, functionName === 'executeDeposit' ? 1 : 2, amount],
    );
    receipts.set(hash, {
      status: 'success',
      to: executor,
      from: account.address,
      blockNumber: 100n,
      blockHash,
      transactionHash: hash,
      logs: [{ address: executor, topics, data }],
    } as unknown as TransactionReceipt);
    return hash;
  }

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
    manifest,
    token,
    snapshotOf,
    mine,
    depositAction,
    liquid,
    timed,
    now,
  };
}
