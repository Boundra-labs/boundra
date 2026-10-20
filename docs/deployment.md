# Testnet deployment

## Prerequisites

Build/test contracts first. Provision a funded testnet deployer and a **different** public risk-admin address. Provision the operator key separately in the worker environment; it must not be the deployer or risk-admin account. Owner keys stay in user wallets.

`contracts/script/DeployBoundra.s.sol` reads `DEPLOYER_PRIVATE_KEY` from the runtime environment, not from command arguments or a committed file. It rejects networks other than Base Sepolia (84532) and local development (31337). Do not use a public Anvil example key on Base Sepolia.

From `contracts/`, with the required environment variables set:

```sh
pnpm exec forge script script/DeployBoundra.s.sol:DeployBoundra --sig 'run(address)' YOUR_RISK_ADMIN_ADDRESS --rpc-url YOUR_BASE_SEPOLIA_RPC_URL
# Review simulation first, then use the same command with --broadcast.
```

Use shell-appropriate quoting for `run(address)` (double quotes work in PowerShell). Keep provider keys out of copied terminal transcripts. The script creates token, faucet, two vaults and factory, then transfers token ownership to the faucet; no operator or user mandate is silently granted.

## Evidence and verification

- Record actual deployment transaction receipts, block number, chain ID, addresses and deployed runtime code hashes from reviewed artifacts.
- Publish the resulting manifest only after checking token decimals, vault assets/lockups/admin, factory configuration and token faucet ownership.
- Owner calls factory `createExecutor()`, claims MockUSDC, approves exact funding, sets mandate and funds its executor. Only then may the separately configured operator execute a typed action.
- Demonstrate LiquidVault deposit and a DEGRADED event with enough remaining capacity for withdrawal. Confirm owner received principal and record public explorer links.
- Verify a reverted excess/expired/unknown-target call separately. Reverts are evidence of rejection, not successful management transactions.
- `contracts/broadcast/` is ignored because local broadcast artifacts can contain sensitive operational details. Export only the reviewed public manifest/receipt evidence into the repository.

## Faucet behavior

`MockUSDCFaucet.claim()` grants exactly 1,000 MockUSDC to the calling address once every 24 hours. The token's fixed 1,000,000 MockUSDC global supply cap is enforced independently. Backend may add IP/session rate limits, but must not claim those prevent direct contract calls or Sybil addresses. Global supply exhaustion produces a failure and does not consume a claimant's cooldown. There is no owner-key faucet service or unlimited mint endpoint.

No public deployment is claimed until these steps are executed with real testnet receipts. Runtime credentials, testnet gas and hosting remain external configuration dependencies.
