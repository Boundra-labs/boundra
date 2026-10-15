import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import {
  assertFenced,
  createDatabaseClient,
  enqueueJob,
  JobQueue,
  LeaseBusyError,
  LeaseLostError,
  LeaseManager,
  type PrismaClient,
} from '@boundra/database';
import {
  encodeAbiParameters,
  encodeEventTopics,
  toHex,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { boundraExecutorAbi, type BoundraChainReader } from '@boundra/chain';
import { OperatorExecutionService, type ExecutionStore } from '../src/chain/execution';
import { RiskEventMonitor, type RiskObservation } from '../src/chain/monitor';
import { AttemptCipher } from '../src/persistence/cipher';
import { PostgresExecutionStore } from '../src/persistence/execution-store';
import {
  CursorConflictError,
  EVALUATE_RISK_JOB,
  PostgresMonitorStore,
} from '../src/persistence/monitor-store';
import { fakeChain, randomAddress, randomHash } from './helpers/fake-chain';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const limits = { maxGas: 500000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 2n };
let db: PrismaClient;
let leases: LeaseManager;
const cipher = new AttemptCipher(randomBytes(32).toString('hex'));
const cleanup = {
  leaseKeys: new Set<string>(),
  actionIds: new Set<string>(),
  jobKinds: new Set<string>(),
  cursorKeys: new Set<string>(),
  txHashes: new Set<string>(),
};

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  db = createDatabaseClient(process.env.DATABASE_URL);
  await db.$connect();
  leases = new LeaseManager(db, { ttlMs: 2_000, waitMs: 10_000 });
});

after(async () => {
  const actionIds = [...cleanup.actionIds];
  await db.attemptEvent.deleteMany({ where: { actionId: { in: actionIds } } });
  await db.transactionAttempt.deleteMany({ where: { actionId: { in: actionIds } } });
  await db.eoaNonceReservation.deleteMany({ where: { actionId: { in: actionIds } } });
  await db.lease.deleteMany({ where: { key: { in: [...cleanup.leaseKeys] } } });
  await db.job.deleteMany({ where: { kind: { in: [...cleanup.jobKinds] } } });
  const events = await db.riskEvent.findMany({
    where: { txHash: { in: [...cleanup.txHashes] } },
    select: { id: true },
  });
  await db.job.deleteMany({
    where: {
      kind: EVALUATE_RISK_JOB,
      OR: events.map((event) => ({ payload: { path: ['riskEventId'], equals: event.id } })),
    },
  });
  await db.riskEvent.deleteMany({ where: { txHash: { in: [...cleanup.txHashes] } } });
  await db.monitorCursor.deleteMany({ where: { key: { in: [...cleanup.cursorKeys] } } });
  await db.$disconnect();
});

function leaseKey() {
  const key = `test:${randomUUID()}`;
  cleanup.leaseKeys.add(key);
  return key;
}

describe('lease manager', () => {
  test('serializes holders of the same key and issues increasing fencing tokens', async () => {
    const key = leaseKey();
    const log: string[] = [];
    const tokens: bigint[] = [];
    await Promise.all(
      [1, 2].map((n) =>
        leases.withLease(key, async (lease) => {
          log.push(`enter${n}`);
          tokens.push(BigInt(lease.fencingToken));
          await sleep(150);
          log.push(`exit${n}`);
        }),
      ),
    );
    assert.match(log.join(','), /^enter(\d),exit\1,enter(\d),exit\2$/);
    assert.ok(tokens[1]! > tokens[0]!);
  });

  test('an expired holder is fenced out after another worker takes over', async () => {
    const key = leaseKey();
    const stale = await leases.tryAcquire(key, 200);
    assert.ok(stale);
    await sleep(300);
    await leases.withLease(key, async (current) => {
      assert.ok(BigInt(current.fencingToken) > BigInt(stale.fencingToken));
      await assert.rejects(stale.assertHeld(), LeaseLostError);
      await assert.rejects(
        db.$transaction((tx) => assertFenced(tx, stale)),
        LeaseLostError,
      );
      await db.$transaction((tx) => assertFenced(tx, current));
    });
  });

  test('a busy lease fails with LEASE_BUSY after the bounded wait', async () => {
    const key = leaseKey();
    const holder = await leases.tryAcquire(key, 5_000);
    assert.ok(holder);
    await assert.rejects(
      leases.withLease(key, async () => {}, { waitMs: 200 }),
      LeaseBusyError,
    );
    await leases.release(holder);
  });
});

