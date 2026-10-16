import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeAbiParameters,
  encodeEventTopics,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  keccak256,
  toHex,
  type Address,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BoundraChainReader, boundraExecutorAbi, type ExecutorSnapshot } from '@boundra/chain';
import {
  OperatorExecutionService,
  type ExecutionStore,
  type SignedAttempt,
  type SignerLease,
} from '../src/chain/execution';

const addr = (n: number) => toHex(n, { size: 20 }) as Address;
const blockHash = toHex(1n, { size: 32 });
function fixture() {
  // Public deterministic fixture key; never loaded from runtime or used outside unit tests.
  const account = privateKeyToAccount(toHex(1n, { size: 32 }));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const snapshot: ExecutorSnapshot = {
    chainId: 84532,
    blockNumber: 100n,
    blockHash,
    blockTimestamp: now,
    observedAtMs: Date.now(),
    owner: addr(2),
    executor: addr(3),
    token: addr(4),
    mandateVersion: 1n,
    nextActionNonce: 0n,
    cumulativeDeposited: 0n,
    idleBalance: 300000000n,
    paused: false,
    revoked: false,
    allocationCompleted: false,
    mandate: {
      chainId: 84532n,
      asset: addr(4),
      operator: account.address,
      beneficiary: addr(2),
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
      address: addr(5),
      principal: 0n,
      unlockAt: 0n,
      maxWithdraw: 0n,
      lockupSeconds: 0n,
      riskLevel: 0,
    },
    timed: {
      address: addr(6),
      principal: 0n,
      unlockAt: 0n,
      maxWithdraw: 0n,
      lockupSeconds: 2592000n,
      riskLevel: 0,
    },
  };
  const action = {
    actionId: toHex(2n, { size: 32 }),
    kind: 'DEPOSIT',
    mandateVersion: '1',
    nonce: '0',
    deadline: (now + 60n).toString(),
    target: addr(5),
    amount: '300000000',
  };
  let attempt: SignedAttempt | null = null;
  let broadcasts = 0;
  let nonceReservations = 0;
  let held = true;
  let receipt: TransactionReceipt | null = null;
  let ambiguous = false;
  let chainTime = now;
  let queue: Promise<unknown> = Promise.resolve();
  const lease: SignerLease = {
    fencingToken: 'fixture',
    assertHeld: async () => {
      if (!held) throw new Error('Lease lost');
    },
  };
  const store: ExecutionStore = {
    durable: true,
    withSignerLease: (_key, work) => {
      const pending = queue.then(() => work(lease));
      queue = pending.catch(() => {});
      return pending;
    },
    findAttempt: async () => attempt,
    reserveEoaNonce: async () => {
      nonceReservations++;
      return 7;
    },
    saveSignedAttempt: async (saved) => {
      assert.equal(attempt, null);
      attempt = saved;
    },
    reserveBroadcast: async (_id, maxAttempts) => broadcasts < maxAttempts,
    recordState: async (_id, state) => {
      assert.ok(attempt);
      attempt.state = state;
    },
  };
  const client = {
    getChainId: async () => 84532,
    simulateContract: async () => ({}),
    estimateGas: async () => 100000n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }),
    getTransactionCount: async () => 7,
    sendRawTransaction: async ({
      serializedTransaction,
    }: {
      serializedTransaction: `0x${string}`;
    }) => {
      assert.ok(attempt, 'Signed attempt must be saved before broadcast');
      broadcasts++;
      if (ambiguous) throw new Error('RPC timeout after accepting transaction');
      return keccak256(serializedTransaction);
    },
    getTransactionReceipt: async () => {
      if (!receipt) throw new Error('Not found');
      return receipt;
    },
    getBlock: async () => ({ hash: blockHash, timestamp: chainTime }),
    getBlockNumber: async () => 104n,
  };
  const reader = {
    manifest: { riskAdmin: addr(9) },
    confirmations: 5,
    client,
    snapshot: async () => snapshot,
  } as unknown as BoundraChainReader;
  const service = new OperatorExecutionService(reader, account, store, {
    maxGas: 500000n,
    maxFeePerGas: 10n,
    maxPriorityFeePerGas: 2n,
  });
  return {
    account,
    snapshot,
    action,
    service,
    client,
    store,
    getAttempt: () => attempt,
    count: () => ({ broadcasts, nonceReservations }),
    loseLease: () => {
      held = false;
    },
    timeout: () => {
      ambiguous = true;
    },
    networkRecovered: () => {
      ambiguous = false;
    },
    setChainTime: (value: bigint) => {
      chainTime = value;
    },
    receipt: (value: TransactionReceipt) => {
      receipt = value;
    },
  };
}

test('persists before broadcast and retries an ambiguous result without a second signature/nonce', async () => {
  const f = fixture();
  f.timeout();
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'RECONCILE');
  const signed = f.getAttempt();
  assert.ok(signed);
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'RECONCILE');
  assert.deepEqual(f.count(), { broadcasts: 1, nonceReservations: 1 });
  assert.equal(f.getAttempt()?.rawTransaction, signed.rawTransaction);
});

test('serializes competing calls through the durable signer lease', async () => {
  const f = fixture();
  await Promise.all([
    f.service.execute(addr(2), addr(3), f.action),
    f.service.execute(addr(2), addr(3), f.action),
  ]);
  assert.deepEqual(f.count(), { broadcasts: 1, nonceReservations: 1 });
  await assert.rejects(
    () => f.service.execute(addr(2), addr(3), { ...f.action, amount: '1' }),
    (e) => (e as { code?: string }).code === 'ACTION_ID_CONFLICT',
  );
});

