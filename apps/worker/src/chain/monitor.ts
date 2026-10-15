import { getAbiItem, getAddress, type Address, type Hash } from 'viem';
import { BoundraChainReader, ChainPolicyError, liquidVaultAbi } from '@boundra/chain';
import type { SignerLease } from './execution';

export interface MonitorCursor {
  nextBlock: bigint;
  previousBlockHash: Hash | null;
}
export interface RiskObservation {
  chainId: 84532;
  source: Address;
  transactionHash: Hash;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hash;
  eventRiskLevel: number;
  eventCapacity: bigint;
  observedAtBlock: bigint;
  observedAtBlockHash: Hash;
  currentRiskLevel: number;
  currentCapacity: bigint;
}
/** Batch/cursor commits and orphan invalidation must be atomic and fenced in PostgreSQL. */
export interface MonitorStore {
  durable: true;
  withMonitorLease<T>(key: string, work: (lease: SignerLease) => Promise<T>): Promise<T>;
  readCursor(key: string): Promise<MonitorCursor | null>;
  rewind(key: string, fromBlock: bigint, lease: SignerLease): Promise<void>;
  commitBatch(
    key: string,
    expected: MonitorCursor | null,
    next: MonitorCursor,
    observations: RiskObservation[],
    lease: SignerLease,
  ): Promise<void>;
}

export class RiskEventMonitor {
  constructor(
    private readonly reader: BoundraChainReader,
    private readonly store: MonitorStore,
    private readonly batchSize = 500n,
    private readonly overlap = 20n,
  ) {
    if (
      store.durable !== true ||
      batchSize < 1n ||
      batchSize > 2000n ||
      overlap < 20n ||
      overlap > batchSize
    )
      throw new Error('Invalid durable monitor configuration');
  }

  async poll(): Promise<'IDLE' | 'SCANNED' | 'REWOUND'> {
    const { client, manifest, confirmations } = this.reader;
    const key = `84532:${manifest.factory.toLowerCase()}:risk`;
    return this.store.withMonitorLease(key, async (lease) => {
      await lease.assertHeld();
      const head = await client.getBlockNumber({ cacheTime: 0 });
      const depth = BigInt(confirmations - 1);
      const deploymentBlock = BigInt(manifest.deploymentBlock);
      if (head < depth || head - depth < deploymentBlock) return 'IDLE';
      const confirmedHead = head - depth;
      const cursor = await this.store.readCursor(key);
      const nextBlock = cursor?.nextBlock ?? deploymentBlock;
      if (cursor && cursor.nextBlock > deploymentBlock) {
        if (cursor.nextBlock - 1n > head) {
          await this.store.rewind(key, deploymentBlock, lease);
          return 'REWOUND';
        }
        const previous = await client.getBlock({ blockNumber: cursor.nextBlock - 1n });
        if (previous.hash !== cursor.previousBlockHash) {
          // Without persisted ancestor history, full deployment rescan is safer than guessing depth.
          await lease.assertHeld();
          await this.store.rewind(key, deploymentBlock, lease);
          return 'REWOUND';
        }
      }
      if (nextBlock > confirmedHead) return 'IDLE';
      const fromBlock =
        nextBlock > deploymentBlock + this.overlap ? nextBlock - this.overlap : deploymentBlock;
      const toBlock =
        nextBlock + this.batchSize - 1n < confirmedHead
          ? nextBlock + this.batchSize - 1n
          : confirmedHead;
      const end = await client.getBlock({ blockNumber: toBlock });
      if (!end.hash) throw new ChainPolicyError('UNCONFIRMED_BLOCK');
      await this.reader.verifyDeployment(toBlock);
      const sources = [getAddress(manifest.liquidVault), getAddress(manifest.timedVault)];
      const event = getAbiItem({ abi: liquidVaultAbi, name: 'RiskStateChanged' });
      const logs = await client.getLogs({
        address: sources,
        event,
        fromBlock,
        toBlock,
        strict: true,
      });
      const state = new Map<string, { risk: number; capacity: bigint }>();
      await Promise.all(
        sources.map(async (address) => {
          const [risk, capacity] = await Promise.all([
            client.readContract({
              address,
              abi: liquidVaultAbi,
              functionName: 'riskLevel',
              blockNumber: toBlock,
            }),
            client.readContract({
              address,
              abi: liquidVaultAbi,
              functionName: 'withdrawalCapacity',
              blockNumber: toBlock,
            }),
          ]);
          state.set(address.toLowerCase(), { risk, capacity });
        }),
      );
      const blockHashes = new Map<bigint, Hash>();
      const observations = new Map<string, RiskObservation>();
      for (const log of logs) {
        const current = state.get(log.address.toLowerCase());
        if (
          !current ||
          log.blockNumber === null ||
          !log.blockHash ||
          !log.transactionHash ||
          log.logIndex === null ||
          log.removed ||
          log.blockNumber < fromBlock ||
          log.blockNumber > toBlock ||
          ![0, 1].includes(log.args.riskLevel)
        )
          throw new ChainPolicyError('INVALID_RISK_EVENT');
        let canonicalHash = blockHashes.get(log.blockNumber);
        if (!canonicalHash) {
          const block = await client.getBlock({ blockNumber: log.blockNumber });
          if (!block.hash) throw new ChainPolicyError('UNCONFIRMED_BLOCK');
          canonicalHash = block.hash;
          blockHashes.set(log.blockNumber, canonicalHash);
        }
        if (canonicalHash !== log.blockHash) throw new ChainPolicyError('EVENT_REORG');
        const id = `${log.transactionHash}:${log.logIndex}`;
        observations.set(id, {
          chainId: 84532,
          source: getAddress(log.address),
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          eventRiskLevel: log.args.riskLevel,
          eventCapacity: log.args.withdrawalCapacity,
          observedAtBlock: toBlock,
          observedAtBlockHash: end.hash,
          currentRiskLevel: current.risk,
          currentCapacity: current.capacity,
        });
      }
      const canonicalEnd = await client.getBlock({ blockNumber: toBlock });
      if (canonicalEnd.hash !== end.hash) throw new ChainPolicyError('EVENT_REORG');
      await lease.assertHeld();
      await this.store.commitBatch(
        key,
        cursor,
        { nextBlock: toBlock + 1n, previousBlockHash: end.hash },
        [...observations.values()],
        lease,
      );
      return 'SCANNED';
    });
  }
}
