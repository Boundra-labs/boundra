import { getAddress, keccak256, type Address } from 'viem';
import type { createReadOnlyChainClient } from './index';
import { deploymentManifestSchema, type DeploymentManifest } from './manifest';
import { ChainPolicyError, type ExecutorSnapshot, type VaultSnapshot } from './policy';
import { boundraFactoryAbi } from './abis/BoundraFactory';
import { boundraExecutorAbi } from './abis/BoundraExecutor';
import { mockUSDCAbi as mockUsdcAbi } from './abis/MockUSDC';
import { mockUSDCFaucetAbi as mockUsdcFaucetAbi } from './abis/MockUSDCFaucet';
import { liquidVaultAbi } from './abis/LiquidVault';

type Client = ReturnType<typeof createReadOnlyChainClient>;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Reads one confirmed block, verifies pinned code and rejects reorgs during observation. */
export class BoundraChainReader {
  readonly manifest: DeploymentManifest;
  private verified?: { blockNumber: bigint; atMs: number };

  constructor(
    readonly client: Client,
    manifest: unknown,
    readonly confirmations = 5,
    readonly deploymentRecheckMs = 60_000,
  ) {
    this.manifest = deploymentManifestSchema.parse(manifest);
    if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 100)
      throw new Error('Invalid confirmation depth');
    if (
      !Number.isSafeInteger(deploymentRecheckMs) ||
      deploymentRecheckMs < 0 ||
      deploymentRecheckMs > 3_600_000
    )
      throw new Error('Invalid deployment recheck interval');
  }

  async verifyDeployment(blockNumber: bigint) {
    // Pinned contracts have no proxy or selfdestruct path, so runtime code cannot change.
    // Periodic rechecks still catch mutable settings such as vault admin ownership.
    if (
      this.verified &&
      blockNumber >= this.verified.blockNumber &&
      Date.now() - this.verified.atMs < this.deploymentRecheckMs
    )
      return;
    const m = this.manifest;
    if ((await this.client.getChainId()) !== m.chainId) throw new ChainPolicyError('WRONG_CHAIN');
    if (blockNumber < BigInt(m.deploymentBlock))
      throw new ChainPolicyError('DEPLOYMENT_NOT_CONFIRMED');
    await Promise.all(
      (['factory', 'mockUsdc', 'faucet', 'liquidVault', 'timedVault'] as const).map(
        async (name) => {
          const code = await this.client.getCode({ address: getAddress(m[name]), blockNumber });
          if (
            !code ||
            code === '0x' ||
            keccak256(code).toLowerCase() !== m.codeHashes[name].toLowerCase()
          )
            throw new ChainPolicyError('UNTRUSTED_BYTECODE');
        },
      ),
    );
    const factory = getAddress(m.factory);
    const liquid = getAddress(m.liquidVault);
    const timed = getAddress(m.timedVault);
    const [
      token,
      lv,
      tv,
      liquidAsset,
      timedAsset,
      liquidLock,
      timedLock,
      liquidAdmin,
      timedAdmin,
      decimals,
      tokenOwner,
      faucetToken,
    ] = await Promise.all([
      this.client.readContract({
        address: factory,
        abi: boundraFactoryAbi,
        functionName: 'token',
        blockNumber,
      }),
      this.client.readContract({
        address: factory,
        abi: boundraFactoryAbi,
        functionName: 'liquidVault',
        blockNumber,
      }),
      this.client.readContract({
        address: factory,
        abi: boundraFactoryAbi,
        functionName: 'timedVault',
        blockNumber,
      }),
      this.client.readContract({
        address: liquid,
        abi: liquidVaultAbi,
        functionName: 'asset',
        blockNumber,
      }),
      this.client.readContract({
        address: timed,
        abi: liquidVaultAbi,
        functionName: 'asset',
        blockNumber,
      }),
      this.client.readContract({
        address: liquid,
        abi: liquidVaultAbi,
        functionName: 'lockupSeconds',
        blockNumber,
      }),
      this.client.readContract({
        address: timed,
        abi: liquidVaultAbi,
        functionName: 'lockupSeconds',
        blockNumber,
      }),
      this.client.readContract({
        address: liquid,
        abi: liquidVaultAbi,
        functionName: 'owner',
        blockNumber,
      }),
      this.client.readContract({
        address: timed,
        abi: liquidVaultAbi,
        functionName: 'owner',
        blockNumber,
      }),
      this.client.readContract({
        address: getAddress(m.mockUsdc),
        abi: mockUsdcAbi,
        functionName: 'decimals',
        blockNumber,
      }),
      this.client.readContract({
        address: getAddress(m.mockUsdc),
        abi: mockUsdcAbi,
        functionName: 'owner',
        blockNumber,
      }),
      this.client.readContract({
        address: getAddress(m.faucet),
        abi: mockUsdcFaucetAbi,
        functionName: 'token',
        blockNumber,
      }),
    ]);
    if (
      !same(token, m.mockUsdc) ||
      !same(lv, m.liquidVault) ||
      !same(tv, m.timedVault) ||
      !same(liquidAsset, token) ||
      !same(timedAsset, token) ||
      liquidLock !== 0n ||
      timedLock !== 2592000n ||
      !same(liquidAdmin, m.riskAdmin) ||
      !same(timedAdmin, m.riskAdmin) ||
      decimals !== 6 ||
      !same(tokenOwner, m.faucet) ||
      !same(faucetToken, token)
    )
      throw new ChainPolicyError('DEPLOYMENT_CONFIG_MISMATCH');
    this.verified = { blockNumber, atMs: Date.now() };
  }

  async snapshot(ownerInput: Address, executorInput: Address): Promise<ExecutorSnapshot> {
    const owner = getAddress(ownerInput);
    const address = getAddress(executorInput);
    const head = await this.client.getBlockNumber({ cacheTime: 0 });
    const depth = BigInt(this.confirmations - 1);
    if (head < depth) throw new ChainPolicyError('INSUFFICIENT_CONFIRMATIONS');
    const blockNumber = head - depth;
    const block = await this.client.getBlock({ blockNumber });
    if (!block.hash) throw new ChainPolicyError('UNCONFIRMED_BLOCK');
    await this.verifyDeployment(blockNumber);
    const [
      registered,
      code,
      accountOwner,
      asset,
      liquid,
      timed,
      chainId,
      mandate,
      mandateVersion,
      nextActionNonce,
      cumulativeDeposited,
      paused,
      revoked,
      allocationCompleted,
      idleBalance,
    ] = await Promise.all([
      this.client.readContract({
        address: getAddress(this.manifest.factory),
        abi: boundraFactoryAbi,
        functionName: 'executorOf',
        args: [owner],
        blockNumber,
      }),
      this.client.getCode({ address, blockNumber }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'owner',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'token',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'liquidVault',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'timedVault',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'deploymentChainId',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'mandate',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'mandateVersion',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'nextActionNonce',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'cumulativeDeposited',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'paused',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'revoked',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: boundraExecutorAbi,
        functionName: 'allocationCompleted',
        blockNumber,
      }),
      this.client.readContract({
        address: getAddress(this.manifest.mockUsdc),
        abi: mockUsdcAbi,
        functionName: 'balanceOf',
        args: [address],
        blockNumber,
      }),
    ]);
    if (
      !code ||
      code === '0x' ||
      !same(registered, address) ||
      !same(accountOwner, owner) ||
      !same(asset, this.manifest.mockUsdc) ||
      !same(liquid, this.manifest.liquidVault) ||
      !same(timed, this.manifest.timedVault) ||
      chainId !== 84532n
    )
      throw new ChainPolicyError('UNTRUSTED_EXECUTOR');
    const [liquidPosition, timedPosition] = await Promise.all([
      this.vaultSnapshot(liquid, address, blockNumber),
      this.vaultSnapshot(timed, address, blockNumber),
    ]);
    const canonical = await this.client.getBlock({ blockNumber });
    if (canonical.hash !== block.hash) throw new ChainPolicyError('OBSERVATION_REORG');
    return {
      chainId: 84532,
      blockNumber,
      blockHash: block.hash,
      blockTimestamp: block.timestamp,
      observedAtMs: Date.now(),
      owner,
      executor: address,
      token: asset,
      mandate,
      mandateVersion,
      nextActionNonce,
      cumulativeDeposited,
      idleBalance,
      paused,
      revoked,
      allocationCompleted,
      liquid: liquidPosition,
      timed: timedPosition,
    };
  }

  private async vaultSnapshot(
    address: Address,
    executor: Address,
    blockNumber: bigint,
  ): Promise<VaultSnapshot> {
    const [principal, unlockAt, maxWithdraw, lockupSeconds, riskLevel] = await Promise.all([
      this.client.readContract({
        address,
        abi: liquidVaultAbi,
        functionName: 'principal',
        args: [executor],
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: liquidVaultAbi,
        functionName: 'unlockAt',
        args: [executor],
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: liquidVaultAbi,
        functionName: 'maxWithdraw',
        args: [executor],
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: liquidVaultAbi,
        functionName: 'lockupSeconds',
        blockNumber,
      }),
      this.client.readContract({
        address,
        abi: liquidVaultAbi,
        functionName: 'riskLevel',
        blockNumber,
      }),
    ]);
    return { address, principal, unlockAt, maxWithdraw, lockupSeconds, riskLevel };
  }
}