test('confirms only a matching canonical execution event and detects a later reorg', async () => {
  const f = fixture();
  await f.service.execute(addr(2), addr(3), f.action);
  const saved = f.getAttempt();
  assert.ok(saved);
  const topics = encodeEventTopics({
    abi: boundraExecutorAbi,
    eventName: 'ActionExecuted',
    args: { actionId: f.action.actionId, version: 1n, target: addr(5) },
  });
  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }],
    [0n, 1, 300000000n],
  );
  f.receipt({
    status: 'success',
    to: addr(3),
    from: f.account.address,
    blockNumber: 100n,
    blockHash,
    transactionHash: saved.transactionHash,
    logs: [{ address: addr(3), topics, data }],
  } as unknown as TransactionReceipt);
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'CONFIRMED');
  f.client.getBlock = async () => ({
    hash: toHex(99n, { size: 32 }),
    timestamp: f.snapshot.blockTimestamp,
  });
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'RECONCILE');
  assert.equal(f.count().broadcasts, 1);
});

test('lease loss or gas cap prevents signing/broadcast', async () => {
  for (const reason of ['lease', 'gas']) {
    const f = fixture();
    if (reason === 'lease') f.loseLease();
    else f.client.estimateGas = async () => 1000000n;
    await assert.rejects(() => f.service.execute(addr(2), addr(3), f.action));
    assert.equal(f.getAttempt(), null);
    assert.equal(f.count().broadcasts, 0);
  }
});

test('recovers crash after persistence using identical signed bytes and a bounded retry budget', async () => {
  const f = fixture();
  const reserve = f.store.reserveBroadcast;
  f.store.reserveBroadcast = async () => {
    throw new Error('Process crash before network call');
  };
  await assert.rejects(() => f.service.execute(addr(2), addr(3), f.action));
  const saved = f.getAttempt();
  assert.ok(saved);
  assert.equal(saved.state, 'SIGNED');
  assert.equal(f.count().broadcasts, 0);
  f.store.reserveBroadcast = reserve;
  f.client.getTransactionReceipt = async () => {
    throw new TransactionReceiptNotFoundError({ hash: saved.transactionHash });
  };
  Object.assign(f.client, {
    getTransaction: async () => {
      throw new TransactionNotFoundError({ hash: saved.transactionHash });
    },
  });
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'BROADCAST');
  assert.equal(f.count().nonceReservations, 1);
  assert.equal(f.getAttempt()?.rawTransaction, saved.rawTransaction);
  await f.service.execute(addr(2), addr(3), f.action);
  await f.service.execute(addr(2), addr(3), f.action);
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'RECONCILE');
  assert.equal(f.count().broadcasts, 3, 'Retry count must remain bounded across restarts');
});

test('a consumed EOA nonce with no receipt never causes another broadcast', async () => {
  const f = fixture();
  await f.service.execute(addr(2), addr(3), f.action);
  const saved = f.getAttempt();
  assert.ok(saved);
  f.client.getTransactionReceipt = async () => {
    throw new TransactionReceiptNotFoundError({ hash: saved.transactionHash });
  };
  Object.assign(f.client, {
    getTransaction: async () => {
      throw new TransactionNotFoundError({ hash: saved.transactionHash });
    },
  });
  f.client.getTransactionCount = async () => 8;
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'RECONCILE');
  assert.equal(f.count().broadcasts, 1);
});

function missingFromChain(f: ReturnType<typeof fixture>, saved: SignedAttempt) {
  f.client.getTransactionReceipt = async () => {
    throw new TransactionReceiptNotFoundError({ hash: saved.transactionHash });
  };
  Object.assign(f.client, {
    getTransaction: async () => {
      throw new TransactionNotFoundError({ hash: saved.transactionHash });
    },
  });
}

test('a policy change before the deadline holds the reserved nonce without resending', async () => {
  const f = fixture();
  const reserve = f.store.reserveBroadcast;
  f.store.reserveBroadcast = async () => {
    throw new Error('Process crash before network call');
  };
  await assert.rejects(() => f.service.execute(addr(2), addr(3), f.action));
  const saved = f.getAttempt();
  assert.ok(saved);
  f.store.reserveBroadcast = reserve;
  missingFromChain(f, saved);
  f.snapshot.paused = true;
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'RECONCILE');
  assert.equal(
    f.count().broadcasts,
    0,
    'A paused mandate must not be overridden by an old candidate',
  );
  // Once the deadline passes the signed bytes can only revert, which safely consumes the nonce.
  f.setChainTime(BigInt(f.action.deadline));
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'BROADCAST');
  assert.equal(f.count().broadcasts, 1);
  assert.equal(f.getAttempt()?.rawTransaction, saved.rawTransaction);
});

test('an expired attempt releases its nonce after the normal retry budget is exhausted', async () => {
  const f = fixture();
  f.timeout();
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'RECONCILE');
  const saved = f.getAttempt();
  assert.ok(saved);
  missingFromChain(f, saved);
  await f.service.execute(addr(2), addr(3), f.action);
  await f.service.execute(addr(2), addr(3), f.action);
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'RECONCILE');
  assert.equal(f.count().broadcasts, 3);
  f.networkRecovered();
  f.setChainTime(BigInt(f.action.deadline) + 1n);
  assert.equal(await f.service.execute(addr(2), addr(3), f.action), 'BROADCAST');
  assert.deepEqual(f.count(), { broadcasts: 4, nonceReservations: 1 });
  assert.equal(f.getAttempt()?.rawTransaction, saved.rawTransaction);
  for (let i = 0; i < 5; i++) await f.service.execute(addr(2), addr(3), f.action);
  assert.equal(f.count().broadcasts, 6, 'Release sends remain bounded');
});
