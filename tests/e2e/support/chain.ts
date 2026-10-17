import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  maxUint256,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount, type Account } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import {
  devAccount,
  fundGas,
  repo,
  type LocalManifest,
} from '../../../scripts/lib/local-chain.mjs';

/** The local chain the web app is built against for E2E (see playwright.config.ts). */
export const E2E_RPC_URL = process.env.E2E_RPC_URL ?? 'http://127.0.0.1:8545';
/** Where global setup records the deployed contracts; the real-API suite uses its own file. */
export const CHAIN_FILE =
  process.env.E2E_CHAIN_FILE ?? join(repo, 'tmp', 'e2e-chain', 'deployment.json');

export interface E2EChain {
  rpc: string;
  manifest: LocalManifest;
  operator: Address;
}

/** Contracts deployed by global-setup.ts for this run. */
export function e2eChain(): E2EChain {
  return JSON.parse(readFileSync(CHAIN_FILE, 'utf8')) as E2EChain;
}

/** Dev accounts 5–9 pay for gas, one per Playwright worker, so funding never races on a nonce. */
export const GAS_FUNDERS = 5;
export function workerFunder() {
  const index = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  if (index >= GAS_FUNDERS)
    throw new Error(
      `Worker ${index} has no gas funder of its own; run at most ${GAS_FUNDERS} workers`,
    );
  return 5 + index;
}

export const chainClient = () =>
  createPublicClient({ chain: baseSepolia, transport: http(E2E_RPC_URL) });

const abi = parseAbi([
  'function claim()',
  'function createExecutor() returns (address)',
  'function executorOf(address owner) view returns (address)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'struct Mandate { uint256 chainId; address asset; address operator; address beneficiary; uint64 expiresAt; uint8 allowedVaults; uint8 allowedActions; uint32 maxLockupSeconds; uint256 maxDepositPerAction; uint256 maxCumulativeDeposits; uint256 maxWithdrawPerAction; uint256 allocationTarget; }',
  'function setMandate(Mandate next)',
  'function fund(uint256 amount)',
  'function mandate() view returns (Mandate)',
  'function mandateVersion() view returns (uint256)',
  'function nextActionNonce() view returns (uint256)',
  'function paused() view returns (bool)',
  'function revoked() view returns (bool)',
  'function allocationCompleted() view returns (bool)',
  'function cumulativeDeposited() view returns (uint256)',
  'function executeDeposit(bytes32 actionId, uint256 version, uint256 nonce, uint64 deadline, address target, uint256 amount)',
  'function principal(address account) view returns (uint256)',
  'function unlockAt(address account) view returns (uint256)',
  'function maxWithdraw(address account) view returns (uint256)',
  'function riskLevel() view returns (uint8)',
  'function withdrawalCapacity() view returns (uint256)',
  'function setRiskState(uint8 level, uint256 capacity)',
]);

const send = async (account: Account, request: Record<string, unknown>) => {
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(E2E_RPC_URL) });
  return chainClient().waitForTransactionReceipt({
    hash: await wallet.writeContract({ abi, ...request } as never),
  });
};

/** Deposits as the mandate's operator (anvil account 3), exactly as the worker would. */
export async function operatorDeposit(executor: Address, vault: Address, amount: bigint) {
  const client = chainClient();
  const [version, nonce, block] = await Promise.all([
    client.readContract({ address: executor, abi, functionName: 'mandateVersion' }),
    client.readContract({ address: executor, abi, functionName: 'nextActionNonce' }),
    client.getBlock(),
  ]);
  return send(devAccount(3), {
    address: executor,
    functionName: 'executeDeposit',
    args: [keccak256(generatePrivateKey()), version, nonce, block.timestamp + 300n, vault, amount],
  });
}

/** The risk admin (anvil account 1) marks a vault degraded or normal, withdrawals unlimited. */
export const setVaultRisk = (vault: Address, degraded: boolean) =>
  send(devAccount(1), {
    address: vault,
    functionName: 'setRiskState',
    args: [degraded ? 1 : 0, maxUint256],
  });

