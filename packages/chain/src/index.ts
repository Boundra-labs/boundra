import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { z } from 'zod';
import { addressSchema, BASE_SEPOLIA_CHAIN_ID } from '@boundra/shared';

export { baseSepolia };

export const deploymentManifestSchema = z
  .object({
    chainId: z.literal(BASE_SEPOLIA_CHAIN_ID),
    factory: addressSchema,
    mockUsdc: addressSchema,
    liquidVault: addressSchema,
    timedVault: addressSchema,
    deploymentBlock: z.string().regex(/^\d+$/),
  })
  .strict();

export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;

// Read-only until Person 1 provides reviewed contracts and deployment evidence.
export function createReadOnlyChainClient(rpcUrl: string) {
  const url = new URL(rpcUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported RPC protocol');
  return createPublicClient({
    chain: baseSepolia,
    transport: http(url.toString(), { timeout: 10_000, retryCount: 2 }),
  });
}
