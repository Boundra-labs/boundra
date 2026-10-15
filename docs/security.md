# Boundra contract security self-assessment

This is implementation evidence for the controlled testnet prototype, not an independent audit or approval for real funds.

## Authority and value flow

- Each executor has one immutable owner and fixed token/two-vault configuration. The factory has no admin override over owner accounts.
- Only owner can approve a new mandate, fund, pause, resume, revoke or recover assets. Operator cannot change authority or beneficiary.
- Operator methods accept typed action parameters only. There is no arbitrary external-call entry point, arbitrary spender or recipient parameter.
- Deposits are capped per action, by cumulative mandate budget and by allocation target. Exactly one allocation is allowed per mandate, including a partial allocation. Vault allowance is exact and cleared after success.
- Withdrawals return principal directly to owner and never replenish a mandate's deposit budget. Repeated partial withdrawals cannot exceed actual principal or protocol capacity.
- Version, deployment chain ID, exclusive action deadline, mandate expiry, monotonic action nonce and globally consumed action IDs are checked on-chain. Reverts roll back nonce/ID consumption.
- Pause/revoke stop subsequent operator calls. Already executed transactions are not undone. Owner recovery survives expiry/revoke while respecting actual lockup/capacity.
- A fresh mandate resets its deposit budget only through explicit owner authorization when both old positions have been settled. Used IDs/nonces remain invalid forever.

## Protocol facts and trust

- Contracts use reviewed MockUSDC and controlled mock vaults. Asset accounting is principal-only; illustrative rates do not accrue tokens or guarantee returns.
- TimedVault really locks principal for 30 days; depositing requires a mandate with explicit lockup acceptance and enough remaining expiry for lockup plus exit buffer.
- Vault administrator can change risk flag and global withdrawal capacity, but cannot redirect a user's position. This role is separate from operator and represents a controlled demo fixture, not an oracle.
- Anyone can deploy a different factory with malicious contracts. Backend must trust a specific reviewed deployment manifest and verify runtime bytecode, chain, asset and factory/owner relationships; factory-looking events alone are insufficient.
- Remaining delegated budget is still at risk if the operator is compromised: an attacker can perform otherwise permitted actions or choose inconvenient timing. Caps do not establish financial suitability.

## Local evidence

Run `pnpm contracts:test`. Coverage includes owner-only changes, exact principal/decimals, supply cap, lockup, bounded capacity, beneficiary routing, pause/revoke/expiry recovery, mandate replacement, per-action/cumulative budget, target/action masks, wrong chain/version/nonce/deadline, replay, arbitrary-call denial, and partial allocation/exit behavior.

Foundry stateful invariant tests execute randomized deposit/withdraw/pause/recovery sequences and assert budget bounds, at most one allocation, owner-only proceeds, principal conservation, vault backing and zero residual allowance. These tests supplement unit/fuzz cases and do not prove absence of all bugs.

## Operational handoff

Never put owner keys on the server. Operator, deployer/token admin and risk-fixture admin must be separate accounts in deployment. Use runtime secrets and disable dispatch until trusted chain/configuration, funding and confirmed mandate are reconciled. On suspected operator compromise, owner revokes and recovers available assets, then authorizes a different operator through a fresh mandate only after settlement.

Pending implementation evidence: transaction simulation and reconciliation, concurrent signer serialization, public Base Sepolia receipts, event/reorg tests, and operational release gates. ABI/client implementation and deployment artifacts are delivered separately; no public addresses or fabricated transaction hashes are included here.