/** A vault's risk fixture state on chain; capacity null = unlimited. */
export async function vaultCondition(vault: Address) {
  const client = chainClient();
  const [risk, capacity] = await Promise.all([
    client.readContract({ address: vault, abi, functionName: 'riskLevel' }),
    client.readContract({ address: vault, abi, functionName: 'withdrawalCapacity' }),
  ]);
  return { degraded: risk !== 0, capacity: capacity === maxUint256 ? null : capacity };
}

/** The executor state the API's dashboard reports, read from the latest block. */
export async function executorSnapshot(executor: Address) {
  const { manifest } = e2eChain();
  const client = chainClient();
  const read = (address: Address, functionName: string, args?: unknown[]) =>
    client.readContract({ address, abi, functionName, args } as never) as Promise<never>;
  const block = await client.getBlock();
  const position = async (vault: Address) => {
    const [principal, unlockAt, withdrawable, risk] = await Promise.all([
      read(vault, 'principal', [executor]) as Promise<bigint>,
      read(vault, 'unlockAt', [executor]) as Promise<bigint>,
      read(vault, 'maxWithdraw', [executor]) as Promise<bigint>,
      read(vault, 'riskLevel') as Promise<number>,
    ]);
    return {
      address: vault.toLowerCase(),
      principal: principal.toString(),
      display: `${principal / 1_000_000n} MockUSDC`,
      unlockAt: unlockAt.toString(),
      withdrawable: withdrawable.toString(),
      risk: risk === 0 ? 'NORMAL' : 'DEGRADED',
    };
  };
  const idle = (await tokenBalance(executor)) as bigint;
  return {
    blockNumber: block.number.toString(),
    blockHash: block.hash,
    mandateVersion: ((await read(executor, 'mandateVersion')) as bigint).toString(),
    paused: (await read(executor, 'paused')) as boolean,
    revoked: (await read(executor, 'revoked')) as boolean,
    allocationCompleted: (await read(executor, 'allocationCompleted')) as boolean,
    cumulativeDeposited: ((await read(executor, 'cumulativeDeposited')) as bigint).toString(),
    idle: { baseUnits: idle.toString(), display: `${idle / 1_000_000n} MockUSDC` },
    positions: [await position(manifest.liquidVault), await position(manifest.timedVault)],
  };
}

/** The API's wire tuple: integers as base-10 strings. */
export interface WireMandate {
  chainId: number;
  asset: string;
  operator: string;
  beneficiary: string;
  expiresAt: string;
  allowedVaults: number;
  allowedActions: number;
  maxLockupSeconds: string;
  maxDepositPerAction: string;
  maxCumulativeDeposits: string;
  maxWithdrawPerAction: string;
  allocationTarget: string;
}

/** Same conversion as @boundra/chain's toMandateStruct. */
export const mandateStruct = (t: WireMandate) => ({
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
});

/** `keccak256(abi.encode(mandate))`, as the executor emits and the API records at approval. */
export const hashWireMandate = (t: WireMandate) =>
  keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
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
          ],
        },
      ],
      [mandateStruct(t)],
    ),
  );

/** A valid LiquidVault mandate for `owner`, like the API drafts by default (7-day expiry). */
export function liquidMandate(owner: Address, amount = 300_000_000n): WireMandate {
  const { manifest, operator } = e2eChain();
  return {
    chainId: 84532,
    asset: manifest.mockUsdc.toLowerCase(),
    operator: operator.toLowerCase(),
    beneficiary: owner.toLowerCase(),
    expiresAt: String(Math.floor(Date.now() / 1000) + 7 * 86_400),
    allowedVaults: 1,
    allowedActions: 3,
    maxLockupSeconds: '0',
    maxDepositPerAction: amount.toString(),
    maxCumulativeDeposits: amount.toString(),
    maxWithdrawPerAction: amount.toString(),
    allocationTarget: amount.toString(),
  };
}

