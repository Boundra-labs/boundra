# Worker chain ports — Person 1 / Person 2

## Implemented modules

`apps/worker/src/chain/execution.ts` implements `OperatorExecutionService` with confirmed snapshot checks, latest-state simulation, gas/fee caps, offline restricted-operator signing, persistence-before-broadcast, canonical receipt/event verification, and identical-transaction crash recovery.

It is deliberately **not registered** in the heartbeat-only WorkerModule. Person 2 wires scheduling/lifecycle after providing the PostgreSQL store below. There is no in-memory production fallback. Test fixtures use isolated in-memory stores only to exercise the port contract.

## ExecutionStore contract

- `durable: true` signifies an actual PostgreSQL implementation; it is not a substitute for testing durability.
- `withSignerLease(key, work)` serializes all dispatches for `(chainId, operatorAddress)`. Use a renewable lease with monotonic fencing tokens; do not hold a database transaction open across RPC/LLM calls. `assertHeld()` rejects an expired/replaced lease.
- `findAttempt(actionId)` returns the immutable action/request fingerprint, owner/executor, EOA nonce, exact signed raw transaction/hash, signed-at block and current state. Encrypt/restrict raw-transaction access and never log it.
- `reserveEoaNonce(actionId, minimumPendingNonce, lease)` atomically persists an idempotent reservation. Ensure unique `(chainId, operator, eoaNonce)`. Reclaim abandoned unsigned reservations only after fencing the old owner and proving no signed attempt was persisted; otherwise reconcile before advancing.
- `saveSignedAttempt(attempt, lease)` is atomic and fenced. Enforce unique action ID, immutable request hash, reserved EOA nonce, and unique `(chainId, executor, contractActionNonce)` even across mandate versions. It completes **before any network broadcast**.
- `reserveBroadcast(actionId, maxAttempts, minIntervalMs, lease)` atomically checks/increments persisted send count and timestamp. Maximum 3 sends, minimum 10 seconds apart, retained across restarts. Count the intent before network I/O so crashes cannot reset the budget.
- `recordState` persists transitions and canonical receipt references using compare-and-set/fencing. Never discard an ambiguous signed attempt or allocate a new action/EOA nonce merely to get past an RPC timeout.

Person 2 must integration-test these constraints against real PostgreSQL, including concurrent workers, lease replacement, a crash between reservation/signing/save, and a crash after save/broadcast. The Person 1 unit tests mock the store and do not claim to prove that database implementation.

## Recovery behavior

Every retry checks receipts again, including previously confirmed/reverted receipts. Canonical hash, operator/from, executor/to, confirmation depth and exact `ActionExecuted` fields must agree. Reorg or missing/mismatched evidence stays RECONCILE.

If a receipt is explicitly not found, the service queries the known transaction. A known pending transaction is not resent. Only when transaction is also explicitly not found and both chain nonce observations show the reserved nonce is still available may the service refresh policy, simulate again, validate stored signed calldata/fees, and rebroadcast **identical bytes** under the persisted retry budget. Generic RPC errors are not treated as proof of absence.

No automatic fee escalation or replacement is implemented. A consumed nonce with an unresolved receipt, exhausted retries, expired policy or unresolved external replacement requires escalation/reconciliation; do not silently invent another action. Any later fee-replacement implementation must preserve the same EOA nonce and exact calldata, be persisted as a linked attempt, obey configured caps, and add dedicated tests before activation.

## Activation gate

Supply a reviewed deployment manifest, funded restricted operator, explicit positive gas/fee limits and the durable store. Reject operator equal to risk admin; deployment operations must also keep deployer and operator keys separate. The API/worker must verify confirmed owner authorization and funding before dispatch. Owner private keys are never backend input. Public Base Sepolia evidence is still required before claiming a completed demo.
