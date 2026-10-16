import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { fundGas, repo, type LocalManifest } from '../../../scripts/lib/local-chain.mjs';

/** The local chain the web app is built against for E2E (see playwright.config.ts). */
export const E2E_RPC_URL = process.env.E2E_RPC_URL ?? 'http://127.0.0.1:8545';
export const CHAIN_FILE = join(repo, 'tmp', 'e2e-chain', 'deployment.json');

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
export const workerFunder = () => 5 + (Number(process.env.TEST_PARALLEL_INDEX ?? 0) % 5);

export const chainClient = () =>
  createPublicClient({ chain: baseSepolia, transport: http(E2E_RPC_URL) });

const abi = parseAbi([
  'function claim()',
  'function createExecutor() returns (address)',
  'function executorOf(address owner) view returns (address)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);

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
  return {
    privateKey,
    address: account.address,
    executor: executor ? await executorOf(account.address) : null,
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
