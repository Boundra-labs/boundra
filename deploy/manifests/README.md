# Deployment manifests

Reviewed deployment manifests for the Docker stack. This folder is mounted read-only at
`/config/manifests` in the API and worker; select one with
`DEPLOYMENT_MANIFEST_PATH=/config/manifests/<file>.json` in `deploy/.env`.

A manifest lists public contract addresses, the risk admin, the deployment block and the pinned
runtime code hashes (`packages/chain/src/manifest.ts`). It holds no secrets, so the reviewed Base
Sepolia manifest belongs in git here once Person 1 publishes it. Check every address and code
hash against the deployment receipts before committing; never take them from an LLM or an
unreviewed endpoint (`docs/chain-integration.md`).
