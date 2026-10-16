import { z } from 'zod';

// Empty values from .env templates mean "not configured".
const unset = <T extends z.ZodType>(inner: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), inner.optional());
const positiveBigint = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform((value) => BigInt(value));

const schema = z.object({
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:/.test(value)),
  CHAIN_ID: z.coerce.number().pipe(z.literal(84532)).default(84532),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  WORKER_HEARTBEAT_MAX_AGE_MS: z.coerce.number().int().min(1000).default(45000),
  BASE_SEPOLIA_RPC_URL: z.url().default('https://sepolia.base.org'),
  DEPLOYMENT_MANIFEST_PATH: unset(z.string().min(1)),
  CHAIN_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(5),
  // Keep terminal receipts under reconciliation for at least the PRD's 20-block overlap.
  RECEIPT_REORG_WINDOW_BLOCKS: z.coerce.number().int().min(20).max(10000).default(20),
  // Signing is opt-in. The operator key is read only here and never logged.
  EXECUTION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  OPERATOR_PRIVATE_KEY: unset(z.string().regex(/^0x[0-9a-fA-F]{64}$/)),
  ATTEMPT_ENCRYPTION_KEY: unset(z.string().regex(/^[0-9a-fA-F]{64}$/)),
  MAX_GAS: unset(positiveBigint),
  MAX_FEE_PER_GAS_WEI: unset(positiveBigint),
  MAX_PRIORITY_FEE_PER_GAS_WEI: unset(positiveBigint),
  ACTION_DEADLINE_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
});

export type WorkerConfig = z.infer<typeof schema>;

export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid worker configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return result.data;
}
