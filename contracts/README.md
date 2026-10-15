# Contracts — Person 1

Foundry and OpenZeppelin are pinned as workspace dependencies; no global Forge installation is required.

```sh
pnpm contracts:build
pnpm contracts:test
```

Implemented: capped MockUSDC, fixed-grant/cooldown faucet, LiquidVault, 30-day TimedVault, per-owner factory/executor, bounded owner mandates, recovery and deployment script. Contract tests include negative cases, fuzzing and stateful invariants. These are controlled testnet fixtures with principal-only accounting, not real yield products or audited production custody.

Interfaces and role boundaries: [contracts](../docs/contracts.md), [security self-assessment](../docs/security.md), and [deployment](../docs/deployment.md). Generated typed ABIs are committed in `packages/chain/src/abis/`; regenerate with `pnpm --filter @boundra/chain abi:generate` after compiling changed contracts. Do not fabricate addresses; keep reviewed deployment manifests in `packages/chain/deployments/` only when actual deployments exist.

The local Foundry binary downloads the pinned Solidity compiler on first build. CI and Windows use platform-specific binaries supplied by `@foundry-rs/forge`.