describe('job queue', () => {
  const kind = () => {
    const value = `test-${randomUUID()}`;
    cleanup.jobKinds.add(value);
    return value;
  };

  test('enqueue is idempotent per key', async () => {
    const k = kind();
    assert.equal(await enqueueJob(db, { key: `${k}:1`, kind: k, payload: {} }), true);
    assert.equal(await enqueueJob(db, { key: `${k}:1`, kind: k, payload: { other: 1 } }), false);
    assert.equal(await db.job.count({ where: { kind: k } }), 1);
  });

  test('concurrent workers claim disjoint jobs', async () => {
    const k = kind();
    for (let i = 0; i < 20; i++)
      await enqueueJob(db, { key: `${k}:${i}`, kind: k, payload: { i } });
    const queue = new JobQueue(db);
    const claims = await Promise.all(
      ['worker-a', 'worker-b', 'worker-c'].map((owner) =>
        queue.claim(owner, { limit: 10, kinds: [k] }),
      ),
    );
    const ids = claims.flat().map((job) => job.id);
    assert.equal(ids.length, 20);
    assert.equal(new Set(ids).size, 20, 'No job may be claimed twice');
  });

  test('a crashed worker’s job is reclaimed and the old owner can no longer complete it', async () => {
    const k = kind();
    await enqueueJob(db, { key: `${k}:1`, kind: k, payload: {} });
    const queue = new JobQueue(db);
    const [crashed] = await queue.claim('crashed', { kinds: [k], leaseMs: 100 });
    assert.ok(crashed);
    await sleep(200);
    const [reclaimed] = await queue.claim('healthy', { kinds: [k] });
    assert.equal(reclaimed?.id, crashed.id);
    assert.equal(reclaimed?.attempts, 2);
    assert.equal(await queue.complete(crashed), false);
    assert.equal(await queue.complete(reclaimed!), true);
  });

  test('retries back off and fail once attempts are exhausted', async () => {
    const k = kind();
    await enqueueJob(db, { key: `${k}:1`, kind: k, payload: {}, maxAttempts: 2 });
    const queue = new JobQueue(db);
    const [first] = await queue.claim('w', { kinds: [k] });
    assert.equal(await queue.retry(first!, 'boom', 0), 'RETRY');
    const [second] = await queue.claim('w', { kinds: [k] });
    assert.equal(await queue.retry(second!, 'boom again', 0), 'FAILED');
    assert.deepEqual(await queue.claim('w', { kinds: [k] }), []);
    const row = await db.job.findFirstOrThrow({ where: { kind: k } });
    assert.equal(row.status, 'FAILED');
    assert.equal(row.lastError, 'boom again');
  });
});

