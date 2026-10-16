import type { ChildProcess, StdioOptions } from 'node:child_process';
import type { Address, Hex } from 'viem';
import type { HDAccount } from 'viem/accounts';

export interface LocalManifest {
  chainId: 84532;
  factory: Address;
  mockUsdc: Address;
  faucet: Address;
  liquidVault: Address;
  timedVault: Address;
  riskAdmin: Address;
  deploymentBlock: string;
  codeHashes: Record<'factory' | 'mockUsdc' | 'faucet' | 'liquidVault' | 'timedVault', Hex>;
}

export const repo: string;
export function devAccount(addressIndex: number): HDAccount;
export function devKey(addressIndex: number): Hex;
export function isChainUp(rpc: string): Promise<boolean>;
export function startAnvil(options?: {
  port?: number;
  stdio?: StdioOptions;
}): Promise<{ anvil: ChildProcess; rpc: string }>;
export function deployBoundra(options: {
  rpc: string;
  workDir: string;
}): Promise<{ manifest: LocalManifest; manifestPath: string; operator: Address }>;
export function fundGas(options: {
  rpc: string;
  addresses: readonly string[];
  ether?: string;
}): Promise<void>;
