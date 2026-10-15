# Typed chain integration — Person 1 handoff

## Exports

`@boundra/chain` exports six generated ABIs, `deploymentManifestSchema`, `BoundraChainReader`, `prepareAction`, `actionRequestSchema`, and typed snapshots. No address is invented or implicitly allowlisted.

Regenerate after contract changes: `pnpm contracts:build`, then `pnpm --filter @boundra/chain abi:generate`, then rebuild the package. ABI sources are committed; production builds do not need a Solidity download merely to compile TypeScript. Compare regenerated ABI changes during review.

## Trusted deployment manifest

Provide chainId 84532, factory/mockUsdc/faucet/liquidVault/timedVault/riskAdmin addresses, deploymentBlock as an integer string, and `codeHashes` for the five deployed contracts. Hashes are keccak256 of actual deployed runtime bytecode including constructor immutables. They must be reviewed against deployment artifacts/receipts, not accepted from an LLM or blindly learned from an untrusted endpoint. The schema rejects missing pins, duplicate/zero contract addresses and any address (including riskAdmin) not in EIP-55 checksummed form.

## Snapshot and candidate

1. Instantiate a read-only client with the configured trusted RPC and construct `BoundraChainReader(client, reviewedManifest, confirmations, deploymentRecheckMs)`. `createReadOnlyChainClient` batches same-block reads through Multicall3. Full deployment verification (pinned code and configuration) is reused for `deploymentRecheckMs` (default 60 s) and repeated for older blocks; pass `0` to verify on every call.
2. Call `snapshot(authenticatedOwner, registeredExecutor)`. It verifies pinned code, factory/token/vault/faucet configuration, owner registration and immutable executor addresses/chain. All data comes from one block at configured confirmation depth. A block-hash change during observation rejects the snapshot.
3. Build an action envelope containing actionId, kind DEPOSIT/WITHDRAW, mandateVersion, nonce, deadline, target and amount. Integer fields are canonical base-unit strings at the wire boundary. There is no recipient or arbitrary calldata field.
4. `prepareAction(snapshot, envelope, operatorAddress)` rejects stale observations, invalid authority/expiry/nonce/version, wrong targets, action restrictions, caps, funding, lockup, repeated allocations and unavailable withdrawals. The result fixes calldata to one of the two reviewed executor methods.
5. Worker must re-read/revalidate, simulate against current state, sign with the restricted operator and persist the signed attempt **before** broadcast. Do not interpret `prepareAction` as proof of confirmed execution.

Snapshots use bigint internally; API/evidence serialization must convert integer fields to strings. Chain action nonce is distinct from the EOA transaction nonce.

## Person 2 database/execution port

Person 1 owns the sender/monitor implementation; Person 2 owns durable storage, locks, scheduling and authenticated workflow. Persistence must provide atomic per-action/per-signer ownership, transaction-attempt save before network broadcast, lookups of ambiguous attempts, canonical event deduplication and block cursors. A retry must retain actionId and reconcile existing attempts before signing a new transaction. Until a durable implementation is supplied, sender startup must remain disabled.

Worker lifecycle/wiring belongs to Person 2. The application remains observe-only until this port, trusted deployment configuration and confirmed owner funding/authorization are integrated. No owner key belongs in backend configuration.
