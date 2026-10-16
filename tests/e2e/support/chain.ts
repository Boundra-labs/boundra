import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { repo, type LocalManifest } from '../../../scripts/lib/local-chain.mjs';

/** The local chain the web app is built against for E2E (see playwright.config.ts). */
export const E2E_RPC_URL = process.env.E2E_RPC_URL ?? 'http://127.0.0.1:8545';
export const CHAIN_FILE = join(repo, 'tmp', 'e2e-chain', 'deployment.json');

export interface E2EChain {
  rpc: string;
  manifest: LocalManifest;
  operator: `0x${string}`;
}

/** Contracts deployed by global-setup.ts for this run. */
export function e2eChain(): E2EChain {
  return JSON.parse(readFileSync(CHAIN_FILE, 'utf8')) as E2EChain;
}

export const chainClient = () =>
  createPublicClient({ chain: baseSepolia, transport: http(E2E_RPC_URL) });
