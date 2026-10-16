import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  BoundraChainReader,
  createReadOnlyChainClient,
  loadDeploymentManifest,
} from '@boundra/chain';
import type { ExecutionLimits } from '../chain/execution';
import type { WorkerConfig } from '../config';

/**
 * observe_only: heartbeat only (no trusted deployment).
 * monitor_only: reads chain, verifies authorizations, records decisions; never signs.
 * execute: additionally signs bounded operator transactions.
 */
export type WorkerMode = 'observe_only' | 'monitor_only' | 'execute';

export interface Activation {
  mode: WorkerMode;
  reasons: string[];
  reader?: BoundraChainReader;
  operator?: PrivateKeyAccount;
  limits?: ExecutionLimits;
}

/** Activation gate (docs/worker-chain-port.md): every check must pass before signing is allowed. */
export async function activate(
  config: WorkerConfig,
  makeReader: (config: WorkerConfig) => BoundraChainReader = defaultReader,
): Promise<Activation> {
  if (!config.DEPLOYMENT_MANIFEST_PATH)
    return { mode: 'observe_only', reasons: ['DEPLOYMENT_MANIFEST_PATH not configured'] };
  const reader = makeReader(config);
  const head = await reader.client.getBlockNumber({ cacheTime: 0 });
  // Pinned code, decimals, vault and faucet configuration at a confirmed block.
  await reader.verifyDeployment(head - BigInt(config.CHAIN_CONFIRMATIONS - 1));
  const reasons: string[] = [];
  if (!config.EXECUTION_ENABLED) reasons.push('EXECUTION_ENABLED is false');
  if (!config.OPERATOR_PRIVATE_KEY) reasons.push('OPERATOR_PRIVATE_KEY missing');
  if (!config.ATTEMPT_ENCRYPTION_KEY) reasons.push('ATTEMPT_ENCRYPTION_KEY missing');
  if (!config.MAX_GAS || !config.MAX_FEE_PER_GAS_WEI || !config.MAX_PRIORITY_FEE_PER_GAS_WEI)
    reasons.push('gas/fee limits missing');
  const operator = config.OPERATOR_PRIVATE_KEY
    ? privateKeyToAccount(config.OPERATOR_PRIVATE_KEY as `0x${string}`)
    : undefined;
  if (operator && operator.address.toLowerCase() === reader.manifest.riskAdmin.toLowerCase())
    reasons.push('operator must not be the risk admin');
  if (reasons.length > 0) return { mode: 'monitor_only', reasons, reader };
  return {
    mode: 'execute',
    reasons: [],
    reader,
    operator,
    limits: {
      maxGas: config.MAX_GAS!,
      maxFeePerGas: config.MAX_FEE_PER_GAS_WEI!,
      maxPriorityFeePerGas: config.MAX_PRIORITY_FEE_PER_GAS_WEI!,
    },
  };
}

function defaultReader(config: WorkerConfig) {
  return new BoundraChainReader(
    createReadOnlyChainClient(config.BASE_SEPOLIA_RPC_URL),
    loadDeploymentManifest(config.DEPLOYMENT_MANIFEST_PATH!),
    config.CHAIN_CONFIRMATIONS,
  );
}
