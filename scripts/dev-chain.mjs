/**
 * Local development chain: anvil with Base Sepolia's chain ID (84532) and Person 1's real deploy
 * script, plus a manifest pinned to the deployed code hashes. It lets the web app, API and worker
 * run the full owner journey before (or without) a public testnet deployment.
 *
 * Uses anvil's public development mnemonic. Those keys are published and only ever valid on this
 * local chain; nothing here is Base Sepolia evidence.
 *
 *   node scripts/dev-chain.mjs [--port 8545] [--fund 0xAddress ...]
 *
 * Leaves anvil running in the foreground; stop it with Ctrl+C. State is not persisted, so a
 * restart deploys fresh contracts and rewrites the manifest.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress } from 'viem';
import { deployBoundra, devAccount, fundGas, repo, startAnvil } from './lib/local-chain.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const fund = args.flatMap((arg, i) => (args[i - 1] === '--fund' ? [getAddress(arg)] : []));

const workDir = join(repo, 'tmp', 'dev-chain');
rmSync(workDir, { recursive: true, force: true });

const { anvil, rpc } = await startAnvil({
  port: Number(option('--port', '8545')),
  stdio: 'inherit',
});
const stop = () => anvil.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
anvil.on('exit', (code) => process.exit(code ?? 0));

let deployment;
try {
  deployment = await deployBoundra({ rpc, workDir });
  await fundGas({ rpc, addresses: fund });
} catch (error) {
  stop();
  throw error;
}
const { manifest, manifestPath, operator } = deployment;

console.log(`
Local chain ready on ${rpc} (chain ID 84532). Contracts from contracts/script/DeployBoundra.s.sol:
  factory      ${manifest.factory}
  MockUSDC     ${manifest.mockUsdc}
  faucet       ${manifest.faucet}
  LiquidVault  ${manifest.liquidVault}
  TimedVault   ${manifest.timedVault}
  risk admin   ${devAccount(1).address}  (anvil account 1)
${fund.length ? `Sent 10 ETH for gas to: ${fund.join(', ')}\n` : ''}
Point the stack at it in .env, then restart the API and worker:
  BASE_SEPOLIA_RPC_URL=${rpc}
  NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=${rpc}
  DEPLOYMENT_MANIFEST_PATH=${manifestPath}
  OPERATOR_ADDRESS=${operator}
  CHAIN_CONFIRMATIONS=2

In your browser wallet, add a network with RPC ${rpc} and chain ID 84532.
Press Ctrl+C to stop the chain.`);
