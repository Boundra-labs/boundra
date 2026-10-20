/**
 * Local development chain: anvil with Base Sepolia's chain ID (84532) and the real deploy
 * script, plus a manifest pinned to the deployed code hashes. It lets the web app, API and worker
 * run the full owner journey before (or without) a public testnet deployment.
 *
 * Uses anvil's public development mnemonic. Those keys are published and only ever valid on this
 * local chain; nothing here is Base Sepolia evidence.
 *
 *   node scripts/dev-chain.mjs [--port 8545] [--fund 0xAddress ...] [--fresh]
 *
 * Chain state is saved in tmp/dev-chain/ every few seconds and on exit (Ctrl+C or closing the
 * terminal), so a restart continues the same chain and the database stays consistent with it.
 * Saves are atomic and the previous snapshot is kept, so a hard kill can lose a few seconds but
 * never the chain. `--fresh` deploys a new chain; reset the database afterwards, since its
 * executors and mandates belong to the old one.
 */
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, getAddress, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import {
  deployBoundra,
  devAccount,
  fundGas,
  latestChainState,
  repo,
  saveChainState,
  startAnvil,
} from './lib/local-chain.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const fund = args.flatMap((arg, i) => (args[i - 1] === '--fund' ? [getAddress(arg)] : []));

const workDir = join(repo, 'tmp', 'dev-chain');
const statePath = join(workDir, 'anvil-state.json');
const manifestPath = join(workDir, 'manifest.json');
if (args.includes('--fresh')) rmSync(workDir, { recursive: true, force: true });
const snapshot = existsSync(manifestPath) ? latestChainState(statePath) : null;
const resuming = Boolean(snapshot);
if (snapshot && snapshot !== statePath) {
  // Keep the damaged file for inspection, but out of the save rotation.
  if (existsSync(statePath)) renameSync(statePath, `${statePath}.damaged`);
  console.warn(
    `The latest chain snapshot was damaged (kept as .damaged); resuming from ${snapshot}.`,
  );
}

const { anvil, rpc } = await startAnvil({
  port: Number(option('--port', '8545')),
  stdio: 'inherit',
  loadStatePath: snapshot ?? undefined,
});

let saving = Promise.resolve();
const save = () => {
  saving = saving.then(() =>
    saveChainState(rpc, statePath).catch((error) =>
      console.error(`Could not save chain state: ${error.message}`),
    ),
  );
  return saving;
};
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(autosave);
  await save();
  anvil.kill();
};
// SIGHUP is what Windows sends when the terminal window closes.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void stop());
anvil.on('exit', (code) => process.exit(stopping ? 0 : (code ?? 1)));
const autosave = setInterval(() => void save(), 5_000);

let manifest;
let deployed = false;
try {
  if (resuming) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
    const code = await client.getCode({ address: manifest.factory });
    if (!code || code === '0x') throw new Error('saved state has no contracts');
  } else {
    ({ manifest } = await deployBoundra({ rpc, workDir }));
    deployed = true;
  }
  await fundGas({ rpc, addresses: fund });
  await save();
} catch (error) {
  stopping = true;
  clearInterval(autosave);
  anvil.kill();
  if (resuming)
    console.error(
      `\nThe saved chain in ${workDir} could not be resumed (${error.message}).\nRun with --fresh to deploy a new chain, then reset the database.`,
    );
  throw error;
}

console.log(`
Local chain ${deployed ? 'deployed' : 'resumed'} on ${rpc} (chain ID 84532). Contracts from contracts/script/DeployBoundra.s.sol:
  factory      ${manifest.factory}
  MockUSDC     ${manifest.mockUsdc}
  faucet       ${manifest.faucet}
  LiquidVault  ${manifest.liquidVault}
  TimedVault   ${manifest.timedVault}
  risk admin   ${devAccount(1).address}  (anvil account 1)
${fund.length ? `Sent 10 ETH for gas to: ${fund.join(', ')}\n` : ''}${
  deployed
    ? `
This is a new chain: if the database holds data from an earlier chain, reset it
(packages/database: prisma migrate reset), since those executors no longer exist.
`
    : ''
}
Point the stack at it in .env, then restart the API and worker:
  BASE_SEPOLIA_RPC_URL=${rpc}
  NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=${rpc}
  DEPLOYMENT_MANIFEST_PATH=${manifestPath}
  OPERATOR_ADDRESS=${devAccount(3).address}
  CHAIN_CONFIRMATIONS=2

In your browser wallet, add a network with RPC ${rpc} and chain ID 84532.
Press Ctrl+C to stop the chain; its state is kept for the next start.`);
