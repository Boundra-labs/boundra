/**
 * Local chain helpers shared by scripts/dev-chain.mjs and the browser E2E setup: anvil with Base
 * Sepolia's chain ID (84532), Person 1's real deploy script and a manifest pinned to the deployed
 * code hashes.
 *
 * Every key here comes from anvil's public development mnemonic. Those keys are published and
 * only ever valid on a local chain; nothing deployed here is Base Sepolia evidence.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  hexToBytes,
  http,
  keccak256,
  parseEther,
  toHex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

/**
 * The workspace root, found from the working directory. (Not `import.meta`: Playwright loads this
 * file through its CommonJS transform.)
 */
export const repo = (() => {
  for (let dir = resolve(process.cwd()); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (dirname(dir) === dir) throw new Error('Run this from inside the Boundra workspace');
  }
})();
const MNEMONIC = 'test test test test test test test test test test test junk';

/** Anvil development account: 0 deploys, 1 is risk admin, 3 is the operator, 5+ are free. */
export const devAccount = (addressIndex) => mnemonicToAccount(MNEMONIC, { addressIndex });
export const devKey = (addressIndex) => toHex(devAccount(addressIndex).getHdKey().privateKey);

const client = (rpc) => createPublicClient({ chain: baseSepolia, transport: http(rpc) });

export async function isChainUp(rpc) {
  try {
    return (await client(rpc).getChainId()) === 84532;
  } catch {
    return false;
  }
}

/**
 * Starts anvil as chain 84532 and resolves once it answers RPC calls. With `loadStatePath`, the
 * chain starts from that snapshot (see saveChainState); anvil itself never writes it.
 */
export async function startAnvil({ port = 8545, stdio = 'ignore', loadStatePath } = {}) {
  const rpc = `http://127.0.0.1:${port}`;
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
      ...(loadStatePath ? ['--load-state', loadStatePath] : []),
    ],
    { stdio },
  );
  for (let i = 0; !(await isChainUp(rpc)); i++) {
    if (i > 80 || anvil.exitCode !== null) {
      anvil.kill();
      throw new Error(`anvil did not start on ${rpc}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { anvil, rpc };
}

/**
 * Saves the chain's full state to `path` without ever leaving a half-written file: the snapshot
 * (anvil_dumpState) is written to a temporary file and renamed into place, and the snapshot it
 * replaces is kept as `<path>.prev`. A kill at any moment leaves at least one whole snapshot.
 */
export async function saveChainState(rpc, path) {
  const hex = await client(rpc).request({ method: 'anvil_dumpState', params: [] });
  const json = gunzipSync(hexToBytes(hex));
  writeFileSync(`${path}.tmp`, json);
  if (existsSync(path)) renameSync(path, `${path}.prev`);
  renameSync(`${path}.tmp`, path);
}

/** The newest whole snapshot among `path` and `<path>.prev`, or null when there is none. */
export function latestChainState(path) {
  for (const candidate of [path, `${path}.prev`]) {
    try {
      JSON.parse(readFileSync(candidate, 'utf8'));
      return candidate;
    } catch {
      // Missing or damaged: try the previous snapshot.
    }
  }
  return null;
}

/**
 * Runs contracts/script/DeployBoundra.s.sol and writes a manifest with pinned code hashes to
 * `workDir`. Broadcast and cache artefacts stay in `workDir`, never in contracts/.
 */
export async function deployBoundra({ rpc, workDir }) {
  mkdirSync(workDir, { recursive: true });
  const riskAdmin = devAccount(1);
  const deploymentBlock = await client(rpc).getBlockNumber();
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
        DEPLOYER_PRIVATE_KEY: devKey(0),
        FOUNDRY_BROADCAST: join(workDir, 'broadcast'),
        FOUNDRY_CACHE_PATH: join(workDir, 'cache'),
      },
    },
  );
  const line = forge.stdout?.split('\n').find((l) => l.includes('"returns"'));
  if (!line)
    throw new Error(`forge deploy script failed: ${forge.stderr?.slice(-2000) ?? forge.error}`);
  const returns = JSON.parse(line).returns;
  const [mockUsdc, faucet, liquidVault, timedVault, factory] = ['0', '1', '2', '3', '4'].map((k) =>
    getAddress(returns[k].value),
  );
  const codeHash = async (address) => keccak256(await client(rpc).getCode({ address }));
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
  const manifestPath = join(workDir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestPath, operator: devAccount(3).address };
}

/**
 * Sends gas money to each address from dev account `funder` (the deployer by default). Parallel
 * callers should use different funders so their transactions never race for the same nonce.
 */
export async function fundGas({ rpc, addresses, ether = '10', funder: from = 0 }) {
  const funder = createWalletClient({
    account: devAccount(from),
    chain: baseSepolia,
    transport: http(rpc),
  });
  for (const address of addresses) {
    const hash = await funder.sendTransaction({
      to: getAddress(address),
      value: parseEther(ether),
    });
    await client(rpc).waitForTransactionReceipt({ hash });
  }
}
