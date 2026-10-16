/**
 * Local-chain end-to-end run (PRD §11.2) on anvil with chain ID 84532: Person 1's deploy script,
 * the real API over HTTP, the real worker through its activation gate, a fresh PostgreSQL
 * database, and owner/risk-admin transactions signed by their own wallets. Time travel is never
 * used, and nothing here is presented as public Base Sepolia evidence.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import {
  boundraExecutorAbi,
  boundraFactoryAbi,
  liquidVaultAbi,
  mockUsdcAbi,
  mockUsdcFaucetAbi,
  toMandateStruct,
} from '@boundra/chain';
import { createDatabaseClient, JobQueue, LeaseManager, type PrismaClient } from '@boundra/database';
import { readWorkerConfig } from '../../src/config';
import { activate } from '../../src/runtime/activation';
import { buildWorker } from '../../src/runtime/worker.runtime';
import { Orchestrator } from '../../src/orchestration/orchestrator';
import { handlersFor, JobRunner } from '../../src/orchestration/job-runner';
import { OperatorExecutionService, type ExecutionStore } from '../../src/chain/execution';
import { AttemptCipher } from '../../src/persistence/cipher';
import { PostgresExecutionStore } from '../../src/persistence/execution-store';

const repo = resolve(__dirname, '../../../..');
const MNEMONIC = 'test test test test test test test test test test test junk';
// Anvil's public development accounts: never usable on Base Sepolia.
const deployer = mnemonicToAccount(MNEMONIC, { addressIndex: 0 });
const riskAdmin = mnemonicToAccount(MNEMONIC, { addressIndex: 1 });
const owner = mnemonicToAccount(MNEMONIC, { addressIndex: 2 });
const operator = mnemonicToAccount(MNEMONIC, { addressIndex: 3 });
const attacker = mnemonicToAccount(MNEMONIC, { addressIndex: 4 });
const ORIGIN = 'http://localhost:3000';
const PORT = 8600 + Math.floor(Math.random() * 300);
const RPC = `http://127.0.0.1:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let anvil: ChildProcess;
let work: string;
let databaseUrl: string;
let adminDb: PrismaClient;
let db: PrismaClient;
let api: { close(): Promise<void>; url: string };
const dbName = `boundra_e2e_${randomBytes(4).toString('hex')}`;
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const wallet = (account: typeof owner) =>
  createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
let contracts: {
  token: Address;
  faucet: Address;
  liquid: Address;
  timed: Address;
  factory: Address;
};

async function send(
  account: typeof owner,
  request: Parameters<ReturnType<typeof wallet>['writeContract']>[0],
) {
  const hash = await wallet(account).writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success', `${request.functionName} reverted`);
  return hash;
}

async function rejects(promise: Promise<unknown>, errorName: string) {
  await assert.rejects(promise, (error: unknown) => String(error).includes(errorName));
}

before(async () => {
  work = mkdtempSync(join(tmpdir(), 'boundra-e2e-'));
  anvil = spawn(
    process.execPath,
    [
      join(repo, 'contracts/node_modules/@foundry-rs/anvil/bin.mjs'),
      '--chain-id',
      '84532',
      '--port',
      String(PORT),
      '--block-time',
      '1',
      '--silent',
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 60; i++) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      await sleep(250);
    }
  }
  const deploymentBlock = await publicClient.getBlockNumber();
  // Person 1's deployment script; broadcast/cache artefacts go to a temp dir, never contracts/.
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
      RPC,
      '--broadcast',
      '--json',
    ],
    {
      cwd: join(repo, 'contracts'),
      encoding: 'utf8',
      env: {
        ...process.env,
        DEPLOYER_PRIVATE_KEY: toHexKey(deployer),
        FOUNDRY_BROADCAST: join(work, 'broadcast'),
        FOUNDRY_CACHE_PATH: join(work, 'cache'),
      },
    },
  );
  const line = forge.stdout.split('\n').find((l) => l.includes('"returns"'));
  assert.ok(line, `forge script failed: ${forge.stderr.slice(-500)}`);
  const returns = JSON.parse(line).returns as Record<string, { value: Address }>;
  contracts = {
    token: getAddress(returns['0']!.value),
    faucet: getAddress(returns['1']!.value),
    liquid: getAddress(returns['2']!.value),
    timed: getAddress(returns['3']!.value),
    factory: getAddress(returns['4']!.value),
  };
  const codeHash = async (address: Address) =>
    keccak256((await publicClient.getCode({ address }))!);
  const manifest = {
    chainId: 84532,
    factory: contracts.factory,
    mockUsdc: contracts.token,
    faucet: contracts.faucet,
    liquidVault: contracts.liquid,
    timedVault: contracts.timed,
    riskAdmin: riskAdmin.address,
    deploymentBlock: deploymentBlock.toString(),
    codeHashes: {
      factory: await codeHash(contracts.factory),
      mockUsdc: await codeHash(contracts.token),
      faucet: await codeHash(contracts.faucet),
      liquidVault: await codeHash(contracts.liquid),
      timedVault: await codeHash(contracts.timed),
    },
  };
  const manifestPath = join(work, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Fresh database with all migrations, dropped afterwards.
  const base = new URL(process.env.DATABASE_URL!);
  adminDb = createDatabaseClient(base.toString());
  await adminDb.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  base.pathname = `/${dbName}`;
  databaseUrl = base.toString();
  const migrate = spawnSync(
    process.execPath,
    [join(repo, 'packages/database/node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: join(repo, 'packages/database'),
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );
  assert.equal(migrate.status, 0, migrate.stderr);
  db = createDatabaseClient(databaseUrl);

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    WEB_ORIGIN: ORIGIN,
    SESSION_SECRET: randomBytes(32).toString('base64url'),
    BASE_SEPOLIA_RPC_URL: RPC,
    DEPLOYMENT_MANIFEST_PATH: manifestPath,
    CHAIN_CONFIRMATIONS: '2',
    OPERATOR_ADDRESS: operator.address,
    EXECUTION_ENABLED: 'true',
    OPERATOR_PRIVATE_KEY: toHexKey(operator),
    ATTEMPT_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    MAX_GAS: '1000000',
    MAX_FEE_PER_GAS_WEI: '100000000000',
    MAX_PRIORITY_FEE_PER_GAS_WEI: '10000000000',
    ACTION_DEADLINE_SECONDS: '300',
    RATE_LIMIT_PER_MINUTE: '10000',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  });
  api = await startApi();
});

after(async () => {
  await api?.close();
  await db?.$disconnect();
  anvil?.kill();
  if (adminDb) {
    await adminDb.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminDb.$disconnect();
  }
  if (work) rmSync(work, { recursive: true, force: true });
});

function toHexKey(account: typeof owner): Hex {
  return `0x${Buffer.from(account.getHdKey().privateKey!).toString('hex')}`;
}

async function startApi() {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../../api/src/app.module');
  const { configureApp } = await import('../../../api/src/app.factory');
  const { readConfig } = await import('../../../api/src/config');
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  configureApp(app as never, readConfig());
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  return { url: `http://127.0.0.1:${port}/api/v1`, close: () => app.close() };
}

/** Minimal browser stand-in: session cookie, CSRF header and same-origin requests. */
async function signIn() {
  const challenge = await (
    await fetch(`${api.url}/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: owner.address }),
    })
  ).json();
  const signature = await owner.signMessage({ message: challenge.message });
  const verified = await fetch(`${api.url}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: challenge.message, signature }),
  });
  const cookie = verified.headers.get('set-cookie')!.split(';')[0]!;
  const { csrfToken } = await verified.json();
  return async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${api.url}${path}`, {
      method,
      headers: {
        cookie,
        origin: ORIGIN,
        'x-csrf-token': csrfToken,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
}

test(
  'owner delegates, the agent deposits, responds to a risk event, and revocation stops it',
  { timeout: 300_000 },
  async () => {
    // Owner gets MockUSDC from the capped faucet and creates their executor.
    await send(owner, { address: contracts.faucet, abi: mockUsdcFaucetAbi, functionName: 'claim' });
    await send(owner, {
      address: contracts.factory,
      abi: boundraFactoryAbi,
      functionName: 'createExecutor',
    });
    const executor = (await publicClient.readContract({
      address: contracts.factory,
      abi: boundraFactoryAbi,
      functionName: 'executorOf',
      args: [owner.address],
    })) as Address;
    await sleep(2_500); // confirmation depth for the API's confirmed reads

    // Clarification and mandate approval through the API.
    const call = await signIn();
    const intent = await call('POST', '/intents', {
      objective: 'Manage 300 MockUSDC safely; I may need it soon',
      amount: '300000000',
      chainId: 84532,
    });
    assert.equal(intent.status, 201, JSON.stringify(intent.body));
    const answered = await call('POST', `/intents/${intent.body.id}/answers`, {
      questionId: intent.body.question.questionId,
      alternativeId: 'no_lockup',
    });
    assert.equal(answered.body.state, 'MANDATE_PENDING');
    const registered = await call('POST', '/executors/register');
    assert.equal(registered.body.address, executor.toLowerCase());
    const draft = await call('POST', `/intents/${intent.body.id}/mandate-drafts`);
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const approved = await call('POST', `/mandate-drafts/${draft.body.id}/approve`, {
      previewHash: draft.body.previewHash,
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));

    // The owner signs setMandate, an exact approval and funding; the API never holds this key.
    const tx = approved.body.ownerTransactions;
    const setMandateHash = await send(owner, {
      address: executor,
      abi: boundraExecutorAbi,
      functionName: 'setMandate',
      args: [toMandateStruct(tx.setMandate.args[0])],
    });
    await send(owner, {
      address: contracts.token,
      abi: mockUsdcAbi,
      functionName: 'approve',
      args: [executor, BigInt(tx.approve.args[1])],
    });
    await send(owner, {
      address: executor,
      abi: boundraExecutorAbi,
      functionName: 'fund',
      args: [BigInt(tx.fund.args[0])],
    });
    assert.equal(
      (
        await call('POST', `/mandate-drafts/${draft.body.id}/authorization-check`, {
          txHash: setMandateHash,
        })
      ).status,
      202,
    );

    // The real worker, through its activation gate.
    const config = readWorkerConfig();
    const activation = await activate(config);
    assert.equal(activation.mode, 'execute', activation.reasons.join('; '));
    const worker = buildWorker(db, config, activation, 'e2e-worker')!;
    const runUntil = async (label: string, done: () => Promise<boolean>) => {
      for (let i = 0; i < 90; i++) {
        await worker.orchestrator.schedule(1_000);
        while ((await worker.runner.drain(50)) > 0);
        if (await done()) return;
        await sleep(500);
      }
      assert.fail(`timed out waiting for: ${label}`);
    };
    const proposals = () => db.actionProposal.findMany({ orderBy: { createdAt: 'asc' } });
    const balance = (account: Address) =>
      publicClient.readContract({
        address: contracts.token,
        abi: mockUsdcAbi,
        functionName: 'balanceOf',
        args: [account],
      });
    const principal = () =>
      publicClient.readContract({
        address: contracts.liquid,
        abi: liquidVaultAbi,
        functionName: 'principal',
        args: [executor],
      });

    // T04: authorization verified on-chain, then the agent deposits without another owner signature.
    await runUntil('deposit confirmed', async () => (await proposals())[0]?.state === 'CONFIRMED');
    const mandate = await db.mandate.findUniqueOrThrow({ where: { id: draft.body.id } });
    assert.equal(mandate.status, 'AUTHORIZED');
    assert.equal(mandate.onchainVersion?.toFixed(0), '1');
    assert.equal(await principal(), 300_000_000n);
    const [deposit] = await proposals();
    const depositAttempt = await db.transactionAttempt.findUniqueOrThrow({
      where: { actionId: deposit!.actionId },
    });
    const depositReceipt = await publicClient.getTransactionReceipt({
      hash: depositAttempt.txHash as Hash,
    });
    assert.equal(depositReceipt.status, 'success');
    assert.equal(depositReceipt.from.toLowerCase(), operator.address.toLowerCase());
    const dashboard = await call('GET', '/dashboard');
    assert.equal(dashboard.body.chainStatus, 'ok');
    const activity = await call('GET', '/activity');
    const confirmed = activity.body.items.find(
      (i: { type: string }) => i.type === 'ACTION_CONFIRMED',
    );
    assert.equal(confirmed.txHash, depositAttempt.txHash);

    // T07/T08/T10/T11: the contract itself rejects out-of-mandate calls, even from the operator key.
    const nonce = await publicClient.readContract({
      address: executor,
      abi: boundraExecutorAbi,
      functionName: 'nextActionNonce',
    });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    await rejects(
      publicClient.simulateContract({
        account: operator,
        address: executor,
        abi: boundraExecutorAbi,
        functionName: 'executeDeposit',
        args: [`0x${'7'.repeat(64)}`, 1n, nonce, deadline, contracts.liquid, 1n],
      }),
      // The cumulative budget is checked before the single-allocation flag; either way it reverts.
      'BudgetExceeded',
    );
    await rejects(
      publicClient.simulateContract({
        account: operator,
        address: executor,
        abi: boundraExecutorAbi,
        functionName: 'executeDeposit',
        args: [`0x${'8'.repeat(64)}`, 1n, nonce, deadline, contracts.timed, 1n],
      }),
      'TargetNotAllowed',
    );
    await rejects(
      publicClient.simulateContract({
        account: operator,
        address: executor,
        abi: boundraExecutorAbi,
        functionName: 'executeWithdraw',
        args: [deposit!.actionId as Hash, 1n, nonce, deadline, contracts.liquid, 1n],
      }),
      'Replay',
    );
    await rejects(
      publicClient.simulateContract({
        account: attacker,
        address: executor,
        abi: boundraExecutorAbi,
        functionName: 'executeWithdraw',
        args: [`0x${'9'.repeat(64)}`, 1n, nonce, deadline, contracts.liquid, 1n],
      }),
      'OperatorOnly',
    );
    await rejects(
      publicClient.simulateContract({
        account: operator,
        address: executor,
        abi: boundraExecutorAbi,
        functionName: 'setMandate',
        args: [toMandateStruct(tx.setMandate.args[0])],
      }),
      'OwnerOnly',
    );

    // T05: the risk admin degrades LiquidVault with 200 MockUSDC of capacity left.
    const ownerBefore = await balance(owner.address);
    await send(riskAdmin, {
      address: contracts.liquid,
      abi: liquidVaultAbi,
      functionName: 'setRiskState',
      args: [1, 200_000_000n],
    });

    // T12 on a real chain: propose without executing, then crash the first dispatch after the
    // signed attempt is persisted but before broadcast.
    const proposeOnly = new JobRunner(
      new JobQueue(db),
      'e2e-proposer',
      handlersFor(worker.orchestrator, 'monitor_only'),
      { warn: () => {} },
    );
    for (let i = 0; i < 90 && (await proposals()).length < 2; i++) {
      await worker.orchestrator.schedule(1_000);
      while ((await proposeOnly.drain(50)) > 0);
      await sleep(500);
    }
    const withdraw = (await proposals())[1]!;
    assert.equal(withdraw.kind, 'WITHDRAW');
    assert.equal(withdraw.state, 'POLICY_CHECKED');
    assert.equal(withdraw.amount.toFixed(0), '200000000', 'bounded by remaining vault capacity');
    const pg = new PostgresExecutionStore(
      db,
      new LeaseManager(db),
      new AttemptCipher(process.env.ATTEMPT_ENCRYPTION_KEY!),
    );
    const crashing: ExecutionStore = Object.assign(Object.create(pg), {
      reserveBroadcast: async () => {
        throw new Error('Process crash before network call');
      },
    });
    const crashed = new Orchestrator({
      db,
      reader: activation.reader!,
      mode: 'execute',
      actionDeadlineSeconds: 300,
      execution: {
        service: new OperatorExecutionService(
          activation.reader!,
          activation.operator!,
          crashing,
          activation.limits!,
        ),
        store: pg,
        operator: activation.operator!.address,
      },
    });
    await assert.rejects(crashed.executeAction(withdraw.actionId, false));
    const persisted = await db.transactionAttempt.findUniqueOrThrow({
      where: { actionId: withdraw.actionId },
    });
    assert.equal(persisted.sendCount, 0, 'signed and persisted, never broadcast');
    await runUntil(
      'risk withdrawal confirmed',
      async () => (await proposals())[1]?.state === 'CONFIRMED',
    );
    const withdrawAttempt = await db.transactionAttempt.findUniqueOrThrow({
      where: { actionId: withdraw.actionId },
    });
    assert.equal(
      withdrawAttempt.txHash,
      persisted.txHash,
      'recovery sent the identical signed bytes',
    );
    assert.equal(await db.eoaNonceReservation.count({ where: { actionId: withdraw.actionId } }), 1);
    assert.equal(
      (await balance(owner.address)) - ownerBefore,
      200_000_000n,
      'withdrawal paid the owner',
    );
    assert.equal(await principal(), 100_000_000n);

    // Zero capacity remains: the agent escalates instead of forcing an exit.
    await runUntil(
      'escalation recorded',
      async () =>
        (await db.mandate.findUniqueOrThrow({ where: { id: draft.body.id } })).escalationReason ===
        'NO_WITHDRAWAL_CAPACITY',
    );

    // T09/T16: owner revokes; the agent stops and the operator is blocked on-chain.
    await send(owner, { address: executor, abi: boundraExecutorAbi, functionName: 'revoke' });
    await runUntil(
      'mandate revoked',
      async () =>
        (await db.mandate.findUniqueOrThrow({ where: { id: draft.body.id } })).status === 'REVOKED',
    );
    await rejects(
      publicClient.simulateContract({
        account: operator,
        address: executor,
        abi: boundraExecutorAbi,
        functionName: 'executeWithdraw',
        args: [`0x${'a'.repeat(64)}`, 1n, nonce + 2n, deadline, contracts.liquid, 1n],
      }),
      'InactiveMandate',
    );
    // Owner recovery follows the vault's real capacity: blocked at zero, possible once restored.
    await rejects(
      publicClient.simulateContract({
        account: owner,
        address: executor,
        // Vault errors bubble up through the executor; include them so the revert decodes.
        abi: [...boundraExecutorAbi, ...liquidVaultAbi.filter((item) => item.type === 'error')],
        functionName: 'ownerWithdraw',
        args: [contracts.liquid, 100_000_000n],
      }),
      'InsufficientCapacity',
    );
    await send(riskAdmin, {
      address: contracts.liquid,
      abi: liquidVaultAbi,
      functionName: 'setRiskState',
      args: [0, 2n ** 256n - 1n],
    });
    await send(owner, {
      address: executor,
      abi: boundraExecutorAbi,
      functionName: 'ownerWithdraw',
      args: [contracts.liquid, 100_000_000n],
    });
    assert.equal(
      await balance(owner.address),
      1_000_000_000n,
      'owner holds the full faucet grant again',
    );
    assert.equal(
      (await proposals()).filter((p) => p.state === 'CONFIRMED').length,
      2,
      'exactly two agent transactions: one deposit and one risk exit',
    );
  },
);
