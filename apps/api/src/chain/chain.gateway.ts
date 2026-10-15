import { HttpStatus } from '@nestjs/common';
import { getAddress, zeroAddress, type Address } from 'viem';
import {
  BoundraChainReader,
  boundraFactoryAbi,
  createReadOnlyChainClient,
  loadDeploymentManifest,
  mockUsdcAbi,
  type DeploymentManifest,
  type ExecutorSnapshot,
} from '@boundra/chain';
import { ApiError } from '../common/errors';
import type { AppConfig } from '../config';

export const CHAIN_GATEWAY = Symbol('CHAIN_GATEWAY');

export interface ChainDeployment {
  manifest: DeploymentManifest;
  operator: string;
}

/** Read-only chain access for the API. Every value comes from a confirmed block. */
export interface ChainGateway {
  deployment(): ChainDeployment | null;
  /** Executor registered for the owner in the trusted factory, verified; null if none. */
  findExecutor(owner: string): Promise<{ address: string; blockNumber: bigint } | null>;
  /** Owner wallet balance plus idle funds already in the executor (base units). */
  fundableBalance(owner: string, executor: string | null): Promise<bigint>;
  snapshot(owner: string, executor: string): Promise<ExecutorSnapshot>;
}

export const chainUnavailable = () =>
  new ApiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'DEPENDENCY_UNAVAILABLE',
    'Chain data is unavailable',
    'The reviewed deployment manifest or RPC endpoint is not available. Try again later.',
  );

export class RpcChainGateway implements ChainGateway {
  private readonly reader: BoundraChainReader | null;
  private readonly operator: string | null;

  constructor(config: AppConfig) {
    this.operator = config.OPERATOR_ADDRESS ?? null;
    this.reader = config.DEPLOYMENT_MANIFEST_PATH
      ? new BoundraChainReader(
          createReadOnlyChainClient(config.BASE_SEPOLIA_RPC_URL),
          loadDeploymentManifest(config.DEPLOYMENT_MANIFEST_PATH),
          config.CHAIN_CONFIRMATIONS,
        )
      : null;
    if (this.reader && this.operator === this.reader.manifest.riskAdmin.toLowerCase())
      throw new Error('OPERATOR_ADDRESS must differ from the risk admin');
  }

  deployment(): ChainDeployment | null {
    return this.reader && this.operator
      ? { manifest: this.reader.manifest, operator: this.operator }
      : null;
  }

  private require(): BoundraChainReader {
    if (!this.reader) throw chainUnavailable();
    return this.reader;
  }

  private async confirmedBlock(reader: BoundraChainReader) {
    const head = await reader.client.getBlockNumber({ cacheTime: 0 });
    return head - BigInt(reader.confirmations - 1);
  }

  async findExecutor(owner: string) {
    const reader = this.require();
    try {
      const blockNumber = await this.confirmedBlock(reader);
      const executor = (await reader.client.readContract({
        address: getAddress(reader.manifest.factory),
        abi: boundraFactoryAbi,
        functionName: 'executorOf',
        args: [getAddress(owner)],
        blockNumber,
      })) as Address;
      if (executor === zeroAddress) return null;
      // Verifies pinned code, factory registration, owner and immutable configuration.
      const snapshot = await reader.snapshot(getAddress(owner), executor);
      return { address: executor.toLowerCase(), blockNumber: snapshot.blockNumber };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw chainUnavailable();
    }
  }

  async fundableBalance(owner: string, executor: string | null) {
    const reader = this.require();
    try {
      const blockNumber = await this.confirmedBlock(reader);
      const balanceOf = (account: string) =>
        reader.client.readContract({
          address: getAddress(reader.manifest.mockUsdc),
          abi: mockUsdcAbi,
          functionName: 'balanceOf',
          args: [getAddress(account)],
          blockNumber,
        }) as Promise<bigint>;
      const [wallet, idle] = await Promise.all([
        balanceOf(owner),
        executor ? balanceOf(executor) : Promise.resolve(0n),
      ]);
      return wallet + idle;
    } catch {
      throw chainUnavailable();
    }
  }

  async snapshot(owner: string, executor: string) {
    const reader = this.require();
    try {
      return await reader.snapshot(getAddress(owner), getAddress(executor));
    } catch {
      throw chainUnavailable();
    }
  }
}
