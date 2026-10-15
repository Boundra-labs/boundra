# Person 1 — Local implementation and handoff

## Completed in separate commits

| Commit    | Deliverable                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `70cc3f2` | LiquidVault and TimedVault, principal/lockup/risk-capacity tests                                       |
| `ab5d2c0` | Factory and bounded owner executor, funding, mandates, pause/revoke/recovery                           |
| `aae7123` | Authority negative tests, stateful asset/budget invariants, security self-assessment                   |
| `b9faa14` | Capped/cooldown faucet and testnet-only deployment script                                              |
| `afabb65` | Six typed ABIs, pinned deployment reader, one-block snapshots, deterministic action preparation        |
| `d305760` | Preserve literal ABI method types for typed simulation                                                 |
| `2d7ffbb` | Durable-store execution port, restricted signing, canonical receipts and identical-byte crash recovery |
| `1e8d828` | Confirmed risk-event monitor, deduplication, cursor/reorg recovery and port documentation              |

`pnpm check` passed: lint, workspace typecheck, unit/fuzz/invariant tests and production builds. Current suites: 31 Foundry tests (including two stateful invariants, each 128 runs/4,096 calls), 8 chain tests, 9 worker-chain tests, 8 shared-schema tests and 4 API tests. These are local results, not public-chain performance or an independent audit. Worker store/RPC tests use fixtures; real PostgreSQL concurrency is a separate integration gate.

## Person 2 handoff

Implement PostgreSQL `ExecutionStore` and `MonitorStore` exactly as specified in [worker-chain-port.md](./worker-chain-port.md), add real concurrent-worker/restart tests, then wire lifecycle/jobs into WorkerModule. Use the canonical contract mandate tuple and typed action envelopes documented in [contracts.md](./contracts.md) and [chain-integration.md](./chain-integration.md). Do not create a second transaction sender or silently broaden mandate fields.

The existing heartbeat worker remains observe-only; value movement is not auto-enabled by these commits. No production in-memory store is provided. Unknown nonce/receipt outcomes stay RECONCILE; exhausted retries and external replacements require explicit investigation. Automatic fee replacement is not implemented.

## Person 3 handoff

Use generated ABIs for owner factory/mandate/funding/revoke/recovery transactions. Mandate default expiry is seven days; a timed deposit requires owner-reviewed expiry greater than actual deposit + 30 days + one-day buffer. Preview must explain that one cap-limited partial deposit completes allocation and leaves residual funds idle. Withdrawals pay owner directly. Integrate UI against Person 2's authenticated API; login is not mandate approval.

## Remaining Person 1 public-chain evidence

- Provision project deployer and restricted operator runtime configuration plus testnet gas. At local verification, neither key was configured in the project's `.env`; no key values were printed or stored in Git.
- Deploy on Base Sepolia after reviewing simulation; keep risk admin separate from deployer/operator.
- Export and review actual manifest addresses/runtime hashes and public receipts.
- Run real agent deposit, risk response and denied-call evidence after durable-store integration.
- Complete end-to-end recovery/reorg/concurrency evidence with Person 2. Local unit tests are not substituted for it.

See [deployment.md](./deployment.md) for the explicit script and verification steps. No public deployment, real yield, full MVP completion or production custody readiness is claimed.
