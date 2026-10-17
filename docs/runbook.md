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

## Backups and restore

**Schedule.** With `docker compose --profile app up`, the `backup` service runs `pg_dump` every `BACKUP_INTERVAL_SECONDS` (default 6 hours) into `BACKUP_DIR` (default `./backups`, gitignored) and keeps the newest `BACKUP_KEEP` dumps (default 28, about a week). `pnpm db:backup` takes one now, also against the plain local database. Each `boundra-<UTC stamp>.dump` comes with a `.sha256` file and a `.json` file of the migration count and per-table row counts.

**Off-host copies are your job.** Backups on the same disk as the database do not survive losing that host. Copy `BACKUP_DIR` to separate storage on the same schedule; dumps contain user data (wallet addresses, intents, sessions), so keep that storage private.

**Drill.** `pnpm db:restore-drill [file]` restores the newest (or given) dump into a separate, throwaway PostgreSQL container and checks the checksum, a clean `pg_restore`, every table's row count against the backup's record, and that `prisma migrate status` sees the schema as current. It writes `<dump>.drill.json` and removes the container. Run it after any backup or schema change and at least weekly.

| Date (UTC)       | Backup                            | Result | Duration | Notes                                                                                      |
| ---------------- | --------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------ |
| 2026-10-17 06:37 | boundra-20261017T063658Z (230 KB) | passed | 10.2 s   | Local dev database, 23 tables. A corrupted byte and a wrong recorded count both failed it. |

**Restoring for real.** Never restore over the live database first.

1. Stop the worker, then the API (`docker compose stop worker api`), so nothing writes or signs meanwhile.
2. Run the drill on the dump you intend to use.
3. Restore into a new database, e.g. `createdb boundra_restored` then `pg_restore --no-owner --exit-on-error -d boundra_restored < file.dump` inside the `postgres` container, and point `DATABASE_URL` at it. Keep the old database until the service is verified.
4. Start the API, check `/api/v1/health/ready`, then start the worker. A restored database can be behind the chain: the worker rescans from its saved cursor, and the executor itself rejects a second allocation (`BudgetExceeded`) or a reused action ID (`Replay`), as Person 2's chain E2E shows. Follow Person 2's worker recovery notes before letting it execute again.

## Deploy, release and roll back

**Settings.** The Docker stack reads `deploy/.env` (create it with `node scripts/setup.mjs --deploy`; template `deploy/env.example`). Pass `--env-file deploy/.env` to every `docker compose` command. It holds secrets: keep it readable by the operator only. Chain configuration: put the reviewed manifest in `deploy/manifests/` and set `DEPLOYMENT_MANIFEST_PATH=/config/manifests/<file>.json`; without it the worker stays `observe_only`.

**Release identifier.** `RELEASE` (use `git describe --always --dirty`, or the tag) is baked into the images and tags them (`${IMAGE_PREFIX}-web:${RELEASE}` and so on). `/status` returns `release.web` and `release.api`, `/api/v1/health/live` returns `release`, the worker logs its release at startup, and the footer shows it. Check them after every deploy.

**Releasing.** Tag a commit whose CI is green (`git tag v0.4.0 && git push origin v0.4.0`). The Release workflow publishes `ghcr.io/<owner>/boundra-{web,api,worker,migrate}:v0.4.0`. To deploy it, set `IMAGE_PREFIX=ghcr.io/<owner>/boundra` and `RELEASE=v0.4.0`, then `docker compose --env-file deploy/.env --profile app --profile public pull` and `up -d --no-build`. Building on the host (`up --build`) also works and tags images with the local `RELEASE`.

**Rolling back.** Set `RELEASE` to the previous identifier and run `up -d --no-build`; the previous images are reused. Migrations only move forward: if the release you leave added a migration, the old code may not match the schema. In that case restore the backup taken before the upgrade (see below) instead of only switching images. Take a backup (`docker compose --env-file deploy/.env run --rm backup once`) before every upgrade.

**HTTPS.** `--profile public` starts Caddy (`deploy/Caddyfile`) on ports 80 and 443 in front of web and API on one origin. With a public `APP_DOMAIN` whose DNS points at the host, Caddy obtains and renews Let's Encrypt certificates itself and sends HSTS. Set `WEB_ORIGIN=https://<APP_DOMAIN>` (sign-in messages and the Origin check depend on it) and `TRUST_PROXY=true` (only behind this proxy). `APP_DOMAIN=localhost` tries the setup on one machine with Caddy's local CA.

## Before public deployment

Still open: a host and domain, Person 1's reviewed Base Sepolia manifest, runtime secrets in the deployment secret facility, monitoring/alerts, and the 60-minute soak. Person 1/2 supply chain/worker recovery procedures after implementing them. `deploy/Caddyfile` is a reverse-proxy template, not an already configured production host.

Do not expose PostgreSQL or mount owner keys. Runtime secrets belong in the deployment secret facility. Local `.env` is gitignored and excluded from Docker builds.
