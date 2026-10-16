import { createConfig, http, injected } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';

export function makeWagmiConfig() {
  return createConfig({
    chains: [baseSepolia],
    connectors: [injected()],
    transports: {
      [baseSepolia.id]: http(
        process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      ),
    },
    // Same as @boundra/chain: deployless Multicall3 needs no pre-deployed contract, so batched
    // reads also work on a local chain (scripts/dev-chain.mjs) exactly as on Base Sepolia.
    batch: { multicall: { deployless: true } },
    ssr: true,
  });
}
