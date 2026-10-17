import { createConfig, http, injected } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';

const rpcUrl = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';

/**
 * The network as a wallet is asked to add it when it does not know chain 84532. On a local chain
 * (scripts/dev-chain.mjs) the wallet must get the local RPC: given public Base Sepolia's, it
 * would send transactions to the public network while the app reads the local one.
 */
const chain = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(rpcUrl)
  ? {
      ...baseSepolia,
      name: 'Base Sepolia (local)',
      rpcUrls: { default: { http: [rpcUrl] } },
      blockExplorers: undefined,
    }
  : baseSepolia;

export function makeWagmiConfig() {
  return createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: http(rpcUrl) },
    // Same as @boundra/chain: deployless Multicall3 needs no pre-deployed contract, so batched
    // reads also work on a local chain (scripts/dev-chain.mjs) exactly as on Base Sepolia.
    batch: { multicall: { deployless: true } },
    ssr: true,
  });
}
