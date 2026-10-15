import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const addressList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().regex(/^0x[0-9a-f]{40}$/)));

// Empty values from .env templates mean "not configured".
const unset = <T extends z.ZodType>(inner: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), inner.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:/.test(value)),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  CHAIN_ID: z.coerce.number().pipe(z.literal(84532)).default(84532),
  WORKER_HEARTBEAT_MAX_AGE_MS: z.coerce.number().int().min(1000).default(45000),
  // Authentication (PRD §10.1). The secret derives CSRF tokens and must stay server-side.
  SESSION_SECRET: unset(z.string().min(32)),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  ADMIN_ADDRESSES: addressList,
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  // Chain access is read-only in the API; the operator key lives only in the worker.
  BASE_SEPOLIA_RPC_URL: z.url().default('https://sepolia.base.org'),
  DEPLOYMENT_MANIFEST_PATH: unset(z.string().min(1)),
  CHAIN_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(5),
  OPERATOR_ADDRESS: unset(
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .transform((value) => value.toLowerCase()),
  ),
});

export type AppConfig = z.infer<typeof schema> & { SESSION_SECRET: string };
export const APP_CONFIG = Symbol('APP_CONFIG');

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid API configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  const config = result.data;
  if (!config.SESSION_SECRET) {
    if (config.NODE_ENV === 'production')
      throw new Error('Invalid API configuration: SESSION_SECRET');
    // Development/test only: a per-process secret, so sessions end on restart. Run `pnpm env:setup`.
    config.SESSION_SECRET = randomBytes(32).toString('base64url');
  }
  return config as AppConfig;
}
