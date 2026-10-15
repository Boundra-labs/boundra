# Boundra

**Autonomy within your boundaries.** A risk-aligned agent wallet for the FinTechathon 2026 Topic F prototype.

## Status

This repository contains the application foundation and Person 1's local contract/chain implementation, not a completed integrated wallet. Available: Next.js UI shell and injected-wallet connection, NestJS API health/OpenAPI, PostgreSQL/Prisma, exact-amount schemas, controlled mock vaults, bounded owner executors/factory, capped faucet, typed ABIs, verified chain snapshots, transaction/reconciliation modules, risk-event monitor, deployment script, Docker/CI and tests.

Still to integrate: wallet authentication, ACCE/provider, frontend mandate/funding flow, Person 2's durable PostgreSQL execution/monitor ports and worker lifecycle, benchmark, and public deployment evidence. The worker remains observe-only until the persistence/runtime activation gates are met. No deployment addresses, transaction hashes or performance claims are invented. See [Person 1 progress](./docs/person-1-progress.md) and [worker integration port](./docs/worker-chain-port.md).

## Requirements

- Node.js **22.22.0** (see `.node-version`).
- pnpm **10.32.1** via Corepack. If the machine has pnpm 8, run `corepack prepare pnpm@10.32.1 --activate`, or prefix commands with `corepack pnpm@10.32.1`.
- Running Docker Engine / Docker Desktop for PostgreSQL.
- No LLM key, operator key or real funds needed for the scaffold.

## Quick start

Run from the repository root:

```sh
corepack pnpm@10.32.1 install
corepack pnpm@10.32.1 env:setup
corepack pnpm@10.32.1 db:up
corepack pnpm@10.32.1 db:migrate
corepack pnpm@10.32.1 dev
```

`env:setup` creates a private local `.env` with a random database password and leaves existing configuration unchanged. PostgreSQL binds to loopback port **55432** to avoid common local conflicts. First startup may take a few seconds to become healthy; retry migrations once PostgreSQL is ready.

| Service                    | Local URL                                 |
| -------------------------- | ----------------------------------------- |
| Web                        | http://localhost:3000                     |
| API liveness               | http://127.0.0.1:3001/api/v1/health/live  |
| API readiness              | http://127.0.0.1:3001/api/v1/health/ready |
| OpenAPI (development only) | http://127.0.0.1:3001/api/docs            |
| Web dependency status      | http://localhost:3000/status              |

The worker starts independently, persists heartbeats, and shuts down cleanly. It has no signing or job-processing implementation yet. A green readiness response means infrastructure is available, not that autonomous asset management is implemented.

## Workspace

```text
apps/web/                      Next.js + React + Tailwind + wagmi
apps/api/                      NestJS API + OpenAPI
apps/worker/src/chain/         Person 1: chain execution/monitoring boundary
apps/worker/src/orchestration/ Person 2: workflow/jobs boundary
packages/shared/              Zod schemas and exact amount types
packages/database/            PostgreSQL + Prisma client/migrations
packages/chain/               viem read client and deployment manifest schema
contracts/                    Solidity + OpenZeppelin + Foundry
evaluation/                   Benchmark handoff (not yet implemented)
tests/e2e/                    Playwright smoke tests
deploy/                       Reverse-proxy template
```

See [PRD](./prd.md), [three-person assignment](./task-assignment.md), and [runbook](./docs/runbook.md).

## Checks

After activating pinned pnpm, run:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm contracts:test
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

`test:integration` requires a migrated PostgreSQL database and creates/removes only its own random fixture records. Playwright starts the web server; its smoke tests do not require MetaMask, a chain deployment or a running API. Full authenticated transaction E2E remains assigned work.

`pnpm check` groups lint, typecheck, unit tests, app builds and contract tests. PostgreSQL integration and browser checks are separate commands. The first contract build downloads the pinned Solidity compiler. Prisma uses its v7 generated client and PostgreSQL driver adapter; `build:packages` generates the client automatically.

## Full stack with Docker

```sh
pnpm env:setup
docker compose --profile app up --build -d
docker compose --profile app ps
```

The migration container runs before the worker/API. API and database are internal to the Docker network; web binds only to `127.0.0.1:3000`. Runtime containers run as a non-root user. Docker setup is a local baseline; configure domain, HTTPS and operational release gates before public use.

The `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` setting is public browser configuration, not a secret. Docker's default build uses the public testnet endpoint; frontend public env changes require rebuilding the image. API/worker private settings are injected at runtime. Never prefix private keys or provider secrets with `NEXT_PUBLIC_`.

## Technical references

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [NestJS first steps](https://docs.nestjs.com/first-steps)
- [Prisma v7 client generator](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators)
- [Wagmi React](https://wagmi.sh/react/getting-started)

Mainnet, real funds, live DeFi and production custody remain outside the MVP scope. Testnet readiness must be established with the tests and release gates in the PRD.
