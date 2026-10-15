# Contract interface — Person 1

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

Factory/executor, ABI exports, chain adapter and deployment scripts are delivered in subsequent commits. See PRD §13.1 and `task-assignment.md` for the remaining integration contract.