describe('PostgresExecutionStore with the operator execution service', () => {
  function setup(store?: ExecutionStore) {
    const chain = fakeChain();
    cleanup.leaseKeys.add(`signer:84532:${chain.account.address.toLowerCase()}`);
    const pgStore = new PostgresExecutionStore(db, leases, cipher);
    const service = new OperatorExecutionService(
      chain.reader,
      chain.account,
      store ?? pgStore,
      limits,
    );
    const action = chain.depositAction();
    cleanup.actionIds.add(action.actionId);
    return { chain, pgStore, service, action, owner: randomAddress(), executor: randomAddress() };
  }

  test('persists an encrypted signed attempt before broadcast and records history', async () => {
    const s = setup();
    assert.equal(await s.service.execute(s.owner, s.executor, s.action), 'BROADCAST');
    const row = await db.transactionAttempt.findUniqueOrThrow({
      where: { actionId: s.action.actionId },
    });
    assert.equal(row.state, 'BROADCAST');
    assert.equal(row.sendCount, 1);
    assert.equal(row.eoaNonce, 7n);
    assert.ok(!Buffer.from(row.rawTxCiphertext).toString('utf8').includes('0x02'));
    const found = await s.pgStore.findAttempt(s.action.actionId as Hash);
    assert.equal(found?.rawTransaction, s.chain.sent[0]);
    const history = await db.attemptEvent.findMany({
      where: { actionId: s.action.actionId },
      orderBy: { id: 'asc' },
    });
    assert.deepEqual(
      history.map((event) => event.state),
      ['SIGNED', 'BROADCAST'],
    );
  });

  test('two workers executing the same action produce one signature and one broadcast', async () => {
    const s = setup();
    const second = new OperatorExecutionService(
      s.chain.reader,
      s.chain.account,
      new PostgresExecutionStore(db, leases, cipher),
      limits,
    );
    const results = await Promise.all([
      s.service.execute(s.owner, s.executor, s.action),
      second.execute(s.owner, s.executor, s.action),
    ]);
    assert.deepEqual(results.sort(), ['BROADCAST', 'BROADCAST']);
    assert.equal(s.chain.sent.length, 1);
    assert.equal(await db.eoaNonceReservation.count({ where: { actionId: s.action.actionId } }), 1);
  });

  test('different actions for one operator receive distinct EOA nonces', async () => {
    const s = setup();
    const other = s.chain.depositAction();
    cleanup.actionIds.add(other.actionId);
    await Promise.all([
      s.service.execute(s.owner, s.executor, s.action),
      s.service.execute(randomAddress(), randomAddress(), other),
    ]);
    const nonces = await db.eoaNonceReservation.findMany({
      where: { actionId: { in: [s.action.actionId, other.actionId] } },
      select: { eoaNonce: true },
    });
    assert.deepEqual(nonces.map((row) => row.eoaNonce).sort(), [7n, 8n]);
  });

  test('a reservation abandoned by a crashed holder is reclaimed, never doubled', async () => {
    const s = setup();
    const abandoned = randomHash();
    cleanup.actionIds.add(abandoned);
    const key = `signer:84532:${s.chain.account.address.toLowerCase()}`;
    const crashed = await leases.tryAcquire(key, 200);
    assert.ok(crashed);
    assert.equal(await s.pgStore.reserveEoaNonce(abandoned, 7, crashed), 7);
    await sleep(300);
    assert.equal(await s.service.execute(s.owner, s.executor, s.action), 'BROADCAST');
    const attempt = await db.transactionAttempt.findUniqueOrThrow({
      where: { actionId: s.action.actionId },
    });
    assert.equal(attempt.eoaNonce, 7n, 'The unsigned nonce is reused');
    const old = await db.eoaNonceReservation.findUniqueOrThrow({ where: { actionId: abandoned } });
    assert.equal(old.status, 'RELEASED');
    // The crashed holder can no longer write anything.
    await assert.rejects(
      s.pgStore.recordState(s.action.actionId as Hash, 'RECONCILE', {}, crashed),
      LeaseLostError,
    );
  });

  test('broadcast budget and interval are persisted across store instances', async () => {
    const s = setup();
    s.chain.state.failSend = true;
    assert.equal(await s.service.execute(s.owner, s.executor, s.action), 'RECONCILE');
    const restarted = new PostgresExecutionStore(db, leases, cipher);
    await restarted.withSignerLease(`84532:${s.chain.account.address}`, async (lease) => {
      const id = s.action.actionId as Hash;
      assert.equal(await restarted.reserveBroadcast(id, 3, 10_000, lease), false, 'interval');
      assert.equal(await restarted.reserveBroadcast(id, 3, 0, lease), true);
      assert.equal(await restarted.reserveBroadcast(id, 3, 0, lease), true);
      assert.equal(await restarted.reserveBroadcast(id, 3, 0, lease), false, 'budget');
    });
  });

  test('a crash after persistence recovers with identical bytes and confirms from the receipt', async () => {
    const s = setup();
    const crashing: ExecutionStore = Object.assign(Object.create(s.pgStore), {
      reserveBroadcast: async () => {
        throw new Error('Process crash before network call');
      },
    });
    const first = new OperatorExecutionService(s.chain.reader, s.chain.account, crashing, limits);
    await assert.rejects(first.execute(s.owner, s.executor, s.action));
    const saved = await s.pgStore.findAttempt(s.action.actionId as Hash);
    assert.equal(saved?.state, 'SIGNED');
    assert.equal(s.chain.sent.length, 0);

    // Fresh process: new store and service instances over the same database.
    const restarted = new OperatorExecutionService(
      s.chain.reader,
      s.chain.account,
      new PostgresExecutionStore(db, leases, cipher),
      limits,
    );
    assert.equal(await restarted.execute(s.owner, s.executor, s.action), 'BROADCAST');
    assert.deepEqual(s.chain.sent, [saved!.rawTransaction]);

    const topics = encodeEventTopics({
      abi: boundraExecutorAbi,
      eventName: 'ActionExecuted',
      args: { actionId: s.action.actionId as Hash, version: 1n, target: s.chain.liquid },
    });
    const data = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }],
      [0n, 1, 300000000n],
    );
    const blockHash = (await s.chain.client.getBlock()).hash;
    s.chain.receipts.set(saved!.transactionHash, {
      status: 'success',
      to: s.executor,
      from: s.chain.account.address,
      blockNumber: 100n,
      blockHash,
      transactionHash: saved!.transactionHash,
      logs: [{ address: s.executor, topics, data }],
    } as unknown as TransactionReceipt);
    assert.equal(await restarted.execute(s.owner, s.executor, s.action), 'CONFIRMED');
    const row = await db.transactionAttempt.findUniqueOrThrow({
      where: { actionId: s.action.actionId },
    });
    assert.equal(row.state, 'CONFIRMED');
    assert.equal(row.receiptBlockNumber?.toFixed(0), '100');
    assert.equal(row.receiptBlockHash, blockHash.toLowerCase());
    assert.equal(s.chain.sent.length, 1);
    assert.equal(await db.eoaNonceReservation.count({ where: { actionId: s.action.actionId } }), 1);
  });
});

