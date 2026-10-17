import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import {
  deployBoundra,
  devKey,
  isChainUp,
  repo,
  startAnvil,
} from '../../scripts/lib/local-chain.mjs';
import { E2E_RPC_URL } from '../e2e/support/chain';
import { REAL_STACK, type RealStack } from './stack';

/**
 * The real-API browser suite (PRD §11.2 through the UI): fresh Boundra contracts on the local
 * anvil chain, a throwaway PostgreSQL database with every migration, and the real API and
 * worker (execute mode, anvil's public operator key) as child processes. Nothing is mocked in
 * the browser.
 *
 * The LLM provider is configured but every call fails (a local stand-in answering like an
 * overloaded provider), so the whole journey also proves the provider-failure path: reviewed
 * template wording, labelled as such, and no blocked flow.
 */
const workDir = join(repo, 'tmp', 'e2e-real');
const logs = join(workDir, 'logs');
const prisma = join(repo, 'packages/database/node_modules/prisma/build/index.js');

/** Runs Prisma's CLI from the database package (its config reads DATABASE_URL). */
function prismaCli(args: string[], databaseUrl: string, input?: string) {
  const result = spawnSync(process.execPath, [prisma, ...args], {
    cwd: join(repo, 'packages/database'),
    encoding: 'utf8',
    input,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (result.status !== 0)
    throw new Error(`prisma ${args[0]} failed: ${result.stderr}${result.stdout}`);
}
const sql = (statement: string) =>
  prismaCli(['db', 'execute', '--stdin'], process.env.DATABASE_URL!, statement);

/** Answers every Messages API request as an overloaded provider; counts what it refused. */
function startProviderOutage(port: number) {
  let refused = 0;
  const server = createServer((request, response) => {
    if (request.url === '/__refused') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ refused }));
      return;
    }
    request.resume();
    refused++;
    response.writeHead(529, { 'content-type': 'application/json', 'retry-after-ms': '10' });
    response.end(
      JSON.stringify({
        type: 'error',
        error: { type: 'overloaded_error', message: 'Simulated provider outage (Boundra E2E)' },
      }),
    );
  });
  return new Promise<Server>((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** Runs a TypeScript service in one process (tsx as a loader), so killing it stops it fully. */
function startService(name: 'api' | 'worker', env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: join(repo, 'apps', name),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = createWriteStream(join(logs, `${name}.log`));
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  return child;
}

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not become ready; see ${logs}`);
}

export default async function globalSetup() {
  mkdirSync(logs, { recursive: true });
  if (existsSync(join(repo, '.env'))) process.loadEnvFile(join(repo, '.env'));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (pnpm env:setup)');

  const port = Number(new URL(E2E_RPC_URL).port);
  const chain = (await isChainUp(E2E_RPC_URL)) ? null : await startAnvil({ port });
  const { manifest, manifestPath, operator } = await deployBoundra({
    rpc: E2E_RPC_URL,
    workDir: join(workDir, 'chain'),
  });

  // A throwaway database, dropped afterwards.
  const database = `boundra_e2e_web_${randomBytes(4).toString('hex')}`;
  sql(`CREATE DATABASE "${database}";`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${database}`;
  const databaseUrl = url.toString();
  prismaCli(['migrate', 'deploy'], databaseUrl);

  const outage = await startProviderOutage(REAL_STACK.providerPort);
  const shared: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    BASE_SEPOLIA_RPC_URL: E2E_RPC_URL,
    DEPLOYMENT_MANIFEST_PATH: manifestPath,
    CHAIN_CONFIRMATIONS: '2',
    WORKER_HEARTBEAT_MAX_AGE_MS: '20000',
  };
  const api = startService('api', {
    ...shared,
    API_PORT: String(REAL_STACK.apiPort),
    API_HOST: '127.0.0.1',
    WEB_ORIGIN: REAL_STACK.webOrigin,
    SESSION_SECRET: randomBytes(32).toString('base64url'),
    OPERATOR_ADDRESS: operator,
    RATE_LIMIT_PER_MINUTE: '10000',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    LLM_PROVIDER: 'anthropic',
    LLM_API_KEY: 'e2e-not-a-real-key',
    LLM_DEADLINE_MS: '5000',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${REAL_STACK.providerPort}`,
  });
  const worker = startService('worker', {
    ...shared,
    WORKER_POLL_INTERVAL_MS: '1000',
    EXECUTION_ENABLED: 'true',
    OPERATOR_PRIVATE_KEY: devKey(3),
    ATTEMPT_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    MAX_GAS: '1000000',
    MAX_FEE_PER_GAS_WEI: '100000000000',
    MAX_PRIORITY_FEE_PER_GAS_WEI: '10000000000',
    ACTION_DEADLINE_SECONDS: '300',
  });

  const stop = async () => {
    api.kill();
    worker.kill();
    outage.close();
    chain?.anvil.kill();
    await Promise.all([api, worker].map(exited));
    sql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE);`);
  };

  try {
    const apiUrl = `http://127.0.0.1:${REAL_STACK.apiPort}/api/v1`;
    // Ready = database reachable and a fresh worker heartbeat; the worker must be executing.
    await waitFor(
      'API and worker',
      async () => {
        const response = await fetch(`${apiUrl}/health/ready`);
        if (!response.ok) return false;
        const body = (await response.json()) as { executionEnabled: boolean; worker: string };
        if (!body.executionEnabled)
          throw new Error(`worker started in ${body.worker} mode, not execute; see ${logs}`);
        return true;
      },
      90_000,
    );
  } catch (error) {
    await stop();
    const tail = (name: string) =>
      readFileSync(join(logs, `${name}.log`), 'utf8')
        .split('\n')
        .slice(-30)
        .join('\n');
    throw new Error(
      `${(error as Error).message}\n--- api ---\n${tail('api')}\n--- worker ---\n${tail('worker')}`,
      {
        cause: error,
      },
    );
  }

  writeFileSync(
    REAL_STACK.chainFile,
    JSON.stringify({ rpc: E2E_RPC_URL, manifest, operator } satisfies RealStack, null, 2),
  );
  return stop;
}

const exited = (child: ChildProcess) =>
  child.exitCode !== null
    ? Promise.resolve()
    : new Promise<void>((resolve) => child.once('exit', () => resolve()));
