import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { BoundraClient, BoundraOperator, loadDeploymentManifest } from '@boundra/sdk';
import type { ServerDeps } from './server.js';

// Empty values from .env templates mean "not configured".
const unset = <T extends z.ZodType>(inner: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), inner.optional());

const schema = z.object({
  /** The Boundra app's origin; the API is served under /api/v1. */
  BOUNDRA_APP_URL: z.url().default('http://localhost:3000'),
  /** Owner tools: an API token the owner created in the app. Never the owner's wallet key. */
  BOUNDRA_API_TOKEN: unset(z.string().min(20).max(100)),
  /** Operator tools: the agent's own key, a reviewed manifest and a Base Sepolia RPC. */
  BOUNDRA_AGENT_PRIVATE_KEY: unset(z.string().regex(/^0x[0-9a-fA-F]{64}$/)),
  BOUNDRA_MANIFEST_PATH: unset(z.string().min(1)),
  BOUNDRA_RPC_URL: z.url().default('https://sepolia.base.org'),
});

export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): ServerDeps {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    // Names only: values may be secrets.
    throw new Error(
      `Invalid Boundra MCP configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  const config = parsed.data;
  const appUrl = config.BOUNDRA_APP_URL.replace(/\/+$/, '');
  const deps: ServerDeps = {
    appUrl,
    publicConfig: () => BoundraClient.publicConfig(appUrl),
  };
  if (config.BOUNDRA_API_TOKEN)
    deps.owner = new BoundraClient({ apiUrl: appUrl, token: config.BOUNDRA_API_TOKEN });
  if (config.BOUNDRA_AGENT_PRIVATE_KEY) {
    if (!config.BOUNDRA_MANIFEST_PATH)
      throw new Error('Invalid Boundra MCP configuration: BOUNDRA_MANIFEST_PATH');
    deps.operator = new BoundraOperator({
      rpcUrl: config.BOUNDRA_RPC_URL,
      manifest: loadDeploymentManifest(config.BOUNDRA_MANIFEST_PATH),
      account: privateKeyToAccount(config.BOUNDRA_AGENT_PRIVATE_KEY as `0x${string}`),
    });
  }
  return deps;
}