describe('PostgresMonitorStore', () => {
  function observation(blockNumber: bigint, overrides: Partial<RiskObservation> = {}) {
    const txHash = randomHash();
    cleanup.txHashes.add(txHash.toLowerCase());
    return {
      chainId: 84532 as const,
      source: randomAddress(),
      transactionHash: txHash,
      logIndex: 0,
      blockNumber,
      blockHash: randomHash(),
      eventRiskLevel: 1,
      eventCapacity: 100n,
      observedAtBlock: blockNumber + 5n,
      observedAtBlockHash: randomHash(),
      currentRiskLevel: 1,
      currentCapacity: 100n,
      ...overrides,
    } satisfies RiskObservation;
  }
  function cursorKey() {
    const key = `84532:${randomAddress()}:risk`;
    cleanup.cursorKeys.add(key);
    cleanup.leaseKeys.add(`monitor:${key}`);
    return key;
  }
  const jobsFor = (txHash: string) =>
    db.riskEvent
      .findUniqueOrThrow({
        where: {
          chainId_txHash_logIndex: { chainId: 84532, txHash: txHash.toLowerCase(), logIndex: 0 },
        },
      })
      .then((event) =>
        db.job.findMany({
          where: { kind: EVALUATE_RISK_JOB, payload: { path: ['riskEventId'], equals: event.id } },
        }),
      );
  // Block numbers far above any real fixture so rewinds stay inside this test's range.
  const base = 10_000_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)) * 1_000n;

  test('cursor commits are compare-and-set and overlap rescans add no new work', async () => {
    const store = new PostgresMonitorStore(db, leases);
    const key = cursorKey();
    const event = observation(base + 10n);
    const first = { nextBlock: base + 20n, previousBlockHash: randomHash() };
    await store.withMonitorLease(key, async (lease) => {
      await store.commitBatch(key, null, first, [event], lease);
      await assert.rejects(store.commitBatch(key, null, first, [], lease), CursorConflictError);
      const second = { nextBlock: base + 40n, previousBlockHash: randomHash() };
      // Overlapping rescan delivers the same event again.
      await store.commitBatch(key, first, second, [event], lease);
      assert.deepEqual(await store.readCursor(key), {
        nextBlock: second.nextBlock,
        previousBlockHash: second.previousBlockHash.toLowerCase(),
      });
    });
    assert.equal((await jobsFor(event.transactionHash)).length, 1);
  });

  test('rewind orphans observations, cancels pending work and re-evaluates reinstated events', async () => {
    const store = new PostgresMonitorStore(db, leases);
    const key = cursorKey();
    const kept = observation(base + 100n);
    const dropped = observation(base + 200n);
    await store.withMonitorLease(key, async (lease) => {
      const next = { nextBlock: base + 300n, previousBlockHash: randomHash() };
      await store.commitBatch(key, null, next, [kept, dropped], lease);
      await store.rewind(key, base + 150n, lease);
      assert.deepEqual(await store.readCursor(key), {
        nextBlock: base + 150n,
        previousBlockHash: null,
      });
    });
    const status = async (o: RiskObservation) =>
      (
        await db.riskEvent.findUniqueOrThrow({
          where: {
            chainId_txHash_logIndex: {
              chainId: 84532,
              txHash: o.transactionHash.toLowerCase(),
              logIndex: 0,
            },
          },
        })
      ).status;
    assert.equal(await status(kept), 'CANONICAL');
    assert.equal(await status(dropped), 'ORPHANED');
    const cancelled = await jobsFor(dropped.transactionHash);
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0]!.status, 'FAILED');
    assert.equal(cancelled[0]!.lastError, 'RISK_EVENT_ORPHANED');

    // The same log is canonical again on the replacement branch.
    await store.withMonitorLease(key, async (lease) => {
      const cursor = await store.readCursor(key);
      await store.commitBatch(
        key,
        cursor,
        { nextBlock: base + 400n, previousBlockHash: randomHash() },
        [dropped],
        lease,
      );
    });
    assert.equal(await status(dropped), 'CANONICAL');
    const jobs = await jobsFor(dropped.transactionHash);
    assert.deepEqual(jobs.map((job) => job.status).sort(), ['FAILED', 'PENDING']);
  });

  test('a stale monitor holder cannot commit', async () => {
    const store = new PostgresMonitorStore(db, leases);
    const key = cursorKey();
    const stale = await leases.tryAcquire(`monitor:${key}`, 200);
    assert.ok(stale);
    await sleep(300);
    await assert.rejects(
      store.commitBatch(key, null, { nextBlock: 1n, previousBlockHash: randomHash() }, [], stale),
      LeaseLostError,
    );
  });

  test('the risk monitor commits a confirmed batch through PostgreSQL and rewinds on reorg', async () => {
    const factory = randomAddress();
    const liquid = randomAddress();
    const deployment = base + 5_000n;
    const head = deployment + 30n;
    const hashes = new Map<bigint, Hash>();
    const blockHash = (n: bigint) => {
      if (!hashes.has(n))
        hashes.set(n, toHex(BigInt(`0x${randomBytes(31).toString('hex')}`), { size: 32 }));
      return hashes.get(n)!;
    };
    const txHash = randomHash();
    cleanup.txHashes.add(txHash.toLowerCase());
    const client = {
      getBlockNumber: async () => head,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
        hash: blockHash(blockNumber),
      }),
      getLogs: async () => [
        {
          address: liquid,
          blockNumber: deployment + 3n,
          blockHash: blockHash(deployment + 3n),
          transactionHash: txHash,
          logIndex: 0,
          removed: false,
          args: { riskLevel: 1, withdrawalCapacity: 100n },
        },
      ],
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === 'riskLevel' ? 1 : 100n,
    };
    const reader = {
      client,
      confirmations: 5,
      manifest: {
        factory,
        liquidVault: liquid,
        timedVault: randomAddress(),
        deploymentBlock: deployment.toString(),
      },
      verifyDeployment: async () => {},
    } as unknown as BoundraChainReader;
    const key = `84532:${factory.toLowerCase()}:risk`;
    cleanup.cursorKeys.add(key);
    cleanup.leaseKeys.add(`monitor:${key}`);
    const store = new PostgresMonitorStore(db, leases);
    const monitor = new RiskEventMonitor(reader, store);
    assert.equal(await monitor.poll(), 'SCANNED');
    const cursor = await store.readCursor(key);
    assert.equal(cursor?.nextBlock, head - 4n + 1n);
    assert.equal((await jobsFor(txHash)).length, 1);
    assert.equal(await monitor.poll(), 'IDLE');

    // Reorg: the block behind the cursor now has a different hash.
    hashes.set(head - 4n, toHex(BigInt(`0x${randomBytes(31).toString('hex')}`), { size: 32 }));
    assert.equal(await monitor.poll(), 'REWOUND');
    assert.equal((await store.readCursor(key))?.nextBlock, deployment);
    const event = await db.riskEvent.findFirstOrThrow({ where: { txHash: txHash.toLowerCase() } });
    assert.equal(event.status, 'ORPHANED');
    assert.equal(await monitor.poll(), 'SCANNED');
    assert.equal(
      (await db.riskEvent.findFirstOrThrow({ where: { txHash: txHash.toLowerCase() } })).status,
      'CANONICAL',
    );
  });
});
