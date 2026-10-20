# Data model

PostgreSQL 17 via Prisma 7 (`packages/database/prisma/schema.prisma`); migrations are applied as a release step with `pnpm db:migrate`, never reset at startup. Addresses are stored lowercase, hashes as lowercase `0x` hex, token amounts and block numbers as `NUMERIC(78,0)` (exact uint256) and EOA nonces as `BIGINT`. PostgreSQL is not the source of truth for authority, receipts or positions: chain state is reconciled before every action.

## Tables

| Area          | Table                                   | Purpose and key constraints                                                                                                                                                                                                              |
| ------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | `WalletIdentity`                        | One row per owner address (unique, canonical lowercase)                                                                                                                                                                                  |
|               | `AuthChallenge`                         | SIWE nonce hash, address, domain, URI, chain 84532, expiry, `consumedAt` (single use)                                                                                                                                                    |
|               | `AuthSession`                           | Session token hash, CSRF token hash, expiry, revocation                                                                                                                                                                                  |
| Clarification | `Intent`                                | Objective, exact amount, `WorkflowState`, optimistic `version`, descriptor/ACCE config versions                                                                                                                                          |
|               | `Question`                              | Ordered questions (1–5) with dimension, alternatives, ordinal components (0–3), score, action disagreement, wording source, answer                                                                                                       |
|               | `PreferenceRecord`                      | Versioned answers per dimension (audit)                                                                                                                                                                                                  |
| Mandates      | `Executor`                              | One verified executor per owner (unique owner, unique address)                                                                                                                                                                           |
|               | `Mandate`                               | One row per draft revision: exact tuple, selected vault, preview + `previewHash`, `mandateHash`, status, `onchainVersion`, authorization/funding blocks, escalation. At most one `AUTHORIZED` per executor (partial unique index)        |
| Agent         | `Decision`                              | Every DEPOSIT/WITHDRAW/HOLD/ESCALATE with reason, candidates, snapshot block/hash, policy version (repeated HOLDs are not re-logged)                                                                                                     |
|               | `ActionProposal`                        | Deterministic `actionId`, immutable envelope, contract nonce + proposal sequence (unique), `WorkflowState`. **At most one non-terminal action per executor** (partial unique index)                                                      |
|               | `PolicyCheck`                           | Proposal- and dispatch-stage checks with codes                                                                                                                                                                                           |
| Chain ports   | `Lease`                                 | Row lease with monotonic `fencingToken` for signer and monitor                                                                                                                                                                           |
|               | `EoaNonceReservation`                   | Idempotent per action; active `(chainId, operator, eoaNonce)` unique                                                                                                                                                                     |
|               | `TransactionAttempt`                    | Signed attempt (raw tx AES-256-GCM encrypted, action ID as AAD), tx hash, send count/time, receipt block, state; unique `(chainId, executor, contractNonce)` until a canonical revert releases the contract nonce after the reorg window |
|               | `AttemptEvent`                          | Append-only attempt history                                                                                                                                                                                                              |
|               | `MonitorCursor`, `RiskEvent`            | Cursor + previous block hash; events unique by `(chainId, txHash, logIndex)`, `CANONICAL`/`ORPHANED`                                                                                                                                     |
| Operations    | `Job`                                   | Outbox/queue: unique key, kind, payload, attempts/max, lease owner/expiry, last error                                                                                                                                                    |
|               | `WorkerHeartbeat`                       | Worker liveness and mode                                                                                                                                                                                                                 |
|               | `ActivityEvent`                         | Owner timeline (append-only)                                                                                                                                                                                                             |
| Evaluation    | `EvaluationRun`, `EvaluationCaseResult` | Benchmark runs with versions and per-persona results                                                                                                                                                                                     |

## State machines

- **Intent:** `INTENT_RECEIVED → CLARIFYING → MANDATE_PENDING → AUTHORIZED`; `ESCALATED` when nothing is eligible; `REJECTED` after a demo reset.
- **Mandate:** `PREVIEWED → APPROVED → AUTHORIZED → (REVOKED | EXPIRED | SUPERSEDED)`; an edit supersedes the open revision. Only the worker sets `AUTHORIZED`, after the confirmed on-chain tuple matches field by field.
- **ActionProposal:** `POLICY_CHECKED → BROADCAST → CONFIRMED | FAILED`, with `RECONCILE` while the outcome is unknown and `REJECTED` when the guard refuses before signing. A signed attempt is never abandoned for a new action ID.
- **TransactionAttempt:** `SIGNED → BROADCAST → CONFIRMED | REVERTED`, `RECONCILE` when ambiguous. Terminal receipts are rechecked for at least 20 blocks; a reverted tuple is not reused until that window passes.

## Concurrency rules

- Workflow changes and their follow-up jobs commit in one transaction (`enqueueJob(tx, …)`); job keys make enqueueing idempotent.
- Jobs are claimed with `FOR UPDATE SKIP LOCKED` and a lease; a crashed worker's job is reclaimed and its old owner can no longer complete it.
- Signer and monitor work hold a row lease across RPC calls (never a database transaction); every write first locks the lease row and checks the fencing token, so a replaced holder cannot commit.
- Answers use optimistic concurrency on `Intent.version`; approvals compare-and-set on status and preview hash.

## Tests

`pnpm test:integration` runs schema, store, orchestrator and API tests against real PostgreSQL; `pnpm test:e2e:chain` migrates a fresh database and runs the full flow on anvil.
