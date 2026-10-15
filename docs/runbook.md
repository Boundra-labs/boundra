# Local operations

## Startup

1. Use Node 22.22 and `corepack pnpm@10.32.1` (or activate that pnpm version).
2. Run `pnpm env:setup` once; it creates `.env` without overwriting existing values. Do not use `pnpm setup`, which is pnpm's global shell-configuration command.
3. Run `pnpm db:up`, wait for PostgreSQL health, then `pnpm db:migrate`.
4. Run `pnpm dev`. API, worker and web start separately.

`/api/v1/health/live` proves API process liveness. `/api/v1/health/ready` requires migrated PostgreSQL and a recent worker heartbeat and reports the worker mode; `executionEnabled` is true only in `execute` mode. Neither endpoint proves public deployment.

## Worker modes

| Mode           | Cause                                                                                                                                                                                                | Action                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `observe_only` | `DEPLOYMENT_MANIFEST_PATH` unset, or activation failed (RPC down, bytecode/config mismatch)                                                                                                          | Fix the manifest/RPC; activation is retried every few ticks, no restart needed |
| `monitor_only` | Signing not fully configured (`EXECUTION_ENABLED`, `OPERATOR_PRIVATE_KEY`, `ATTEMPT_ENCRYPTION_KEY`, `MAX_GAS`, `MAX_FEE_PER_GAS_WEI`, `MAX_PRIORITY_FEE_PER_GAS_WEI`) or operator equals risk admin | Intended until the release gates pass                                          |
| `execute`      | All checks passed                                                                                                                                                                                    | Agent proposes, signs and reconciles bounded actions                           |

Stuck actions stay `RECONCILE` and are retried automatically; an operator EOA nonce blocked by an unsendable attempt is released after the action deadline (`ACTION_DEADLINE_SECONDS`) by a guaranteed-revert rebroadcast. Investigate `ActionProposal`/`TransactionAttempt`/`AttemptEvent` rows before any manual action; never create a replacement action ID. On suspected operator compromise: owners revoke on-chain, set `EXECUTION_ENABLED=false`, rotate the key, and authorize a new operator only through fresh mandates.

## Diagnose

- Database: `docker compose ps` and `docker compose logs postgres`.
- Missing tables: run `pnpm db:migrate`; never reset a deployed database as a startup fix.
- API 503: inspect worker process and database connectivity; heartbeat expiry is 45 seconds by default.
- Changed database password: changing `.env` does not modify credentials in an existing PostgreSQL volume. Update the database role deliberately or restore a known backup; do not delete volumes to bypass this.
- Stop local Compose services with `docker compose down`; omit `--volumes` to retain data.

## Before public deployment

Person 3 must finish HTTPS/domain wiring, backup scheduling and a restore drill, monitoring/alerts, release identifiers and rollback instructions. Person 1/2 supply chain/worker recovery procedures after implementing them. `deploy/Caddyfile` is a reverse-proxy template, not an already configured production host.

Do not expose PostgreSQL or mount owner keys. Runtime secrets belong in the deployment secret facility. Local `.env` is gitignored and excluded from Docker builds.
