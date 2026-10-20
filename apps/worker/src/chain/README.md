# Chain execution boundary

`execution.ts` implements restricted signing, simulation, persistence-before-broadcast and transaction reconciliation behind a required durable store port. `monitor.ts` implements confirmed, canonical mock-vault event ingestion and reorg/cursor recovery. See `docs/worker-chain-port.md` for the PostgreSQL and lifecycle integration contract.

These classes are not auto-wired into WorkerModule. The existing worker remains heartbeat-only until durable PostgreSQL ports, reviewed deployment/runtime credentials and PRD release gates are integrated. No owner key belongs on the server. Unit tests use test-only in-memory ports and do not claim real PostgreSQL concurrency or public-chain execution evidence.
