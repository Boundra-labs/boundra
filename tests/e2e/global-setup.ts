import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deployBoundra, isChainUp, repo, startAnvil } from '../../scripts/lib/local-chain.mjs';
import { CHAIN_FILE, E2E_RPC_URL } from './support/chain';

/**
 * Browser tests that send transactions run against the real contracts on a local anvil
 * chain (chain ID 84532). A chain already listening on the port (for example
 * `node scripts/dev-chain.mjs`) is reused; otherwise one is started and stopped afterwards.
 * Fresh contracts are deployed for every run, so tests never share chain state with dev data.
 */
export default async function globalSetup() {
  const port = Number(new URL(E2E_RPC_URL).port);
  const started = (await isChainUp(E2E_RPC_URL)) ? null : await startAnvil({ port });
  const workDir = join(repo, 'tmp', 'e2e-chain');
  const { manifest, operator } = await deployBoundra({ rpc: E2E_RPC_URL, workDir });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(CHAIN_FILE, JSON.stringify({ rpc: E2E_RPC_URL, manifest, operator }, null, 2));
  return () => {
    started?.anvil.kill();
  };
}
