import { z } from 'zod';
import { getAddress } from 'viem';
import {
  addressSchema,
  hashSchema,
  BASE_SEPOLIA_CHAIN_ID,
  tokenAmountSchema,
} from '@boundra/shared';

const contractNames = ['factory', 'mockUsdc', 'faucet', 'liquidVault', 'timedVault'] as const;
export const deploymentManifestSchema = z
  .object({
    chainId: z.literal(BASE_SEPOLIA_CHAIN_ID),
    factory: addressSchema,
    mockUsdc: addressSchema,
    faucet: addressSchema,
    liquidVault: addressSchema,
    timedVault: addressSchema,
    riskAdmin: addressSchema,
    deploymentBlock: tokenAmountSchema,
    codeHashes: z
      .object({
        factory: hashSchema,
        mockUsdc: hashSchema,
        faucet: hashSchema,
        liquidVault: hashSchema,
        timedVault: hashSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const addresses = contractNames.map((name) => manifest[name].toLowerCase());
    if (
      addresses.some((address) => /^0x0{40}$/.test(address)) ||
      new Set(addresses).size !== addresses.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Deployment requires distinct nonzero contract addresses',
      });
    }
    if (/^0x0{40}$/i.test(manifest.riskAdmin))
      context.addIssue({ code: 'custom', message: 'Risk admin required' });
    for (const name of contractNames) {
      try {
        getAddress(manifest[name]);
      } catch {
        context.addIssue({ code: 'custom', path: [name], message: 'Invalid address checksum' });
      }
    }
  });

export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;
