# Contract interface

## Mock vaults (implemented)

`LiquidVault(token, admin)` and `TimedVault(token, admin)` implement `IBoundraVault`.
All amounts are underlying MockUSDC base units (6 decimals), with 1:1 principal and no yield accrual.
`illustrativeYieldBps()` returns fixture metadata only: 300 and 600 basis points per year.

- `deposit(amount)`: caller transfers its own approved token, records principal and unlock time. DEGRADED blocks new deposits.
- `withdraw(amount)`: caller receives its own principal; there is no arbitrary recipient argument. Requires unlock and available global withdrawal capacity.
- `principal(account)`, `unlockAt(account)`, `maxWithdraw(account)`: read position and currently withdrawable amount.
- `setRiskState(level, capacity)`: mock-vault owner/admin only; NORMAL=0, DEGRADED=1. Capacity is a global remaining withdrawal allowance; `uint256.max` means unlimited and is not decremented.
- Deposits into TimedVault extend the entire account position to the maximum of the previous unlock time and `block.timestamp + 30 days`. The agent executor must prevent top-ups after its initial allocation.
- `Deposited(account, amount, unlockTimestamp)`, `Withdrawn(account, amount)`, and `RiskStateChanged(level, capacity)` support monitoring. Event sources must be checked against trusted deployment addresses.

Contract tests use local time travel for TimedVault. Public demo withdrawal uses LiquidVault. No public addresses or receipts are asserted until deployment is performed.

## Factory and executor (implemented)

`BoundraFactory(token, liquid, timed)` fixes the reviewed asset/vault configuration. Owner calls `createExecutor()` once; discover it with `executorOf(owner)` or `ExecutorCreated(owner, executor)`. Owner, token, targets and deployment chain ID are immutable; there is no arbitrary-call or upgrade entry point.

Canonical `Mandate` tuple: `chainId`, `asset`, `operator`, `beneficiary`, `expiresAt` (uint64 seconds), `allowedVaults` (1 liquid / 2 timed / 3 both), `allowedActions` (1 deposit / 2 withdraw / 3 both), `maxLockupSeconds` (uint32), `maxDepositPerAction`, `maxCumulativeDeposits`, `maxWithdrawPerAction`, `allocationTarget` (uint256 base units).

- Owner calls `setMandate(tuple)` directly; beneficiary must equal owner. `MandateSet(version, mandateHash, operator)` records `keccak256(abi.encode(tuple))`. Backend must reconcile confirmed fields/hash with approved preview.
- Owner approves exact MockUSDC then calls `fund(amount)`. Both funding and authorization must be confirmed before agent dispatch.
- Operator calls `executeDeposit(actionId, version, nonce, deadline, target, amount)` or `executeWithdraw(...)`; no recipient override or arbitrary calldata. Deadline is exclusive and cannot exceed mandate expiry.
- Contract action nonce `nextActionNonce` is separate from EOA transaction nonce. It and `consumedActionIds` never reset across mandate versions. Reverted calls consume neither.
- Exactly one deposit allocation per mandate. A cap-limited partial deposit completes allocation; leftover idle funds remain recoverable by owner. Preview must explain this when the cap is below the requested target.
- Operator withdrawal pays the owner wallet directly, not the operator. It does not refill deposit budget. Repeated partial exits remain bounded by vault principal/capacity and maxWithdrawPerAction.
- Timed deposit requires accepted 30-day lockup and expiry strictly after actual deposit time + 30 days + one-day buffer. The seven-day default cannot authorize it.
- Owner can `pause()`, `resume()` (unexpired/non-revoked only), or `revoke()`. `recoverIdle(amount)` and `ownerWithdraw(target, amount)` survive expiry/revoke; recovery still follows vault lockup/capacity.
- Replacement requires zero positions in both vaults. Resetting deposit budget is therefore a new explicit owner authorization after settlement, never an automatic result of withdrawal.
- `ActionExecuted(actionId, version, nonce, action, target, amount)` is transaction evidence. A broadcast hash alone is not confirmation.

Typed ABIs and the chain adapter are documented in [chain-integration.md](./chain-integration.md); the deployment script in [deployment.md](./deployment.md).
