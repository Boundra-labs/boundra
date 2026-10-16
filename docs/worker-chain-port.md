# Worker chain ports — Person 1 / Person 2

## Implemented modules

`apps/worker/src/chain/execution.ts` implements `OperatorExecutionService` with confirmed snapshot checks, latest-state simulation, gas/fee caps, offline restricted-operator signing, persistence-before-broadcast, canonical receipt/event verification, and identical-transaction crash recovery.

Person 2's PostgreSQL implementations live in `apps/worker/src/persistence/` (`PostgresExecutionStore`, `PostgresMonitorStore`) and are wired by `apps/worker/src/runtime/worker.runtime.ts`. The worker starts in one of three modes chosen by `runtime/activation.ts`:

| Mode           | When                                                                                                                                  | Behaviour                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `observe_only` | No `DEPLOYMENT_MANIFEST_PATH`, or activation failed (RPC down, untrusted bytecode)                                                    | Heartbeat only; activation is retried periodically, never a restart loop      |
| `monitor_only` | Manifest verified, but `EXECUTION_ENABLED`, operator key, `ATTEMPT_ENCRYPTION_KEY` or gas caps missing, or operator equals risk admin | Verifies authorizations, monitors risk events, records decisions; never signs |
| `execute`      | All of the above present                                                                                                              | Additionally proposes, signs and reconciles bounded operator actions          |

The heartbeat records the mode and API readiness reports `executionEnabled` only for `execute`. There is no in-memory production fallback.

## ExecutionStore contract

- `durable: true` signifies an actual PostgreSQL implementation; it is not a substitute for testing durability.
- `withSignerLease(key, work)` serializes all dispatches for `(chainId, operatorAddress)`. Use a renewable lease with monotonic fencing tokens; do not hold a database transaction open across RPC/LLM calls. `assertHeld()` rejects an expired/replaced lease.
- `findAttempt(actionId)` returns the immutable action/request fingerprint, owner/executor, EOA nonce, exact signed raw transaction/hash, signed-at block and current state. Encrypt/restrict raw-transaction access and never log it.
- `reserveEoaNonce(actionId, minimumPendingNonce, lease)` atomically persists an idempotent reservation. Ensure unique `(chainId, operator, eoaNonce)`. Reclaim abandoned unsigned reservations only after fencing the old owner and proving no signed attempt was persisted; otherwise reconcile before advancing.
- `saveSignedAttempt(attempt, lease)` is atomic and fenced. Enforce unique action ID, immutable request hash, reserved EOA nonce, and a unique live `(chainId, executor, contractActionNonce)` even across mandate versions. A mined revert may release that contract nonce only after the configured reorg window. It completes **before any network broadcast**.
- `reserveBroadcast(actionId, maxAttempts, minIntervalMs, lease)` atomically checks/increments persisted send count and timestamp. Maximum 3 sends, minimum 10 seconds apart, retained across restarts. Count the intent before network I/O so crashes cannot reset the budget.
- `recordState` persists transitions and canonical receipt references using compare-and-set/fencing. Never discard an ambiguous signed attempt or allocate a new action/EOA nonce merely to get past an RPC timeout.

Person 2 must integration-test these constraints against real PostgreSQL, including concurrent workers, lease replacement, a crash between reservation/signing/save, and a crash after save/broadcast. The Person 1 unit tests mock the store and do not claim to prove that database implementation.

## Recovery behavior

Every retry checks receipts again, including previously confirmed/reverted receipts. Canonical hash, operator/from, executor/to, confirmation depth and exact `ActionExecuted` fields must agree. Reorg or missing/mismatched evidence stays RECONCILE.

The scheduler re-enqueues terminal receipt checks for at least 20 blocks after inclusion. During the same window, a reverted attempt blocks a new signature for its unchanged executor contract nonce. Once the window passes, the partial unique index excludes `REVERTED`, so the next proposal can safely reuse that contract nonce with a fresh action ID and EOA nonce.

If a receipt is explicitly not found, the service queries the known transaction. A known pending transaction is not resent. Only when transaction is also explicitly not found and both chain nonce observations show the reserved nonce is still available may the service validate stored signed calldata/fees, refresh policy, simulate again, and rebroadcast **identical bytes** under the persisted retry budget. Generic RPC errors are not treated as proof of absence.

If policy, refresh or simulation fails before the action deadline (for example the owner paused), the old candidate is not resent: state stays RECONCILE with `RESEND_BLOCKED_UNTIL_DEADLINE`, and the EOA nonce stays reserved. Once a confirmed block timestamp reaches the action deadline, the executor's `deadline <= block.timestamp` check guarantees those bytes revert. The service then rebroadcasts the identical bytes (`NONCE_RELEASE_BROADCAST`) so the reverted transaction consumes the reserved nonce instead of leaving a permanent gap that blocks every later operator transaction. Release sends share the persisted counter with a total cap of 6 (3 normal + 3 release). Reconciliation then records the mined revert as REVERTED. Keep action deadlines short so a blocked nonce is released quickly.

No automatic fee escalation or replacement is implemented. A consumed nonce with an unresolved receipt, exhausted retries, expired policy or unresolved external replacement requires escalation/reconciliation; do not silently invent another action. Any later fee-replacement implementation must preserve the same EOA nonce and exact calldata, be persisted as a linked attempt, obey configured caps, and add dedicated tests before activation.

## Activation gate

Supply a reviewed deployment manifest, funded restricted operator, explicit positive gas/fee limits and the durable store. Reject operator equal to risk admin; deployment operations must also keep deployer and operator keys separate. The API/worker must verify confirmed owner authorization and funding before dispatch. Owner private keys are never backend input. Public Base Sepolia evidence is still required before claiming a completed demo.

## Risk monitor store

`RiskEventMonitor` in `monitor.ts` reads only the two pinned mock-vault sources at configured confirmation depth. It checks deployment code, each log's canonical block hash and the end-of-batch block hash. Historical event risk is recorded separately from current risk/capacity at the batch's confirmed head; an old warning does not override a recovered NORMAL state.

Implement `MonitorStore` with a renewable fenced lease, persistent `(nextBlock, previousBlockHash)` cursor and atomic `commitBatch(expectedCursor, nextCursor, observations)`. Event identity is `(chainId, txHash, logIndex)` with canonical block hash attached. Overlap rescans must upsert without producing duplicate decisions. Enqueue new decision work in the same PostgreSQL transaction as the event/cursor update, using stable idempotency keys.

Cursor hash mismatch or chain regression triggers `rewind` to the trusted deployment block. Without stored ancestor history, full rescan is the conservative fallback for a deeper-than-overlap reorg. `rewind` must mark affected observations orphaned and invalidate pending derived decisions atomically. It must not erase receipt history or pretend executed transactions were undone; affected actions go through reconciliation.

Normal scans overlap at least 20 blocks, bounded in configurable batches. Never dispatch directly from event text: reconcile current vault/position/mandate through `BoundraChainReader`, enforce freshness and policy, then use the execution service. RPC errors or invalid/removed/unknown-source logs do not advance the cursor. Person 2 owns store migrations and real PostgreSQL/restart/concurrency integration tests.
