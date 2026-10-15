# Contracts — Person 1

Foundry and OpenZeppelin are pinned as workspace dependencies; no global Forge installation is required.

```sh
pnpm contracts:build
pnpm contracts:test
```

The scaffold implements a capped, owner-minted **test token only**. Factory, executor, mock vaults, faucet, mandates and deployment scripts remain assigned work. Do not deploy a placeholder executor or fabricate addresses. Keep reviewed deployment manifests in `packages/chain/deployments/` when actual deployments exist.

The local Foundry binary downloads the pinned Solidity compiler on first build. CI and Windows use platform-specific binaries supplied by `@foundry-rs/forge`.
