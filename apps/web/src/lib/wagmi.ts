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
    ssr: true,
  });
}