/** Whether the executor currently holds exactly this mandate (what the worker verifies). */
export async function executorHolds(executor: Address, t: WireMandate) {
  const client = chainClient();
  const version = await client.readContract({
    address: executor,
    abi,
    functionName: 'mandateVersion',
  });
  if (version === 0n) return false;
  const onchain = await client.readContract({ address: executor, abi, functionName: 'mandate' });
  return (
    hashWireMandate({
      ...t,
      asset: onchain.asset,
      operator: onchain.operator,
      beneficiary: onchain.beneficiary,
      expiresAt: onchain.expiresAt.toString(),
      allowedVaults: onchain.allowedVaults,
      allowedActions: onchain.allowedActions,
      maxLockupSeconds: String(onchain.maxLockupSeconds),
      maxDepositPerAction: onchain.maxDepositPerAction.toString(),
      maxCumulativeDeposits: onchain.maxCumulativeDeposits.toString(),
      maxWithdrawPerAction: onchain.maxWithdrawPerAction.toString(),
      allocationTarget: onchain.allocationTarget.toString(),
    }) === hashWireMandate(t)
  );
}

export async function tokenBalance(owner: Address) {
  return chainClient().readContract({
    address: e2eChain().manifest.mockUsdc,
    abi,
    functionName: 'balanceOf',
    args: [owner],
  });
}

export async function executorOf(owner: Address): Promise<Address | null> {
  const executor = await chainClient().readContract({
    address: e2eChain().manifest.factory,
    abi,
    functionName: 'executorOf',
    args: [owner],
  });
  return executor === zeroAddress ? null : executor;
}

/** A fresh owner wallet with gas, and optionally claimed MockUSDC and an executor. */
export async function prepareOwner({
  claim = true,
  executor = true,
}: { claim?: boolean; executor?: boolean } = {}) {
  const { manifest } = e2eChain();
  const privateKey: Hex = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  await fundGas({
    rpc: E2E_RPC_URL,
    addresses: [account.address],
    ether: '1',
    funder: workerFunder(),
  });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(E2E_RPC_URL) });
  const client = chainClient();
  const send = async (address: Address, functionName: 'claim' | 'createExecutor') =>
    client.waitForTransactionReceipt({
      hash: await wallet.writeContract({ address, abi, functionName }),
    });
  if (claim) await send(manifest.faucet, 'claim');
  if (executor) await send(manifest.factory, 'createExecutor');
  const executorAddress = executor ? await executorOf(account.address) : null;
  const write = async (request: Parameters<typeof wallet.writeContract>[0]) =>
    client.waitForTransactionReceipt({ hash: await wallet.writeContract(request) });
  return {
    privateKey,
    address: account.address,
    executor: executorAddress,
    /** Sets a mandate on the executor directly from the owner's key (an earlier session). */
    setMandate: (t: WireMandate) =>
      write({
        address: executorAddress!,
        abi,
        functionName: 'setMandate',
        args: [mandateStruct(t)],
      } as never),
    /** Moves `amount` MockUSDC into the executor (needs the allowance first). */
    fund: (amount: bigint) =>
      write({ address: executorAddress!, abi, functionName: 'fund', args: [amount] } as never),
    /** Approves the executor for `amount` MockUSDC directly from the owner's key. */
    approve: (amount: bigint) =>
      write({
        address: manifest.mockUsdc,
        abi,
        functionName: 'approve',
        args: [executorAddress!, amount],
      } as never),
    /** Moves all MockUSDC out of the wallet (to the deployer), keeping the faucet cooldown. */
    emptyWallet: async () => {
      const balance = await client.readContract({
        address: manifest.mockUsdc,
        abi,
        functionName: 'balanceOf',
        args: [account.address],
      });
      await client.waitForTransactionReceipt({
        hash: await wallet.writeContract({
          address: manifest.mockUsdc,
          abi,
          functionName: 'transfer',
          args: ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', balance],
        }),
      });
    },
  };
}
