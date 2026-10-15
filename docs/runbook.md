# Local operations

## Startup

1. Use Node 22.22 and `corepack pnpm@10.32.1` (or activate that pnpm version).
2. Run `pnpm env:setup` once; it creates `.env` without overwriting existing values. Do not use `pnpm setup`, which is pnpm's global shell-configuration command.
3. Run `pnpm db:up`, wait for PostgreSQL health, then `pnpm db:migrate`.
4. Run `pnpm dev`. API, worker and web start separately.

`/api/v1/health/live` proves API process liveness. `/api/v1/health/ready` requires migrated PostgreSQL and a recent worker heartbeat. Neither endpoint proves contract deployment or execution readiness. The scaffold cannot sign transactions.

## Diagnose

- Database: `docker compose ps` and `docker compose logs postgres`.
- Missing tables: run `pnpm db:migrate`; never reset a deployed database as a startup fix.
- API 503: inspect worker process and database connectivity; heartbeat expiry is 45 seconds by default.
- Changed database password: changing `.env` does not modify credentials in an existing PostgreSQL volume. Update the database role deliberately or restore a known backup; do not delete volumes to bypass this.
- Stop local Compose services with `docker compose down`; omit `--volumes` to retain data.

## Before public deployment

Person 3 must finish HTTPS/domain wiring, backup scheduling and a restore drill, monitoring/alerts, release identifiers and rollback instructions. Person 1/2 supply chain/worker recovery procedures after implementing them. `deploy/Caddyfile` is a reverse-proxy template, not an already configured production host.

Do not expose PostgreSQL or mount owner keys. Runtime secrets belong in the deployment secret facility. Local `.env` is gitignored and excluded from Docker builds.
