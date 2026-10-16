/**
 * Local development chain: anvil with Base Sepolia's chain ID (84532) and Person 1's real deploy
 * script, plus a reviewed-style manifest pinned to the deployed code hashes. It lets the web app,
 * API and worker run the full owner journey before (or without) a public testnet deployment.
 *
 * Uses anvil's public development mnemonic. Those keys are published and only ever valid on this
 * local chain; nothing here is Base Sepolia evidence.
 *
 *   node scripts/dev-chain.mjs [--port 8545] [--fund 0xAddress ...]
 *
 * Leaves anvil running in the foreground; stop it with Ctrl+C. State is not persisted, so a
 * restart deploys fresh contracts and rewrites the manifest.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseEther,
  toHex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const fund = args.flatMap((arg, i) => (args[i - 1] === '--fund' ? [getAddress(arg)] : []));
const port = Number(option('--port', '8545'));
const rpc = `http://127.0.0.1:${port}`;

const MNEMONIC = 'test test test test test test test test test test test junk';
const account = (addressIndex) => mnemonicToAccount(MNEMONIC, { addressIndex });
const deployer = account(0);
const riskAdmin = account(1);
const operator = account(3);
const hexKey = (a) => toHex(a.getHdKey().privateKey);

const work = join(repo, 'tmp', 'dev-chain');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const anvil = spawn(
  process.execPath,
  [
    join(repo, 'contracts/node_modules/@foundry-rs/anvil/bin.mjs'),
    '--chain-id',
    '84532',
    '--port',
    String(port),
    '--block-time',
    '1',
    '--silent',
  ],
  { stdio: 'inherit' },
);
const stop = () => anvil.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
anvil.on('exit', (code) => process.exit(code ?? 0));

const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
for (let i = 0; ; i++) {
  try {
    await client.getBlockNumber();
    break;
  } catch {
    if (i > 80) throw new Error(`anvil did not start on ${rpc}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const deploymentBlock = await client.getBlockNumber();
// Broadcast/cache artefacts stay in tmp/, never in contracts/.
const forge = spawnSync(
  process.execPath,
  [
    join(repo, 'contracts/node_modules/@foundry-rs/forge/bin.mjs'),
    'script',
    'script/DeployBoundra.s.sol:DeployBoundra',
    '--sig',
    'run(address)',
    riskAdmin.address,
    '--rpc-url',
    rpc,
    '--broadcast',
    '--json',
  ],
  {
    cwd: join(repo, 'contracts'),
    encoding: 'utf8',
    env: {
      ...process.env,
      DEPLOYER_PRIVATE_KEY: hexKey(deployer),
      FOUNDRY_BROADCAST: join(work, 'broadcast'),
      FOUNDRY_CACHE_PATH: join(work, 'cache'),
    },
  },
);
const line = forge.stdout?.split('\n').find((l) => l.includes('"returns"'));
if (!line) {
  console.error(forge.stderr?.slice(-2000) || forge.error);
  stop();
  throw new Error('forge deploy script failed');
}
const returns = JSON.parse(line).returns;
const [mockUsdc, faucet, liquidVault, timedVault, factory] = ['0', '1', '2', '3', '4'].map((k) =>
  getAddress(returns[k].value),
);
const codeHash = async (address) => keccak256(await client.getCode({ address }));
const manifest = {
  chainId: 84532,
  factory,
  mockUsdc,
  faucet,
  liquidVault,
  timedVault,
  riskAdmin: riskAdmin.address,
  deploymentBlock: deploymentBlock.toString(),
  codeHashes: {
    factory: await codeHash(factory),
    mockUsdc: await codeHash(mockUsdc),
    faucet: await codeHash(faucet),
    liquidVault: await codeHash(liquidVault),
    timedVault: await codeHash(timedVault),
  },
};
const manifestPath = join(work, 'manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// Gas money for wallets you test with (owner wallets claim MockUSDC from the faucet themselves).
const funder = createWalletClient({ account: deployer, chain: baseSepolia, transport: http(rpc) });
for (const address of fund) {
  const hash = await funder.sendTransaction({ to: address, value: parseEther('10') });
  await client.waitForTransactionReceipt({ hash });
}

console.log(`
Local chain ready on ${rpc} (chain ID 84532). Contracts from contracts/script/DeployBoundra.s.sol:
  factory      ${factory}
  MockUSDC     ${mockUsdc}
  faucet       ${faucet}
  LiquidVault  ${liquidVault}
  TimedVault   ${timedVault}
  risk admin   ${riskAdmin.address}  (anvil account 1)
${fund.length ? `Sent 10 ETH for gas to: ${fund.join(', ')}\n` : ''}
Point the stack at it in .env, then restart the API and worker:
  BASE_SEPOLIA_RPC_URL=${rpc}
  NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=${rpc}
  DEPLOYMENT_MANIFEST_PATH=${manifestPath}
  OPERATOR_ADDRESS=${operator.address}
  CHAIN_CONFIRMATIONS=2

In your browser wallet, add a network with RPC ${rpc} and chain ID 84532.
Press Ctrl+C to stop the chain.`);
