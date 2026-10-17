#!/usr/bin/env node
/**
 * Web server for the Playwright suites:  node scripts/e2e-web-server.mjs <port>
 *
 * In CI (or with E2E_WEB=production) it runs the production standalone server from the existing
 * `pnpm build`, exactly as the Docker image does, so tests never wait on `next dev` compiling a
 * page on first request (which made the first test on each page flaky on small CI runners).
 * Locally it runs `next dev`. API_INTERNAL_URL is read at runtime either way; the chain RPC is
 * baked into the browser bundle, so a production build must have been made with
 * NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL pointing at the E2E chain, which is checked here.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repo } from './lib/local-chain.mjs';

const port = process.argv[2] ?? '3000';
const web = join(repo, 'apps', 'web');
const production = process.env.E2E_WEB === 'production' || Boolean(process.env.CI);
const rpc = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? 'http://127.0.0.1:8545';

let child;
if (production) {
  const standalone = join(web, '.next', 'standalone', 'apps', 'web');
  if (!existsSync(join(standalone, 'server.js')))
    throw new Error('No production build of the web app. Run `pnpm build` first.');
  const chunks = join(web, '.next', 'static', 'chunks');
  const pointsAtChain = readdirSync(chunks, { recursive: true })
    .filter((file) => String(file).endsWith('.js'))
    .some((file) => readFileSync(join(chunks, String(file)), 'utf8').includes(rpc));
  if (!pointsAtChain)
    throw new Error(
      `The web build does not use ${rpc}. Build with NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=${rpc}.`,
    );
  // The standalone output leaves static assets out, as in the Dockerfile.
  cpSync(join(web, '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true });
  child = spawn(process.execPath, ['server.js'], {
    cwd: standalone,
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: port },
    stdio: 'inherit',
  });
} else {
  child = spawn(
    process.execPath,
    [
      join(web, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      port,
    ],
    { cwd: web, env: process.env, stdio: 'inherit' },
  );
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
