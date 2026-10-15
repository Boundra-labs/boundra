import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex, type Hash } from 'viem';
import type { BoundraChainReader } from '@boundra/chain';
import {
  RiskEventMonitor,
  type MonitorStore,
  type MonitorCursor,
  type RiskObservation,
} from '../src/chain/monitor';

const addr = (n: number) => toHex(n, { size: 20 });
const hash = (n: bigint) => toHex(n, { size: 32 });
function fixture() {
  let cursor: MonitorCursor | null = null;
  let committed: RiskObservation[] = [];
  let rewound = false;
  const lease = { fencingToken: 'test', assertHeld: async () => {} };
  const store: MonitorStore = {
    durable: true,
    withMonitorLease: (_key, work) => work(lease),
    readCursor: async () => cursor,
    rewind: async (_key, from) => {
      rewound = true;
      cursor = { nextBlock: from, previousBlockHash: null };
    },
    commitBatch: async (_key, _expected, next, events) => {
      cursor = next;
      committed = events;
    },
  };
  const log = {
    address: addr(4),
    blockNumber: 98n,
    blockHash: hash(98n),
    transactionHash: hash(999n),
    logIndex: 0,
    removed: false,
    args: { riskLevel: 1, withdrawalCapacity: 100n },
  };
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    getBlockNumber: async () => 104n,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: hash(blockNumber) }),
    getLogs: async (range: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push(range);
      return [log, log];
    },
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === 'riskLevel' ? 0 : 1000n,
  };
  const reader = {
    client,
    confirmations: 5,
    manifest: {
      factory: addr(1),
      liquidVault: addr(4),
      timedVault: addr(5),
      deploymentBlock: '90',
    },
    verifyDeployment: async () => {},
  } as unknown as BoundraChainReader;
  return {
    reader,
    store,
    client,
    log,
    ranges,
    cursor: () => cursor,
    events: () => committed,
    rewound: () => rewound,
    seedCursor: (value: MonitorCursor) => {
      cursor = value;
    },
  };
}

test('monitor scans only confirmed blocks and deduplicates events with current risk state', async () => {
  const f = fixture();
  const monitor = new RiskEventMonitor(f.reader, f.store);
  assert.equal(await monitor.poll(), 'SCANNED');
  assert.equal(f.ranges[0]?.toBlock, 100n);
  assert.equal(f.events().length, 1);
  assert.equal(f.events()[0]?.eventRiskLevel, 1);
  assert.equal(
    f.events()[0]?.currentRiskLevel,
    0,
    'Historical warning must not override current NORMAL state',
  );
  assert.equal(f.cursor()?.nextBlock, 101n);
  assert.equal(await monitor.poll(), 'IDLE');
});

test('canonical cursor mismatch rewinds to deployment for a safe rescan', async () => {
  const f = fixture();
  f.seedCursor({ nextBlock: 101n, previousBlockHash: hash(999n) });
  assert.equal(await new RiskEventMonitor(f.reader, f.store).poll(), 'REWOUND');
  assert.equal(f.rewound(), true);
  assert.equal(f.cursor()?.nextBlock, 90n);
  assert.equal(f.ranges.length, 0);
});

test('unknown source, removed log or reorg cannot commit observations', async () => {
  for (const kind of ['source', 'removed', 'reorg']) {
    const f = fixture();
    if (kind === 'source') f.log.address = addr(99);
    if (kind === 'removed') f.log.removed = true;
    if (kind === 'reorg') f.log.blockHash = hash(99n) as Hash;
    await assert.rejects(() => new RiskEventMonitor(f.reader, f.store).poll());
    assert.equal(f.cursor(), null);
    assert.equal(f.events().length, 0);
  }
});
