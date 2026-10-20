# Boundra

**Autonomy within your boundaries.** A risk-aligned agent wallet for the FinTechathon 2026 Topic F prototype.

## Status

Built and tested: Person 1's contracts (deployed on Base Sepolia, reviewed manifest in `deploy/manifests/base-sepolia.json`), typed chain modules and deploy script; Person 2's SIWE sessions and API tokens, REST API with OpenAPI, deterministic ACCE planner and mandate builder, PostgreSQL schema, durable execution and monitor stores, the bounded agent loop (deposit, risk exit, escalation, revocation) with crash recovery, validated LLM wording (OpenAI or Anthropic) and the B0–B3 benchmark runner; Person 3's owner web app, browser end-to-end suites, the SDK and MCP server, and the deployable stack (Docker Compose with Caddy, or Render).

The full flow is proven end to end on a local anvil chain (`pnpm test:e2e:chain`, `pnpm test:e2e:real`), and the stack runs against the Base Sepolia deployment. Still open: the frozen 50-persona benchmark run, monitoring and alerts, and an independent security review. No addresses, transaction hashes, benchmark results or performance claims are invented.

| Document                                                                       | Where                                                                                                    |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Technical documentation (architecture, core algorithm, security design)        | [docs/technical/boundra-technical.pdf](./docs/technical/boundra-technical.pdf)                           |
| Contract security self-assessment                                              | [docs/security.md](./docs/security.md)                                                                   |
| Execution evidence (real Base Sepolia transactions, including the agent's own) | [docs/execution-evidence.md](./docs/execution-evidence.md)                                               |
| Deployment instructions                                                        | [docs/runbook.md](./docs/runbook.md), [docs/deploy-render.md](./docs/deploy-render.md)                   |
| API, ACCE, data model                                                          | [docs/api.md](./docs/api.md), [docs/acce.md](./docs/acce.md), [docs/data-model.md](./docs/data-model.md) |
| SDK and MCP server                                                             | [docs/roadmap-sdk-mcp.md](./docs/roadmap-sdk-mcp.md)                                                     |
| Tests                                                                          | [Checks](#checks) below: unit, integration, contract, chain end-to-end and browser suites                |

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

| Service                              | Local URL                                 |
| ------------------------------------ | ----------------------------------------- |
| Web                                  | http://localhost:3000                     |
| Owner app (sign-in)                  | http://localhost:3000/app                 |
| Vault conditions (risk admin wallet) | http://localhost:3000/app/risk            |
| API liveness                         | http://127.0.0.1:3001/api/v1/health/live  |
| API readiness                        | http://127.0.0.1:3001/api/v1/health/ready |
| OpenAPI (development only)           | http://127.0.0.1:3001/api/docs            |
| Web dependency status                | http://localhost:3000/status              |

Open the web app at the exact origin in `WEB_ORIGIN` (default `http://localhost:3000`). Sign-in messages are bound to that origin, so the app refuses to sign in from `http://127.0.0.1:3000` and links to the right address instead. The web app forwards `/api/v1/*` to `API_INTERNAL_URL`, so the browser only ever talks to one origin.

The worker starts independently and reports its mode in the heartbeat: `observe_only` without a reviewed deployment manifest, `monitor_only` when signing is not fully configured, and `execute` only when `EXECUTION_ENABLED=true`, an operator key, `ATTEMPT_ENCRYPTION_KEY` and gas caps are set and the deployment verifies. Readiness reports `executionEnabled` accordingly.

### Local chain (optional)

Creating an intent checks your MockUSDC balance on chain, so the owner journey needs a deployment. Before (or instead of) the public Base Sepolia deployment, run Person 1's contracts on a local anvil chain:

```sh
node scripts/dev-chain.mjs --fund 0xYourWalletAddress
```

It starts anvil with chain ID 84532 on `http://127.0.0.1:8545`, runs `contracts/script/DeployBoundra.s.sol`, writes a manifest pinned to the deployed code hashes in `tmp/dev-chain/`, sends gas money to each `--fund` address and prints the `.env` lines to set (`BASE_SEPOLIA_RPC_URL`, `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL`, `DEPLOYMENT_MANIFEST_PATH`, `OPERATOR_ADDRESS`). Restart the API, worker and web dev server after changing `.env`, and add the local network to your wallet. The chain uses anvil's public development keys; nothing on it is Base Sepolia evidence.

Chain state is saved in `tmp/dev-chain/` every few seconds and on exit, so restarting the script continues the same chain and the database stays consistent with it. Saves are atomic and the previous snapshot is kept, so even closing the terminal loses a few seconds at most. `--fresh` deploys a new chain: reset the database afterwards (`prisma migrate reset` in `packages/database`), because its executors and mandates belong to the old chain.

#### Testing with MetaMask on the local chain

The local chain uses Base Sepolia's chain ID, which the app requires. MetaMask keys some of its hosted services to the chain ID, so it treats this chain as the real Base Sepolia. Verified with MetaMask on 2026-10-17:

- **Network:** add it yourself, with RPC `http://127.0.0.1:8545`, chain ID `84532` and currency `ETH`. Delete any old "Anvil" network on the same RPC with chain ID 31337 first. If MetaMask does not know chain 84532, the app's switch prompt now offers the local RPC as "Base Sepolia (local)".
- **Owner account:** import a free anvil account with `node -e "import('./scripts/lib/local-chain.mjs').then(m => console.log(m.devKey(2)))"`. Account 2 is free; 0 deploys, 1 is the risk admin (useful for `/app/risk`), 3 is the operator and 5–9 are reserved for tests. Keep it a throwaway account: these keys are public, so never fund them on a public network.
- **Gas:** MetaMask may set a gas limit estimated against the real Base Sepolia, where these contracts do not exist (about 21,000 gas, so the transaction runs out of gas and reverts). Set the gas limit by hand in the confirmation (Advanced): 2,200,000 for "Create executor", 500,000 for "Set mandate", 300,000 for the rest.
- **Fees:** choose to pay with ETH, not "Paid by MetaMask" (its relay only reaches the real network), and turn off Settings → Advanced → Smart transactions. "This transaction is likely to fail" comes from the same real-network simulation and can be ignored here.
- **Address:** open the app at `http://localhost:3000` exactly. Sign-in messages are bound to `WEB_ORIGIN`, so `127.0.0.1:3000` cannot sign in.
- **Agent:** for the agent to act, start the worker with `EXECUTION_ENABLED=true`, `OPERATOR_PRIVATE_KEY` set to anvil account 3's key and the `MAX_*` gas caps. The worker then deposits, exits on risk and escalates by itself, with no MetaMask prompt.

On the public Base Sepolia none of the gas or relay workarounds apply: MetaMask's services see the real contracts there.

## Workspace

```text
apps/web/                      Next.js + React + Tailwind + wagmi
apps/api/                      NestJS API + OpenAPI
apps/worker/src/chain/         Person 1: chain execution/monitoring boundary
apps/worker/src/orchestration/ Person 2: decision policy, orchestrator, job runner
apps/worker/src/persistence/  Person 2: PostgreSQL execution/monitor stores
packages/shared/              Zod schemas and exact amount types
packages/database/            PostgreSQL + Prisma client/migrations
packages/chain/               viem read client, deployment manifest, mandate hashing
packages/acce/                Person 2: deterministic ACCE planner and mandate builder
packages/llm/                 Person 2: optional validated LLM wording/summaries
packages/sdk/                 SDK for developers and agents: owner API client, bounded operator
apps/mcp/                     MCP server for AI assistants (stdio), on top of the SDK
contracts/                    Solidity + OpenZeppelin + Foundry
evaluation/                   Person 2: B0–B3 benchmark runner (fixtures: Person 3)
tests/e2e/                    Playwright: UI on real contracts, API mocked
tests/e2e-real/               Playwright: full journeys on the real API, worker and chain
deploy/                       Reverse-proxy template
```

See [PRD](./prd.md), [three-person assignment](./task-assignment.md), and [runbook](./docs/runbook.md). Developers and AI assistants: [SDK](./packages/sdk/README.md), [MCP server](./apps/mcp/README.md) and [what they guarantee](./docs/roadmap-sdk-mcp.md); owners create API tokens in the app under **Apps & AI**.

## Checks

After activating pinned pnpm, run:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm contracts:test
pnpm test:integration
pnpm test:e2e:chain
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:real
```

`test:integration` requires a migrated PostgreSQL database and creates/removes only its own random fixture records. `test:e2e:chain` starts anvil (chain ID 84532), deploys with the contracts' deploy script, migrates and drops its own temporary database, and runs the API and worker end to end; it also runs the SDK's operator against the contracts. It needs PostgreSQL but no keys or public RPC. `pnpm benchmark -- --fixture <file>` runs B0–B3 (see `evaluation/README.md`). Both browser suites use an in-page test wallet instead of MetaMask (anvil's public development keys only) and start their own web server and local chain. `test:e2e` checks every screen and owner transaction against Person 1's real contracts, with the API mocked. `test:e2e:real` mocks nothing: it starts the real API and worker (execute mode) on a temporary PostgreSQL database and runs the required journey (sign-in → setup → goal → ACCE → review → authorize and fund → agent deposit → risk event set by the risk admin's wallet → agent exit and escalation → revoke → owner recovery) and the same-prompt, two-persona walkthrough. Its LLM provider is configured but simulated as overloaded, so it also proves that a provider failure falls back to labelled template wording without blocking anything. It needs PostgreSQL but no keys; service logs land in `tmp/e2e-real/logs/`.

`pnpm check` groups lint, typecheck, unit tests, app builds and contract tests. PostgreSQL integration and browser checks are separate commands. The first contract build downloads the pinned Solidity compiler. Prisma uses its v7 generated client and PostgreSQL driver adapter; `build:packages` generates the client automatically.

## Full stack with Docker

The Docker stack reads its own settings file, `deploy/.env`, because values inside containers (RPC, manifest path) differ from the host-run development `.env`.

```sh
node scripts/setup.mjs --deploy        # creates deploy/.env with fresh secrets
export RELEASE=$(git describe --always --dirty)
docker compose --env-file deploy/.env --profile app up --build -d
docker compose --env-file deploy/.env --profile app ps
```

Add `--profile public` for HTTPS through Caddy on one origin (set `APP_DOMAIN`, `WEB_ORIGIN=https://<domain>` and `TRUST_PROXY=true` first). The migration container runs before the worker and API; a `backup` service dumps PostgreSQL every 6 hours. API and database are internal to the Docker network, web binds only to `127.0.0.1:3000`, and runtime containers run as a non-root user. `/status` and `/api/v1/health/*` report the running release and whether the worker is executing. Deployment, release, rollback and backups: [runbook](./docs/runbook.md).

The `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` setting is public browser configuration, not a secret. Docker's default build uses the public testnet endpoint; frontend public env changes require rebuilding the image. API/worker private settings are injected at runtime. Never prefix private keys or provider secrets with `NEXT_PUBLIC_`.

## Technical references

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [NestJS first steps](https://docs.nestjs.com/first-steps)
- [Prisma v7 client generator](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators)
- [Wagmi React](https://wagmi.sh/react/getting-started)

Mainnet, real funds, live DeFi and production custody remain outside the MVP scope. Testnet readiness must be established with the tests and release gates in the PRD.
